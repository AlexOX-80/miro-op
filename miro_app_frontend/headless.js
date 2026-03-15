const CARD_WIDTH = 320;
const LANE_WIDTH = 360;
const FRAME_PADDING_X = 40;

const LANE_CONFIGS = [
  {
    id: "sprint-backlog",
    label: "Sprint Backlog",
    statuses: ["Offen", "Neu", "priorisiert", "Ready"],
  },
  {
    id: "refinement",
    label: "refinement noetig",
    statuses: ["Abklaeren", "Abklären"],
  },
  {
    id: "blocked",
    label: "Geblockt",
    statuses: ["Geblockt"],
  },
  {
    id: "in-work",
    label: "in Arbeit",
    statuses: ["in Arbeit"],
  },
  {
    id: "test",
    label: "im Test",
    statuses: ["Testbereit TEST", "Im Test", "Testbereit PROD"],
  },
  {
    id: "closed",
    label: "geschlossen",
    statuses: ["Geschlossen", "Abgelehnt"],
  },
];

const SYNC_ERROR_FIELD_VALUE = "Sync-Fehler";

let appConfig = null;
let currentBoardId = "";

function normalizeStatus(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function laneConfigForStatus(statusName) {
  const normalized = normalizeStatus(statusName);
  return (
    LANE_CONFIGS.find((lane) =>
      lane.statuses.some((candidate) => normalizeStatus(candidate) === normalized)
    ) || null
  );
}

function readStoryIdFromDescription(description) {
  if (typeof description !== "string") {
    return null;
  }
  for (const line of description.split("\n")) {
    if (line.startsWith("OpenProject ID:")) {
      const value = line.slice("OpenProject ID:".length).trim();
      if (/^\d+$/.test(value)) {
        return Number(value);
      }
    }
  }
  return null;
}

function errorMessageFromPayload(payload) {
  if (!payload) {
    return "Unbekannter Fehler.";
  }
  if (typeof payload === "string") {
    return payload;
  }
  return payload.message || payload.error || JSON.stringify(payload);
}

function normalizeDialogChoiceResult(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  const candidates = [value.value, value.result, value.selected, value.statusName, value.choice];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

function getOauthToken() {
  try {
    return window.localStorage.getItem("miro_oauth_token") || "";
  } catch {
    return "";
  }
}

async function appFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getOauthToken();
  if (token) {
    headers.set("X-Miro-OAuth-Token", token);
  }
  return fetch(url, { ...options, headers });
}

async function fetchConfig() {
  const response = await appFetch("/api/config");
  if (!response.ok) {
    throw new Error("Konfiguration konnte nicht geladen werden.");
  }
  return response.json();
}

async function resolveCurrentBoardId() {
  if (currentBoardId) {
    return currentBoardId;
  }
  if (typeof miro?.board?.getInfo === "function") {
    const info = await miro.board.getInfo();
    currentBoardId = String(info?.id || "").trim();
  }
  if (!currentBoardId && miro?.board?.info?.id) {
    currentBoardId = String(miro.board.info.id).trim();
  }
  if (!currentBoardId) {
    throw new Error("Aktuelle Miro-Board-ID konnte nicht ermittelt werden.");
  }
  return currentBoardId;
}

async function fetchJson(url, options = {}) {
  const response = await appFetch(url, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${url}`);
  }
  return response.json();
}

async function fetchCardConnection(appCardId, fallbackWorkPackageId = null) {
  const boardId = await resolveCurrentBoardId();
  const query = new URLSearchParams({ board_id: boardId });
  if (fallbackWorkPackageId) {
    query.set("work_package_id", String(fallbackWorkPackageId));
  }
  return fetchJson(`/api/app-cards/${encodeURIComponent(appCardId)}?${query.toString()}`);
}

async function patchCardStatus(appCardId, statusName, fallbackWorkPackageId = null) {
  const boardId = await resolveCurrentBoardId();
  const query = new URLSearchParams({ board_id: boardId, action: "status" });
  if (fallbackWorkPackageId) {
    query.set("work_package_id", String(fallbackWorkPackageId));
  }
  const response = await appFetch(`/api/app-cards/${encodeURIComponent(appCardId)}/refresh?${query.toString()}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ statusName }),
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text || "Unbekannter Fehler." };
  }
  if (!response.ok) {
    throw new Error(errorMessageFromPayload(payload));
  }
  return payload;
}

async function showDialog(kind, title, message, options = []) {
  const modal = await miro.board.ui.openModal({
    url: `${appConfig.appPublicUrl}/dialog.html?kind=${encodeURIComponent(kind)}`,
    width: kind === "choice" ? 480 : 440,
    data: {
      kind,
      title,
      message,
      options,
    },
  });
  const result = await modal.waitForClose();
  return kind === "choice" ? normalizeDialogChoiceResult(result) : result;
}

async function showErrorDialog(message) {
  return showDialog("error", "OpenProject-Fehler", String(message || "Unbekannter Fehler."));
}

async function chooseStatusDialog(lane, matchingCandidates) {
  return showDialog(
    "choice",
    "OpenProject-Status waehlen",
    `Fuer die Spalte "${lane.label}" gibt es mehrere moegliche OpenProject-Statuswerte.`,
    matchingCandidates
  );
}

function laneForCardPosition(card, frame) {
  const frameLeft = frame.x - frame.width / 2;
  const candidates = [
    {
      x: card.x,
    },
    {
      x: card.x - frameLeft,
    },
  ];

  for (const candidate of candidates) {
    const relativeX = candidate.x - FRAME_PADDING_X;
    const laneIndex = Math.floor(relativeX / LANE_WIDTH);
    if (laneIndex >= 0 && laneIndex < LANE_CONFIGS.length) {
      return LANE_CONFIGS[laneIndex];
    }
  }
  return null;
}

function withoutSyncErrorField(fields) {
  return (Array.isArray(fields) ? fields : []).filter(
    (field) => String(field?.value || "") !== SYNC_ERROR_FIELD_VALUE
  );
}

async function setCardSyncError(appCardId, message) {
  const boardCard = await miro.board.getById(appCardId);
  if (!boardCard) {
    return;
  }
  const fields = withoutSyncErrorField(boardCard.fields);
  fields.unshift({
    value: SYNC_ERROR_FIELD_VALUE,
    fillColor: "#ffe3e3",
    textColor: "#9c2c2c",
    tooltip: String(message || "Statuswechsel fehlgeschlagen."),
  });
  boardCard.fields = fields.slice(0, 20);
  await boardCard.sync();
}

function applyConnectedCardPayload(boardCard, payload) {
  const appCardData = payload?.appCard?.data || {};
  if (appCardData.title) {
    boardCard.title = appCardData.title;
  }
  if (typeof appCardData.description === "string") {
    boardCard.description = appCardData.description;
  }
  const nextFields = withoutSyncErrorField(appCardData.fields || boardCard.fields || []);
  if (Array.isArray(nextFields)) {
    boardCard.fields = nextFields;
  }
  boardCard.status = "connected";
  return boardCard.sync();
}

async function resolveTargetStatus(lane, allowedStatuses) {
  const allowedNormalized = new Set((allowedStatuses || []).map(normalizeStatus));
  const matchingCandidates = lane.statuses.filter(
    (candidate) => allowedNormalized.size === 0 || allowedNormalized.has(normalizeStatus(candidate))
  );

  if (matchingCandidates.length === 0) {
    throw new Error(
      `OpenProject erlaubt keinen Wechsel in die Spalte "${lane.label}". Erlaubt sind: ${
        allowedStatuses.length ? allowedStatuses.join(", ") : "keine"
      }.`
    );
  }

  if (matchingCandidates.length === 1) {
    return matchingCandidates[0];
  }

  return chooseStatusDialog(lane, matchingCandidates);
}

async function syncStatusFromPosition(appCardId) {
  const boardCard = await miro.board.getById(appCardId);
  if (!boardCard || boardCard.type !== "app_card") {
    throw new Error("Die Auswahl ist keine App Card.");
  }
  if (boardCard.status !== "connected") {
    throw new Error("Diese Karte ist noch nicht mit einer OpenProject-Story verbunden.");
  }

  const parentId = boardCard.parentId || boardCard.parent?.id;
  if (!parentId) {
    throw new Error("Die Karte liegt nicht in einem Versions-Frame.");
  }

  const frame = await miro.board.getById(parentId);
  if (!frame || frame.type !== "frame") {
    throw new Error("Der Parent der Karte ist kein gueltiger Frame.");
  }

  const lane = laneForCardPosition(boardCard, frame);
  if (!lane) {
    throw new Error("Aus der aktuellen Kartenposition konnte keine Lane ermittelt werden.");
  }

  const fallbackWorkPackageId = readStoryIdFromDescription(boardCard.description);
  const connection = await fetchCardConnection(appCardId, fallbackWorkPackageId);
  const currentStatus = connection?.story?.statusName || "";
  const currentLane = laneConfigForStatus(currentStatus);
  if (currentLane && currentLane.id === lane.id) {
    return;
  }

  const targetStatus = await resolveTargetStatus(lane, connection.allowedStatusTransitions || []);
  if (!targetStatus) {
    return;
  }

  const payload = await patchCardStatus(appCardId, targetStatus, fallbackWorkPackageId);
  await applyConnectedCardPayload(boardCard, payload);
}

function pickAppCardFromActionEvent(event) {
  if (event?.appCard?.id) {
    return String(event.appCard.id);
  }
  const items = Array.isArray(event?.items) ? event.items : Array.isArray(event) ? event : [];
  const appCard = items.find((item) => item?.type === "app_card" && item?.id);
  return appCard ? String(appCard.id) : "";
}

async function handleSyncStatusAction(event) {
  const appCardId = pickAppCardFromActionEvent(event);
  if (!appCardId) {
    return;
  }

  try {
    await syncStatusFromPosition(appCardId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setCardSyncError(appCardId, message);
    await showErrorDialog(message);
  }
}

async function registerCustomActions() {
  if (!miro?.board?.experimental?.action?.register) {
    return;
  }
  miro.board.ui.on("custom:sync-status-from-position", handleSyncStatusAction);
  try {
    await miro.board.experimental.action.register({
      event: "sync-status-from-position",
      scope: "local",
      contexts: {
        item: {},
      },
      predicate: {
        type: "app_card",
      },
      ui: {
        label: {
          en: "Sync status from lane",
          de: "Status aus Position uebernehmen",
        },
        description: {
          en: "Apply an OpenProject status based on the current card lane.",
          de: "OpenProject-Status passend zur aktuellen Kartenposition setzen.",
        },
        icon: "chat-two",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("already")) {
      throw error;
    }
  }
}

async function registerAppEvents() {
  miro.board.ui.on("icon:click", async () => {
    await miro.board.ui.openPanel({ url: `${appConfig.appPublicUrl}/panel.html` });
  });

  miro.board.ui.on("app_card:connect", async (event) => {
    const url = `${appConfig.appPublicUrl}/connect.html?appCardId=${encodeURIComponent(event.appCard.id)}`;
    await miro.board.ui.openModal({ url, width: 620 });
  });

  miro.board.ui.on("app_card:open", async (event) => {
    const url = `${appConfig.appPublicUrl}/modal.html?appCardId=${encodeURIComponent(event.appCard.id)}`;
    await miro.board.ui.openPanel({ url });
  });
}

async function bootstrap() {
  appConfig = await fetchConfig();
  await resolveCurrentBoardId();
  await registerAppEvents();
  await registerCustomActions();
}

bootstrap().catch((error) => {
  console.error(error);
});

const statusNode = document.querySelector("#status");
const createButton = document.querySelector("#create-disconnected");
const refreshAllCardsButton = document.querySelector("#refresh-all-cards");
const createVersionButton = document.querySelector("#create-version-board");
const reloadVersionsButton = document.querySelector("#reload-versions");
const versionSelectNode = document.querySelector("#version-select");
const authButton = document.querySelector("#auth-button");
const choiceButton = document.querySelector("#choice-button");
const statusActionsNode = document.querySelector("#status-actions");
const debugToggleButton = document.querySelector("#toggle-debug");

const CARD_WIDTH = 320;
const CARD_HEIGHT = 180;
const LANE_WIDTH = 360;
const CARD_VERTICAL_GAP = 44;
const FRAME_PADDING_X = 40;
const FRAME_PADDING_Y = 48;
const FRAME_TITLE_SPACE = 84;
const LANE_HEADER_HEIGHT = 44;
const LANE_INNER_PADDING_Y = 18;
const LANE_CAPACITY_BUFFER_ROWS = 2;
const SYNC_INCONSISTENT_FIELD_VALUE = "Status-Sync inkonsistent";

const LANE_CONFIGS = [
  {
    id: "sprint-backlog",
    label: "Sprint Backlog",
    statuses: ["Offen", "Neu", "priorisiert", "Ready"],
    fillColor: "#f2f4fc",
  },
  {
    id: "refinement",
    label: "refinement nötig",
    statuses: ["Abklären"],
    fillColor: "#fff9e3",
  },
  {
    id: "blocked",
    label: "Geblockt",
    statuses: ["Geblockt"],
    fillColor: "#ffe3e3",
  },
  {
    id: "in-work",
    label: "in Arbeit",
    statuses: ["in Arbeit"],
    fillColor: "#fff9e3",
  },
  {
    id: "test",
    label: "im Test",
    statuses: ["Testbereit TEST", "Im Test", "Testbereit PROD"],
    fillColor: "#e7f5ff",
  },
  {
    id: "closed",
    label: "geschlossen",
    statuses: ["Geschlossen", "Abgelehnt"],
    fillColor: "#eaf6e6",
  },
];

let currentBoardId = "";
let appConfig = null;
const moveSyncByCardId = new Map();
const suppressStatusSyncUntilByCardId = new Map();
const statusChoiceModalOpenByCardId = new Set();
let debugEnabled = false;
const debugLines = [];
let pendingStatusChoice = null;

function setStatus(message) {
  statusNode.textContent = message || "";
}

function refreshStatusActionsVisibility() {
  const hasVisibleAction =
    (authButton && !authButton.hidden) ||
    (choiceButton && !choiceButton.hidden);
  statusActionsNode.hidden = !hasVisibleAction;
}

function setAuthButtonVisible(visible) {
  if (!authButton) {
    return;
  }
  authButton.hidden = !visible;
  refreshStatusActionsVisibility();
}

function clearPendingStatusChoice() {
  pendingStatusChoice = null;
  if (choiceButton) {
    choiceButton.hidden = true;
  }
  refreshStatusActionsVisibility();
}

function setPendingStatusChoice(choice) {
  pendingStatusChoice = choice;
  if (choice?.appCardId) {
    suppressStatusSyncUntilByCardId.set(String(choice.appCardId), Date.now() + 4000);
  }
  if (choiceButton) {
    choiceButton.hidden = false;
  }
  refreshStatusActionsVisibility();
}

function setDebugState(enabled) {
  debugEnabled = Boolean(enabled);
  debugLines.length = 0;
  if (debugToggleButton) {
    debugToggleButton.textContent = debugEnabled ? "Debug an" : "Debug aus";
  }
}

function debugStatus(message) {
  if (!debugEnabled) {
    return;
  }
  debugLines.push(String(message));
  while (debugLines.length > 10) {
    debugLines.shift();
  }
  setStatus(debugLines.map((line) => `[DEBUG] ${line}`).join("\n"));
}

function clearStatus() {
  statusNode.textContent = "";
  clearPendingStatusChoice();
  setAuthButtonVisible(false);
}

function clearOauthStatusIfPresent() {
  const text = statusNode.textContent || "";
  if (
    text.includes("Miro OAuth fehlt noch") ||
    text.includes("OAuth-Fenster wird geoeffnet") ||
    text.includes("OAuth wurde nicht abgeschlossen")
  ) {
    clearStatus();
  } else {
    setAuthButtonVisible(false);
  }
}

function getOauthToken() {
  try {
    return window.localStorage.getItem("miro_oauth_token") || "";
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

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

function getUnmappedStatuses(statuses) {
  return (statuses || []).filter((status) => !laneConfigForStatus(status));
}

function laneConfigById(laneId) {
  return LANE_CONFIGS.find((lane) => lane.id === laneId) || null;
}

function laneIndexById(laneId) {
  return LANE_CONFIGS.findIndex((lane) => lane.id === laneId);
}

function laneFillColor(laneId) {
  return laneConfigById(laneId)?.fillColor || "#f6f7f9";
}

function laneHeaderContent(lane) {
  const statuses = lane.statuses.map((status) => escapeHtml(status)).join(" · ");
  return `<p><strong>${escapeHtml(lane.label)}</strong></p><p><small>${statuses}</small></p>`;
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

function withoutSyncStateFields(fields) {
  return (Array.isArray(fields) ? fields : []).filter((field) => {
    const value = String(field?.value || "");
    return value !== SYNC_INCONSISTENT_FIELD_VALUE && value !== "Sync-Fehler";
  });
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

async function showErrorDialog(message) {
  const text = String(message || "Unbekannter Fehler.");
  setStatus(text);
  if (!appConfig) {
    return Promise.resolve();
  }
  try {
    const modal = await miro.board.ui.openModal({
      url: `${appConfig.appPublicUrl}/dialog.html?kind=error`,
      width: 440,
      data: {
        kind: "error",
        title: "OpenProject-Fehler",
        message: text,
      },
    });
    return modal.waitForClose();
  } catch (error) {
    const modalError = error instanceof Error ? error.message : String(error);
    debugStatus(`Fehlerdialog konnte nicht geoeffnet werden: ${modalError}`);
    return null;
  }
}

async function chooseStatusDialog(lane, matchingCandidates, appCardId = "") {
  if (!appConfig) {
    return matchingCandidates[0] || null;
  }
  const key = String(appCardId || "");
  if (key) {
    statusChoiceModalOpenByCardId.add(key);
  }
  try {
    const modal = await miro.board.ui.openModal({
      url: `${appConfig.appPublicUrl}/dialog.html?kind=choice`,
      width: 480,
      data: {
        kind: "choice",
        title: "OpenProject-Status waehlen",
        message: `Fuer die Spalte "${lane.label}" gibt es mehrere moegliche OpenProject-Statuswerte.`,
        options: matchingCandidates,
      },
    });
    const result = await modal.waitForClose();
    if (key && result) {
      suppressStatusSyncUntilByCardId.set(key, Date.now() + 4000);
    }
    return normalizeDialogChoiceResult(result);
  } finally {
    if (key) {
      statusChoiceModalOpenByCardId.delete(key);
    }
  }
}

async function openPendingStatusChoiceDialog() {
  if (!pendingStatusChoice) {
    return null;
  }
  const { lane, matchingCandidates, appCardId } = pendingStatusChoice;
  const result = await chooseStatusDialog(lane, matchingCandidates, appCardId);
  return result;
}

async function applyStatusChange(appCardId, targetStatus, fallbackWorkPackageId = null) {
  const boardCard = await miro.board.getById(appCardId);
  const payload = await patchCardStatus(appCardId, targetStatus, fallbackWorkPackageId);
  if (boardCard) {
    await applyConnectedCardPayload(boardCard, payload);
  }
  suppressStatusSyncUntilByCardId.set(String(appCardId), Date.now() + 4000);
  clearPendingStatusChoice();
  setStatus(`OpenProject-Status fuer Karte ${appCardId} auf "${targetStatus}" aktualisiert.`);
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

async function fetchOauthStatus(config, boardId) {
  const response = await appFetch(`${config.oauthStatusUrl}?board_id=${encodeURIComponent(boardId)}`);
  if (!response.ok) {
    throw new Error("OAuth-Status konnte nicht geladen werden.");
  }
  return response.json();
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
  debugStatus(`Lade Verbindung fuer Card ${appCardId} auf Board ${boardId}.`);
  return fetchJson(`/api/app-cards/${encodeURIComponent(appCardId)}?${query.toString()}`);
}

async function patchCardStatus(appCardId, statusName, fallbackWorkPackageId = null) {
  const boardId = await resolveCurrentBoardId();
  const query = new URLSearchParams({ board_id: boardId, action: "status" });
  if (fallbackWorkPackageId) {
    query.set("work_package_id", String(fallbackWorkPackageId));
  }
  debugStatus(`Sende Statuswechsel fuer Card ${appCardId} nach "${statusName}".`);
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

function applyConnectedCardPayload(boardCard, payload) {
  const appCardData = payload?.appCard?.data || {};
  if (appCardData.title) {
    boardCard.title = appCardData.title;
  }
  if (typeof appCardData.description === "string") {
    boardCard.description = appCardData.description;
  }
  if (Array.isArray(appCardData.fields)) {
    boardCard.fields = withoutSyncStateFields(appCardData.fields);
  }
  boardCard.status = "connected";
  return boardCard.sync();
}

async function syncCardConsistency(boardCard, payload = null) {
  if (!boardCard || boardCard.type !== "app_card" || boardCard.status !== "connected") {
    return false;
  }
  const parentId = boardCard.parentId || boardCard.parent?.id;
  if (!parentId) {
    return false;
  }
  const frame = await miro.board.getById(parentId);
  if (!frame || frame.type !== "frame") {
    return false;
  }
  const laneMatch = laneForCardPosition(boardCard, frame);
  if (!laneMatch) {
    return false;
  }
  const lane = laneMatch.lane;
  const storyStatus = payload?.story?.statusName || "";
  const statusLane = laneConfigForStatus(storyStatus);
  const fields = withoutSyncStateFields(boardCard.fields);
  let inconsistent = false;
  if (statusLane && statusLane.id !== lane.id) {
    inconsistent = true;
    fields.unshift({
      value: SYNC_INCONSISTENT_FIELD_VALUE,
      fillColor: "#fff3bf",
      textColor: "#7a5a00",
      tooltip: `OpenProject Status "${storyStatus}" passt nicht zur aktuellen Spalte "${lane.label}". Bitte Karte manuell verschieben und danach den Status uebernehmen.`,
    });
  }
  boardCard.fields = fields.slice(0, 20);
  await boardCard.sync();
  return inconsistent;
}

function buildStoriesByLane(stories) {
  const storiesByLaneId = new Map(LANE_CONFIGS.map((lane) => [lane.id, []]));
  const unmappedStatuses = new Set();

  for (const story of stories) {
    const lane = laneConfigForStatus(story.statusName);
    if (!lane) {
      unmappedStatuses.add(story.statusName || "Ohne Status");
      continue;
    }
    storiesByLaneId.get(lane.id).push(story);
  }

  return { storiesByLaneId, unmappedStatuses: Array.from(unmappedStatuses).sort((a, b) => a.localeCompare(b, "de")) };
}

function laneForCardPosition(card, frame) {
  const frameLeft = frame.x - frame.width / 2;
  const candidates = [
    {
      source: "parent_top_left",
      x: card.x,
    },
    {
      source: "canvas_center",
      x: card.x - frameLeft,
    },
  ];

  for (const candidate of candidates) {
    const relativeX = candidate.x - FRAME_PADDING_X;
    const laneIndex = Math.floor(relativeX / LANE_WIDTH);
    if (laneIndex >= 0 && laneIndex < LANE_CONFIGS.length) {
      return {
        lane: LANE_CONFIGS[laneIndex],
        source: candidate.source,
        relativeX,
        laneIndex,
      };
    }
  }
  return null;
}

async function promptForTargetStatus(lane, allowedStatuses, deferredChoice = null) {
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
  const deferredCardId = String(deferredChoice?.appCardId || "");
  try {
    return await chooseStatusDialog(lane, matchingCandidates, deferredCardId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("There is already a modal open")) {
      setPendingStatusChoice({ lane, matchingCandidates, ...deferredChoice });
      setStatus(
        `Fuer die Spalte "${lane.label}" ist eine Statuswahl noetig. Schliesse zuerst das offene Miro-Modal und klicke dann auf "Status waehlen".`
      );
      return null;
    }
    throw error;
  }
}

async function handlePotentialStatusChange(item) {
  if (!item || item.type !== "app_card") {
    return;
  }

  const appCardId = String(item.id || "");
  const suppressUntil = suppressStatusSyncUntilByCardId.get(appCardId) || 0;
  if (appCardId && suppressUntil > Date.now()) {
    debugStatus(`Ignoriere Card ${appCardId}, weil der Statuswechsel gerade noch entprellt wird.`);
    return;
  }
  if (appCardId && statusChoiceModalOpenByCardId.has(appCardId)) {
    debugStatus(`Ignoriere Card ${appCardId}, weil fuer diese Karte bereits ein Statuswahl-Dialog offen ist.`);
    return;
  }
  if (pendingStatusChoice?.appCardId && String(pendingStatusChoice.appCardId) === appCardId) {
    debugStatus(`Ignoriere Card ${appCardId}, weil bereits eine Statuswahl aussteht.`);
    return;
  }
  if (!appCardId || moveSyncByCardId.has(appCardId)) {
    if (appCardId && moveSyncByCardId.has(appCardId)) {
      debugStatus(`Ignoriere Card ${appCardId}, weil bereits ein Sync laeuft.`);
    }
    return;
  }

  const syncPromise = (async () => {
    debugStatus(`Move-Event fuer Card ${appCardId} empfangen.`);
    const boardCard = await miro.board.getById(appCardId);
    if (!boardCard || boardCard.status !== "connected") {
      debugStatus(`Card ${appCardId} ist nicht verbunden oder konnte nicht geladen werden.`);
      return;
    }

    const parentId = boardCard.parentId || boardCard.parent?.id;
    if (!parentId) {
      debugStatus(`Card ${appCardId} hat keinen Parent-Frame.`);
      return;
    }

    const frame = await miro.board.getById(parentId);
    if (!frame || frame.type !== "frame") {
      debugStatus(`Parent ${parentId} von Card ${appCardId} ist kein Frame.`);
      return;
    }

    debugStatus(
      `Card ${appCardId} Position: x=${boardCard.x}, y=${boardCard.y}, relativeTo=${boardCard.relativeTo || "unknown"}, parent=${parentId}.`
    );
    const laneMatch = laneForCardPosition(boardCard, frame);
    debugStatus(
      `Card ${appCardId} Position: x=${boardCard.x}, y=${boardCard.y}, relativeTo=${boardCard.relativeTo || "unknown"}, parent=${parentId}, frameX=${frame.x}, frameWidth=${frame.width}.`
    );
    if (!laneMatch) {
      debugStatus(`Lane-Berechnung fuer Card ${appCardId} schlug fehl.`);
      return;
    }
    const lane = laneMatch.lane;
    debugStatus(
      `Lane fuer Card ${appCardId}: "${lane.label}" ueber ${laneMatch.source}, relativeX=${laneMatch.relativeX}, laneIndex=${laneMatch.laneIndex}.`
    );

    const fallbackWorkPackageId = readStoryIdFromDescription(boardCard.description);
    const connection = await fetchCardConnection(appCardId, fallbackWorkPackageId);
    const currentStatus = connection?.story?.statusName || "";
    const currentLane = laneConfigForStatus(currentStatus);
    debugStatus(`Aktueller OpenProject-Status fuer Card ${appCardId}: "${currentStatus || "unbekannt"}".`);
    if (currentLane && currentLane.id === lane.id) {
      debugStatus(`Card ${appCardId} ist bereits in der passenden Lane "${lane.label}".`);
      return;
    }

    const allowedStatuses = connection.allowedStatusTransitions || [];
    debugStatus(
      `Erlaubte Zielstatus fuer Card ${appCardId}: ${allowedStatuses.length ? allowedStatuses.join(", ") : "keine"}.`
    );
    const targetStatus = await promptForTargetStatus(lane, allowedStatuses, {
      appCardId,
      fallbackWorkPackageId,
    });
    if (!targetStatus) {
      debugStatus(`Kein Zielstatus fuer Card ${appCardId} gewaehlt.`);
      return;
    }
    debugStatus(`Ausgewaehlter Zielstatus fuer Card ${appCardId}: "${targetStatus}".`);

    try {
      await applyStatusChange(appCardId, targetStatus, fallbackWorkPackageId);
    } catch (error) {
      await showErrorDialog(error instanceof Error ? error.message : String(error));
    }
  })().finally(() => {
    moveSyncByCardId.delete(appCardId);
  });

  moveSyncByCardId.set(appCardId, syncPromise);
  await syncPromise;
}

function extractUpdatedItems(event) {
  if (Array.isArray(event)) {
    return event;
  }
  if (Array.isArray(event?.items)) {
    return event.items;
  }
  if (Array.isArray(event?.updated)) {
    return event.updated;
  }
  if (event?.item) {
    return [event.item];
  }
  return [];
}

async function handleItemsUpdate(event) {
  const items = extractUpdatedItems(event);
  const uniqueItems = [];
  const seenIds = new Set();
  for (const item of items) {
    const id = String(item?.id || "");
    if (!id || seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    uniqueItems.push(item);
  }
  debugStatus(
    `experimental:items:update empfangen mit ${items.length} Item(s), ${uniqueItems.length} eindeutig.`
  );
  for (const item of uniqueItems) {
    try {
      await handlePotentialStatusChange(item);
    } catch (error) {
      await showErrorDialog(error instanceof Error ? error.message : String(error));
    }
  }
}

async function registerAppCardEvents(config) {
  miro.board.ui.on("icon:click", async () => {
    await miro.board.ui.openPanel({ url: `${config.appPublicUrl}/` });
  });

  miro.board.ui.on("app_card:connect", async (event) => {
    const url = `${config.appPublicUrl}/connect.html?appCardId=${encodeURIComponent(event.appCard.id)}`;
    await miro.board.ui.openModal({ url, width: 620 });
  });

  miro.board.ui.on("app_card:open", async (event) => {
    const url = `${config.appPublicUrl}/modal.html?appCardId=${encodeURIComponent(event.appCard.id)}`;
    await miro.board.ui.openPanel({ url });
  });

  if (typeof miro?.board?.ui?.on === "function") {
    miro.board.ui.on("experimental:items:update", handleItemsUpdate);
  }
}

function createAppCardDataFromStory(story) {
  const fields = [
    {
      value: `Status: ${story.statusName || "Unbekannt"}`,
      fillColor: "#f1f3f5",
      textColor: "#1a1a1a",
      tooltip: "OpenProject Status",
    },
  ];

  if (story.priorityName) {
    fields.push({
      value: `Prio: ${story.priorityName}`,
      fillColor: "#fff3bf",
      textColor: "#1a1a1a",
      tooltip: "OpenProject Prioritaet",
    });
  }
  if (story.assigneeName) {
    fields.push({
      value: `Bearbeiter: ${story.assigneeName}`,
      fillColor: "#e6fcf5",
      textColor: "#1a1a1a",
      tooltip: "OpenProject Bearbeiter",
    });
  }
  if (story.projectName) {
    fields.push({
      value: story.projectName,
      fillColor: "#e7f5ff",
      textColor: "#1a1a1a",
      tooltip: "OpenProject Projekt",
    });
  }

  const descriptionLines = [
    `OpenProject ID: ${story.id}`,
    `Version: ${story.versionName || ""}`.trim(),
    `Story: ${story.uiLink || ""}`.trim(),
  ].filter(Boolean);

  if (story.description) {
    descriptionLines.push("", story.description.trim());
  }

  return {
    title: story.subject,
    description: descriptionLines.join("\n"),
    fields,
  };
}

async function createDisconnectedAppCard() {
  const viewport = await miro.board.viewport.get();
  const card = await miro.board.createAppCard({
    title: "OpenProject Story verbinden",
    description: "Noch keiner OpenProject-Story zugeordnet.",
    x: viewport.x + 400,
    y: viewport.y,
    width: CARD_WIDTH,
    status: "disconnected",
    fields: [
      {
        value: "Nicht verbunden",
        fillColor: "#f1f3f5",
        textColor: "#1a1a1a",
        tooltip: "Diese App Card ist noch keiner OpenProject Story zugeordnet.",
      },
    ],
  });
  setStatus(`App Card ${card.id} angelegt. Oeffne jetzt den Connect-Dialog ueber das Status-Icon.`);
}

async function loadRecentVersions() {
  versionSelectNode.innerHTML = "";
  const payload = await fetchJson("/api/versions?limit=5");

  if (!payload.items.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Keine Versionen gefunden";
    versionSelectNode.append(option);
    versionSelectNode.disabled = true;
    createVersionButton.disabled = true;
    return;
  }

  versionSelectNode.disabled = false;
  createVersionButton.disabled = false;

  payload.items.forEach((version) => {
    const option = document.createElement("option");
    option.value = version.name;
    option.textContent = version.name;
    option.dataset.versionId = String(version.id);
    versionSelectNode.append(option);
  });
}

async function connectCreatedAppCard(appCardId, workPackageId) {
  const boardId = await resolveCurrentBoardId();
  const attempts = 4;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await appFetch("/api/app-cards/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appCardId, workPackageId, boardId }),
    });
    if (response.ok) {
      return response.json();
    }

    const text = await response.text();
    const isLastAttempt = attempt === attempts;
    const looksLikeMiroNotReady = response.status === 404 && text.includes("Item not found");
    if (!looksLikeMiroNotReady || isLastAttempt) {
      throw new Error(text || `Verbinden fehlgeschlagen fuer ${appCardId}`);
    }

    await new Promise((resolve) => window.setTimeout(resolve, 400 * attempt));
  }
}

async function refreshConnectedCard(boardCard) {
  const appCardId = String(boardCard?.id || "");
  if (!appCardId) {
    return { updated: false };
  }
  const fallbackWorkPackageId = readStoryIdFromDescription(boardCard.description);
  const boardId = await resolveCurrentBoardId();
  const query = new URLSearchParams({ board_id: boardId });
  if (fallbackWorkPackageId) {
    query.set("work_package_id", String(fallbackWorkPackageId));
  }
  const payload = await fetchJson(`/api/app-cards/${encodeURIComponent(appCardId)}/refresh?${query.toString()}`, {
    method: "PATCH",
  });
  await applyConnectedCardPayload(boardCard, payload);
  const inconsistent = await syncCardConsistency(boardCard, payload);
  return { updated: true, inconsistent };
}

async function refreshAllConnectedCards() {
  const boardItems = await miro.board.get({ type: "app_card" });
  const connectedCards = (Array.isArray(boardItems) ? boardItems : []).filter((item) => item?.status === "connected");
  if (!connectedCards.length) {
    setStatus("Keine verbundenen App Cards auf diesem Board gefunden.");
    return;
  }

  if (refreshAllCardsButton) {
    refreshAllCardsButton.disabled = true;
  }

  setStatus(`Starte Aktualisierung von ${connectedCards.length} Cards ...`);

  let refreshed = 0;
  let inconsistent = 0;
  try {
    for (const [index, card] of connectedCards.entries()) {
      setStatus(
        `Aktualisiere Cards aus OpenProject: ${index + 1}/${connectedCards.length} verarbeitet` +
        `${inconsistent ? `, ${inconsistent} inkonsistent` : ""} ...`
      );
      const payload = await refreshConnectedCard(card);
      if (payload.updated) {
        refreshed += 1;
        if (payload.inconsistent) {
          inconsistent += 1;
        }
      }
    }
  } finally {
    if (refreshAllCardsButton) {
      refreshAllCardsButton.disabled = false;
    }
  }
  setStatus(
    `${refreshed} Cards aus OpenProject aktualisiert.${inconsistent ? ` ${inconsistent} davon sind als Status-Sync inkonsistent markiert.` : ""}`
  );
}

async function createVersionFrameAndCards() {
  await resolveCurrentBoardId();
  const versionName = versionSelectNode.value;
  if (!versionName) {
    setStatus("Bitte zuerst eine Version auswaehlen.");
    return;
  }

  setStatus(`Lade Stories fuer ${versionName} ...`);
  const payload = await fetchJson(`/api/stories?version_name=${encodeURIComponent(versionName)}`);
  const stories = payload.items || [];

  if (!stories.length) {
    setStatus(`Keine User Stories fuer ${versionName} gefunden.`);
    return;
  }

  const { storiesByLaneId, unmappedStatuses } = buildStoriesByLane(stories);
  if (unmappedStatuses.length) {
    throw new Error(
      `Diese Story-Status sind noch keiner Lane zugeordnet: ${unmappedStatuses.join(", ")}. `
      + "Bitte Lane-Mapping zuerst ergaenzen."
    );
  }

  const viewport = await miro.board.viewport.get();
  const tallestLaneSize = Math.max(...Array.from(storiesByLaneId.values(), (items) => items.length), 1);
  const reservedRows = Math.max(stories.length + LANE_CAPACITY_BUFFER_ROWS, tallestLaneSize + LANE_CAPACITY_BUFFER_ROWS);
  const laneCount = LANE_CONFIGS.length;
  const frameWidth = laneCount * LANE_WIDTH + FRAME_PADDING_X * 2;
  const laneHeight =
    LANE_HEADER_HEIGHT +
    LANE_INNER_PADDING_Y * 2 +
    reservedRows * CARD_HEIGHT +
    Math.max(0, reservedRows - 1) * CARD_VERTICAL_GAP;
  const frameHeight = FRAME_TITLE_SPACE + laneHeight + FRAME_PADDING_Y * 2;
  const frameX = viewport.x;
  const frameY = viewport.y + frameHeight / 2 - 40;
  const frameLeft = frameX - frameWidth / 2;
  const frameTop = frameY - frameHeight / 2;
  const lanesTop = frameTop + FRAME_TITLE_SPACE;

  const createdCards = [];
  setStatus(`${stories.length} Stories gefunden. App Cards werden angelegt ...`);

  const frame = await miro.board.createFrame({
    title: versionName,
    x: frameX,
    y: frameY,
    width: frameWidth,
    height: frameHeight,
  });

  const createdLaneItems = [];
  const createdLaneShapes = [];

  for (const [laneIndex, lane] of LANE_CONFIGS.entries()) {
    const laneLeft = frameLeft + FRAME_PADDING_X + laneIndex * LANE_WIDTH;
    const laneCenterX = laneLeft + LANE_WIDTH / 2;
    const laneShape = await miro.board.createShape({
      shape: "round_rectangle",
      content: "",
      x: laneCenterX,
      y: lanesTop + laneHeight / 2,
      width: LANE_WIDTH - 12,
      height: laneHeight - 12,
      style: {
        fillColor: laneFillColor(lane.id),
        fillOpacity: 1,
        borderColor: "#d1d4db",
        borderOpacity: 1,
        borderStyle: "normal",
        borderWidth: 1,
      },
    });
    createdLaneItems.push(laneShape);
    createdLaneShapes.push(laneShape);

    const laneHeader = await miro.board.createText({
      content: laneHeaderContent(lane),
      x: laneCenterX,
      y: lanesTop + LANE_HEADER_HEIGHT / 2,
      width: LANE_WIDTH - 24,
      style: {
        fillColor: "transparent",
        fillOpacity: 1,
        color: "#343741",
        fontFamily: "arial",
        fontSize: 14,
        textAlign: "center",
      },
    });
    createdLaneItems.push(laneHeader);

    const laneStories = storiesByLaneId.get(lane.id) || [];
    for (const [rowIndex, story] of laneStories.entries()) {
      const x = laneLeft + LANE_WIDTH / 2;
      const y =
        lanesTop +
        LANE_HEADER_HEIGHT +
        LANE_INNER_PADDING_Y +
        CARD_HEIGHT / 2 +
        rowIndex * (CARD_HEIGHT + CARD_VERTICAL_GAP);
      const appCardData = createAppCardDataFromStory(story);

      const card = await miro.board.createAppCard({
        title: appCardData.title,
        description: appCardData.description,
        x,
        y,
        width: CARD_WIDTH,
        status: "connected",
        fields: appCardData.fields,
      });

      await connectCreatedAppCard(card.id, story.id);
      await syncCardConsistency(card, { story });
      createdCards.push(card);
    }
  }

  for (const item of createdLaneItems) {
    await frame.add(item);
  }
  for (const card of createdCards) {
    await frame.add(card);
  }
  for (const laneShape of createdLaneShapes) {
    await laneShape.sendToBack();
  }

  setStatus(`Frame "${versionName}" mit ${stories.length} verknuepften App Cards in ${laneCount} Kanban-Spalten angelegt.`);
}

function setAuthUi(hasUsableToken) {
  createVersionButton.disabled = !hasUsableToken || versionSelectNode.disabled;
  if (!hasUsableToken) {
    setStatus("Miro OAuth fehlt noch. Fuer verknuepfte Karten bitte zuerst verbinden.");
    setAuthButtonVisible(true);
    return;
  }
  clearOauthStatusIfPresent();
}

async function startOauthFlow(config) {
  clearStatus();
  authButton.disabled = true;
  statusNode.textContent = "OAuth-Fenster wird geoeffnet ...";
  setAuthButtonVisible(true);

  try {
    const popup = window.open(config.oauthStartUrl, "_blank", "noopener,noreferrer,width=700,height=800");
    if (!popup) {
      throw new Error("OAuth-Fenster konnte nicht geoeffnet werden.");
    }

    const maxChecks = 120;
    for (let attempt = 0; attempt < maxChecks; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      const oauthStatus = await fetchOauthStatus(config, await resolveCurrentBoardId());
      if (oauthStatus.hasUsableToken) {
        setAuthUi(true);
        return;
      }
    }

    throw new Error("OAuth wurde nicht abgeschlossen. Bitte erneut versuchen.");
  } finally {
    authButton.disabled = false;
  }
}

async function bootstrap() {
  appConfig = await fetchConfig();
  await resolveCurrentBoardId();
  await loadRecentVersions();
  const oauthStatus = await fetchOauthStatus(appConfig, currentBoardId);
  setAuthUi(oauthStatus.hasUsableToken);

  createButton.addEventListener("click", async () => {
    try {
      clearStatus();
      await createDisconnectedAppCard();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  });

  if (refreshAllCardsButton) {
    refreshAllCardsButton.addEventListener("click", async () => {
      try {
        clearStatus();
        await refreshAllConnectedCards();
      } catch (error) {
        await showErrorDialog(error instanceof Error ? error.message : String(error));
      }
    });
  }

  createVersionButton.addEventListener("click", async () => {
    try {
      clearStatus();
      await createVersionFrameAndCards();
    } catch (error) {
      showErrorDialog(error instanceof Error ? error.message : String(error));
    }
  });

  reloadVersionsButton.addEventListener("click", async () => {
    try {
      clearStatus();
      await loadRecentVersions();
      const refreshedOauthStatus = await fetchOauthStatus(appConfig, await resolveCurrentBoardId());
      setAuthUi(refreshedOauthStatus.hasUsableToken);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  });

  authButton.addEventListener("click", async () => {
    try {
      await startOauthFlow(appConfig);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  });

  if (choiceButton) {
    choiceButton.addEventListener("click", async () => {
      try {
        const targetStatus = await openPendingStatusChoiceDialog();
        if (targetStatus) {
          const { appCardId, fallbackWorkPackageId } = pendingStatusChoice || {};
          if (!appCardId) {
            clearPendingStatusChoice();
            setStatus(`Status "${targetStatus}" ausgewaehlt.`);
            return;
          }
          await applyStatusChange(appCardId, targetStatus, fallbackWorkPackageId);
        }
      } catch (error) {
        await showErrorDialog(error instanceof Error ? error.message : String(error));
      }
    });
  }

  if (debugToggleButton) {
    setDebugState(false);
    debugToggleButton.addEventListener("click", () => {
      setDebugState(!debugEnabled);
      setStatus(debugEnabled ? "[DEBUG] Debug-Modus aktiviert." : "");
    });
  }
}

bootstrap().catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error));
});

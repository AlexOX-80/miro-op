const params = new URLSearchParams(window.location.search);
const appCardId = params.get("appCardId");

const titleNode = document.querySelector("#title");
const typeNameNode = document.querySelector("#type-name");
const metaNode = document.querySelector("#meta");
const descriptionNode = document.querySelector("#description");
const linkNode = document.querySelector("#story-link");
const statusNode = document.querySelector("#modal-status");
const syncStatusNode = document.querySelector("#sync-status");
const statusSyncButton = document.querySelector("#status-sync-button");
const refreshButton = document.querySelector("#refresh-button");
const fieldListNode = document.querySelector("#field-list");
const commentListNode = document.querySelector("#comment-list");
const commentInputNode = document.querySelector("#comment-input");
const commentSubmitNode = document.querySelector("#comment-submit");
const commentStatusNode = document.querySelector("#comment-status");
const tabButtons = Array.from(document.querySelectorAll("[data-tab]"));
const viewNodes = Array.from(document.querySelectorAll("[data-view]"));

let currentPayload = null;
let currentBoardId = "";

const LANE_WIDTH = 360;
const FRAME_PADDING_X = 40;
const SYNC_ERROR_FIELD_VALUE = "Sync-Fehler";
const LANE_CONFIGS = [
  { id: "sprint-backlog", label: "Sprint Backlog", statuses: ["Offen", "Neu", "priorisiert", "Ready"] },
  { id: "refinement", label: "refinement noetig", statuses: ["Abklaeren", "Abklären"] },
  { id: "blocked", label: "Geblockt", statuses: ["Geblockt"] },
  { id: "in-work", label: "in Arbeit", statuses: ["in Arbeit"] },
  { id: "test", label: "im Test", statuses: ["Testbereit TEST", "Im Test", "Testbereit PROD"] },
  { id: "closed", label: "geschlossen", statuses: ["Geschlossen", "Abgelehnt"] },
];

function setStatus(message) {
  statusNode.textContent = message || "";
}

function setSyncStatus(message) {
  syncStatusNode.textContent = message || "";
}

function setCommentStatus(message) {
  commentStatusNode.textContent = message || "";
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

function getStoryCache() {
  try {
    const raw = window.localStorage.getItem(`op_story_${appCardId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveStoryCache(payload) {
  try {
    const story = payload.story || {};
    window.localStorage.setItem(
      `op_story_${appCardId}`,
      JSON.stringify({
        workPackageId: story.id,
        subject: story.subject,
        description: story.description || "",
        uiLink: story.uiLink || "",
        projectName: story.projectName || "",
        statusName: story.statusName || "",
        versionName: story.versionName || "",
      })
    );
  } catch {
    // Ignore local cache failures.
  }
}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getOauthToken();
  if (token) {
    headers.set("X-Miro-OAuth-Token", token);
  }
  return fetch(url, { ...options, headers });
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

async function withBoardQuery(baseQuery = "") {
  const boardId = await resolveCurrentBoardId();
  const prefix = baseQuery ? `${baseQuery}&` : "?";
  return `${prefix}board_id=${encodeURIComponent(boardId)}`;
}

async function readError(response, fallbackMessage) {
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    return payload.message || payload.error || fallbackMessage;
  } catch {
    return text || fallbackMessage;
  }
}

function fallbackWorkPackageQuery() {
  const cache = getStoryCache();
  return cache?.workPackageId
    ? `?work_package_id=${encodeURIComponent(cache.workPackageId)}`
    : "";
}

async function loadConnection() {
  const response = await apiFetch(
    `/api/app-cards/${encodeURIComponent(appCardId)}${await withBoardQuery(fallbackWorkPackageQuery())}`
  );
  if (!response.ok) {
    throw new Error(await readError(response, "Keine Verbindung fuer diese App Card gefunden."));
  }
  return response.json();
}

async function loadComments() {
  const response = await apiFetch(
    `/api/app-cards/${encodeURIComponent(appCardId)}/comments${await withBoardQuery(fallbackWorkPackageQuery())}`
  );
  if (!response.ok) {
    throw new Error(await readError(response, "Kommentare konnten nicht geladen werden."));
  }
  return response.json();
}

async function patchCardStatus(statusName, fallbackWorkPackageId = null) {
  const params = new URLSearchParams();
  params.set("board_id", await resolveCurrentBoardId());
  params.set("action", "status");
  if (fallbackWorkPackageId) {
    params.set("work_package_id", String(fallbackWorkPackageId));
  } else {
    const cache = getStoryCache();
    if (cache?.workPackageId) {
      params.set("work_package_id", String(cache.workPackageId));
    }
  }
  const response = await apiFetch(`/api/app-cards/${encodeURIComponent(appCardId)}/refresh?${params.toString()}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ statusName }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Statuswechsel fehlgeschlagen."));
  }
  return response.json();
}

async function showChoiceDialog(lane, options) {
  const modal = await miro.board.ui.openModal({
    url: "/dialog.html?kind=choice",
    width: 480,
    data: {
      kind: "choice",
      title: "OpenProject-Status waehlen",
      message: `Fuer die Spalte "${lane.label}" gibt es mehrere moegliche OpenProject-Statuswerte.`,
      options,
    },
  });
  const result = await modal.waitForClose();
  return normalizeDialogChoiceResult(result);
}

async function showErrorDialog(message) {
  const modal = await miro.board.ui.openModal({
    url: "/dialog.html?kind=error",
    width: 440,
    data: {
      kind: "error",
      title: "OpenProject-Fehler",
      message: String(message || "Unbekannter Fehler."),
    },
  });
  return modal.waitForClose();
}


function parseDescriptionValue(description, prefix) {
  if (typeof description !== "string") {
    return null;
  }
  for (const line of description.split("\n")) {
    if (line.startsWith(prefix)) {
      return line.slice(prefix.length).trim();
    }
  }
  return null;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function markdownToHtml(markdown) {
  const source = String(markdown || "").replace(/\r\n/g, "\n");
  const lines = source.split("\n");
  const html = [];
  let inList = false;

  const flushList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  const inline = (value) =>
    escapeHtml(value)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inline(trimmed.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    flushList();
    if (/^####\s+/.test(trimmed)) {
      html.push(`<h4>${inline(trimmed.replace(/^####\s+/, ""))}</h4>`);
      continue;
    }
    if (/^###\s+/.test(trimmed)) {
      html.push(`<h3>${inline(trimmed.replace(/^###\s+/, ""))}</h3>`);
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      html.push(`<h2>${inline(trimmed.replace(/^##\s+/, ""))}</h2>`);
      continue;
    }
    if (/^#\s+/.test(trimmed)) {
      html.push(`<h1>${inline(trimmed.replace(/^#\s+/, ""))}</h1>`);
      continue;
    }
    html.push(`<p>${inline(trimmed)}</p>`);
  }

  flushList();
  return html.join("");
}

function loadConnectionFromCache() {
  const cache = getStoryCache();
  if (!cache) {
    throw new Error("Keine lokale Story-Zuordnung vorhanden.");
  }
  return {
    story: {
      id: cache.workPackageId || "",
      subject: cache.subject || "OpenProject Story",
      typeName: "OpenProject Story",
      statusName: cache.statusName || "",
      priorityName: "",
      assigneeName: "",
      responsibleName: "",
      projectName: cache.projectName || "",
      versionName: cache.versionName || "",
      description: cache.description || "",
      descriptionHtml: "",
      uiLink: cache.uiLink || "#",
      dueDate: "",
      startDate: "",
      estimatedTime: "",
      tagNames: [],
    },
    comments: [],
  };
}

async function loadConnectionFromBoard() {
  if (!appCardId) {
    throw new Error("App Card fehlt.");
  }
  const appCard = await miro.board.getById(appCardId);
  const description = appCard.description || "";
  const uiLink = parseDescriptionValue(description, "Story:");
  const versionName = parseDescriptionValue(description, "Version:");
  const openProjectId = parseDescriptionValue(description, "OpenProject ID:");
  return {
    story: {
      id: openProjectId || "",
      subject: appCard.title || "OpenProject Story",
      typeName: "OpenProject Story",
      statusName: "",
      priorityName: "",
      assigneeName: "",
      responsibleName: "",
      projectName: "",
      versionName: versionName || "",
      description,
      descriptionHtml: "",
      uiLink: uiLink || "#",
      dueDate: "",
      startDate: "",
      estimatedTime: "",
      tagNames: [],
    },
    comments: [],
  };
}

function humanDate(value) {
  if (!value) {
    return "--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: value.includes("T") ? "2-digit" : undefined,
    minute: value.includes("T") ? "2-digit" : undefined,
  }).format(date);
}

function humanDuration(value) {
  if (!value) {
    return "--";
  }
  const match = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?)$/i.exec(value);
  if (!match) {
    return value;
  }
  const hours = match[1] ? `${match[1]}h` : "";
  const minutes = match[2] ? `${match[2]}m` : "";
  return `${hours}${hours && minutes ? " " : ""}${minutes}` || "0h";
}

function createPropertyRow(label, value, options = {}) {
  const row = document.createElement("div");
  row.className = "opm-prop-row";

  const labelNode = document.createElement("div");
  labelNode.className = "opm-prop-label";
  labelNode.textContent = label;

  const valueNode = document.createElement("div");
  valueNode.className = "opm-prop-value";

  if (options.asStatusPill && value && value !== "--") {
    const pill = document.createElement("span");
    pill.className = "opm-status-pill";
    pill.textContent = value;
    valueNode.append(pill);
  } else if (options.asTags) {
    if (Array.isArray(options.tags) && options.tags.length) {
      const tagList = document.createElement("div");
      tagList.className = "opm-tag-list";
      options.tags.forEach((tag) => {
        const chip = document.createElement("span");
        chip.className = "opm-tag-chip";
        chip.textContent = tag;
        tagList.append(chip);
      });
      valueNode.append(tagList);
    } else {
      valueNode.textContent = "Keine Tags";
    }
  } else {
    valueNode.textContent = value || "--";
  }

  row.append(labelNode, valueNode);
  return row;
}

function laneForCardPosition(card, frame) {
  const frameLeft = frame.x - frame.width / 2;
  const candidates = [{ x: card.x }, { x: card.x - frameLeft }];

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
  return (Array.isArray(fields) ? fields : []).filter((field) => String(field?.value || "") !== SYNC_ERROR_FIELD_VALUE);
}

async function setCardSyncError(message) {
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

async function applyConnectedCardPayloadToBoard(payload) {
  const boardCard = await miro.board.getById(appCardId);
  if (!boardCard) {
    return;
  }
  const appCardData = payload?.appCard?.data || {};
  if (appCardData.title) {
    boardCard.title = appCardData.title;
  }
  if (typeof appCardData.description === "string") {
    boardCard.description = appCardData.description;
  }
  if (Array.isArray(appCardData.fields)) {
    boardCard.fields = withoutSyncErrorField(appCardData.fields);
  }
  boardCard.status = "connected";
  await boardCard.sync();
}

async function syncStatusFromPosition() {
  const boardCard = await miro.board.getById(appCardId);
  if (!boardCard || boardCard.type !== "app_card") {
    throw new Error("Die aktuelle Karte konnte nicht geladen werden.");
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

  const fallbackWorkPackageId = getStoryCache()?.workPackageId || null;
  const connection = await loadConnection();
  const currentStatus = connection?.story?.statusName || "";
  const currentLane = laneConfigForStatus(currentStatus);
  if (currentLane && currentLane.id === lane.id) {
    setSyncStatus(`Die Karte liegt bereits in der passenden Spalte "${lane.label}".`);
    return;
  }

  const allowedStatuses = connection.allowedStatusTransitions || [];
  const allowedNormalized = new Set(allowedStatuses.map(normalizeStatus));
  const matchingCandidates = lane.statuses.filter(
    (candidate) => allowedNormalized.size === 0 || allowedNormalized.has(normalizeStatus(candidate))
  );

  if (!matchingCandidates.length) {
    throw new Error(
      `OpenProject erlaubt keinen Wechsel in die Spalte "${lane.label}". Erlaubt sind: ${
        allowedStatuses.length ? allowedStatuses.join(", ") : "keine"
      }.`
    );
  }

  let targetStatus = matchingCandidates[0];
  if (matchingCandidates.length > 1) {
    targetStatus = await showChoiceDialog(lane, matchingCandidates);
  }
  if (!targetStatus) {
    setSyncStatus("Statuswechsel nicht ausgefuehrt, weil keine Auswahl bestaetigt wurde.");
    return;
  }

  const payload = await patchCardStatus(targetStatus, fallbackWorkPackageId);
  await applyConnectedCardPayloadToBoard(payload);
  const commentsPayload = await loadComments().catch(() => ({ items: currentPayload?.comments || [] }));
  renderStory({ ...payload, comments: commentsPayload.items || [] });
  setSyncStatus(`OpenProject-Status auf "${targetStatus}" aktualisiert.`);
}

function renderMeta(story) {
  metaNode.innerHTML = "";
  [
    ["Projekt", story.projectName || "--"],
    ["Version", story.versionName || "--"],
  ].forEach(([label, value]) => {
    const term = document.createElement("dt");
    term.className = "opm-meta-label";
    term.textContent = label;

    const description = document.createElement("dd");
    description.className = "opm-meta-value";
    description.textContent = value;

    metaNode.append(term, description);
  });
}

function renderStory(payload) {
  const story = payload.story;
  currentPayload = payload;
  saveStoryCache(payload);

  titleNode.textContent = story.subject || "OpenProject Story";
  typeNameNode.textContent = story.typeName || "OpenProject Story";
  linkNode.href = story.uiLink || "#";

  if (story.descriptionHtml) {
    descriptionNode.innerHTML = story.descriptionHtml;
  } else if (story.description) {
    descriptionNode.innerHTML = markdownToHtml(story.description);
  } else {
    descriptionNode.textContent = "Keine Beschreibung";
  }

  renderMeta(story);

  fieldListNode.innerHTML = "";
  fieldListNode.append(
    createPropertyRow("Status", story.statusName || "--", { asStatusPill: true }),
    createPropertyRow("Bearbeiter", story.assigneeName || "--"),
    createPropertyRow("Verantwortlich", story.responsibleName || "--"),
    createPropertyRow("Schaetzung", humanDuration(story.estimatedTime)),
    createPropertyRow("Startdatum", humanDate(story.startDate)),
    createPropertyRow("Enddatum", humanDate(story.dueDate)),
    createPropertyRow("Prioritaet", story.priorityName || "--"),
    createPropertyRow("Tags", "", { asTags: true, tags: story.tagNames || [] })
  );

  renderComments(payload.comments || []);
}

function renderComments(items) {
  commentListNode.innerHTML = "";
  if (!items.length) {
    const emptyNode = document.createElement("div");
    emptyNode.className = "opm-comment-empty";
    emptyNode.textContent = "Noch keine Kommentare in OpenProject.";
    commentListNode.append(emptyNode);
    return;
  }

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "opm-comment";

    const head = document.createElement("div");
    head.className = "opm-comment-head";

    const author = document.createElement("div");
    author.className = "opm-comment-author";
    author.textContent = item.authorName || "OpenProject";

    const date = document.createElement("div");
    date.className = "opm-comment-date";
    date.textContent = humanDate(item.createdAt || item.updatedAt || "");

    const body = document.createElement("div");
    body.className = "opm-comment-body";
    body.textContent = item.comment || "";

    head.append(author, date);
    card.append(head, body);
    commentListNode.append(card);
  }
}

function activateTab(tabName) {
  tabButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === tabName);
  });
  viewNodes.forEach((node) => {
    node.classList.toggle("is-active", node.dataset.view === tabName);
  });
}

async function refresh() {
  const response = await apiFetch(
    `/api/app-cards/${encodeURIComponent(appCardId)}/refresh${await withBoardQuery(fallbackWorkPackageQuery())}`,
    {
      method: "PATCH",
    }
  );
  if (!response.ok) {
    throw new Error(await readError(response, "Aktualisierung fehlgeschlagen."));
  }
  const payload = await response.json();
  const commentsPayload = await loadComments().catch(() => ({ items: currentPayload?.comments || [] }));
  renderStory({ ...payload, comments: commentsPayload.items || [] });
  setStatus("App Card wurde aus OpenProject aktualisiert.");
}

async function submitComment() {
  const comment = commentInputNode.value.trim();
  if (!comment) {
    setCommentStatus("Bitte zuerst einen Kommentar eingeben.");
    return;
  }

  const response = await apiFetch(
    `/api/app-cards/${encodeURIComponent(appCardId)}/comments${await withBoardQuery(fallbackWorkPackageQuery())}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    }
  );
  if (!response.ok) {
    throw new Error(await readError(response, "Kommentar konnte nicht gespeichert werden."));
  }

  const payload = await response.json();
  renderComments(payload.items || []);
  commentInputNode.value = "";
  setCommentStatus("Kommentar wurde als Aktivitaet nach OpenProject geschrieben.");
}

refreshButton.addEventListener("click", async () => {
  try {
    await refresh();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

statusSyncButton.addEventListener("click", async () => {
  try {
    setSyncStatus("Statuswechsel wird geprueft ...");
    await syncStatusFromPosition();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setCardSyncError(message);
    setSyncStatus(message);
    await showErrorDialog(message);
  }
});

commentSubmitNode.addEventListener("click", async () => {
  try {
    await submitComment();
  } catch (error) {
    setCommentStatus(error instanceof Error ? error.message : String(error));
  }
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab));
});

loadConnection()
  .catch(() => loadConnectionFromCache())
  .catch(() => loadConnectionFromBoard())
  .then((payload) => {
    renderStory(payload);
    setStatus("Story-Daten geladen.");
    setCommentStatus("Kommentare koennen direkt als OpenProject-Aktivitaet geschrieben werden.");
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(message);
    setCommentStatus(message);
  });

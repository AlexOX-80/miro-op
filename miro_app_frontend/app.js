const statusNode = document.querySelector("#status");
const createButton = document.querySelector("#create-disconnected");
const createVersionButton = document.querySelector("#create-version-board");
const reloadVersionsButton = document.querySelector("#reload-versions");
const versionSelectNode = document.querySelector("#version-select");
const authButton = document.querySelector("#auth-button");
const statusActionsNode = document.querySelector("#status-actions");
let currentBoardId = "";

const CARD_WIDTH = 320;
const CARD_HEIGHT = 180;
const LANE_WIDTH = 360;
const CARD_VERTICAL_GAP = 44;
const FRAME_PADDING_X = 40;
const FRAME_PADDING_Y = 48;
const FRAME_TITLE_SPACE = 84;
const LANE_HEADER_HEIGHT = 44;
const LANE_INNER_PADDING_Y = 18;
const KANBAN_STATUS_ORDER = [
  "neu",
  "new",
  "abklären",
  "abklaeren",
  "priorisiert",
  "ready",
  "in progress",
  "in bearbeitung",
  "done",
  "closed",
  "erledigt",
  "abgenommen",
];

function setStatus(message) {
  statusNode.textContent = message;
}

function clearStatus() {
  statusNode.textContent = "";
  statusActionsNode.hidden = true;
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
    statusActionsNode.hidden = true;
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

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function statusSortValue(status) {
  const index = KANBAN_STATUS_ORDER.indexOf(normalizeStatus(status));
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function compareStatuses(left, right) {
  const leftOrder = statusSortValue(left);
  const rightOrder = statusSortValue(right);
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return String(left).localeCompare(String(right), "de");
}

function laneFillColor(status) {
  const normalized = normalizeStatus(status);
  if (["neu", "new", "ready"].includes(normalized)) {
    return "#f2f4fc";
  }
  if (["abklären", "abklaeren", "priorisiert", "in progress", "in bearbeitung"].includes(normalized)) {
    return "#fff9e3";
  }
  if (["done", "closed", "erledigt", "abgenommen"].includes(normalized)) {
    return "#eaf6e6";
  }
  return "#f6f7f9";
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

  const viewport = await miro.board.viewport.get();
  const storiesByStatus = new Map();
  for (const story of stories) {
    const statusName = story.statusName || "Ohne Status";
    if (!storiesByStatus.has(statusName)) {
      storiesByStatus.set(statusName, []);
    }
    storiesByStatus.get(statusName).push(story);
  }

  const sortedStatuses = Array.from(storiesByStatus.keys()).sort(compareStatuses);
  const laneCount = sortedStatuses.length;
  const tallestLaneSize = Math.max(...Array.from(storiesByStatus.values(), (items) => items.length));
  const frameWidth = laneCount * LANE_WIDTH + FRAME_PADDING_X * 2;
  const laneHeight =
    LANE_HEADER_HEIGHT +
    LANE_INNER_PADDING_Y * 2 +
    tallestLaneSize * CARD_HEIGHT +
    Math.max(0, tallestLaneSize - 1) * CARD_VERTICAL_GAP;
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

  for (const [laneIndex, statusName] of sortedStatuses.entries()) {
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
        fillColor: laneFillColor(statusName),
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
      content: `<p><strong>${escapeHtml(statusName)}</strong></p>`,
      x: laneCenterX,
      y: lanesTop + LANE_HEADER_HEIGHT / 2,
      width: LANE_WIDTH - 24,
      style: {
        fillColor: "transparent",
        fillOpacity: 1,
        color: "#343741",
        fontFamily: "arial",
        fontSize: 18,
        textAlign: "center",
      },
    });
    createdLaneItems.push(laneHeader);

    const laneStories = storiesByStatus.get(statusName) || [];
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

  setStatus(`Frame "${versionName}" mit ${stories.length} verknuepften App Cards in ${laneCount} Status-Bereichen angelegt.`);
}

function setAuthUi(hasUsableToken) {
  createVersionButton.disabled = !hasUsableToken || versionSelectNode.disabled;
  if (!hasUsableToken) {
    setStatus("Miro OAuth fehlt noch. Fuer verknuepfte Karten bitte zuerst verbinden.");
    statusActionsNode.hidden = false;
    return;
  }

  clearOauthStatusIfPresent();
}

async function startOauthFlow(config) {
  clearStatus();
  authButton.disabled = true;
  statusNode.textContent = "OAuth-Fenster wird geoeffnet ...";
  statusActionsNode.hidden = false;

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
  const config = await fetchConfig();
  await resolveCurrentBoardId();
  await registerAppCardEvents(config);
  await loadRecentVersions();
  const oauthStatus = await fetchOauthStatus(config, currentBoardId);
  setAuthUi(oauthStatus.hasUsableToken);

  createButton.addEventListener("click", async () => {
    try {
      clearStatus();
      await createDisconnectedAppCard();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  });

  createVersionButton.addEventListener("click", async () => {
    try {
      clearStatus();
      await createVersionFrameAndCards();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  });

  reloadVersionsButton.addEventListener("click", async () => {
    try {
      clearStatus();
      await loadRecentVersions();
      const refreshedOauthStatus = await fetchOauthStatus(config, await resolveCurrentBoardId());
      setAuthUi(refreshedOauthStatus.hasUsableToken);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  });

  authButton.addEventListener("click", async () => {
    try {
      await startOauthFlow(config);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  });
}

bootstrap().catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error));
});

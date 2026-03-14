const params = new URLSearchParams(window.location.search);
const appCardId = params.get("appCardId");
const selectNode = document.querySelector("#story-select");
const statusNode = document.querySelector("#connect-status");
const connectButton = document.querySelector("#connect-button");
const oauthHelpNode = document.querySelector("#oauth-help");

let configPromise;
let currentBoardId = "";

function setStatus(message) {
  statusNode.textContent = message;
}

function getOauthToken() {
  try {
    return window.localStorage.getItem("miro_oauth_token") || "";
  } catch {
    return "";
  }
}

function saveStoryCache(appCardIdValue, payload) {
  try {
    const story = payload.story || {};
    const appCardData = (payload.appCard && payload.appCard.data) || {};
    window.localStorage.setItem(
      `op_story_${appCardIdValue}`,
      JSON.stringify({
        workPackageId: story.id,
        subject: story.subject,
        description: appCardData.description || "",
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

async function readError(response, fallbackMessage) {
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    return payload.message || payload.error || fallbackMessage;
  } catch {
    return text || fallbackMessage;
  }
}

async function loadConfig() {
  if (!configPromise) {
    configPromise = apiFetch("/api/config").then((response) => {
      if (!response.ok) {
        throw new Error("Konfiguration konnte nicht geladen werden.");
      }
      return response.json();
    });
  }
  return configPromise;
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

async function loadOauthStatus() {
  const config = await loadConfig();
  const response = await apiFetch(`${config.oauthStatusUrl}?board_id=${encodeURIComponent(await resolveCurrentBoardId())}`);
  if (!response.ok) {
    throw new Error("OAuth-Status konnte nicht geladen werden.");
  }
  return { config, status: await response.json() };
}

function renderOauthHelp(authorizeUrl) {
  oauthHelpNode.innerHTML = "";
  const link = document.createElement("a");
  link.href = authorizeUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "Miro OAuth verbinden";
  oauthHelpNode.textContent = "Miro OAuth ist noch nicht abgeschlossen. ";
  oauthHelpNode.append(link);
}

async function loadStories() {
  const response = await apiFetch("/api/stories");
  if (!response.ok) {
    throw new Error("Stories konnten nicht geladen werden.");
  }
  const payload = await response.json();
  for (const item of payload.items) {
    const option = document.createElement("option");
    option.value = String(item.id);
    option.textContent = `#${item.id} ${item.subject}`;
    selectNode.append(option);
  }
}

async function connectAppCard() {
  const workPackageId = selectNode.value;
  if (!appCardId || !workPackageId) {
    setStatus("App Card oder Story fehlt.");
    return;
  }

  const response = await apiFetch("/api/app-cards/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appCardId, workPackageId, boardId: await resolveCurrentBoardId() }),
  });
  if (!response.ok) {
    const message = await readError(response, "Verbinden fehlgeschlagen.");
    if (message.includes("tokenNotProvided") || message.includes("authorization")) {
      throw new Error(
        `${message} Bitte zuerst Miro OAuth verbinden und dann den Dialog erneut oeffnen.`
      );
    }
    throw new Error(message);
  }

  const payload = await response.json();
  const appCard = await miro.board.getById(appCardId);
  appCard.title = (payload.appCard.data && payload.appCard.data.title) || payload.story.subject;
  appCard.description = (payload.appCard.data && payload.appCard.data.description) || "";
  appCard.fields = (payload.appCard.data && payload.appCard.data.fields) || [];
  appCard.status = "connected";
  await appCard.sync();
  saveStoryCache(appCardId, payload);
  setStatus("Verbunden. Du kannst das Modal jetzt schliessen.");
}

async function bootstrap() {
  const { config, status } = await loadOauthStatus();
  if (!status.hasUsableToken) {
    connectButton.disabled = true;
    const oauthStartResponse = await apiFetch(`${config.oauthStartUrl}?format=json`);
    if (!oauthStartResponse.ok) {
      throw new Error("OAuth-Start konnte nicht geladen werden.");
    }
    const oauthStart = await oauthStartResponse.json();
    renderOauthHelp(oauthStart.authorizeUrl);
    setStatus("Miro OAuth fehlt noch. Bitte zuerst verbinden.");
    return;
  }
  await loadStories();
}

connectButton.addEventListener("click", async () => {
  try {
    await connectAppCard();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

bootstrap().catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error));
});

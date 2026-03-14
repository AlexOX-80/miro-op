const params = new URLSearchParams(window.location.search);
const appCardId = params.get("appCardId");

const titleNode = document.querySelector("#title");
const metaNode = document.querySelector("#meta");
const descriptionNode = document.querySelector("#description");
const linkNode = document.querySelector("#story-link");
const statusNode = document.querySelector("#modal-status");
const refreshButton = document.querySelector("#refresh-button");

function setStatus(message) {
  statusNode.textContent = message;
}

async function loadConnection() {
  const response = await fetch(`/api/app-cards/${encodeURIComponent(appCardId)}`);
  if (!response.ok) {
    throw new Error("Keine Verbindung für diese App Card gefunden.");
  }
  return response.json();
}

function render(payload) {
  titleNode.textContent = payload.story.subject;
  metaNode.textContent = `${payload.story.projectName} | ${payload.story.statusName}`;
  descriptionNode.textContent = payload.story.description || "Keine Beschreibung";
  linkNode.href = payload.story.uiLink || "#";
}

async function refresh() {
  const response = await fetch(`/api/app-cards/${encodeURIComponent(appCardId)}/refresh`, {
    method: "PATCH",
  });
  if (!response.ok) {
    throw new Error("Aktualisierung fehlgeschlagen.");
  }
  const payload = await response.json();
  render(payload);
  setStatus("App Card wurde aus OpenProject aktualisiert.");
}

refreshButton.addEventListener("click", async () => {
  try {
    await refresh();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

loadConnection()
  .then((payload) => render(payload))
  .catch((error) => setStatus(error instanceof Error ? error.message : String(error)));

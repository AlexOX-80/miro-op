const params = new URLSearchParams(window.location.search);
const appCardId = params.get("appCardId");
const selectNode = document.querySelector("#story-select");
const statusNode = document.querySelector("#connect-status");
const connectButton = document.querySelector("#connect-button");

function setStatus(message) {
  statusNode.textContent = message;
}

async function loadStories() {
  const response = await fetch("/api/stories");
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

  const response = await fetch("/api/app-cards/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appCardId, workPackageId }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Verbinden fehlgeschlagen.");
  }

  const payload = await response.json();
  const appCard = await miro.board.getById(appCardId);
  appCard.title = payload.story.subject;
  appCard.description = payload.story.description || "";
  appCard.fields = payload.appCard.data.fields || [];
  appCard.status = "connected";
  await appCard.sync();
  setStatus("Verbunden. Du kannst das Modal jetzt schließen.");
}

connectButton.addEventListener("click", async () => {
  try {
    await connectAppCard();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
});

loadStories().catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error));
});

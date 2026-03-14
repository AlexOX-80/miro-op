const statusNode = document.querySelector("#status");
const createButton = document.querySelector("#create-disconnected");

function setStatus(message) {
  statusNode.textContent = message;
}

async function fetchConfig() {
  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error("Konfiguration konnte nicht geladen werden.");
  }
  return response.json();
}

async function registerAppCardEvents(config) {
  miro.board.ui.on("app_card:connect", async (event) => {
    const url = `${config.appPublicUrl}/connect.html?appCardId=${encodeURIComponent(event.appCard.id)}`;
    await miro.board.ui.openModal({ url });
  });

  miro.board.ui.on("app_card:open", async (event) => {
    const url = `${config.appPublicUrl}/modal.html?appCardId=${encodeURIComponent(event.appCard.id)}`;
    await miro.board.ui.openModal({ url });
  });
}

async function createDisconnectedAppCard() {
  const viewport = await miro.board.viewport.get();
  const card = await miro.board.createAppCard({
    title: "OpenProject Story verbinden",
    description: "Noch keiner OpenProject-Story zugeordnet.",
    x: viewport.x + 400,
    y: viewport.y,
    width: 320,
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
  setStatus(`App Card ${card.id} angelegt. Über das Status-Icon verbinden.`);
}

async function bootstrap() {
  const config = await fetchConfig();
  await registerAppCardEvents(config);
  createButton.addEventListener("click", async () => {
    try {
      await createDisconnectedAppCard();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  });
  setStatus(`Verbunden mit Board ${config.boardId} und Version ${config.versionName}.`);
}

bootstrap().catch((error) => {
  setStatus(error instanceof Error ? error.message : String(error));
});

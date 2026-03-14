const gridNode = document.querySelector("#setup-grid");

function appendRow(label, value) {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  const code = document.createElement("code");
  code.textContent = value;
  dd.append(code);
  gridNode.append(dt, dd);
}

async function bootstrap() {
  const response = await fetch("/api/setup");
  if (!response.ok) {
    throw new Error("Setup-Daten konnten nicht geladen werden.");
  }
  const payload = await response.json();
  appendRow("App URL", payload.appUrl);
  appendRow("Connect Modal URL", payload.connectModalUrl);
  appendRow("Open Modal URL", payload.openModalUrl);
  appendRow("Backend Health URL", payload.healthUrl);
  appendRow("Stories API URL", payload.storiesApiUrl);
  appendRow("Board ID", payload.boardId);
}

bootstrap().catch((error) => {
  appendRow("Fehler", error instanceof Error ? error.message : String(error));
});

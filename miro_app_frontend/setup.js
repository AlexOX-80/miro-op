const gridNode = document.querySelector("#setup-grid");
const iconGridNode = document.querySelector("#icon-grid");

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
  appendRow("OAuth Start URL", payload.oauthStartUrl);
  appendRow("OAuth Status URL", payload.oauthStatusUrl);
  appendRow("OAuth Redirect URI", payload.oauthRedirectUri);
  appendRow("Board ID", payload.boardId);

  for (const icon of payload.icons) {
    const card = document.createElement("article");
    card.className = "icon-card";

    const title = document.createElement("h3");
    title.textContent = icon.label;

    const preview = document.createElement("img");
    preview.src = icon.url;
    preview.alt = icon.label;
    preview.className = "icon-preview";

    const link = document.createElement("a");
    link.href = icon.url;
    link.textContent = "SVG herunterladen";
    link.setAttribute("download", "");

    card.append(title, preview, link);
    iconGridNode.append(card);
  }
}

bootstrap().catch((error) => {
  appendRow("Fehler", error instanceof Error ? error.message : String(error));
});

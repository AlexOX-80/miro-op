const titleNode = document.querySelector("#dialog-title");
const messageNode = document.querySelector("#dialog-message");
const bodyNode = document.querySelector("#dialog-body");
const actionsNode = document.querySelector("#dialog-actions");

function buildButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderErrorDialog(data) {
  titleNode.textContent = data.title || "OpenProject-Fehler";
  messageNode.textContent = data.message || "Unbekannter Fehler.";
  bodyNode.innerHTML = "";
  actionsNode.innerHTML = "";
  actionsNode.append(
    buildButton("Verstanden", "button button-primary button-small", async () => {
      await miro.board.ui.closeModal({ acknowledged: true });
    })
  );
}

function renderChoiceDialog(data) {
  titleNode.textContent = data.title || "OpenProject-Status waehlen";
  messageNode.textContent = data.message || "";
  bodyNode.innerHTML = "";
  actionsNode.innerHTML = "";

  const options = Array.isArray(data.options) ? data.options : [];
  options.forEach((status, index) => {
    const label = document.createElement("label");
    label.className = "app-choice-option";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "target-status";
    input.value = status;
    input.checked = index === 0;

    const text = document.createElement("span");
    text.textContent = status;

    label.append(input, text);
    bodyNode.append(label);
  });

  actionsNode.append(
    buildButton("Abbrechen", "button button-secondary button-small", async () => {
      await miro.board.ui.closeModal(null);
    }),
    buildButton("Uebernehmen", "button button-primary button-small", async () => {
      const selected = bodyNode.querySelector('input[name="target-status"]:checked');
      await miro.board.ui.closeModal(selected ? selected.value : null);
    })
  );
}

async function bootstrap() {
  const data = await miro.board.ui.getModalData();
  if (data?.kind === "choice") {
    renderChoiceDialog(data);
    return;
  }
  renderErrorDialog(data || {});
}

bootstrap();

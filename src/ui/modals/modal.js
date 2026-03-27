export function openModal({ title, bodyHtml, actions }) {
  const root = document.getElementById("modal-root");
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal card" role="dialog" aria-modal="true" aria-label="${title}">
      <h3 class="title">${title}</h3>
      <div class="modal-body">${bodyHtml}</div>
      <div class="toolbar" id="modal-actions"></div>
    </div>
  `;
  const actionsEl = backdrop.querySelector("#modal-actions");
  actions.forEach((action) => {
    const btn = document.createElement("button");
    btn.className = `btn ${action.secondary ? "secondary" : ""}`.trim();
    btn.textContent = action.label;
    btn.addEventListener("click", () => action.onClick(close));
    actionsEl.append(btn);
  });

  function close() {
    backdrop.remove();
  }

  backdrop.addEventListener("click", (evt) => {
    if (evt.target === backdrop) close();
  });
  root.append(backdrop);
  return close;
}

export function openModal({ title, bodyHtml, actions }) {
  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  const root = document.getElementById("modal-root");
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const safeTitle = escapeHtml(title);
  backdrop.innerHTML = `
    <div class="modal card" role="dialog" aria-modal="true" aria-label="${safeTitle}">
      <h3 class="title">${safeTitle}</h3>
      <div class="modal-body">${bodyHtml}</div>
      <div class="toolbar" id="modal-actions"></div>
    </div>
  `;
  const actionsEl = backdrop.querySelector("#modal-actions");
  actions.forEach((action) => {
    const btn = document.createElement("button");
    const classNames = ["btn"];
    if (action.secondary) classNames.push("secondary");
    if (typeof action.className === "string" && action.className.trim()) {
      classNames.push(action.className.trim());
    }
    btn.className = classNames.join(" ");
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

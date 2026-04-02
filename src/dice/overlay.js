export function dockDiceOverlay({ app, isPlayMode }) {
  const overlay = document.getElementById("dice-overlay");
  if (!overlay) return;

  const playSlot = app.querySelector("#play-header-dice-slot");
  if (isPlayMode && playSlot) {
    playSlot.appendChild(overlay);
    overlay.classList.add("in-header");
    return;
  }

  if (overlay.parentElement !== document.body) {
    document.body.appendChild(overlay);
  }
  overlay.classList.remove("in-header");
}

export function isDiceTrayEnabled(character) {
  return character?.showDiceTray !== false;
}

export function syncDiceOverlayVisibility(state) {
  const overlay = document.getElementById("dice-overlay");
  if (!overlay) return;
  const isPlayMode = state?.mode === "play";
  overlay.hidden = !isPlayMode;
  overlay.classList.toggle("dice-tray-disabled", !isDiceTrayEnabled(state?.character));
}

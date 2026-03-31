export function createDiceUi(deps) {
  const {
    esc,
    toNumber,
    rollHistoryLimit,
    diceStylePresets,
    uiState,
  } = deps;

  function ensureOffscreenRollPanel() {
    let panel = document.getElementById("dice-offscreen-panel");
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = "dice-offscreen-panel";
    panel.className = "dice-offscreen-panel";
    panel.hidden = true;
    panel.setAttribute("role", "status");
    panel.setAttribute("aria-live", "polite");
    panel.innerHTML = `
      <div class="dice-offscreen-panel-title">Roll Result</div>
      <div class="dice-offscreen-panel-message"></div>
    `;
    document.body.appendChild(panel);
    return panel;
  }

  function clearOffscreenRollPanelTimer() {
    const timer = uiState.offscreenRollPanelTimer;
    if (timer != null) {
      clearTimeout(timer);
      uiState.offscreenRollPanelTimer = null;
    }
  }

  function hideOffscreenRollPanel() {
    const panel = document.getElementById("dice-offscreen-panel");
    if (panel) panel.hidden = true;
    clearOffscreenRollPanelTimer();
  }

  function isDiceTrayOffscreen() {
    const tray = document.getElementById("dice-tray");
    if (!tray || tray.offsetParent === null) return false;

    const rect = tray.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    return rect.bottom <= 0 || rect.top >= viewportHeight || rect.right <= 0 || rect.left >= viewportWidth;
  }

  function showOffscreenRollPanelIfNeeded(message, isError) {
    if (!message || !isDiceTrayOffscreen()) {
      hideOffscreenRollPanel();
      return;
    }

    const panel = ensureOffscreenRollPanel();
    const messageEl = panel.querySelector(".dice-offscreen-panel-message");
    if (!messageEl) return;

    messageEl.innerHTML = formatDiceResultHtml(message);
    panel.classList.toggle("is-error", Boolean(isError));
    panel.hidden = false;

    clearOffscreenRollPanelTimer();
    uiState.offscreenRollPanelTimer = setTimeout(() => {
      const currentPanel = document.getElementById("dice-offscreen-panel");
      if (currentPanel) currentPanel.hidden = true;
      uiState.offscreenRollPanelTimer = null;
    }, 10000);
  }

  function renderRollHistory() {
    const listEl = document.getElementById("dice-history-list");
    if (!listEl) return;

    const history = uiState.rollHistory;
    if (!history.length) {
      listEl.innerHTML = `<div class="dice-history-empty muted">No rolls yet.</div>`;
      return;
    }

    listEl.innerHTML = history
      .map(
        (entry) => `
        <div class="dice-history-entry ${entry.isError ? "is-error" : ""}">
          <span class="dice-history-time">${esc(entry.timeLabel)}</span>
          <span class="dice-history-message">${esc(entry.message)}</span>
        </div>
      `
      )
      .join("");
  }

  function formatDiceResultHtml(message) {
    const safeMessage = esc(String(message ?? ""));
    return safeMessage.replace(/=\s*(-?\d+)(?!.*=\s*-?\d+)/, '= <span class="dice-result-total">$1</span>');
  }

  function syncDiceResultElements() {
    const resultEls = [document.getElementById("dice-result"), document.getElementById("dice-result-inline")].filter(Boolean);
    resultEls.forEach((resultEl) => {
      resultEl.innerHTML = formatDiceResultHtml(uiState.latestDiceResultMessage);
      resultEl.classList.toggle("is-error", uiState.latestDiceResultIsError);
    });
  }

  function syncSpellCastStatusElements() {
    const statusEl = document.getElementById("spell-cast-status");
    if (!statusEl) return;

    const message = uiState.latestSpellCastStatusMessage;
    const hasMessage = Boolean(message);
    statusEl.hidden = !hasMessage;
    statusEl.textContent = hasMessage ? message : "";
    statusEl.classList.toggle("is-error", uiState.latestSpellCastStatusIsError);
  }

  function setDiceResult(message, isError = false, options = {}) {
    const shouldRecord = options.record !== false;
    uiState.latestDiceResultMessage = String(message ?? "");
    uiState.latestDiceResultIsError = Boolean(isError);
    syncDiceResultElements();
    showOffscreenRollPanelIfNeeded(uiState.latestDiceResultMessage, uiState.latestDiceResultIsError);

    if (!shouldRecord) return;

    uiState.rollHistory = [
      {
        message: uiState.latestDiceResultMessage,
        isError: uiState.latestDiceResultIsError,
        timeLabel: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      },
      ...uiState.rollHistory,
    ].slice(0, rollHistoryLimit);
    renderRollHistory();
  }

  function setSpellCastStatus(message, isError = false, options = {}) {
    uiState.latestSpellCastStatusMessage = String(message ?? "");
    uiState.latestSpellCastStatusIsError = Boolean(isError);
    syncSpellCastStatusElements();

    const timer = uiState.spellCastStatusTimer;
    if (timer != null) {
      clearTimeout(timer);
      uiState.spellCastStatusTimer = null;
    }

    const durationMs = toNumber(options.durationMs, 0);
    if (durationMs > 0 && uiState.latestSpellCastStatusMessage) {
      uiState.spellCastStatusTimer = setTimeout(() => {
        uiState.latestSpellCastStatusMessage = "";
        uiState.latestSpellCastStatusIsError = false;
        uiState.spellCastStatusTimer = null;
        syncSpellCastStatusElements();
      }, durationMs);
    }
  }

  function applyDiceStyle(box = uiState.diceBox) {
    const selectedStyleKey = uiState.selectedDiceStyle in diceStylePresets ? uiState.selectedDiceStyle : "arcane";
    uiState.selectedDiceStyle = selectedStyleKey;
    const preset = diceStylePresets[selectedStyleKey] ?? diceStylePresets.arcane ?? Object.values(diceStylePresets)[0];

    const overlay = document.getElementById("dice-overlay");
    if (overlay) {
      overlay.dataset.diceStyle = selectedStyleKey;
    }

    if (document.body) {
      document.body.dataset.diceStyle = selectedStyleKey;
    }

    const rootStyle = document.documentElement?.style;
    if (rootStyle && preset) {
      rootStyle.setProperty("--dice-theme-accent", String(preset.pageAccent ?? preset.themeColor ?? "#22d3ee"));
      rootStyle.setProperty("--dice-theme-glow", String(preset.pageGlow ?? "rgba(34, 211, 238, 0.22)"));
      rootStyle.setProperty("--dice-theme-bg-top", String(preset.pageBgTop ?? "rgba(30, 58, 138, 0.32)"));
      rootStyle.setProperty("--dice-theme-bg-bottom", String(preset.pageBgBottom ?? "rgba(15, 118, 110, 0.26)"));
      rootStyle.setProperty("--dice-theme-tray-border", String(preset.trayBorder ?? "rgba(34, 211, 238, 0.55)"));
      rootStyle.setProperty("--dice-theme-tray-glow", String(preset.trayGlow ?? "rgba(34, 211, 238, 0.24)"));
    }

    if (!box || typeof box.updateConfig !== "function") return Promise.resolve();
    if (!preset) return Promise.resolve();
    const requestedTheme = String(preset.diceTheme ?? "default");
    const buildConfig = (theme) => ({
      theme,
      themeColor: preset.themeColor,
      lightIntensity: preset.lightIntensity,
      shadowTransparency: preset.shadowTransparency,
    });
    const updateTheme = (theme) => Promise.resolve(box.updateConfig(buildConfig(theme)));

    const applyPromise = updateTheme(requestedTheme).catch((error) => {
      if (requestedTheme === "default") throw error;
      console.warn(`Dice theme "${requestedTheme}" failed; falling back to default theme.`, error);
      return updateTheme("default");
    });

    const trackedPromise = applyPromise
      .catch((error) => {
        console.error("Dice theme application failed", error);
      })
      .finally(() => {
        if (uiState.diceStyleApplyPromise === trackedPromise) {
          uiState.diceStyleApplyPromise = null;
        }
      });

    uiState.diceStyleApplyPromise = trackedPromise;
    return trackedPromise;
  }

  function renderDiceStyleOptions() {
    return Object.entries(diceStylePresets)
      .map(
        ([key, preset]) =>
          `<option value="${esc(key)}" ${uiState.selectedDiceStyle === key ? "selected" : ""}>${esc(preset.label)}</option>`
      )
      .join("");
  }

  return {
    renderRollHistory,
    syncDiceResultElements,
    syncSpellCastStatusElements,
    setDiceResult,
    setSpellCastStatus,
    applyDiceStyle,
    renderDiceStyleOptions,
  };
}

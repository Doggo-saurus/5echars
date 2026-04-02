export function createOnboardingView({
  app,
  esc,
  isUuid,
  newCharacterOptionValue,
  historyApi,
  partyFeature,
  appState,
  renderPersistenceNotice,
  createAndOpenNewCharacter,
  switchCharacterFromHistory,
  setCharacterIdInUrl,
  loadCharacterById,
  renderState,
  store,
}) {
  function renderOnboardingHome() {
    const lastCharacterId = historyApi.getLastCharacterId();
    const hasLastCharacter = Boolean(lastCharacterId);
    const openLastButtonClass = hasLastCharacter ? "btn onboarding-create-btn" : "btn secondary";
    const createButtonClass = hasLastCharacter ? "btn secondary" : "btn onboarding-create-btn";
    const lastCharacterSummary = hasLastCharacter
      ? historyApi.formatCharacterHistoryEntrySummary(historyApi.loadCharacterHistory().find((entry) => entry.id === lastCharacterId))
      : "";
    const lastPartyId = partyFeature.getLastPartyId();
    const hasLastParty = Boolean(lastPartyId);
    const lastPartySummary = partyFeature.getLastPartySummary();
    return `
      <main class="layout layout-onboarding">
        <section class="card onboarding-hero-card">
          <div class="onboarding-hero-head">
            <div class="title-with-history">
              <a class="app-brand-link" href="/" aria-label="Go to home">
                <img class="app-brand-logo" src="/icons/icon.svg" alt="Action Surge logo" />
              </a>
              <h1 class="title">Action Surge</h1>
            </div>
          </div>
          <p class="onboarding-kicker">Built for quick and simple play.</p>
          <h2 class="onboarding-tagline">Spend less time prepping your sheet and more time playing your turn.</h2>
          ${
            appState.startupErrorMessage
              ? `<p class="muted onboarding-warning">Could not load requested character. ${esc(appState.startupErrorMessage)}</p>`
              : ""
          }
          ${renderPersistenceNotice()}
        </section>
        <section class="card onboarding-cta-card">
          ${historyApi.renderCharacterHistorySelector("home-character-history-select", null, {
            className: "character-history-control onboarding-history-select",
          })}
          <div class="onboarding-actions">
            <button class="${openLastButtonClass}" id="home-open-last" type="button" ${hasLastCharacter ? "" : "disabled"}>
              Open Last Character
            </button>
            <button class="${createButtonClass}" id="home-create-character" type="button">Create Character</button>
          </div>
          <p class="muted onboarding-last-character">
            ${
              hasLastCharacter
                ? `Last character: ${esc(lastCharacterSummary)}`
                : "No recent character found in this browser."
            }
          </p>
          <div class="onboarding-actions onboarding-party-actions">
            <button class="btn onboarding-create-btn" id="home-open-last-party" type="button" ${hasLastParty ? "" : "disabled"}>
              Open Last Party
            </button>
            <button class="btn secondary" id="home-create-party" type="button">Create Party</button>
          </div>
          <p class="muted onboarding-last-character">Recent party: ${esc(lastPartySummary)}</p>
        </section>
      </main>
    `;
  }

  function bindOnboardingEvents() {
    app.querySelector("#home-character-history-select")?.addEventListener("change", async (evt) => {
      const selectedId = String(evt.target.value || "").trim();
      if (!selectedId) return;
      evt.target.disabled = true;
      try {
        if (selectedId === newCharacterOptionValue) {
          await createAndOpenNewCharacter();
          return;
        }
        if (!isUuid(selectedId)) return;
        await switchCharacterFromHistory(selectedId);
      } finally {
        evt.target.disabled = false;
      }
    });

    app.querySelector("#home-create-character")?.addEventListener("click", async () => {
      const button = app.querySelector("#home-create-character");
      if (button) button.disabled = true;
      try {
        await createAndOpenNewCharacter();
      } catch (error) {
        appState.startupErrorMessage = error instanceof Error ? error.message : "Failed to create character";
        renderState(store.getState());
      } finally {
        if (button) button.disabled = false;
      }
    });

    app.querySelector("#home-open-last")?.addEventListener("click", async () => {
      const id = historyApi.getLastCharacterId();
      if (!id) return;
      try {
        setCharacterIdInUrl(id, false);
        await loadCharacterById(id);
        renderState(store.getState());
      } catch (error) {
        appState.startupErrorMessage = error instanceof Error ? error.message : "Failed to load last character";
        historyApi.clearLastCharacterId();
        appState.showOnboardingHome = true;
        renderState(store.getState());
      }
    });

    app.querySelector("#home-create-party")?.addEventListener("click", async () => {
      const button = app.querySelector("#home-create-party");
      if (button) button.disabled = true;
      try {
        await partyFeature.createAndOpenNewParty();
      } catch (error) {
        appState.startupErrorMessage = error instanceof Error ? error.message : "Failed to create party";
        appState.showOnboardingHome = true;
        renderState(store.getState());
      } finally {
        if (button) button.disabled = false;
      }
    });

    app.querySelector("#home-open-last-party")?.addEventListener("click", async () => {
      const partyId = partyFeature.getLastPartyId();
      if (!isUuid(partyId)) return;
      try {
        await partyFeature.loadPartyIntoContext(partyId, { replaceUrl: false });
      } catch (error) {
        appState.startupErrorMessage = error instanceof Error ? error.message : "Failed to load last party";
        appState.showOnboardingHome = true;
        renderState(store.getState());
      }
    });
  }

  return {
    renderOnboardingHome,
    bindOnboardingEvents,
  };
}

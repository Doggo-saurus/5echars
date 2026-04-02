export function createBootstrap({
  isUuid,
  appState,
  render,
  loadCharacterById,
  bootstrapPersistence,
  flushPendingSaves,
  partyFeature,
  getCharacterIdFromUrl,
}) {
  let serviceWorkerRefreshPending = false;
  let serviceWorkerUpdateTimer = null;

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      registration.update().catch(() => {});
      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            installing.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (serviceWorkerRefreshPending) return;
        serviceWorkerRefreshPending = true;
        window.location.reload();
      });
      if (serviceWorkerUpdateTimer != null) {
        clearInterval(serviceWorkerUpdateTimer);
      }
      serviceWorkerUpdateTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") {
          registration.update().catch(() => {});
        }
      }, 60_000);
    } catch (error) {
      console.error("Service worker registration failed", error);
    }
  }

  async function syncAppRouteFromUrl() {
    const requestedCharacterId = getCharacterIdFromUrl();
    if (requestedCharacterId) {
      try {
        await loadCharacterById(requestedCharacterId);
        appState.showOnboardingHome = false;
        appState.startupErrorMessage = "";
        render();
        return;
      } catch (error) {
        appState.startupErrorMessage = error instanceof Error ? error.message : "Failed to load character";
        appState.showOnboardingHome = true;
        render();
        return;
      }
    }

    const requestedPartyId = partyFeature.getPartyIdFromUrl();
    if (requestedPartyId) {
      await partyFeature.loadPartyIntoContext(requestedPartyId, { replaceUrl: true });
      return;
    }

    partyFeature.clearActiveParty();
    await bootstrapPersistence();
  }

  function bindGlobalEvents() {
    window.addEventListener("online", () => {
      flushPendingSaves().catch((error) => {
        console.error("Pending sync flush failed", error);
      });
    });
    window.addEventListener("popstate", () => {
      syncAppRouteFromUrl().catch((error) => {
        console.error("Navigation sync failed", error);
      });
    });
  }

  async function bootstrap() {
    await syncAppRouteFromUrl();
  }

  return {
    registerServiceWorker,
    syncAppRouteFromUrl,
    bindGlobalEvents,
    bootstrap,
  };
}

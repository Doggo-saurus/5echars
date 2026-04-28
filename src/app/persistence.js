import { createCharacterSyncController } from "./persistence/sync-controller.js";

export function createPersistence(deps) {
  const d = deps;

  const syncController = createCharacterSyncController({
    core: {
      store: d.store,
      appState: d.appState,
      isUuid: d.isUuid,
      initialSyncedCharacter: d.persistedState?.character,
    },
    api: {
      getCharacter: d.getCharacter,
      createCharacter: d.createCharacter,
      saveCharacter: d.saveCharacter,
      patchCharacter: d.patchCharacter,
      flushPendingCharacterSync: d.flushPendingCharacterSync,
      clearPendingCharacterSync: d.clearPendingCharacterSync,
      applyRemoteCharacterPayload: d.applyRemoteCharacterPayload,
      setCharacterIdInUrl: d.setCharacterIdInUrl,
      getCharacterFromApiPayload: d.getCharacterFromApiPayload,
    },
    syncMeta: {
      getCharacterVersion: d.getCharacterVersion,
      withSyncMeta: d.withSyncMeta,
      withCharacterChangeLog: d.withCharacterChangeLog,
    },
    hooks: {
      updatePersistenceStatusFromPayload: d.updatePersistenceStatusFromPayload,
      markBrowserOnlyPersistence: d.markBrowserOnlyPersistence,
      onEditPasswordRequired: d.onEditPasswordRequired,
      onStaleWriteConflict: d.onStaleWriteConflict,
    },
  });

  async function loadCharacterById(characterId) {
    await syncController.flushPendingSaves();
    const latestLocalState = d.loadAppState();
    const localCharacter = latestLocalState?.character && latestLocalState.character.id === characterId ? latestLocalState.character : null;
    let payload = null;
    try {
      payload = await d.getCharacter(characterId);
      d.updatePersistenceStatusFromPayload(payload);
    } catch (error) {
      const status = Number(error?.status);
      const isNotFound = status === 404 || (error instanceof Error && error.message.toLowerCase().includes("character not found"));
      if (!isNotFound || !localCharacter) {
        throw error;
      }
      await d.applyRemoteCharacterPayload({ id: characterId, character: localCharacter }, characterId, "play");
      try {
        const nextCharacter = d.withSyncMeta(d.withCharacterChangeLog(localCharacter), d.getCharacterVersion(localCharacter));
        await syncController.syncVersionedCharacter({
          characterId,
          versionedCharacter: nextCharacter,
          defaultMode: "play",
        });
      } catch (syncError) {
        syncController.handleSyncError(syncError, characterId);
      }
      return;
    }

    const remoteCharacter = d.getCharacterFromApiPayload(payload, characterId).character;
    d.appState.lastKnownServerCharacterVersion = d.getCharacterVersion(remoteCharacter);
    d.appState.lastKnownServerCharacterUpdatedAt =
      (typeof remoteCharacter?.__syncMeta?.updatedAt === "string" && remoteCharacter.__syncMeta.updatedAt) ||
      d.appState.lastKnownServerCharacterUpdatedAt;
    const shouldUseRemote = d.isRemoteSameOrNewer(localCharacter, remoteCharacter);
    const selectedPayload = shouldUseRemote ? payload : { ...payload, id: characterId, character: localCharacter };
    await d.applyRemoteCharacterPayload(selectedPayload, characterId, "play");
    syncController.setLastSyncedCharacter(d.store.getState()?.character);

    if (!shouldUseRemote && localCharacter) {
      try {
        const nextCharacter = d.withSyncMeta(d.withCharacterChangeLog(localCharacter), d.getCharacterVersion(localCharacter));
        await syncController.syncVersionedCharacter({
          characterId,
          versionedCharacter: nextCharacter,
          defaultMode: "play",
        });
      } catch (error) {
        syncController.handleSyncError(error, characterId);
      }
    }
  }

  async function bootstrap() {
    await syncController.flushPendingSaves();
    const requestedCharacterId = d.getCharacterIdFromUrl();

    if (requestedCharacterId) {
      try {
        await loadCharacterById(requestedCharacterId);
        return;
      } catch (error) {
        d.appState.startupErrorMessage = error instanceof Error ? error.message : "Failed to load character";
        d.appState.showOnboardingHome = true;
      }
    } else {
      d.appState.showOnboardingHome = true;
    }

    if (!d.appState.showOnboardingHome) {
      if (d.persistedState?.mode === "play") d.store.setMode("play");
      if (Number.isFinite(d.persistedState?.stepIndex)) d.store.setStep(d.persistedState.stepIndex);
      const persistedCharacter = d.persistedState?.character;
      const sourcePreset = persistedCharacter?.sourcePreset ?? d.defaultSourcePreset;
      await d.loadCatalogsForCharacter(persistedCharacter ?? { sourcePreset });
      return;
    }

    d.render(d.store.getState());
  }

  return {
    loadCharacterById,
    createOrSavePermanentCharacter: syncController.createOrSavePermanentCharacter,
    queueRemoteSave: syncController.queueRemoteSave,
    bootstrap,
    flushPendingSaves: syncController.flushPendingSaves,
  };
}

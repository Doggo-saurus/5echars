export function createPersistence(deps) {
  const {
    store,
    loadAppState,
    getCharacter,
    saveCharacter,
    createCharacter,
    isUuid,
    getCharacterVersion,
    withSyncMeta,
    getCharacterFromApiPayload,
    updatePersistenceStatusFromPayload,
    markBrowserOnlyPersistence,
    applyRemoteCharacterPayload,
    isRemoteSameOrNewer,
    setCharacterIdInUrl,
    getCharacterIdFromUrl,
    loadCatalogsForCharacter,
    render,
    persistedState,
    appState,
    defaultSourcePreset,
  } = deps;

  async function loadCharacterById(characterId) {
    const latestLocalState = loadAppState();
    const localCharacter = latestLocalState?.character && latestLocalState.character.id === characterId ? latestLocalState.character : null;
    let payload = null;
    try {
      payload = await getCharacter(characterId);
      updatePersistenceStatusFromPayload(payload);
    } catch (error) {
      const status = Number(error?.status);
      const isNotFound = status === 404 || (error instanceof Error && error.message.toLowerCase().includes("character not found"));
      if (!isNotFound || !localCharacter) {
        throw error;
      }
      await applyRemoteCharacterPayload({ id: characterId, character: localCharacter }, characterId, "play");
      try {
        const synced = await saveCharacter(characterId, withSyncMeta(localCharacter, getCharacterVersion(localCharacter)));
        updatePersistenceStatusFromPayload(synced);
      } catch (syncError) {
        markBrowserOnlyPersistence(syncError);
      }
      return;
    }

    const remoteCharacter = getCharacterFromApiPayload(payload, characterId).character;
    const shouldUseRemote = isRemoteSameOrNewer(localCharacter, remoteCharacter);
    const selectedPayload = shouldUseRemote ? payload : { ...payload, id: characterId, character: localCharacter };
    await applyRemoteCharacterPayload(selectedPayload, characterId, "play");

    if (!shouldUseRemote && localCharacter) {
      try {
        const synced = await saveCharacter(characterId, withSyncMeta(localCharacter, getCharacterVersion(localCharacter)));
        updatePersistenceStatusFromPayload(synced);
      } catch (error) {
        markBrowserOnlyPersistence(error);
      }
    }
  }

  async function createOrSavePermanentCharacter(state) {
    const existingId = isUuid(state.character?.id) ? state.character.id : null;
    const nextVersion = Math.max(appState.localCharacterVersion, getCharacterVersion(state.character)) + 1;
    const versionedCharacter = withSyncMeta(state.character, nextVersion);
    if (existingId) {
      const payload = await saveCharacter(existingId, versionedCharacter);
      await applyRemoteCharacterPayload(payload, existingId);
      setCharacterIdInUrl(existingId, true);
      return existingId;
    }

    const payload = await createCharacter(versionedCharacter);
    const parsed = getCharacterFromApiPayload(payload, null);
    setCharacterIdInUrl(parsed.id, false);
    await applyRemoteCharacterPayload(payload, parsed.id);
    return parsed.id;
  }

  function queueRemoteSave(state) {
    if (appState.isRemoteSaveSuppressed || appState.showOnboardingHome) return;
    const characterId = state.character?.id;
    if (!isUuid(characterId)) return;
    const existingTimer = appState.remoteSaveTimer;
    if (existingTimer != null) {
      clearTimeout(existingTimer);
    }
    appState.remoteSaveTimer = setTimeout(async () => {
      appState.remoteSaveTimer = null;
        try {
          const latestState = store.getState();
          const nextVersion = Math.max(appState.localCharacterVersion, getCharacterVersion(latestState.character)) + 1;
          const versionedCharacter = withSyncMeta(latestState.character, nextVersion);
          const payload = await saveCharacter(characterId, versionedCharacter);
          appState.localCharacterVersion = Math.max(appState.localCharacterVersion, nextVersion);
          appState.localCharacterUpdatedAt = withSyncMeta(versionedCharacter, nextVersion).__syncMeta?.updatedAt ?? appState.localCharacterUpdatedAt;
          updatePersistenceStatusFromPayload(payload);
        } catch (error) {
          console.error("Remote character save failed", error);
          markBrowserOnlyPersistence(error);
        }
      }, 700);
  }

  async function bootstrap() {
    const requestedCharacterId = getCharacterIdFromUrl();

    if (requestedCharacterId) {
      try {
        await loadCharacterById(requestedCharacterId);
        return;
      } catch (error) {
        appState.startupErrorMessage = error instanceof Error ? error.message : "Failed to load character";
        appState.showOnboardingHome = true;
      }
    } else {
      appState.showOnboardingHome = true;
    }

    if (!appState.showOnboardingHome) {
      if (persistedState?.mode === "play") store.setMode("play");
      if (Number.isFinite(persistedState?.stepIndex)) store.setStep(persistedState.stepIndex);
      const sourcePreset = persistedState?.character?.sourcePreset ?? defaultSourcePreset;
      await loadCatalogsForCharacter({ sourcePreset });
      return;
    }

    render(store.getState());
  }

  return { loadCharacterById, createOrSavePermanentCharacter, queueRemoteSave, bootstrap };
}

export function createPersistence(deps) {
  const {
    store,
    loadAppState,
    getCharacter,
    saveCharacter,
    createCharacter,
    flushPendingCharacterSync,
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
    withCharacterChangeLog,
    onEditPasswordRequired,
  } = deps;

  const isInvalidEditPasswordError = (error) =>
    Number(error?.status) === 403 && String(error?.payload?.code ?? "") === "INVALID_EDIT_PASSWORD";

  const handleSyncError = (error, characterId = null) => {
    if (isInvalidEditPasswordError(error)) {
      let handledByPasswordUi = false;
      if (typeof onEditPasswordRequired === "function" && isUuid(characterId)) {
        handledByPasswordUi = onEditPasswordRequired(characterId, error) === true;
      }
      if (!handledByPasswordUi) {
        markBrowserOnlyPersistence(error);
      }
      return;
    }
    markBrowserOnlyPersistence(error);
  };

  async function flushPendingSaves() {
    if (typeof flushPendingCharacterSync !== "function") return { flushed: 0, pending: 0 };
    try {
      return await flushPendingCharacterSync();
    } catch (error) {
      markBrowserOnlyPersistence(error);
      return { flushed: 0, pending: null };
    }
  }

  async function loadCharacterById(characterId) {
    await flushPendingSaves();
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
        const synced = await saveCharacter(
          characterId,
          withSyncMeta(withCharacterChangeLog(localCharacter), getCharacterVersion(localCharacter))
        );
        updatePersistenceStatusFromPayload(synced);
      } catch (syncError) {
        handleSyncError(syncError, characterId);
      }
      return;
    }

    const remoteCharacter = getCharacterFromApiPayload(payload, characterId).character;
    const shouldUseRemote = isRemoteSameOrNewer(localCharacter, remoteCharacter);
    const selectedPayload = shouldUseRemote ? payload : { ...payload, id: characterId, character: localCharacter };
    await applyRemoteCharacterPayload(selectedPayload, characterId, "play");

    if (!shouldUseRemote && localCharacter) {
      try {
        const synced = await saveCharacter(
          characterId,
          withSyncMeta(withCharacterChangeLog(localCharacter), getCharacterVersion(localCharacter))
        );
        updatePersistenceStatusFromPayload(synced);
      } catch (error) {
        handleSyncError(error, characterId);
      }
    }
  }

  async function createOrSavePermanentCharacter(state) {
    await flushPendingSaves();
    const existingId = isUuid(state.character?.id) ? state.character.id : null;
    const nextVersion = Math.max(appState.localCharacterVersion, getCharacterVersion(state.character)) + 1;
    const versionedCharacter = withSyncMeta(withCharacterChangeLog(state.character), nextVersion);
    if (existingId) {
      const payload = await saveCharacter(existingId, versionedCharacter);
      await applyRemoteCharacterPayload(payload, existingId);
      await flushPendingSaves();
      setCharacterIdInUrl(existingId, true);
      return existingId;
    }

    const payload = await createCharacter(versionedCharacter);
    const parsed = getCharacterFromApiPayload(payload, null);
    setCharacterIdInUrl(parsed.id, false);
    await applyRemoteCharacterPayload(payload, parsed.id);
    await flushPendingSaves();
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
          await flushPendingSaves();
          const latestState = store.getState();
          const nextVersion = Math.max(appState.localCharacterVersion, getCharacterVersion(latestState.character)) + 1;
          const versionedCharacter = withSyncMeta(withCharacterChangeLog(latestState.character), nextVersion);
          const payload = await saveCharacter(characterId, versionedCharacter);
          appState.localCharacterVersion = Math.max(appState.localCharacterVersion, nextVersion);
          appState.localCharacterUpdatedAt = withSyncMeta(versionedCharacter, nextVersion).__syncMeta?.updatedAt ?? appState.localCharacterUpdatedAt;
          updatePersistenceStatusFromPayload(payload);
          await flushPendingSaves();
        } catch (error) {
          console.error("Remote character save failed", error);
          handleSyncError(error, characterId);
        }
      }, 700);
  }

  async function bootstrap() {
    await flushPendingSaves();
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
      const persistedCharacter = persistedState?.character;
      const sourcePreset = persistedCharacter?.sourcePreset ?? defaultSourcePreset;
      await loadCatalogsForCharacter(persistedCharacter ?? { sourcePreset });
      return;
    }

    render(store.getState());
  }

  return { loadCharacterById, createOrSavePermanentCharacter, queueRemoteSave, bootstrap, flushPendingSaves };
}

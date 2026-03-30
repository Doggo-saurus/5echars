export function createPersistence(deps) {
  const {
    store,
    loadAppState,
    getCharacter,
    saveCharacter,
    patchCharacter,
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
  const isPlainObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
  const cloneCharacter = (character) => {
    if (!isPlainObject(character)) return null;
    if (typeof structuredClone === "function") return structuredClone(character);
    try {
      return JSON.parse(JSON.stringify(character));
    } catch {
      return { ...character };
    }
  };
  const deepEqual = (left, right) => {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) return false;
      for (let i = 0; i < left.length; i += 1) {
        if (!deepEqual(left[i], right[i])) return false;
      }
      return true;
    }
    if (isPlainObject(left) && isPlainObject(right)) {
      const leftKeys = Object.keys(left);
      const rightKeys = Object.keys(right);
      if (leftKeys.length !== rightKeys.length) return false;
      for (const key of leftKeys) {
        if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
        if (!deepEqual(left[key], right[key])) return false;
      }
      return true;
    }
    return false;
  };
  const buildMergePatch = (previousValue, nextValue) => {
    const previous = isPlainObject(previousValue) ? previousValue : {};
    const next = isPlainObject(nextValue) ? nextValue : {};
    const patch = {};
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    for (const key of keys) {
      const hasNext = Object.prototype.hasOwnProperty.call(next, key);
      if (!hasNext) {
        patch[key] = null;
        continue;
      }
      const previousItem = previous[key];
      const nextItem = next[key];
      if (isPlainObject(previousItem) && isPlainObject(nextItem)) {
        const nestedPatch = buildMergePatch(previousItem, nextItem);
        if (Object.keys(nestedPatch).length > 0) patch[key] = nestedPatch;
        continue;
      }
      if (!deepEqual(previousItem, nextItem)) patch[key] = nextItem;
    }
    return patch;
  };
  let lastSyncedCharacter = cloneCharacter(persistedState?.character);

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
        lastSyncedCharacter = cloneCharacter(store.getState()?.character);
      } catch (syncError) {
        handleSyncError(syncError, characterId);
      }
      return;
    }

    const remoteCharacter = getCharacterFromApiPayload(payload, characterId).character;
    const shouldUseRemote = isRemoteSameOrNewer(localCharacter, remoteCharacter);
    const selectedPayload = shouldUseRemote ? payload : { ...payload, id: characterId, character: localCharacter };
    await applyRemoteCharacterPayload(selectedPayload, characterId, "play");
    lastSyncedCharacter = cloneCharacter(store.getState()?.character);

    if (!shouldUseRemote && localCharacter) {
      try {
        const synced = await saveCharacter(
          characterId,
          withSyncMeta(withCharacterChangeLog(localCharacter), getCharacterVersion(localCharacter))
        );
        updatePersistenceStatusFromPayload(synced);
        lastSyncedCharacter = cloneCharacter(store.getState()?.character);
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
      lastSyncedCharacter = cloneCharacter(store.getState()?.character);
      await flushPendingSaves();
      setCharacterIdInUrl(existingId, true);
      return existingId;
    }

    const payload = await createCharacter(versionedCharacter);
    const parsed = getCharacterFromApiPayload(payload, null);
    setCharacterIdInUrl(parsed.id, false);
    await applyRemoteCharacterPayload(payload, parsed.id);
    lastSyncedCharacter = cloneCharacter(store.getState()?.character);
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
          const canUsePatch = typeof patchCharacter === "function" && latestState.mode === "play";
          const patchCharacterPayload = canUsePatch ? buildMergePatch(lastSyncedCharacter, versionedCharacter) : null;
          if (canUsePatch && Object.keys(patchCharacterPayload).length === 0) {
            return;
          }
          const payload = canUsePatch
            ? await patchCharacter(characterId, patchCharacterPayload)
            : await saveCharacter(characterId, versionedCharacter);
          appState.localCharacterVersion = Math.max(appState.localCharacterVersion, nextVersion);
          appState.localCharacterUpdatedAt =
            (canUsePatch ? patchCharacterPayload : versionedCharacter)?.__syncMeta?.updatedAt ?? appState.localCharacterUpdatedAt;
          lastSyncedCharacter = cloneCharacter(versionedCharacter);
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

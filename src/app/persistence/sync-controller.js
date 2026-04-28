import { createConflictResolutionController } from "./conflict-resolution.js";
import { buildMergePatch, cloneCharacter, withPartySnapshot } from "./sync-utils.js";

export function createCharacterSyncController(deps) {
  const core = deps.core;
  const api = deps.api;
  const syncMeta = deps.syncMeta;
  const hooks = deps.hooks;

  let lastSyncedCharacter = cloneCharacter(core.initialSyncedCharacter);

  function getKnownServerVersion() {
    const parsed = Number(core.appState.lastKnownServerCharacterVersion);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
  }

  function getKnownServerUpdatedAt() {
    return typeof core.appState.lastKnownServerCharacterUpdatedAt === "string"
      ? core.appState.lastKnownServerCharacterUpdatedAt
      : "";
  }

  function updateKnownServerStateFromPayload(payload) {
    const version = syncMeta.getCharacterVersion(payload?.character);
    const updatedAt = typeof payload?.character?.__syncMeta?.updatedAt === "string"
      ? payload.character.__syncMeta.updatedAt
      : "";
    if (version > 0) {
      core.appState.lastKnownServerCharacterVersion = version;
    }
    if (updatedAt) {
      core.appState.lastKnownServerCharacterUpdatedAt = updatedAt;
    }
  }

  function setLastSyncedCharacter(character) {
    lastSyncedCharacter = cloneCharacter(character);
  }

  const conflictController = createConflictResolutionController({
    core,
    api,
    syncMeta,
    hooks,
    setLastSyncedCharacter,
  });

  async function flushPendingSaves() {
    if (typeof api.flushPendingCharacterSync !== "function") return { flushed: 0, pending: 0 };
    try {
      return await api.flushPendingCharacterSync();
    } catch (error) {
      hooks.markBrowserOnlyPersistence(error);
      return { flushed: 0, pending: null };
    }
  }

  async function syncVersionedCharacter({
    characterId,
    versionedCharacter,
    defaultMode = "play",
  }) {
    const result = await conflictController.saveWithConflictResolution({
      characterId,
      localCharacter: versionedCharacter,
      runSave: (overwriteAuthorization) =>
        api.saveCharacter(characterId, versionedCharacter, {
          overwriteAuthorization,
          baseServerVersion: getKnownServerVersion(),
          baseServerUpdatedAt: getKnownServerUpdatedAt(),
        }),
      defaultMode,
    });
    if (result.saved) {
      setLastSyncedCharacter(core.store.getState()?.character);
      updateKnownServerStateFromPayload(result.payload);
    }
    return result;
  }

  async function createOrSavePermanentCharacter(state) {
    await flushPendingSaves();
    const existingId = core.isUuid(state.character?.id) ? state.character.id : null;
    const nextVersion = Math.max(core.appState.localCharacterVersion, syncMeta.getCharacterVersion(state.character)) + 1;
    const bakedCharacter = withPartySnapshot(state, state.character);
    const versionedCharacter = syncMeta.withSyncMeta(syncMeta.withCharacterChangeLog(bakedCharacter), nextVersion);

    if (existingId) {
      const result = await conflictController.saveWithConflictResolution({
        characterId: existingId,
        localCharacter: versionedCharacter,
        runSave: (overwriteAuthorization) =>
          api.saveCharacter(existingId, versionedCharacter, {
            overwriteAuthorization,
            baseServerVersion: getKnownServerVersion(),
            baseServerUpdatedAt: getKnownServerUpdatedAt(),
          }),
        defaultMode: state.mode,
      });
      if (!result.saved) return existingId;
      updateKnownServerStateFromPayload(result.payload);
      await api.applyRemoteCharacterPayload(result.payload, existingId);
      setLastSyncedCharacter(core.store.getState()?.character);
      await flushPendingSaves();
      api.setCharacterIdInUrl(existingId, true);
      return existingId;
    }

    const payload = await api.createCharacter(versionedCharacter);
    const parsed = api.getCharacterFromApiPayload(payload, null);
    api.setCharacterIdInUrl(parsed.id, false);
    updateKnownServerStateFromPayload(payload);
    await api.applyRemoteCharacterPayload(payload, parsed.id);
    setLastSyncedCharacter(core.store.getState()?.character);
    await flushPendingSaves();
    return parsed.id;
  }

  function queueRemoteSave(state) {
    if (core.appState.isRemoteSaveSuppressed || core.appState.showOnboardingHome) return;
    const characterId = state.character?.id;
    if (!core.isUuid(characterId)) return;

    const existingTimer = core.appState.remoteSaveTimer;
    if (existingTimer != null) {
      clearTimeout(existingTimer);
    }

    core.appState.remoteSaveTimer = setTimeout(async () => {
      core.appState.remoteSaveTimer = null;
      try {
        await flushPendingSaves();
        const latestState = core.store.getState();
        const nextVersion = Math.max(core.appState.localCharacterVersion, syncMeta.getCharacterVersion(latestState.character)) + 1;
        const bakedCharacter = withPartySnapshot(latestState, latestState.character);
        const versionedCharacter = syncMeta.withSyncMeta(syncMeta.withCharacterChangeLog(bakedCharacter), nextVersion);
        const canUsePatch = typeof api.patchCharacter === "function" && latestState.mode === "play";
        const patchCharacterPayload = canUsePatch ? buildMergePatch(lastSyncedCharacter, versionedCharacter) : null;
        if (canUsePatch && Object.keys(patchCharacterPayload).length === 0) {
          return;
        }

        const runSave = (overwriteAuthorization = null) =>
          canUsePatch
            ? api.patchCharacter(characterId, patchCharacterPayload, {
                overwriteAuthorization,
                baseServerVersion: getKnownServerVersion(),
                baseServerUpdatedAt: getKnownServerUpdatedAt(),
              })
            : api.saveCharacter(characterId, versionedCharacter, {
                overwriteAuthorization,
                baseServerVersion: getKnownServerVersion(),
                baseServerUpdatedAt: getKnownServerUpdatedAt(),
              });

        const result = await conflictController.saveWithConflictResolution({
          characterId,
          localCharacter: versionedCharacter,
          runSave,
          defaultMode: latestState.mode,
        });
        if (!result.saved) return;
        updateKnownServerStateFromPayload(result.payload);

        core.appState.localCharacterVersion = Math.max(core.appState.localCharacterVersion, nextVersion);
        core.appState.localCharacterUpdatedAt =
          (canUsePatch ? patchCharacterPayload : versionedCharacter)?.__syncMeta?.updatedAt ?? core.appState.localCharacterUpdatedAt;
        setLastSyncedCharacter(versionedCharacter);
        await flushPendingSaves();
      } catch (error) {
        console.error("Remote character save failed", error);
        conflictController.handleSyncError(error, characterId);
      }
    }, 700);
  }

  return {
    flushPendingSaves,
    setLastSyncedCharacter,
    handleSyncError: conflictController.handleSyncError,
    syncVersionedCharacter,
    createOrSavePermanentCharacter,
    queueRemoteSave,
  };
}

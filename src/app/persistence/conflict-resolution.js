import { cloneCharacter, isPlainObject } from "./sync-utils.js";

const STALE_CHARACTER_WRITE_CODE = "STALE_CHARACTER_WRITE";
const STALE_CONFLICT_MODAL_COOLDOWN_MS = 1000;

function toNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function toTimestampString(value) {
  return typeof value === "string" ? value : "";
}

export function createConflictResolutionController(deps) {
  const {
    core,
    api,
    syncMeta,
    hooks,
    setLastSyncedCharacter,
  } = deps;

  const staleConflictActiveCharacterIds = new Set();
  const staleConflictCooldownUntilByCharacter = new Map();

  const isInvalidEditPasswordError = (error) =>
    Number(error?.status) === 403 && String(error?.payload?.code ?? "") === "INVALID_EDIT_PASSWORD";
  const isStaleCharacterWriteError = (error) =>
    Number(error?.status) === 409 && String(error?.payload?.code ?? "") === STALE_CHARACTER_WRITE_CODE;

  function getConflictPayload(error, localCharacter) {
    const payload = isPlainObject(error?.payload) ? error.payload : {};
    return {
      code: STALE_CHARACTER_WRITE_CODE,
      serverVersion: toNonNegativeInteger(payload.serverVersion),
      serverUpdatedAt: toTimestampString(payload.serverUpdatedAt),
      clientVersion: toNonNegativeInteger(payload.clientVersion ?? payload.baseServerVersion),
      clientUpdatedAt: toTimestampString(payload.clientUpdatedAt ?? payload.baseServerUpdatedAt),
    };
  }

  function buildOverwriteAuthorization(conflict) {
    return {
      confirmOverwriteNewer: true,
      serverVersion: toNonNegativeInteger(conflict?.serverVersion),
      serverUpdatedAt: toTimestampString(conflict?.serverUpdatedAt),
      clientVersion: toNonNegativeInteger(conflict?.clientVersion),
      clientUpdatedAt: toTimestampString(conflict?.clientUpdatedAt),
    };
  }

  function handleSyncError(error, characterId = null) {
    if (isInvalidEditPasswordError(error)) {
      let handledByPasswordUi = false;
      if (typeof hooks.onEditPasswordRequired === "function" && core.isUuid(characterId)) {
        handledByPasswordUi = hooks.onEditPasswordRequired(characterId, error) === true;
      }
      if (!handledByPasswordUi) hooks.markBrowserOnlyPersistence(error);
      return;
    }
    hooks.markBrowserOnlyPersistence(error);
  }

  async function resolveStaleWriteConflict({
    error,
    characterId,
    localCharacter,
    retrySave,
    defaultMode = "play",
  }) {
    if (!isStaleCharacterWriteError(error) || !core.isUuid(characterId)) {
      return { handled: false, resolution: "none", payload: null };
    }
    if (staleConflictActiveCharacterIds.has(characterId)) {
      return { handled: true, resolution: "cancel", payload: null };
    }
    const now = Date.now();
    const cooldownUntil = Number(staleConflictCooldownUntilByCharacter.get(characterId) ?? 0);
    if (cooldownUntil > now) {
      return { handled: true, resolution: "cancel", payload: null };
    }
    staleConflictActiveCharacterIds.add(characterId);
    try {
      const conflict = getConflictPayload(error, localCharacter);
      const requestedResolution =
        typeof hooks.onStaleWriteConflict === "function"
          ? await hooks.onStaleWriteConflict({
              characterId,
              conflict,
              localCharacter: cloneCharacter(localCharacter),
            })
          : "cancel";
      if (requestedResolution === "overwrite" && typeof retrySave === "function") {
        const payload = await retrySave(buildOverwriteAuthorization(conflict));
        staleConflictCooldownUntilByCharacter.delete(characterId);
        return { handled: true, resolution: "overwrite", payload };
      }
      if (requestedResolution === "reload") {
        if (typeof api.clearPendingCharacterSync === "function") {
          api.clearPendingCharacterSync(characterId);
        }
        const payload = await api.getCharacter(characterId);
        hooks.updatePersistenceStatusFromPayload(payload);
        await api.applyRemoteCharacterPayload(payload, characterId, defaultMode);
        setLastSyncedCharacter(core.store.getState()?.character);
        staleConflictCooldownUntilByCharacter.delete(characterId);
        return { handled: true, resolution: "reload", payload };
      }
      staleConflictCooldownUntilByCharacter.set(characterId, Date.now() + STALE_CONFLICT_MODAL_COOLDOWN_MS);
      return { handled: true, resolution: "cancel", payload: null };
    } catch (resolutionError) {
      handleSyncError(resolutionError, characterId);
      staleConflictCooldownUntilByCharacter.set(characterId, Date.now() + STALE_CONFLICT_MODAL_COOLDOWN_MS);
      return { handled: true, resolution: "cancel", payload: null };
    } finally {
      staleConflictActiveCharacterIds.delete(characterId);
    }
  }

  async function saveWithConflictResolution({
    characterId,
    localCharacter,
    runSave,
    defaultMode = "play",
  }) {
    try {
      const payload = await runSave();
      hooks.updatePersistenceStatusFromPayload(payload);
      return { saved: true, payload };
    } catch (error) {
      const conflictResolution = await resolveStaleWriteConflict({
        error,
        characterId,
        localCharacter,
        retrySave: (overwriteAuthorization) => runSave(overwriteAuthorization),
        defaultMode,
      });
      if (!conflictResolution.handled) throw error;
      if (conflictResolution.resolution !== "overwrite") return { saved: false, payload: conflictResolution.payload };
      hooks.updatePersistenceStatusFromPayload(conflictResolution.payload);
      return { saved: true, payload: conflictResolution.payload };
    }
  }

  return {
    handleSyncError,
    saveWithConflictResolution,
  };
}

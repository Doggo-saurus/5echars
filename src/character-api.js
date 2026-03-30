const DEFAULT_API_BASE = "/api";
const LOCAL_CHARACTER_STORE_KEY = "fivee-character-local-store-v1";
const LOCAL_SYNC_QUEUE_KEY = "fivee-character-sync-queue-v1";
const LOCAL_EDIT_PASSWORD_STORE_KEY = "fivee-character-edit-password-store-v1";
const EDIT_PASSWORD_FIELD = "editPassword";
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getApiBase() {
  const runtimeBase = globalThis.__CHAR_API_BASE__;
  if (typeof runtimeBase === "string" && runtimeBase.trim()) {
    return runtimeBase.replace(/\/+$/, "");
  }
  return DEFAULT_API_BASE;
}

function isUuid(value) {
  return UUID_V4_REGEX.test(String(value ?? "").trim());
}

function createLocalUuid() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return template.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const next = char === "x" ? random : (random & 0x3) | 0x8;
    return next.toString(16);
  });
}

function isOnline() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

function readJsonStorage(key, fallbackValue) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallbackValue;
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

function writeJsonStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeCharacterForId(id, character) {
  const next = character && typeof character === "object" && !Array.isArray(character) ? character : {};
  return { ...next, id };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function applyCharacterMergePatch(existingCharacter, patchCharacter) {
  const base = isPlainObject(existingCharacter) ? { ...existingCharacter } : {};
  if (!isPlainObject(patchCharacter)) return base;

  for (const [key, value] of Object.entries(patchCharacter)) {
    if (value === null) {
      delete base[key];
      continue;
    }
    if (isPlainObject(value) && isPlainObject(base[key])) {
      base[key] = applyCharacterMergePatch(base[key], value);
      continue;
    }
    base[key] = value;
  }
  return base;
}

function hasOwnEditPassword(character) {
  return Boolean(
    character &&
      typeof character === "object" &&
      !Array.isArray(character) &&
      Object.prototype.hasOwnProperty.call(character, EDIT_PASSWORD_FIELD)
  );
}

function preserveLocalEditPassword(remoteCharacter, localCharacter) {
  if (hasOwnEditPassword(remoteCharacter)) return remoteCharacter;
  if (!localCharacter || typeof localCharacter !== "object" || Array.isArray(localCharacter)) return remoteCharacter;
  const localPassword = localCharacter[EDIT_PASSWORD_FIELD];
  if (typeof localPassword !== "string" || !localPassword) return remoteCharacter;
  return { ...remoteCharacter, [EDIT_PASSWORD_FIELD]: localPassword };
}

function readLocalEditPasswordStore() {
  const parsed = readJsonStorage(LOCAL_EDIT_PASSWORD_STORE_KEY, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed;
}

function writeLocalEditPasswordStore(store) {
  writeJsonStorage(LOCAL_EDIT_PASSWORD_STORE_KEY, store);
}

function getStoredEditPasswordForCharacter(id) {
  if (!isUuid(id)) return "";
  const store = readLocalEditPasswordStore();
  const value = store[id];
  return typeof value === "string" ? value : "";
}

function syncStoredEditPasswordForCharacter(id, character) {
  if (!isUuid(id)) return;
  if (!character || typeof character !== "object" || Array.isArray(character)) return;
  if (!hasOwnEditPassword(character)) return;
  const store = readLocalEditPasswordStore();
  const rawPassword = character[EDIT_PASSWORD_FIELD];
  const nextPassword = typeof rawPassword === "string" ? rawPassword : "";
  if (nextPassword) store[id] = nextPassword;
  else delete store[id];
  writeLocalEditPasswordStore(store);
}

export function getCharacterEditPassword(character) {
  const value = character?.[EDIT_PASSWORD_FIELD];
  return typeof value === "string" ? value : "";
}

function readLocalCharacterStore() {
  const parsed = readJsonStorage(LOCAL_CHARACTER_STORE_KEY, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed;
}

function writeLocalCharacterStore(store) {
  writeJsonStorage(LOCAL_CHARACTER_STORE_KEY, store);
}

function getLocalCharacter(id) {
  if (!isUuid(id)) return null;
  const store = readLocalCharacterStore();
  const entry = store[id];
  if (!entry || typeof entry !== "object") return null;
  const character = normalizeCharacterForId(id, entry.character);
  const storedPassword = getStoredEditPasswordForCharacter(id);
  if (!hasOwnEditPassword(character) && storedPassword) {
    return { ...character, [EDIT_PASSWORD_FIELD]: storedPassword };
  }
  return character;
}

function setLocalCharacter(id, character) {
  if (!isUuid(id)) return;
  const store = readLocalCharacterStore();
  const normalizedCharacter = normalizeCharacterForId(id, character);
  store[id] = {
    character: normalizedCharacter,
    updatedAt: new Date().toISOString(),
  };
  writeLocalCharacterStore(store);
  syncStoredEditPasswordForCharacter(id, normalizedCharacter);
}

function readSyncQueue() {
  const parsed = readJsonStorage(LOCAL_SYNC_QUEUE_KEY, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry) => {
      const id = String(entry?.id ?? "").trim();
      if (!isUuid(id)) return null;
      const character = normalizeCharacterForId(id, entry?.character);
      const queuedAt = typeof entry?.queuedAt === "string" ? entry.queuedAt : new Date().toISOString();
      return { id, character, queuedAt };
    })
    .filter(Boolean);
}

function writeSyncQueue(entries) {
  writeJsonStorage(LOCAL_SYNC_QUEUE_KEY, Array.isArray(entries) ? entries : []);
}

function enqueueSyncCharacter(id, character) {
  if (!isUuid(id)) return;
  const queue = readSyncQueue();
  const filtered = queue.filter((entry) => entry.id !== id);
  filtered.push({
    id,
    character: normalizeCharacterForId(id, character),
    queuedAt: new Date().toISOString(),
  });
  writeSyncQueue(filtered);
}

function dequeueSyncCharacter(id) {
  const queue = readSyncQueue();
  writeSyncQueue(queue.filter((entry) => entry.id !== id));
}

function createOfflineStorageMeta(warning = "offline-local-cache") {
  return {
    durable: false,
    warning,
    offline: true,
  };
}

function shouldUseOfflineFallback(error) {
  const status = Number(error?.status);
  if (!Number.isFinite(status) || status <= 0) return true;
  return status >= 500;
}

function createNotFoundError(message = "Character not found") {
  const error = new Error(message);
  error.status = 404;
  return error;
}

async function parseJsonResponse(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      (payload && typeof payload.error === "string" && payload.error) || `Request failed with ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload ?? {};
}

async function saveCharacterToRemote(id, character, options = {}) {
  const method = options.method === "PATCH" ? "PATCH" : "PUT";
  const requestBody = {
    character: character ?? null,
    editPasswordAttempt: typeof options.editPasswordAttempt === "string" ? options.editPasswordAttempt : "",
  };
  if (options.returnCharacter === false) {
    requestBody.returnCharacter = false;
  }
  if (options.validateOnly === true) {
    requestBody.validateEditPasswordOnly = true;
  }
  const response = await fetch(`${getApiBase()}/characters/${encodeURIComponent(id)}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  return parseJsonResponse(response);
}

function toOfflinePayload(id, character, warning = "offline-local-cache") {
  return {
    id,
    character: normalizeCharacterForId(id, character),
    storage: createOfflineStorageMeta(warning),
  };
}

export async function flushPendingCharacterSync() {
  const queue = readSyncQueue();
  if (!queue.length) {
    return { flushed: 0, pending: 0 };
  }
  if (!isOnline()) {
    return { flushed: 0, pending: queue.length };
  }

  let flushed = 0;
  const pending = [];
  for (const entry of queue) {
    try {
      const payload = await saveCharacterToRemote(entry.id, entry.character, {
        editPasswordAttempt: getCharacterEditPassword(entry.character) || getCharacterEditPassword(getLocalCharacter(entry.id)),
      });
      const remoteId = isUuid(payload?.id) ? payload.id : entry.id;
      const remoteCharacter = preserveLocalEditPassword(
        normalizeCharacterForId(remoteId, payload?.character ?? entry.character),
        entry.character
      );
      setLocalCharacter(remoteId, remoteCharacter);
      dequeueSyncCharacter(entry.id);
      flushed += 1;
    } catch (error) {
      pending.push(entry);
    }
  }
  writeSyncQueue(pending);
  return { flushed, pending: pending.length };
}

export async function createCharacter(character) {
  const baseCharacter = character && typeof character === "object" && !Array.isArray(character) ? character : {};
  try {
    if (isOnline()) {
      const response = await fetch(`${getApiBase()}/characters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ character: baseCharacter }),
      });
      const payload = await parseJsonResponse(response);
      const id = isUuid(payload?.id) ? payload.id : createLocalUuid();
      const remoteCharacter = preserveLocalEditPassword(
        normalizeCharacterForId(id, payload?.character ?? baseCharacter),
        baseCharacter
      );
      setLocalCharacter(id, remoteCharacter);
      dequeueSyncCharacter(id);
      return { ...payload, id, character: remoteCharacter };
    }
  } catch (error) {
    if (!shouldUseOfflineFallback(error)) throw error;
  }

  const id = isUuid(baseCharacter?.id) ? baseCharacter.id : createLocalUuid();
  const offlineCharacter = normalizeCharacterForId(id, baseCharacter);
  setLocalCharacter(id, offlineCharacter);
  enqueueSyncCharacter(id, offlineCharacter);
  return toOfflinePayload(id, offlineCharacter, "offline-create-queued");
}

export async function getCharacter(id) {
  const parsedId = String(id ?? "").trim();
  if (!isUuid(parsedId)) {
    throw createNotFoundError("Invalid character id");
  }
  try {
    if (isOnline()) {
      const response = await fetch(`${getApiBase()}/characters/${encodeURIComponent(parsedId)}`);
      const payload = await parseJsonResponse(response);
      const remoteCharacter = preserveLocalEditPassword(
        normalizeCharacterForId(parsedId, payload?.character),
        getLocalCharacter(parsedId)
      );
      setLocalCharacter(parsedId, remoteCharacter);
      return { ...payload, id: parsedId, character: remoteCharacter };
    }
  } catch (error) {
    const status = Number(error?.status);
    if (status === 404) {
      const localCharacter = getLocalCharacter(parsedId);
      if (localCharacter) {
        return toOfflinePayload(parsedId, localCharacter, "offline-local-read");
      }
      throw error;
    }
    if (!shouldUseOfflineFallback(error)) throw error;
  }

  const localCharacter = getLocalCharacter(parsedId);
  if (localCharacter) {
    return toOfflinePayload(parsedId, localCharacter, "offline-local-read");
  }
  throw createNotFoundError();
}

export async function validateCharacterEditPassword(id, editPasswordAttempt) {
  const parsedId = String(id ?? "").trim();
  if (!isUuid(parsedId)) {
    throw createNotFoundError("Invalid character id");
  }
  const attempt = typeof editPasswordAttempt === "string" ? editPasswordAttempt : "";
  const allowOfflineValidationBypass = () => ({
    id: parsedId,
    storage: createOfflineStorageMeta("offline-edit-password-validation-skipped"),
  });
  try {
    if (isOnline()) {
      const payload = await saveCharacterToRemote(parsedId, null, {
        validateOnly: true,
        editPasswordAttempt: attempt,
      });
      return { ...payload, id: parsedId };
    }
  } catch (error) {
    if (!shouldUseOfflineFallback(error)) throw error;
    return allowOfflineValidationBypass();
  }
  return allowOfflineValidationBypass();
}

export async function saveCharacter(id, character) {
  const parsedId = String(id ?? "").trim();
  if (!isUuid(parsedId)) {
    throw createNotFoundError("Invalid character id");
  }
  const nextCharacter = normalizeCharacterForId(parsedId, character);
  const localCharacter = getLocalCharacter(parsedId);
  const editPasswordAttempt = getCharacterEditPassword(nextCharacter) || getCharacterEditPassword(localCharacter);
  try {
    if (isOnline()) {
      const payload = await saveCharacterToRemote(parsedId, nextCharacter, {
        editPasswordAttempt,
      });
      const remoteCharacter = preserveLocalEditPassword(
        normalizeCharacterForId(parsedId, payload?.character ?? nextCharacter),
        nextCharacter
      );
      setLocalCharacter(parsedId, remoteCharacter);
      dequeueSyncCharacter(parsedId);
      return { ...payload, id: parsedId, character: remoteCharacter };
    }
  } catch (error) {
    if (!shouldUseOfflineFallback(error)) throw error;
  }

  setLocalCharacter(parsedId, nextCharacter);
  enqueueSyncCharacter(parsedId, nextCharacter);
  return toOfflinePayload(parsedId, nextCharacter, "offline-save-queued");
}

export async function patchCharacter(id, partialCharacter) {
  const parsedId = String(id ?? "").trim();
  if (!isUuid(parsedId)) {
    throw createNotFoundError("Invalid character id");
  }

  const localCharacter = getLocalCharacter(parsedId);
  const patchPayload = isPlainObject(partialCharacter) ? partialCharacter : {};
  const editPasswordAttempt = getCharacterEditPassword(localCharacter) || getCharacterEditPassword(patchPayload);

  try {
    if (isOnline()) {
      const payload = await saveCharacterToRemote(parsedId, patchPayload, {
        editPasswordAttempt,
        method: "PATCH",
        returnCharacter: false,
      });
      const fallbackCharacter = normalizeCharacterForId(
        parsedId,
        applyCharacterMergePatch(localCharacter ?? { id: parsedId }, patchPayload)
      );
      const remoteCharacter = preserveLocalEditPassword(
        normalizeCharacterForId(parsedId, payload?.character ?? fallbackCharacter),
        localCharacter ?? patchPayload
      );
      setLocalCharacter(parsedId, remoteCharacter);
      dequeueSyncCharacter(parsedId);
      return { ...payload, id: parsedId, character: remoteCharacter };
    }
  } catch (error) {
    if (!shouldUseOfflineFallback(error)) throw error;
  }

  const nextCharacter = normalizeCharacterForId(
    parsedId,
    applyCharacterMergePatch(localCharacter ?? { id: parsedId }, patchPayload)
  );
  setLocalCharacter(parsedId, nextCharacter);
  enqueueSyncCharacter(parsedId, nextCharacter);
  return toOfflinePayload(parsedId, nextCharacter, "offline-patch-queued");
}

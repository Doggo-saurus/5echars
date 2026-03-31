const DEFAULT_API_BASE = "/api";
const LOCAL_PARTY_PASSWORD_STORE_KEY = "fivee-party-password-store-v1";
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

function readLocalPartyPasswordStore() {
  const parsed = readJsonStorage(LOCAL_PARTY_PASSWORD_STORE_KEY, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed;
}

function writeLocalPartyPasswordStore(store) {
  writeJsonStorage(LOCAL_PARTY_PASSWORD_STORE_KEY, store);
}

export function getStoredPartyPassword(id) {
  if (!isUuid(id)) return "";
  const store = readLocalPartyPasswordStore();
  const value = store[id];
  return typeof value === "string" ? value : "";
}

export function setStoredPartyPassword(id, password) {
  if (!isUuid(id)) return;
  const store = readLocalPartyPasswordStore();
  const nextPassword = typeof password === "string" ? password : "";
  if (nextPassword) store[id] = nextPassword;
  else delete store[id];
  writeLocalPartyPasswordStore(store);
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

function normalizePartyInput(id, partyInput) {
  const party = partyInput && typeof partyInput === "object" && !Array.isArray(partyInput) ? partyInput : {};
  const members = Array.isArray(party.members)
    ? party.members
        .map((member) => {
          if (!member || typeof member !== "object" || Array.isArray(member)) return null;
          const characterId = String(member.characterId ?? "").trim();
          if (!isUuid(characterId)) return null;
          const nickname = typeof member.nickname === "string" ? member.nickname.trim() : "";
          const pinned = member.pinned === true;
          return nickname ? { characterId, nickname, pinned } : { characterId, pinned };
        })
        .filter(Boolean)
    : [];
  const uniqueMembers = [];
  const seen = new Set();
  for (const member of members) {
    if (seen.has(member.characterId)) continue;
    seen.add(member.characterId);
    uniqueMembers.push(member);
  }
  return {
    id,
    name: String(party.name ?? "").trim() || "Untitled Party",
    notes: String(party.notes ?? ""),
    visibility: String(party.visibility ?? "").trim().toLowerCase() === "public" ? "public" : "unlisted",
    members: uniqueMembers,
    version: Number.isFinite(Number(party.version)) ? Math.max(1, Math.floor(Number(party.version))) : 1,
    createdAt: typeof party.createdAt === "string" ? party.createdAt : "",
    updatedAt: typeof party.updatedAt === "string" ? party.updatedAt : "",
  };
}

function buildPartyWriteRequestBody(party, options = {}) {
  const requestBody = { party };
  const passwordAttempt = typeof options.passwordAttempt === "string" ? options.passwordAttempt : "";
  requestBody.passwordAttempt = passwordAttempt;
  return requestBody;
}

export async function createParty(party) {
  const response = await fetch(`${getApiBase()}/parties`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ party }),
  });
  const payload = await parseJsonResponse(response);
  const id = String(payload?.id ?? "").trim();
  if (!isUuid(id)) throw new Error("Invalid party id from server");
  return { ...payload, id, party: normalizePartyInput(id, payload?.party) };
}

export async function getParty(id) {
  const parsedId = String(id ?? "").trim();
  if (!isUuid(parsedId)) throw new Error("Invalid party id");
  const response = await fetch(`${getApiBase()}/parties/${encodeURIComponent(parsedId)}`);
  const payload = await parseJsonResponse(response);
  return { ...payload, id: parsedId, party: normalizePartyInput(parsedId, payload?.party) };
}

export async function saveParty(id, party, options = {}) {
  const parsedId = String(id ?? "").trim();
  if (!isUuid(parsedId)) throw new Error("Invalid party id");
  const response = await fetch(`${getApiBase()}/parties/${encodeURIComponent(parsedId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildPartyWriteRequestBody(party, options)),
  });
  const payload = await parseJsonResponse(response);
  return { ...payload, id: parsedId, party: normalizePartyInput(parsedId, payload?.party) };
}

export async function patchParty(id, partialParty, options = {}) {
  const parsedId = String(id ?? "").trim();
  if (!isUuid(parsedId)) throw new Error("Invalid party id");
  const response = await fetch(`${getApiBase()}/parties/${encodeURIComponent(parsedId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildPartyWriteRequestBody(partialParty, options)),
  });
  const payload = await parseJsonResponse(response);
  return { ...payload, id: parsedId, party: normalizePartyInput(parsedId, payload?.party) };
}

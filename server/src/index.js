import express from "express";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import { createCharacterRepository, createPartyRepository } from "./bootstrap.js";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EDIT_PASSWORD_FIELD = "editPassword";
const INVALID_EDIT_PASSWORD_CODE = "INVALID_EDIT_PASSWORD";
const PARTY_PASSWORD_FIELD = "password";
const INVALID_PARTY_PASSWORD_CODE = "INVALID_PARTY_PASSWORD";
const MAX_CHARACTER_SAVE_BYTES = 256 * 1024;
const CHARACTER_TOO_LARGE_CODE = "CHARACTER_TOO_LARGE";

function isUuid(value) {
  return UUID_V4_REGEX.test(String(value ?? "").trim());
}

function normalizeCharacterInput(input, fallbackId = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { id: fallbackId, name: "", level: 1 };
  }
  const id = isUuid(input.id) ? input.id : fallbackId;
  return { ...input, id };
}

function hasOwnEditPassword(character) {
  return Boolean(
    character &&
      typeof character === "object" &&
      !Array.isArray(character) &&
      Object.prototype.hasOwnProperty.call(character, EDIT_PASSWORD_FIELD)
  );
}

function getStoredEditPassword(character) {
  const value = character?.[EDIT_PASSWORD_FIELD];
  return typeof value === "string" ? value : "";
}

function isEditPasswordConfigured(character) {
  return getStoredEditPassword(character).length > 0;
}

function isValidEditPasswordAttempt(character, attempt) {
  if (!isEditPasswordConfigured(character)) return true;
  return getStoredEditPassword(character) === String(attempt ?? "");
}

function getEditPasswordAttempt(body) {
  if (typeof body?.editPasswordAttempt === "string") return body.editPasswordAttempt;
  if (typeof body?.character?.[EDIT_PASSWORD_FIELD] === "string") return body.character[EDIT_PASSWORD_FIELD];
  return "";
}

function normalizePartyInput(input, fallbackId = null) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const id = isUuid(source.id) ? source.id : fallbackId;
  const rawName = String(source.name ?? "").trim();
  const rawNotes = String(source.notes ?? "");
  const rawVisibility = String(source.visibility ?? "").trim().toLowerCase();
  const normalizedVisibility = rawVisibility === "public" ? "public" : "unlisted";
  const rawVersion = Number(source.version);
  const version = Number.isFinite(rawVersion) && rawVersion >= 1 ? Math.floor(rawVersion) : 1;
  const members = Array.isArray(source.members)
    ? source.members
        .map((member) => {
          if (!member || typeof member !== "object" || Array.isArray(member)) return null;
          const characterId = String(member.characterId ?? "").trim();
          if (!isUuid(characterId)) return null;
          const nicknameRaw = member.nickname;
          const nickname = typeof nicknameRaw === "string" ? nicknameRaw.trim() : "";
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
  const password = typeof source[PARTY_PASSWORD_FIELD] === "string" ? source[PARTY_PASSWORD_FIELD] : "";
  return {
    id,
    name: rawName || "Untitled Party",
    members: uniqueMembers,
    notes: rawNotes,
    visibility: normalizedVisibility,
    version,
    createdAt: typeof source.createdAt === "string" ? source.createdAt : new Date().toISOString(),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : new Date().toISOString(),
    [PARTY_PASSWORD_FIELD]: password,
  };
}

function hasOwnPartyPassword(party) {
  return Boolean(
    party &&
      typeof party === "object" &&
      !Array.isArray(party) &&
      Object.prototype.hasOwnProperty.call(party, PARTY_PASSWORD_FIELD)
  );
}

function getStoredPartyPassword(party) {
  const value = party?.[PARTY_PASSWORD_FIELD];
  return typeof value === "string" ? value : "";
}

function isPartyPasswordConfigured(party) {
  return getStoredPartyPassword(party).length > 0;
}

function isValidPartyPasswordAttempt(party, attempt) {
  if (!isPartyPasswordConfigured(party)) return true;
  return getStoredPartyPassword(party) === String(attempt ?? "");
}

function getPartyPasswordAttempt(body) {
  if (typeof body?.passwordAttempt === "string") return body.passwordAttempt;
  if (typeof body?.party?.[PARTY_PASSWORD_FIELD] === "string") return body.party[PARTY_PASSWORD_FIELD];
  return "";
}

function toPublicParty(input, fallbackId = null) {
  const normalized = normalizePartyInput(input, fallbackId);
  const next = { ...normalized };
  delete next[PARTY_PASSWORD_FIELD];
  return next;
}

function mergePartyForPersist(existingParty, incomingParty, id) {
  const normalizedExisting = normalizePartyInput(existingParty, id);
  const normalizedIncoming = normalizePartyInput(incomingParty, id);
  const nextVersion = Math.max(1, Number(normalizedExisting.version) || 1, Number(normalizedIncoming.version) || 1) + 1;
  if (hasOwnPartyPassword(normalizedIncoming)) {
    return {
      ...normalizedIncoming,
      version: nextVersion,
      createdAt: normalizedExisting.createdAt || normalizedIncoming.createdAt,
      updatedAt: new Date().toISOString(),
    };
  }
  return {
    ...normalizedIncoming,
    version: nextVersion,
    createdAt: normalizedExisting.createdAt || normalizedIncoming.createdAt,
    updatedAt: new Date().toISOString(),
    [PARTY_PASSWORD_FIELD]: getStoredPartyPassword(normalizedExisting),
  };
}

function toPublicCharacter(input, fallbackId = null) {
  const normalized = normalizeCharacterInput(input, fallbackId);
  const next = { ...normalized };
  delete next[EDIT_PASSWORD_FIELD];
  return next;
}

function mergeCharacterForPersist(existingCharacter, incomingCharacter, id) {
  const normalizedExisting = normalizeCharacterInput(existingCharacter, id);
  const normalizedIncoming = normalizeCharacterInput(incomingCharacter, id);
  if (hasOwnEditPassword(normalizedIncoming)) return normalizedIncoming;
  return {
    ...normalizedIncoming,
    [EDIT_PASSWORD_FIELD]: getStoredEditPassword(normalizedExisting),
  };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function applyCharacterMergePatch(existingCharacter, patchCharacter) {
  if (!isPlainObject(existingCharacter)) return normalizeCharacterInput(existingCharacter);
  if (!isPlainObject(patchCharacter)) return { ...existingCharacter };

  const next = { ...existingCharacter };
  for (const [key, value] of Object.entries(patchCharacter)) {
    if (value === null) {
      delete next[key];
      continue;
    }
    if (isPlainObject(value) && isPlainObject(next[key])) {
      next[key] = applyCharacterMergePatch(next[key], value);
      continue;
    }
    next[key] = value;
  }
  return next;
}

function getSerializedJsonByteSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function tryRejectOversizedCharacter(res, character) {
  const sizeBytes = getSerializedJsonByteSize(character);
  if (sizeBytes <= MAX_CHARACTER_SAVE_BYTES) return false;
  res.status(413).json({
    error: `Character payload exceeds ${MAX_CHARACTER_SAVE_BYTES} bytes`,
    code: CHARACTER_TOO_LARGE_CODE,
    maxBytes: MAX_CHARACTER_SAVE_BYTES,
    sizeBytes,
  });
  return true;
}

async function listRelativeFiles(rootDir, subDir, includeFile) {
  const startDir = path.join(rootDir, subDir);
  const stack = [startDir];
  const results = [];
  while (stack.length) {
    const currentDir = stack.pop();
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      const relativePath = path.relative(rootDir, absolutePath).split(path.sep).join("/");
      if (includeFile(relativePath)) {
        results.push(`/${relativePath}`);
      }
    }
  }
  return results;
}

function keepPublicOfflineAsset(relativePath) {
  const normalized = String(relativePath ?? "");
  if (!normalized.startsWith("public/")) return false;
  if (normalized === "public/index.html") return true;
  if (normalized === "public/manifest.webmanifest") return true;
  if (normalized === "public/sw.js") return true;
  if (normalized.startsWith("public/icons/")) return true;
  return false;
}

function keepSrcOfflineAsset(relativePath) {
  return /\.(?:js|css)$/i.test(String(relativePath ?? ""));
}

function keepCatalogDataAsset(relativePath) {
  return /\.json$/i.test(String(relativePath ?? ""));
}

function normalizeManualBaseUrl(value) {
  const normalized = String(value ?? "").trim().replace(/\/+$/g, "");
  return normalized;
}

const JSON_CACHE_CONTROL_DEFAULT = "public, max-age=86400, stale-while-revalidate=604800";

function applyJsonCacheHeaders(res, absoluteFilePath) {
  const normalizedPath = String(absoluteFilePath ?? "").split(path.sep).join("/");
  if (!normalizedPath.toLowerCase().endsWith(".json")) return;

  res.setHeader("Cache-Control", JSON_CACHE_CONTROL_DEFAULT);
}

const app = express();
app.use(express.json({ limit: "2mb" }));
const manualBaseUrl = normalizeManualBaseUrl(process.env.MANUAL_BASE_URL);

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ALLOW_ORIGIN ?? "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

const { repository, mode, storage, close } = await createCharacterRepository();
const { repository: partyRepository, close: closePartyRepository } = await createPartyRepository();

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, storage });
});

app.post("/api/characters", async (req, res) => {
  try {
    const id = uuidv4();
    const character = normalizeCharacterInput(req.body?.character, id);
    if (tryRejectOversizedCharacter(res, character)) return;
    await repository.create(id, character);
    res.status(201).json({ id, character: toPublicCharacter(character, id), storage });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create character" });
  }
});

app.post("/api/parties", async (req, res) => {
  try {
    const id = uuidv4();
    const now = new Date().toISOString();
    const party = normalizePartyInput(
      {
        ...(req.body?.party && typeof req.body.party === "object" ? req.body.party : {}),
        createdAt: now,
        updatedAt: now,
      },
      id
    );
    await partyRepository.create(id, party);
    res.status(201).json({ id, party: toPublicParty(party, id), storage });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create party" });
  }
});

app.get("/api/parties/:id", async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid party id" });
    return;
  }

  try {
    const party = await partyRepository.getById(id);
    if (!party) {
      res.status(404).json({ error: "Party not found" });
      return;
    }
    res.json({ id, party: toPublicParty(party, id), storage });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load party" });
  }
});

app.put("/api/parties/:id", async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid party id" });
    return;
  }

  try {
    const existing = await partyRepository.getById(id);
    if (!existing) {
      const now = new Date().toISOString();
      const party = normalizePartyInput(
        {
          ...(req.body?.party && typeof req.body.party === "object" ? req.body.party : {}),
          createdAt: now,
          updatedAt: now,
        },
        id
      );
      await partyRepository.create(id, party);
      res.status(201).json({ id, party: toPublicParty(party, id), storage });
      return;
    }

    const existingParty = normalizePartyInput(existing, id);
    const passwordAttempt = getPartyPasswordAttempt(req.body);
    if (!isValidPartyPasswordAttempt(existingParty, passwordAttempt)) {
      res.status(403).json({ error: "Invalid party password", code: INVALID_PARTY_PASSWORD_CODE });
      return;
    }

    const party = mergePartyForPersist(existingParty, req.body?.party, id);
    await partyRepository.save(id, party);
    res.json({ id, party: toPublicParty(party, id), storage });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save party" });
  }
});

app.patch("/api/parties/:id", async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid party id" });
    return;
  }

  try {
    const existing = await partyRepository.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Party not found" });
      return;
    }
    const existingParty = normalizePartyInput(existing, id);
    const passwordAttempt = getPartyPasswordAttempt(req.body);
    if (!isValidPartyPasswordAttempt(existingParty, passwordAttempt)) {
      res.status(403).json({ error: "Invalid party password", code: INVALID_PARTY_PASSWORD_CODE });
      return;
    }
    const incomingPatch = isPlainObject(req.body?.party) ? req.body.party : {};
    const merged = applyCharacterMergePatch(existingParty, incomingPatch);
    const normalizedMerged = normalizePartyInput(merged, id);
    const nextVersion = Math.max(1, Number(existingParty.version) || 1, Number(normalizedMerged.version) || 1) + 1;
    const party = hasOwnPartyPassword(incomingPatch)
      ? {
          ...normalizedMerged,
          version: nextVersion,
          createdAt: existingParty.createdAt || normalizedMerged.createdAt,
          updatedAt: new Date().toISOString(),
        }
      : {
          ...normalizedMerged,
          version: nextVersion,
          createdAt: existingParty.createdAt || normalizedMerged.createdAt,
          updatedAt: new Date().toISOString(),
          [PARTY_PASSWORD_FIELD]: getStoredPartyPassword(existingParty),
        };
    await partyRepository.save(id, party);
    res.json({ id, party: toPublicParty(party, id), storage });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to patch party" });
  }
});

app.get("/api/characters/:id", async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid character id" });
    return;
  }

  try {
    const character = await repository.getById(id);
    if (!character) {
      res.status(404).json({ error: "Character not found" });
      return;
    }
    res.json({ id, character: toPublicCharacter(character, id), storage });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load character" });
  }
});

app.put("/api/characters/:id", async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid character id" });
    return;
  }

  try {
    const existing = await repository.getById(id);
    if (!existing) {
      if (req.body?.validateEditPasswordOnly === true) {
        res.json({ id, ok: true, storage });
        return;
      }
      const character = normalizeCharacterInput(req.body?.character, id);
      if (tryRejectOversizedCharacter(res, character)) return;
      await repository.create(id, character);
      res.status(201).json({ id, character: toPublicCharacter(character, id), storage });
      return;
    }

    const existingCharacter = normalizeCharacterInput(existing, id);
    const editPasswordAttempt = getEditPasswordAttempt(req.body);
    if (!isValidEditPasswordAttempt(existingCharacter, editPasswordAttempt)) {
      res.status(403).json({ error: "Invalid edit password", code: INVALID_EDIT_PASSWORD_CODE });
      return;
    }

    if (req.body?.validateEditPasswordOnly === true) {
      res.json({ id, ok: true, storage });
      return;
    }

    const character = mergeCharacterForPersist(existingCharacter, req.body?.character, id);
    if (tryRejectOversizedCharacter(res, character)) return;
    await repository.save(id, character);
    res.json({ id, character: toPublicCharacter(character, id), storage });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save character" });
  }
});

app.patch("/api/characters/:id", async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!isUuid(id)) {
    res.status(400).json({ error: "Invalid character id" });
    return;
  }

  try {
    const existing = await repository.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Character not found" });
      return;
    }

    const existingCharacter = normalizeCharacterInput(existing, id);
    const editPasswordAttempt = getEditPasswordAttempt(req.body);
    if (!isValidEditPasswordAttempt(existingCharacter, editPasswordAttempt)) {
      res.status(403).json({ error: "Invalid edit password", code: INVALID_EDIT_PASSWORD_CODE });
      return;
    }

    if (req.body?.validateEditPasswordOnly === true) {
      res.json({ id, ok: true, storage });
      return;
    }

    const incomingPatch = isPlainObject(req.body?.character) ? req.body.character : {};
    const mergedCharacter = applyCharacterMergePatch(existingCharacter, incomingPatch);
    const normalizedMergedCharacter = normalizeCharacterInput(mergedCharacter, id);
    const character = hasOwnEditPassword(incomingPatch)
      ? normalizedMergedCharacter
      : {
          ...normalizedMergedCharacter,
          [EDIT_PASSWORD_FIELD]: getStoredEditPassword(existingCharacter),
        };

    if (tryRejectOversizedCharacter(res, character)) return;
    await repository.save(id, character);
    if (req.body?.returnCharacter === false) {
      res.json({ id, storage });
      return;
    }
    res.json({ id, character: toPublicCharacter(character, id), storage });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to patch character" });
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const offlineAssetSet = new Set(["/"]);

const publicAssets = await listRelativeFiles(repoRoot, "public", keepPublicOfflineAsset);
publicAssets.forEach((assetPath) => {
  if (assetPath === "/public/index.html") {
    offlineAssetSet.add("/");
    offlineAssetSet.add("/index.html");
    return;
  }
  offlineAssetSet.add(assetPath.replace(/^\/public/, ""));
});

const srcAssets = await listRelativeFiles(repoRoot, "src", keepSrcOfflineAsset);
srcAssets.forEach((assetPath) => {
  offlineAssetSet.add(assetPath);
});

const dataAssets = await listRelativeFiles(repoRoot, "data/catalog-src/data", keepCatalogDataAsset);
dataAssets.forEach((assetPath) => {
  offlineAssetSet.add(assetPath);
});

const offlineAssets = [...offlineAssetSet].sort((a, b) => a.localeCompare(b));

app.use("/src", express.static(path.join(repoRoot, "src"), { setHeaders: applyJsonCacheHeaders }));
app.use("/data", express.static(path.join(repoRoot, "data"), { setHeaders: applyJsonCacheHeaders }));
app.use("/data/catalog-src", express.static(path.join(repoRoot, "data/catalog-src"), { setHeaders: applyJsonCacheHeaders }));
app.use(express.static(path.join(repoRoot, "public"), { setHeaders: applyJsonCacheHeaders }));

app.get("/api/offline-assets", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ assets: offlineAssets });
});

app.get("/config.js", (_req, res) => {
  res.type("application/javascript; charset=utf-8");
  res.send(`window.__MANUAL_BASE_URL__ = ${JSON.stringify(manualBaseUrl)};`);
});

app.get("/JSON_FORMAT_REFERENCE", (_req, res) => {
  res.type("text/markdown; charset=utf-8");
  res.sendFile(path.join(repoRoot, "JSON_FORMAT_REFERENCE.md"));
});

app.get("/JSON_FORMAT_REFERENCE.md", (_req, res) => {
  res.type("text/markdown; charset=utf-8");
  res.sendFile(path.join(repoRoot, "JSON_FORMAT_REFERENCE.md"));
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    next();
    return;
  }
  res.sendFile(path.join(repoRoot, "public/index.html"));
});

const port = Number(process.env.PORT || 3000);
const host = String(process.env.HOST || "127.0.0.1").trim() || "127.0.0.1";
app.listen(port, host, () => {
  console.log(`Server listening on ${host}:${port} (storage=${mode})`);
});

process.on("SIGINT", async () => {
  await close();
  await closePartyRepository();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await close();
  await closePartyRepository();
  process.exit(0);
});

import express from "express";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import { createCharacterRepository } from "./bootstrap.js";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EDIT_PASSWORD_FIELD = "editPassword";
const INVALID_EDIT_PASSWORD_CODE = "INVALID_EDIT_PASSWORD";

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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, storage });
});

app.post("/api/characters", async (req, res) => {
  try {
    const id = uuidv4();
    const character = normalizeCharacterInput(req.body?.character, id);
    await repository.create(id, character);
    res.status(201).json({ id, character: toPublicCharacter(character, id), storage });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to create character" });
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

app.use("/src", express.static(path.join(repoRoot, "src")));
app.use("/data", express.static(path.join(repoRoot, "data")));
app.use("/data/catalog-src", express.static(path.join(repoRoot, "data/catalog-src")));
app.use(express.static(path.join(repoRoot, "public")));

app.get("/api/offline-assets", (_req, res) => {
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
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await close();
  process.exit(0);
});

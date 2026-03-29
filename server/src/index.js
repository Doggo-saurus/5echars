import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import { createCharacterRepository } from "./bootstrap.js";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ALLOW_ORIGIN ?? "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
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
    res.status(201).json({ id, character, storage });
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
    res.json({ id, character: normalizeCharacterInput(character, id), storage });
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
    const character = normalizeCharacterInput(req.body?.character, id);
    await repository.save(id, character);
    res.json({ id, character, storage });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save character" });
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

app.use("/src", express.static(path.join(repoRoot, "src")));
app.use("/data", express.static(path.join(repoRoot, "data")));
app.use("/data/catalog-src", express.static(path.join(repoRoot, "data/catalog-src")));
app.use(express.static(path.join(repoRoot, "public")));

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

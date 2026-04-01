import { createClient } from "redis";

const DEFAULT_PAGE_SIZE = 100;

function parsePositiveInt(value, fallbackValue) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function getRedisUrl() {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  const host = process.env.REDIS_HOST ?? "127.0.0.1";
  const port = process.env.REDIS_PORT ?? "6379";
  const password = String(process.env.REDIS_PASSWORD ?? "");
  if (password) {
    return `redis://:${encodeURIComponent(password)}@${host}:${port}`;
  }
  return `redis://${host}:${port}`;
}

function toCharacterUuid(key, payload) {
  const payloadId = typeof payload?.id === "string" ? payload.id.trim() : "";
  if (payloadId) return payloadId;
  if (typeof key === "string" && key.startsWith("char:")) return key.slice(5);
  return "";
}

function toCharacterName(payload) {
  const directName = String(payload?.name ?? "").trim();
  if (directName) return directName;
  return "(unnamed)";
}

function toCharacterClass(payload) {
  const directClass = String(payload?.class ?? "").trim();
  if (directClass) return directClass;
  const selectedClassName = String(payload?.classSelection?.class?.name ?? payload?.classSelection?.name ?? "").trim();
  if (selectedClassName) return selectedClassName;
  return "(no class)";
}

function toModifiedTimestampMs(payload) {
  const candidates = [
    payload?.__syncMeta?.updatedAt,
    payload?.updatedAt,
    payload?.modifiedAt,
    payload?.lastModified,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

async function scanCharacterKeys(client) {
  const keys = [];
  for await (const key of client.scanIterator({ MATCH: "char:*", COUNT: 1000 })) {
    keys.push(key);
  }
  return keys;
}

async function main() {
  const pageSize = parsePositiveInt(getArgValue("--page-size"), DEFAULT_PAGE_SIZE);
  const redisUrl = getRedisUrl();
  const connectTimeoutMs = parsePositiveInt(process.env.REDIS_CONNECT_TIMEOUT_MS, 2000);
  const client = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: connectTimeoutMs,
      reconnectStrategy: () => false,
    },
  });

  client.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Redis client error: ${message}`);
  });

  await client.connect();
  try {
    const keys = await scanCharacterKeys(client);
    if (!keys.length) {
      console.log("No character keys found.");
      return;
    }

    const rawPayloads = await client.mGet(keys);
    const characters = [];
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const raw = rawPayloads[index];
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        characters.push({
          uuid: toCharacterUuid(key, parsed),
          name: toCharacterName(parsed),
          className: toCharacterClass(parsed),
          modifiedMs: toModifiedTimestampMs(parsed),
        });
      } catch {
        // Skip malformed JSON payloads without failing the full listing.
      }
    }

    characters.sort((left, right) => right.modifiedMs - left.modifiedMs);
    const totalPages = Math.ceil(characters.length / pageSize);
    console.log(`Found ${characters.length} characters. Page size: ${pageSize}.`);
    for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
      const start = pageIndex * pageSize;
      const end = start + pageSize;
      const pageEntries = characters.slice(start, end);
      console.log(`\nPage ${pageIndex + 1}/${totalPages}`);
      for (const entry of pageEntries) {
        console.log(`${entry.name}\t${entry.className}\t${entry.uuid}`);
      }
    }
  } finally {
    await client.quit();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to list Redis characters: ${message}`);
  process.exitCode = 1;
});

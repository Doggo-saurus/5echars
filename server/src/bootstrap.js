import { createClient } from "redis";
import { RedisCharacterRepository } from "./repositories/redis-character-repository.js";
import { FileCharacterRepository } from "./repositories/file-character-repository.js";
import { RedisPartyRepository } from "./repositories/redis-party-repository.js";
import { FilePartyRepository } from "./repositories/file-party-repository.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

function shouldEnableRedis() {
  const flag = String(process.env.REDIS_ENABLED ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

function buildRedisUrl() {
  if (process.env.REDIS_URL) return process.env.REDIS_URL;
  const host = process.env.REDIS_HOST ?? "127.0.0.1";
  const port = process.env.REDIS_PORT ?? "6379";
  return `redis://${host}:${port}`;
}

function buildStorageDetails(mode, warning = "") {
  const isDurable = mode === "redis" || mode === "file-fallback";
  return {
    mode,
    durable: isDurable,
    warning: warning ? String(warning) : "",
  };
}

function getFileFallbackDir() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, "../..");
  const configuredSubdir = String(process.env.FILE_FALLBACK_SUBDIR ?? "character-fallback").trim();
  const safeSubdir = path.basename(configuredSubdir || "character-fallback");
  return path.join(repoRoot, "data", safeSubdir);
}

function getPartyFileFallbackDir() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, "../..");
  const configuredSubdir = String(process.env.FILE_FALLBACK_PARTY_SUBDIR ?? "party-fallback").trim();
  const safeSubdir = path.basename(configuredSubdir || "party-fallback");
  return path.join(repoRoot, "data", safeSubdir);
}

export async function createCharacterRepository() {
  const fileRepository = new FileCharacterRepository(getFileFallbackDir());

  if (!shouldEnableRedis()) {
    return {
      repository: fileRepository,
      mode: "file",
      storage: buildStorageDetails("file"),
      close: async () => {},
    };
  }

  const connectTimeoutMs = Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 2000);
  const client = createClient({
    url: buildRedisUrl(),
    socket: {
      connectTimeout: Number.isFinite(connectTimeoutMs) && connectTimeoutMs > 0 ? connectTimeoutMs : 2000,
      // Fail fast so startup can fall back to file mode instead of hanging.
      reconnectStrategy: () => false,
    },
  });
  client.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error ?? "Unknown Redis error");
    console.error(`Redis client error: ${message}`);
  });
  try {
    await client.connect();
  } catch (error) {
    const warning =
      error instanceof Error
        ? `Redis unavailable, running in file-fallback mode: ${error.message}`
        : "Redis unavailable, running in file-fallback mode.";
    console.warn(warning);
    return {
      repository: fileRepository,
      mode: "file-fallback",
      storage: buildStorageDetails("file-fallback", warning),
      close: async () => {},
    };
  }

  return {
    repository: new RedisCharacterRepository(client),
    mode: "redis",
    storage: buildStorageDetails("redis"),
    close: async () => {
      await client.quit();
    },
  };
}

export async function createPartyRepository() {
  const fileRepository = new FilePartyRepository(getPartyFileFallbackDir());

  if (!shouldEnableRedis()) {
    return {
      repository: fileRepository,
      mode: "file",
      storage: buildStorageDetails("file"),
      close: async () => {},
    };
  }

  const connectTimeoutMs = Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 2000);
  const client = createClient({
    url: buildRedisUrl(),
    socket: {
      connectTimeout: Number.isFinite(connectTimeoutMs) && connectTimeoutMs > 0 ? connectTimeoutMs : 2000,
      reconnectStrategy: () => false,
    },
  });
  client.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error ?? "Unknown Redis error");
    console.error(`Redis client error: ${message}`);
  });
  try {
    await client.connect();
  } catch (error) {
    const warning =
      error instanceof Error
        ? `Redis unavailable, running in file-fallback mode: ${error.message}`
        : "Redis unavailable, running in file-fallback mode.";
    console.warn(warning);
    return {
      repository: fileRepository,
      mode: "file-fallback",
      storage: buildStorageDetails("file-fallback", warning),
      close: async () => {},
    };
  }

  return {
    repository: new RedisPartyRepository(client),
    mode: "redis",
    storage: buildStorageDetails("redis"),
    close: async () => {
      await client.quit();
    },
  };
}

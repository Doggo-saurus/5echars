import { createClient } from "redis";
import { InMemoryCharacterRepository } from "./repositories/in-memory-character-repository.js";
import { RedisCharacterRepository } from "./repositories/redis-character-repository.js";

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
  const isRedis = mode === "redis";
  return {
    mode,
    durable: isRedis,
    warning: warning ? String(warning) : "",
  };
}

export async function createCharacterRepository() {
  if (!shouldEnableRedis()) {
    return {
      repository: new InMemoryCharacterRepository(),
      mode: "memory",
      storage: buildStorageDetails("memory"),
      close: async () => {},
    };
  }

  const client = createClient({ url: buildRedisUrl() });
  try {
    await client.connect();
  } catch (error) {
    const warning =
      error instanceof Error
        ? `Redis unavailable, running in in-memory mode: ${error.message}`
        : "Redis unavailable, running in in-memory mode.";
    console.warn(warning);
    return {
      repository: new InMemoryCharacterRepository(),
      mode: "memory-fallback",
      storage: buildStorageDetails("memory-fallback", warning),
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

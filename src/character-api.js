const DEFAULT_API_BASE = "/api";

function getApiBase() {
  const runtimeBase = globalThis.__CHAR_API_BASE__;
  if (typeof runtimeBase === "string" && runtimeBase.trim()) {
    return runtimeBase.replace(/\/+$/, "");
  }
  return DEFAULT_API_BASE;
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

export async function createCharacter(character) {
  const response = await fetch(`${getApiBase()}/characters`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ character: character ?? null }),
  });
  return parseJsonResponse(response);
}

export async function getCharacter(id) {
  const response = await fetch(`${getApiBase()}/characters/${encodeURIComponent(id)}`);
  return parseJsonResponse(response);
}

export async function saveCharacter(id, character) {
  const response = await fetch(`${getApiBase()}/characters/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ character: character ?? null }),
  });
  return parseJsonResponse(response);
}

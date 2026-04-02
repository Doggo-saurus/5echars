export function getCharacterFromApiPayload(payload, fallbackId, { isUuid } = {}) {
  const id = payload?.id ?? fallbackId ?? null;
  if (typeof isUuid !== "function" || !isUuid(id)) {
    throw new Error("Invalid character id");
  }
  if (!payload || typeof payload.character !== "object" || payload.character == null || Array.isArray(payload.character)) {
    throw new Error("Invalid character payload");
  }
  const normalizedCharacter = { ...payload.character, id };
  // Ignore persisted computed snapshots; runtime derived stats are recalculated.
  delete normalizedCharacter.derived;
  return {
    id,
    character: normalizedCharacter,
  };
}

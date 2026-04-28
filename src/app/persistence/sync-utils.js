export function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function cloneCharacter(character) {
  if (!isPlainObject(character)) return null;
  if (typeof structuredClone === "function") return structuredClone(character);
  try {
    return JSON.parse(JSON.stringify(character));
  } catch {
    return { ...character };
  }
}

export function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (!deepEqual(left[i], right[i])) return false;
    }
    return true;
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
      if (!deepEqual(left[key], right[key])) return false;
    }
    return true;
  }
  return false;
}

export function buildMergePatch(previousValue, nextValue) {
  const previous = isPlainObject(previousValue) ? previousValue : {};
  const next = isPlainObject(nextValue) ? nextValue : {};
  const patch = {};
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    const hasNext = Object.prototype.hasOwnProperty.call(next, key);
    if (!hasNext) {
      patch[key] = null;
      continue;
    }
    const previousItem = previous[key];
    const nextItem = next[key];
    if (isPlainObject(previousItem) && isPlainObject(nextItem)) {
      const nestedPatch = buildMergePatch(previousItem, nextItem);
      if (Object.keys(nestedPatch).length > 0) patch[key] = nestedPatch;
      continue;
    }
    if (!deepEqual(previousItem, nextItem)) patch[key] = nextItem;
  }
  return patch;
}

function readFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveInitiativeFromState(state) {
  const dexMod = readFiniteNumber(state?.derived?.mods?.dex);
  const bonus = readFiniteNumber(state?.character?.play?.initiativeBonus) ?? 0;
  if (dexMod == null) return null;
  return dexMod + bonus;
}

function deriveSpeedFromCharacter(character) {
  const direct = readFiniteNumber(character?.play?.speed);
  if (direct != null) return direct;
  const topLevel = readFiniteNumber(character?.speed);
  if (topLevel != null) return topLevel;
  const walk = readFiniteNumber(character?.speed?.walk);
  if (walk != null) return walk;
  return null;
}

export function withPartySnapshot(state, character) {
  const nextCharacter = isPlainObject(character) ? character : {};
  const derived = state?.derived ?? {};
  const initiative = deriveInitiativeFromState(state);
  const speed = deriveSpeedFromCharacter(nextCharacter);
  const snapshot = {
    version: 1,
    ac: readFiniteNumber(derived?.ac),
    hp: readFiniteNumber(derived?.hp),
    proficiencyBonus: readFiniteNumber(derived?.proficiencyBonus),
    dexMod: readFiniteNumber(derived?.mods?.dex),
    wisMod: readFiniteNumber(derived?.mods?.wis),
    intMod: readFiniteNumber(derived?.mods?.int),
    passivePerception: readFiniteNumber(derived?.passivePerception),
    passiveInsight: readFiniteNumber(derived?.passiveInsight),
    passiveInvestigation: readFiniteNumber(derived?.passiveInvestigation),
    initiative,
    speed,
  };
  return { ...nextCharacter, partySnapshot: snapshot };
}

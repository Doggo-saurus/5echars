function abilityMod(score) {
  return Math.floor((Number(score || 0) - 10) / 2);
}

function proficiencyBonus(level) {
  const lvl = Math.max(1, Number(level || 1));
  return 2 + Math.floor((lvl - 1) / 4);
}

function getClassKey(className) {
  return String(className ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function getCharacterClassLevels(character) {
  const totalLevel = Math.max(1, Math.min(20, toNumber(character?.level, 1)));
  const multiclassEntries = Array.isArray(character?.multiclass) ? character.multiclass : [];
  const cleanedMulticlass = multiclassEntries
    .map((entry) => ({
      class: String(entry?.class ?? "").trim(),
      level: Math.max(1, Math.min(20, toNumber(entry?.level, 1))),
    }))
    .filter((entry) => entry.class);
  const multiclassTotal = cleanedMulticlass.reduce((sum, entry) => sum + entry.level, 0);
  const primaryLevel = Math.max(1, totalLevel - multiclassTotal);
  return { totalLevel, primaryLevel, multiclass: cleanedMulticlass };
}

function getClassHitDieFaces(catalogs, className) {
  const selectedName = String(className ?? "").trim().toLowerCase();
  if (!selectedName || !Array.isArray(catalogs?.classes)) return 8;
  const classEntry = catalogs.classes.find((entry) => String(entry?.name ?? "").trim().toLowerCase() === selectedName);
  const faces = Math.max(0, toNumber(classEntry?.hd?.faces, 0));
  return faces > 0 ? faces : 8;
}

function getFixedHitPointGain(faces) {
  return Math.max(1, Math.floor(Math.max(1, faces) / 2) + 1);
}

function getAdditionalHitPointEntries(catalogs, character) {
  const { primaryLevel, multiclass } = getCharacterClassLevels(character);
  const primaryClassName = String(character?.class ?? "").trim();
  const entries = [];
  const primaryFaces = getClassHitDieFaces(catalogs, primaryClassName);
  const primaryKey = getClassKey(primaryClassName) || "primary";

  for (let level = 2; level <= primaryLevel; level += 1) {
    entries.push({
      key: `${primaryKey}:${level}`,
      faces: primaryFaces,
    });
  }

  multiclass.forEach((entry) => {
    const className = String(entry.class ?? "").trim();
    const faces = getClassHitDieFaces(catalogs, className);
    const classKey = getClassKey(className) || "multiclass";
    for (let level = 1; level <= entry.level; level += 1) {
      entries.push({
        key: `${classKey}:${level}`,
        faces,
      });
    }
  });

  return entries;
}

function sanitizeHitPointRollOverrides(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .map(([key, value]) => [String(key ?? "").trim(), Math.floor(toNumber(value, NaN))])
      .filter(([key, value]) => key && Number.isFinite(value) && value > 0)
  );
}

function normalizeFeatName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getFeatHitPointBonus(character, totalLevel) {
  const feats = Array.isArray(character?.feats) ? character.feats : [];
  const featNames = new Set(feats.map((feat) => normalizeFeatName(feat?.name)).filter(Boolean));
  // Tough: increase hit point maximum by 2 per level.
  if (featNames.has("tough")) return Math.max(1, totalLevel) * 2;
  return 0;
}

export function getHitPointBreakdown(catalogs, character, options = {}) {
  const abilities = character?.abilities ?? {};
  const conMod = abilityMod(abilities.con);
  const { totalLevel } = getCharacterClassLevels(character);
  const primaryFaces = getClassHitDieFaces(catalogs, character?.class);
  const overrides = sanitizeHitPointRollOverrides(options.rollOverrides ?? character?.hitPointRollOverrides);
  const additionalBaseHp = getAdditionalHitPointEntries(catalogs, character).reduce((sum, entry) => {
    const rolled = Math.floor(toNumber(overrides[entry.key], NaN));
    if (Number.isFinite(rolled) && rolled >= 1 && rolled <= entry.faces) return sum + rolled;
    return sum + getFixedHitPointGain(entry.faces);
  }, 0);
  const firstLevelHp = primaryFaces + conMod;
  const conFromAdditionalLevels = Math.max(0, totalLevel - 1) * conMod;
  const featBonusHp = getFeatHitPointBonus(character, totalLevel);
  const total = Math.max(1, firstLevelHp + additionalBaseHp + conFromAdditionalLevels + featBonusHp);
  return {
    total,
    conMod,
    totalLevel,
    firstLevelHp,
    additionalBaseHp,
    conFromAdditionalLevels,
    featBonusHp,
  };
}

function getEquippedInventoryEntries(character) {
  const inventory = Array.isArray(character?.inventory) ? character.inventory : [];
  return inventory.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && Boolean(entry.equipped));
}

function normalizeItemTypeCode(value) {
  return String(value ?? "")
    .split("|")[0]
    .trim()
    .toUpperCase();
}

function getArmorClassFromEquipment(character, dexMod) {
  const equippedItems = getEquippedInventoryEntries(character);
  if (!equippedItems.length) return 10 + dexMod;

  let bestArmorAc = null;
  let shieldBonus = 0;

  equippedItems.forEach((entry) => {
    const typeCode = normalizeItemTypeCode(entry.itemType ?? entry.type);
    const isShield = typeCode === "S" || Boolean(entry.isShield);
    const isArmor = ["LA", "MA", "HA"].includes(typeCode) || Boolean(entry.armor);
    const parsedAc = Number(entry.ac);

    if (isShield) {
      const bonus = Number.isFinite(parsedAc) && parsedAc > 0 ? parsedAc : 2;
      shieldBonus = Math.max(shieldBonus, bonus);
      return;
    }

    if (!isArmor || !Number.isFinite(parsedAc) || parsedAc <= 0) return;

    let dexContribution = dexMod;
    if (typeCode === "MA") dexContribution = Math.min(2, dexMod);
    if (typeCode === "HA") dexContribution = 0;
    const total = parsedAc + dexContribution;
    if (bestArmorAc == null || total > bestArmorAc) bestArmorAc = total;
  });

  if (bestArmorAc != null) return bestArmorAc + shieldBonus;
  return 10 + dexMod + shieldBonus;
}

export function computeDerivedStats(character, catalogs = null) {
  const abilities = character.abilities ?? {};
  const mods = {
    str: abilityMod(abilities.str),
    dex: abilityMod(abilities.dex),
    con: abilityMod(abilities.con),
    int: abilityMod(abilities.int),
    wis: abilityMod(abilities.wis),
    cha: abilityMod(abilities.cha),
  };
  const prof = proficiencyBonus(character.level);
  const hp = getHitPointBreakdown(catalogs, character).total;
  const ac = getArmorClassFromEquipment(character, mods.dex);

  return {
    mods,
    proficiencyBonus: prof,
    hp,
    ac,
    passivePerception: 10 + mods.wis,
  };
}

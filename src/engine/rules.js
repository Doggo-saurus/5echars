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

function normalizeCategoryList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? "").trim().toUpperCase())
      .filter(Boolean);
  }
  const single = String(value ?? "").trim().toUpperCase();
  return single ? [single] : [];
}

function normalizeOptionalFeatureTypeList(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? "").trim().toUpperCase())
      .filter(Boolean);
  }
  const single = String(value ?? "").trim().toUpperCase();
  return single ? [single] : [];
}

function findFeatCatalogEntry(catalogs, feat) {
  const feats = Array.isArray(catalogs?.feats) ? catalogs.feats : [];
  const normalizedName = normalizeFeatName(feat?.name);
  const normalizedSource = String(feat?.source ?? "").trim().toUpperCase();
  return (
    feats.find((entry) => {
      if (normalizeFeatName(entry?.name) !== normalizedName) return false;
      if (!normalizedSource) return true;
      return String(entry?.source ?? "").trim().toUpperCase() === normalizedSource;
    }) ?? null
  );
}

function findOptionalFeatureCatalogEntry(catalogs, optionalFeature) {
  const entries = Array.isArray(catalogs?.optionalFeatures) ? catalogs.optionalFeatures : [];
  const normalizedName = normalizeFeatName(optionalFeature?.name);
  const normalizedSource = String(optionalFeature?.source ?? "").trim().toUpperCase();
  return (
    entries.find((entry) => {
      if (normalizeFeatName(entry?.name) !== normalizedName) return false;
      if (!normalizedSource) return true;
      return String(entry?.source ?? "").trim().toUpperCase() === normalizedSource;
    }) ?? null
  );
}

export function getCharacterFightingStyleSet(character, catalogs = null) {
  const styleNames = new Set();
  const addStyleName = (name) => {
    const normalized = normalizeFeatName(name);
    if (normalized) styleNames.add(normalized);
  };

  const feats = Array.isArray(character?.feats) ? character.feats : [];
  feats.forEach((feat) => {
    const detail = findFeatCatalogEntry(catalogs, feat);
    const categories = normalizeCategoryList(detail?.category);
    if (!categories.some((category) => category.startsWith("FS"))) return;
    addStyleName(detail?.name ?? feat?.name);
  });

  const optionalFeatures = Array.isArray(character?.optionalFeatures) ? character.optionalFeatures : [];
  optionalFeatures.forEach((feature) => {
    const detail = findOptionalFeatureCatalogEntry(catalogs, feature);
    const featureTypes = normalizeOptionalFeatureTypeList(detail?.featureType);
    if (!featureTypes.some((category) => category.startsWith("FS:"))) return;
    addStyleName(detail?.name ?? feature?.name);
  });

  return styleNames;
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

export function getArmorClassBreakdown(character, dexMod, fightingStyles = new Set()) {
  const equippedItems = getEquippedInventoryEntries(character);
  let bestArmorTotal = null;
  let bestArmorBase = 0;
  let bestArmorDex = 0;
  let bestArmorName = "";
  let bestArmorTypeCode = "";
  let shieldBonus = 0;
  let shieldName = "";
  let isWearingArmor = false;

  equippedItems.forEach((entry) => {
    const typeCode = normalizeItemTypeCode(entry.itemType ?? entry.type);
    const isShield = typeCode === "S" || Boolean(entry.isShield);
    const isArmor = ["LA", "MA", "HA"].includes(typeCode) || Boolean(entry.armor);
    const parsedAc = Number(entry.ac);

    if (isShield) {
      const bonus = Number.isFinite(parsedAc) && parsedAc > 0 ? parsedAc : 2;
      if (bonus > shieldBonus) {
        shieldBonus = bonus;
        shieldName = String(entry?.name ?? "").trim();
      }
      return;
    }

    if (!isArmor || !Number.isFinite(parsedAc) || parsedAc <= 0) return;

    isWearingArmor = true;
    let dexContribution = dexMod;
    if (typeCode === "MA") dexContribution = Math.min(2, dexMod);
    if (typeCode === "HA") dexContribution = 0;
    const total = parsedAc + dexContribution;
    if (bestArmorTotal == null || total > bestArmorTotal) {
      bestArmorTotal = total;
      bestArmorBase = parsedAc;
      bestArmorDex = dexContribution;
      bestArmorName = String(entry?.name ?? "").trim();
      bestArmorTypeCode = typeCode;
    }
  });

  const defenseBonus = isWearingArmor && fightingStyles.has("defense") ? 1 : 0;
  const isArmored = bestArmorTotal != null;
  const baseLabel = isArmored ? (bestArmorName || "Equipped Armor") : "Base AC";
  const baseValue = isArmored ? bestArmorBase : 10;
  const dexValue = isArmored ? bestArmorDex : dexMod;
  const dexLabel =
    isArmored && bestArmorTypeCode === "MA"
      ? "Dexterity (max +2)"
      : isArmored && bestArmorTypeCode === "HA"
        ? "Dexterity"
        : "Dexterity";
  const components = [
    { label: baseLabel, value: baseValue, source: isArmored ? "Armor" : "Unarmored" },
    { label: dexLabel, value: dexValue, source: "Ability" },
  ];
  if (shieldBonus > 0) {
    components.push({
      label: shieldName || "Shield",
      value: shieldBonus,
      source: "Shield",
    });
  }
  if (defenseBonus > 0) {
    components.push({
      label: "Fighting Style: Defense",
      value: defenseBonus,
      source: "Fighting Style",
    });
  }

  const total = components.reduce((sum, component) => sum + toNumber(component.value, 0), 0);
  return { total, components, isArmored };
}

function getArmorClassFromEquipment(character, dexMod, fightingStyles = new Set()) {
  return getArmorClassBreakdown(character, dexMod, fightingStyles).total;
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
  const fightingStyles = getCharacterFightingStyleSet(character, catalogs);
  const ac = getArmorClassFromEquipment(character, mods.dex, fightingStyles);

  return {
    mods,
    proficiencyBonus: prof,
    hp,
    ac,
    passivePerception: 10 + mods.wis,
  };
}

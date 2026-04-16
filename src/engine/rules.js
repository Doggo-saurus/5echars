import { getActiveInventoryCatalogItems } from "../app/catalog/inventory-item-rules.js";

function abilityMod(score) {
  return Math.floor((Number(score || 0) - 10) / 2);
}

function proficiencyBonus(level) {
  const lvl = Math.max(1, Number(level || 1));
  return 2 + Math.floor((lvl - 1) / 4);
}

function normalizeSkillProficiencyMode(value) {
  const mode = String(value ?? "").trim().toLowerCase();
  if (mode === "half" || mode === "proficient" || mode === "expertise") return mode;
  return "none";
}

function getSkillProficiencyBonus(proficiencyBonusValue, mode) {
  if (mode === "expertise") return proficiencyBonusValue * 2;
  if (mode === "proficient") return proficiencyBonusValue;
  if (mode === "half") return Math.floor(proficiencyBonusValue / 2);
  return 0;
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

function normalizeSourceTag(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function collectTraitTextLines(entry, out = []) {
  if (entry == null) return out;
  if (typeof entry === "string") {
    const line = entry
      .replace(/\{@[a-z]+ ([^}]+)\}/gi, "$1")
      .replace(/\{@[a-z]+\}/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (line) out.push(line);
    return out;
  }
  if (Array.isArray(entry)) {
    entry.forEach((value) => collectTraitTextLines(value, out));
    return out;
  }
  if (typeof entry !== "object") return out;
  if (typeof entry.name === "string" && entry.name.trim()) out.push(entry.name.trim());
  collectTraitTextLines(entry.entry, out);
  collectTraitTextLines(entry.text, out);
  collectTraitTextLines(entry.entries, out);
  collectTraitTextLines(entry.items, out);
  return out;
}

function getSelectedRaceEntry(catalogs, character) {
  const races = Array.isArray(catalogs?.races) ? catalogs.races : [];
  if (!races.length) return null;
  const raceName = String(character?.race ?? "").trim().toLowerCase();
  if (!raceName) return null;
  const raceSource = normalizeSourceTag(character?.raceSource);
  const raceMatch = races.find((entry) => {
    if (String(entry?.name ?? "").trim().toLowerCase() !== raceName) return false;
    if (!raceSource) return true;
    return normalizeSourceTag(entry?.source) === raceSource;
  }) ?? races.find((entry) => String(entry?.name ?? "").trim().toLowerCase() === raceName);
  return raceMatch ?? null;
}

function getSpeciesUnarmoredAcRule(catalogs, character) {
  const raceEntry = getSelectedRaceEntry(catalogs, character);
  if (!raceEntry) return null;
  const traitEntries = Array.isArray(raceEntry?.entries) ? raceEntry.entries : [];
  for (const trait of traitEntries) {
    if (!trait || typeof trait !== "object") continue;
    const traitName = String(trait?.name ?? "").trim();
    const joinedText = collectTraitTextLines(trait, []).join(" ").toLowerCase();
    const baseMatch = joinedText.match(/(?:base ac|armor class)\D{0,32}(\d{1,2})\s*\+\s*(?:your\s+)?dexterity modifier/i);
    if (!baseMatch?.[1]) continue;
    const base = toNumber(baseMatch[1], 0);
    if (base <= 0) continue;
    return {
      base,
      label: traitName || "Species Trait",
    };
  }
  return null;
}

function normalizeSenseFieldList(fieldValue) {
  if (fieldValue == null) return [];
  if (Array.isArray(fieldValue)) {
    return fieldValue.filter((senseEntry) => senseEntry && typeof senseEntry === "object" && !Array.isArray(senseEntry));
  }
  if (typeof fieldValue === "object" && !Array.isArray(fieldValue)) {
    return [fieldValue];
  }
  return [];
}

function mergeDarkvisionFromCatalogEntryText(entry, map) {
  if (!entry || typeof entry !== "object") return;
  const blocks = Array.isArray(entry.entries) ? entry.entries : [];
  if (!blocks.length) return;
  const lines = [];
  blocks.forEach((block) => collectTraitTextLines(block, lines));
  const text = lines.join(" ").toLowerCase();
  if (!/dark\s*vision|darkvision/.test(text)) return;
  const anchor = text.includes("darkvision") ? text.indexOf("darkvision") : text.search(/\bdark\s+vision\b/);
  if (anchor < 0) return;
  const windowText = text.slice(anchor, anchor + 240);
  const match = windowText.match(/(\d+)\s*(?:feet|ft)\b/);
  if (!match?.[1]) return;
  const ft = Math.max(0, toNumber(match[1], 0));
  if (ft <= 0) return;
  map.darkvision = Math.max(toNumber(map.darkvision, 0), ft);
}

function collectSenseMapFromEntry(entry, map) {
  if (!entry || typeof entry !== "object") return;
  ["senses", "bonusSenses"].forEach((fieldKey) => {
    normalizeSenseFieldList(entry?.[fieldKey]).forEach((senseEntry) => {
      Object.entries(senseEntry).forEach(([senseKey, amountRaw]) => {
        const key = String(senseKey ?? "").trim().toLowerCase();
        if (!key) return;
        const amount = Math.max(0, toNumber(amountRaw, 0));
        if (amount <= 0) return;
        map[key] = Math.max(toNumber(map?.[key], 0), amount);
      });
    });
  });
  mergeDarkvisionFromCatalogEntryText(entry, map);
}

function findClassCatalogEntrySimple(catalogs, className, classSource = "") {
  const classes = Array.isArray(catalogs?.classes) ? catalogs.classes : [];
  const normalizedName = String(className ?? "").trim().toLowerCase();
  if (!normalizedName) return null;
  const matches = classes.filter((entry) => String(entry?.name ?? "").trim().toLowerCase() === normalizedName);
  if (!matches.length) return null;
  const normalizedSource = normalizeSourceTag(classSource);
  if (normalizedSource) {
    const bySource = matches.find((entry) => normalizeSourceTag(entry?.source) === normalizedSource);
    if (bySource) return bySource;
  }
  return matches[0];
}

function findSubclassCatalogEntrySimple(catalogs, character, primaryClassName) {
  const subName = String(character?.classSelection?.subclass?.name ?? character?.subclass ?? "").trim().toLowerCase();
  if (!subName) return null;
  const subs = Array.isArray(catalogs?.subclasses) ? catalogs.subclasses : [];
  const classMatches = subs.filter((entry) => String(entry?.name ?? "").trim().toLowerCase() === subName);
  if (!classMatches.length) return null;
  const primary = String(primaryClassName ?? "").trim().toLowerCase();
  if (primary) {
    const aligned = classMatches.find((entry) => String(entry?.className ?? "").trim().toLowerCase() === primary);
    if (aligned) return aligned;
  }
  return classMatches[0];
}

function getCharacterSenseSummary(catalogs, character) {
  const senseMap = {};
  const raceEntry = getSelectedRaceEntry(catalogs, character);
  collectSenseMapFromEntry(raceEntry, senseMap);
  const feats = Array.isArray(character?.feats) ? character.feats : [];
  feats.forEach((feat) => {
    const detail = findFeatCatalogEntry(catalogs, feat);
    collectSenseMapFromEntry(detail, senseMap);
  });
  const optionalFeatures = Array.isArray(character?.optionalFeatures) ? character.optionalFeatures : [];
  optionalFeatures.forEach((feature) => {
    const detail = findOptionalFeatureCatalogEntry(catalogs, feature);
    collectSenseMapFromEntry(detail, senseMap);
  });
  const primaryClassName = String(character?.class ?? "").trim();
  if (primaryClassName) {
    collectSenseMapFromEntry(findClassCatalogEntrySimple(catalogs, primaryClassName, character?.classSource), senseMap);
    collectSenseMapFromEntry(findSubclassCatalogEntrySimple(catalogs, character, primaryClassName), senseMap);
  }
  const multiclassEntries = Array.isArray(character?.multiclass) ? character.multiclass : [];
  multiclassEntries.forEach((entry) => {
    const name = String(entry?.class ?? "").trim();
    if (!name) return;
    collectSenseMapFromEntry(findClassCatalogEntrySimple(catalogs, name, entry?.source), senseMap);
  });
  getActiveInventoryCatalogItems(catalogs, character).forEach(({ catalogItem }) => {
    collectSenseMapFromEntry(catalogItem, senseMap);
  });
  return senseMap;
}

function getActiveItemNumericBonusEntries(catalogs, character, fieldKey) {
  return getActiveInventoryCatalogItems(catalogs, character)
    .map(({ inventoryEntry, catalogItem }) => {
      const value = toNumber(catalogItem?.[fieldKey], Number.NaN);
      if (!Number.isFinite(value) || value === 0) return null;
      const label = String(inventoryEntry?.name ?? catalogItem?.name ?? "Item").trim() || "Item";
      return { label, value };
    })
    .filter(Boolean);
}

export function getArmorClassBreakdown(character, dexMod, fightingStyles = new Set(), catalogs = null) {
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
  const speciesUnarmoredRule = isArmored ? null : getSpeciesUnarmoredAcRule(catalogs, character);
  const baseLabel = isArmored ? (bestArmorName || "Equipped Armor") : speciesUnarmoredRule?.label || "Base AC";
  const baseValue = isArmored ? bestArmorBase : toNumber(speciesUnarmoredRule?.base, 10);
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
  getActiveItemNumericBonusEntries(catalogs, character, "bonusAc").forEach((entry) => {
    components.push({
      label: `${entry.label} (Item Bonus)`,
      value: entry.value,
      source: "Item",
    });
  });
  const customModifier = Math.floor(toNumber(character?.play?.customAcModifier, 0));
  if (customModifier !== 0) {
    components.push({
      label: "Custom Modifier",
      value: customModifier,
      source: "Custom",
    });
  }

  const total = components.reduce((sum, component) => sum + toNumber(component.value, 0), 0);
  return { total, components, isArmored };
}

function getArmorClassFromEquipment(character, dexMod, fightingStyles = new Set(), catalogs = null) {
  return getArmorClassBreakdown(character, dexMod, fightingStyles, catalogs).total;
}

export function computeDerivedStats(character, catalogs = null) {
  const abilities = character.abilities ?? {};
  const play = character.play ?? {};
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
  const ac = getArmorClassFromEquipment(character, mods.dex, fightingStyles, catalogs);
  const getPassiveSkillValue = (skillKey, abilityKey) => {
    const mode = normalizeSkillProficiencyMode(
      play.skillProficiencyModes?.[skillKey] ?? (play.skillProficiencies?.[skillKey] ? "proficient" : "none")
    );
    return 10 + toNumber(mods?.[abilityKey], 0) + getSkillProficiencyBonus(prof, mode);
  };
  const passivePerception = getPassiveSkillValue("perception", "wis");
  const passiveInsight = getPassiveSkillValue("insight", "wis");
  const passiveInvestigation = getPassiveSkillValue("investigation", "int");
  const senses = getCharacterSenseSummary(catalogs, character);
  const itemSavingThrowBonus = getActiveItemNumericBonusEntries(catalogs, character, "bonusSavingThrow")
    .reduce((sum, entry) => sum + toNumber(entry?.value, 0), 0);

  return {
    mods,
    proficiencyBonus: prof,
    hp,
    ac,
    passivePerception,
    passiveInsight,
    passiveInvestigation,
    senses,
    itemSavingThrowBonus,
  };
}

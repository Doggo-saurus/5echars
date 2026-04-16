export function createSpellcastingRules({
  toNumber,
  spellSlotLevels,
  getPreferredSourceOrder,
  getClassCatalogEntry,
  saveAbilities,
  abilityLabels,
  getSelectedSubclassEntry,
}) {
  const saveAbilitiesList =
    Array.isArray(saveAbilities) && saveAbilities.length ? saveAbilities : ["str", "dex", "con", "int", "wis", "cha"];
  const getClassKey = (className) =>
    String(className ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, "");

  function getEmptySpellSlotDefaults() {
    return Object.fromEntries(spellSlotLevels.map((level) => [String(level), 0]));
  }

  function getSpellProgressionRows(catalogs, className) {
    if (!catalogs || !Array.isArray(catalogs.classes)) return null;
    const normalizedClassName = String(className ?? "").trim().toLowerCase();
    if (!normalizedClassName) return null;
    const classEntry = catalogs.classes.find((entry) => String(entry?.name ?? "").trim().toLowerCase() === normalizedClassName);
    if (!classEntry || !Array.isArray(classEntry.classTableGroups)) return null;
    const progressionGroup = classEntry.classTableGroups.find((group) => Array.isArray(group?.rowsSpellProgression));
    return Array.isArray(progressionGroup?.rowsSpellProgression) ? progressionGroup.rowsSpellProgression : null;
  }

  function getClassSpellSlotDefaults(catalogs, className, classLevel) {
    const defaults = getEmptySpellSlotDefaults();
    if (!catalogs || !Array.isArray(catalogs.classes)) return defaults;
    const normalizedClassName = String(className ?? "").trim().toLowerCase();
    if (!normalizedClassName) return defaults;
    const classEntry = catalogs.classes.find((entry) => String(entry?.name ?? "").trim().toLowerCase() === normalizedClassName);
    if (!classEntry || !Array.isArray(classEntry.classTableGroups)) return defaults;
    const levelIndex = Math.max(0, Math.min(19, toNumber(classLevel, 1) - 1));
    const progressionGroup = classEntry.classTableGroups.find((group) => Array.isArray(group?.rowsSpellProgression));
    const progressionRows = progressionGroup?.rowsSpellProgression;
    const row = Array.isArray(progressionRows?.[levelIndex]) ? progressionRows[levelIndex] : null;
    if (!row) return defaults;
    spellSlotLevels.forEach((slotLevel, idx) => {
      defaults[String(slotLevel)] = Math.max(0, toNumber(row[idx], 0));
    });
    return defaults;
  }

  function getClassCasterType(catalogs, className) {
    const classKey = getClassKey(className);
    if (classKey === "warlock") return "pact";
    const rows = getSpellProgressionRows(catalogs, className);
    const level20Row = Array.isArray(rows?.[19]) ? rows[19] : null;
    if (!level20Row) return "none";
    const totalSlots = level20Row.reduce((sum, value) => sum + Math.max(0, toNumber(value, 0)), 0);
    const highestSlotLevel = level20Row.reduce((highest, value, idx) => {
      if (toNumber(value, 0) > 0) return Math.max(highest, idx + 1);
      return highest;
    }, 0);
    if (highestSlotLevel > 0 && totalSlots <= 4) return "pact";
    if (highestSlotLevel >= 9) return "full";
    if (highestSlotLevel >= 5) return "half";
    if (highestSlotLevel >= 4) return "third";
    return "none";
  }

  function getClassCasterContribution(catalogs, className, classLevel) {
    const casterType = getClassCasterType(catalogs, className);
    const classKey = getClassKey(className);
    const level = Math.max(0, toNumber(classLevel, 0));
    if (casterType === "full") return level;
    if (casterType === "half") {
      if (classKey === "artificer") return Math.ceil(level / 2);
      return Math.floor(level / 2);
    }
    if (casterType === "third") return Math.floor(level / 3);
    return 0;
  }

  function normalizeAbilityKey(value) {
    const key = String(value ?? "").trim().toLowerCase();
    return saveAbilitiesList.includes(key) ? key : "";
  }

  function resolveSpellModsFromAbilityField(raw, mods) {
    if (raw == null) return null;
    const keys =
      typeof raw === "string"
        ? [normalizeAbilityKey(raw)].filter(Boolean)
        : Array.isArray(raw)
          ? raw.map((entry) => normalizeAbilityKey(entry)).filter(Boolean)
          : [];
    if (!keys.length) return null;
    let bestKey = keys[0];
    let bestMod = toNumber(mods[bestKey], 0);
    for (let i = 1; i < keys.length; i += 1) {
      const k = keys[i];
      const m = toNumber(mods[k], 0);
      if (m > bestMod) {
        bestMod = m;
        bestKey = k;
      }
    }
    return { bestKey, bestMod, allKeys: keys };
  }

  function resolveSpellMods(classEntry, subclassEntry, mods) {
    const fromClass = classEntry ? resolveSpellModsFromAbilityField(classEntry.spellcastingAbility, mods) : null;
    if (fromClass) return fromClass;
    if (subclassEntry) return resolveSpellModsFromAbilityField(subclassEntry.spellcastingAbility, mods);
    return null;
  }

  function spellcastingTrackIsActive(catalogs, resolvedClassName, level) {
    const t = getClassCasterType(catalogs, resolvedClassName);
    if (t === "pact") return level >= 1;
    return getClassCasterContribution(catalogs, resolvedClassName, level) > 0;
  }

  function getCharacterSpellSaveSummary(catalogs, character, mods, proficiencyBonus) {
    const pb = Math.max(0, toNumber(proficiencyBonus, 0));
    const { primaryLevel, multiclass } = getCharacterClassLevels(character);
    const rows = [];
    const considerTrack = (className, classSource, level, isPrimary) => {
      const trimmed = String(className ?? "").trim();
      if (!trimmed || level < 1) return;
      const classEntry = getClassCatalogEntry(catalogs, trimmed, classSource, getPreferredSourceOrder(character));
      if (!classEntry) return;
      const resolvedName = String(classEntry.name ?? trimmed).trim();
      if (!resolvedName) return;
      const subclassEntry = isPrimary && typeof getSelectedSubclassEntry === "function" ? getSelectedSubclassEntry(catalogs, character) : null;
      const modInfo = resolveSpellMods(classEntry, subclassEntry, mods);
      if (!modInfo) return;
      if (!spellcastingTrackIsActive(catalogs, resolvedName, level)) return;
      const dc = 8 + pb + modInfo.bestMod;
      const abilityLabel =
        modInfo.allKeys.length > 1
          ? `max ${modInfo.allKeys.map((k) => abilityLabels?.[k] ?? String(k).toUpperCase()).join("/")}`
          : abilityLabels?.[modInfo.bestKey] ?? String(modInfo.bestKey).toUpperCase();
      rows.push({ classLabel: resolvedName, dc, abilityLabel });
    };
    considerTrack(character?.class, character?.classSource, primaryLevel, true);
    multiclass.forEach((entry) => considerTrack(entry.class, entry.source ?? "", entry.level, false));
    if (!rows.length) return null;
    const dcs = rows.map((r) => r.dc);
    const minDc = Math.min(...dcs);
    const maxDc = Math.max(...dcs);
    const displayText = minDc === maxDc ? String(maxDc) : `${minDc}–${maxDc}`;
    let title = rows.map((r) => `${r.classLabel}: spell save DC ${r.dc} (${r.abilityLabel})`).join(". ");
    if (rows.length > 1) {
      title += " Each spell uses the DC for the class that granted it.";
    }
    return { displayText, title, rows };
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

  function getFullCasterSpellSlotsByLevel(catalogs, casterLevel) {
    const defaults = getEmptySpellSlotDefaults();
    const level = Math.max(0, Math.min(20, toNumber(casterLevel, 0)));
    if (level <= 0 || !Array.isArray(catalogs?.classes)) return defaults;
    const fullCaster = catalogs.classes.find((entry) => getClassCasterType(catalogs, entry?.name) === "full");
    const rows = getSpellProgressionRows(catalogs, fullCaster?.name);
    const row = Array.isArray(rows?.[level - 1]) ? rows[level - 1] : null;
    if (!row) return defaults;
    spellSlotLevels.forEach((slotLevel, idx) => {
      defaults[String(slotLevel)] = Math.max(0, toNumber(row[idx], 0));
    });
    return defaults;
  }

  function getCharacterSpellSlotDefaults(catalogs, character) {
    const defaults = getEmptySpellSlotDefaults();
    const primaryClassName = String(character?.class ?? "").trim();
    if (!primaryClassName) return defaults;
    const sourceOrder = getPreferredSourceOrder(character);
    const primaryClassEntry = getClassCatalogEntry(catalogs, primaryClassName, character?.classSource, sourceOrder);
    const resolvedPrimaryClassName = String(primaryClassEntry?.name ?? primaryClassName).trim();
    const { primaryLevel, multiclass } = getCharacterClassLevels(character);
    if (!multiclass.length) {
      return getClassSpellSlotDefaults(catalogs, resolvedPrimaryClassName, primaryLevel);
    }
    const casterLevel = getClassCasterContribution(catalogs, resolvedPrimaryClassName, primaryLevel)
      + multiclass.reduce((sum, entry) => sum + getClassCasterContribution(catalogs, entry.class, entry.level), 0);
    return getFullCasterSpellSlotsByLevel(catalogs, casterLevel);
  }

  return {
    getEmptySpellSlotDefaults,
    getClassSpellSlotDefaults,
    getClassCasterType,
    getClassCasterContribution,
    getCharacterClassLevels,
    getFullCasterSpellSlotsByLevel,
    getCharacterSpellSlotDefaults,
    getCharacterSpellSaveSummary,
  };
}

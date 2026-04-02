export function createProficiencyRules({
  toNumber,
  saveAbilities,
  skills,
  skillKeyByCanonical,
  skillProficiencyNone,
  skillProficiencyHalf,
  skillProficiencyProficient,
  skillProficiencyExpertise,
  skillProficiencyModes,
  asiFeatureNameRegex,
  isRecordObject,
  getCharacterClassLevels,
  getPreferredSourceOrder,
  getClassCatalogEntry,
  getEffectiveRaceEntry,
  findCatalogEntryByNameWithSelectedSourcePreference,
  getClassSaveProficiencies,
}) {
  function normalizeAbilityKey(value) {
    const key = String(value ?? "").trim().toLowerCase();
    return saveAbilities.includes(key) ? key : "";
  }

  function normalizeSkillKey(value) {
    const token = String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, "");
    return skillKeyByCanonical[token] ?? "";
  }

  function getEmptyAbilityMap() {
    return saveAbilities.reduce((acc, ability) => {
      acc[ability] = 0;
      return acc;
    }, {});
  }

  function getAutoChoiceSelectionMap(play, sourceKey) {
    if (!isRecordObject(play?.autoChoiceSelections)) return {};
    const selected = play.autoChoiceSelections[sourceKey];
    return isRecordObject(selected) ? selected : {};
  }

  function normalizeChoiceToken(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function getAutoChoiceSelectedValues(play, sourceKey, choiceId, from, count) {
    const selectionMap = getAutoChoiceSelectionMap(play, sourceKey);
    const storedRaw = selectionMap[choiceId];
    const fromByToken = new Map(
      from
        .map((entry) => [normalizeChoiceToken(entry), entry])
        .filter(([token, value]) => token && value)
    );
    const stored = (Array.isArray(storedRaw) ? storedRaw : [storedRaw])
      .map((value) => normalizeChoiceToken(value))
      .filter((token) => fromByToken.has(token))
      .map((token) => fromByToken.get(token));
    const uniqueStored = [...new Set(stored)];
    if (uniqueStored.length) return uniqueStored.slice(0, Math.max(0, count));
    return from.slice(0, Math.max(0, count));
  }

  function getStoredAutoChoiceSelectedValues(play, sourceKey, choiceId, from, count, options = {}) {
    const fallback = options.allowFallback !== false;
    const allowDuplicates = options.allowDuplicates === true;
    const preserveStoredOrder = options.preserveStoredOrder !== false;
    const fromByToken = new Map(
      (Array.isArray(from) ? from : [])
        .map((entry) => [normalizeChoiceToken(entry), entry])
        .filter(([token, value]) => token && value)
    );
    const normalizedCount = Math.max(0, toNumber(count, 0));
    const selectionMap = getAutoChoiceSelectionMap(play, sourceKey);
    const storedRaw = selectionMap[choiceId];
    const storedList = (Array.isArray(storedRaw) ? storedRaw : [storedRaw])
      .map((entry) => normalizeChoiceToken(entry))
      .filter((token) => fromByToken.has(token));
    const orderedStored = preserveStoredOrder ? storedList : [...new Set(storedList)];
    const selected = allowDuplicates ? orderedStored : [...new Set(orderedStored)];
    if (selected.length >= normalizedCount) {
      return selected.slice(0, normalizedCount).map((token) => fromByToken.get(token));
    }
    if (!fallback) return selected.map((token) => fromByToken.get(token));
    const remaining = [...fromByToken.keys()].filter((token) => (allowDuplicates ? true : !selected.includes(token)));
    const filled = [...selected, ...remaining.slice(0, Math.max(0, normalizedCount - selected.length))];
    return filled.slice(0, normalizedCount).map((token) => fromByToken.get(token));
  }

  function applyAbilityChoiceBonuses(choice, bonuses, context) {
    if (!isRecordObject(choice)) return;
    saveAbilities.forEach((ability) => {
      const bonus = toNumber(choice?.[ability], 0);
      if (!Number.isFinite(bonus) || bonus <= 0) return;
      bonuses[ability] = Math.max(0, toNumber(bonuses[ability], 0) + bonus);
    });
    if (!isRecordObject(choice.choose)) return;
    const from = (Array.isArray(choice.choose.from) ? choice.choose.from : [])
      .map((entry) => normalizeAbilityKey(entry))
      .filter(Boolean)
      .filter((ability, index, list) => list.indexOf(ability) === index);
    if (!from.length) return;
    const amount = Math.max(1, toNumber(choice.choose.amount, 1));
    const count = Math.max(1, Math.min(from.length, toNumber(choice.choose.count, 1)));
    const selected = getStoredAutoChoiceSelectedValues(context.play, context.sourceKey, context.choiceId, from, count);
    selected.forEach((ability) => {
      bonuses[ability] = Math.max(0, toNumber(bonuses[ability], 0) + amount);
    });
  }

  function getAbilityBonusesFromEntity(entry, sourceKey, play) {
    const bonuses = getEmptyAbilityMap();
    const abilityOptions = Array.isArray(entry?.ability) ? entry.ability : [];
    const choice = abilityOptions.find((item) => isRecordObject(item)) ?? null;
    if (!choice) return bonuses;
    applyAbilityChoiceBonuses(choice, bonuses, { play, sourceKey, choiceId: "a:0:choose:0" });
    return bonuses;
  }

  function getSelectedFeatAndOptionalFeatureEntries(catalogs, character, sourceOrder) {
    const selectedFeats = Array.isArray(character?.feats) ? character.feats : [];
    const selectedOptionalFeatures = Array.isArray(character?.optionalFeatures) ? character.optionalFeatures : [];
    const featEntries = selectedFeats
      .map((feat) => {
        const matched = findCatalogEntryByNameWithSelectedSourcePreference(catalogs?.feats, feat?.name, feat?.source, sourceOrder);
        if (!matched) return null;
        const sourceKey = `feat:${String(feat?.id ?? matched.name ?? "").trim() || String(matched.name ?? "").trim()}`;
        return { selection: feat, entry: matched, sourceKey };
      })
      .filter(Boolean);
    const optionalFeatureEntries = selectedOptionalFeatures
      .map((feature) => {
        const matched = findCatalogEntryByNameWithSelectedSourcePreference(catalogs?.optionalFeatures, feature?.name, feature?.source, sourceOrder);
        if (!matched) return null;
        const sourceKey = `optionalfeature:${String(feature?.id ?? matched.name ?? "").trim() || String(matched.name ?? "").trim()}`;
        return { selection: feature, entry: matched, sourceKey };
      })
      .filter(Boolean);
    return { featEntries, optionalFeatureEntries };
  }

  function getAutomaticAbilityBonuses(catalogs, character, play) {
    const sourceOrder = getPreferredSourceOrder(character);
    const raceEntry = getEffectiveRaceEntry(catalogs, character, sourceOrder);
    const backgroundEntry = findCatalogEntryByNameWithSelectedSourcePreference(
      catalogs?.backgrounds,
      character?.background,
      character?.backgroundSource,
      sourceOrder
    );
    const { featEntries, optionalFeatureEntries } = getSelectedFeatAndOptionalFeatureEntries(catalogs, character, sourceOrder);
    const raceBonuses = getAbilityBonusesFromEntity(raceEntry, "race", play);
    const backgroundBonuses = getAbilityBonusesFromEntity(backgroundEntry, "background", play);
    const featBonuses = getEmptyAbilityMap();
    featEntries.forEach(({ entry, sourceKey }) => {
      const bonuses = getAbilityBonusesFromEntity(entry, sourceKey, play);
      saveAbilities.forEach((ability) => {
        featBonuses[ability] = Math.max(0, toNumber(featBonuses?.[ability], 0) + toNumber(bonuses?.[ability], 0));
      });
    });
    const optionalFeatureBonuses = getEmptyAbilityMap();
    optionalFeatureEntries.forEach(({ entry, sourceKey }) => {
      const bonuses = getAbilityBonusesFromEntity(entry, sourceKey, play);
      saveAbilities.forEach((ability) => {
        optionalFeatureBonuses[ability] = Math.max(0, toNumber(optionalFeatureBonuses?.[ability], 0) + toNumber(bonuses?.[ability], 0));
      });
    });
    const featSlots = Array.isArray(character?.progression?.featSlots) ? character.progression.featSlots : [];
    const selectedFeatSlotIds = new Set(
      (Array.isArray(character?.feats) ? character.feats : []).map((feat) => String(feat?.slotId ?? "").trim()).filter(Boolean)
    );
    const asiBonuses = getEmptyAbilityMap();
    featSlots
      .filter((slot) => asiFeatureNameRegex.test(String(slot?.slotType ?? "")))
      .filter((slot) => !selectedFeatSlotIds.has(String(slot?.id ?? "").trim()))
      .forEach((slot) => {
        const sourceKey = `asi:${String(slot?.id ?? "").trim()}`;
        if (!sourceKey) return;
        const selectedAbilities = getStoredAutoChoiceSelectedValues(play, sourceKey, "a:0:choose:0", saveAbilities, 2);
        selectedAbilities.forEach((ability) => {
          asiBonuses[ability] = Math.max(0, toNumber(asiBonuses[ability], 0) + 1);
        });
      });
    return saveAbilities.reduce((acc, ability) => {
      acc[ability] = Math.max(
        0,
        toNumber(raceBonuses[ability], 0)
          + toNumber(backgroundBonuses[ability], 0)
          + toNumber(asiBonuses[ability], 0)
          + toNumber(featBonuses[ability], 0)
          + toNumber(optionalFeatureBonuses[ability], 0)
      );
      return acc;
    }, {});
  }

  function mergeProficienciesWithOverrides(auto, overrides, keys) {
    return keys.reduce((acc, key) => {
      const overrideValue = overrides?.[key];
      if (typeof overrideValue === "boolean") {
        acc[key] = overrideValue;
        return acc;
      }
      acc[key] = Boolean(auto?.[key]);
      return acc;
    }, {});
  }

  function deriveLegacyProficiencyOverrides(current, auto, keys) {
    const overrides = {};
    keys.forEach((key) => {
      const currentValue = Boolean(current?.[key]);
      const autoValue = Boolean(auto?.[key]);
      if (currentValue !== autoValue) overrides[key] = currentValue;
    });
    return overrides;
  }

  function hasStoredProficiencyState(stateMap, keys) {
    return keys.some((key) => typeof stateMap?.[key] === "boolean");
  }

  function normalizeSkillProficiencyMode(value, fallback = skillProficiencyNone) {
    const mode = String(value ?? "").trim().toLowerCase();
    return skillProficiencyModes.includes(mode) ? mode : fallback;
  }

  function isSkillModeProficient(mode) {
    return mode === skillProficiencyProficient || mode === skillProficiencyExpertise;
  }

  function hasStoredSkillModeState(stateMap, keys) {
    return keys.some((key) => skillProficiencyModes.includes(String(stateMap?.[key] ?? "").trim().toLowerCase()));
  }

  function mapSkillModesToProficiencyMap(modeMap, keys) {
    return keys.reduce((acc, key) => {
      acc[key] = isSkillModeProficient(normalizeSkillProficiencyMode(modeMap?.[key], skillProficiencyNone));
      return acc;
    }, {});
  }

  function mergeSkillModesWithOverrides(autoModes, overrides, keys) {
    return keys.reduce((acc, key) => {
      const overrideMode = normalizeSkillProficiencyMode(overrides?.[key], "");
      if (overrideMode) {
        acc[key] = overrideMode;
        return acc;
      }
      acc[key] = normalizeSkillProficiencyMode(autoModes?.[key], skillProficiencyNone);
      return acc;
    }, {});
  }

  function getClassLevelByName(character, className) {
    const target = String(className ?? "").trim().toLowerCase();
    if (!target) return 0;
    const { primaryLevel, multiclass } = getCharacterClassLevels(character);
    let total = 0;
    if (String(character?.class ?? "").trim().toLowerCase() === target) total += primaryLevel;
    multiclass.forEach((entry) => {
      if (String(entry?.class ?? "").trim().toLowerCase() === target) total += Math.max(0, toNumber(entry?.level, 0));
    });
    return total;
  }

  function applySkillProficiencyOption(activeSkills, option, context) {
    if (!isRecordObject(option)) return;
    const fixedSkillKeys = Object.entries(option)
      .filter(([key, value]) => key !== "choose" && key !== "any" && value === true)
      .map(([key]) => normalizeSkillKey(key))
      .filter(Boolean);
    fixedSkillKeys.forEach((skillKey) => activeSkills.add(skillKey));
    const anyCount = Math.max(0, toNumber(option.any, 0));
    if (anyCount > 0) {
      const pool = skills.map((skill) => skill.key).filter((skillKey) => !activeSkills.has(skillKey));
      const anyChoiceId = `s:${context.optionIndex}:any`;
      const selected = getAutoChoiceSelectedValues(context.play, context.sourceKey, anyChoiceId, pool, anyCount);
      selected.forEach((skillKey) => activeSkills.add(skillKey));
    }
    const choose = isRecordObject(option.choose) ? option.choose : null;
    if (!choose) return;
    const from = (Array.isArray(choose.from) ? choose.from : [])
      .map((entry) => normalizeSkillKey(entry))
      .filter(Boolean)
      .filter((skillKey, index, list) => list.indexOf(skillKey) === index);
    if (!from.length) return;
    const count = Math.max(1, toNumber(choose.count, 1));
    const pool = from.filter((skillKey) => !activeSkills.has(skillKey));
    const chooseChoiceId = `s:${context.optionIndex}:choose`;
    const selected = getAutoChoiceSelectedValues(context.play, context.sourceKey, chooseChoiceId, pool, count);
    selected.forEach((skillKey) => activeSkills.add(skillKey));
  }

  function collectSkillProficienciesFromEntity(entry, sourceKey, play) {
    const activeSkills = new Set();
    const options = Array.isArray(entry?.skillProficiencies) ? entry.skillProficiencies : [];
    const optionIndex = options.findIndex((option) => isRecordObject(option));
    const firstOption = optionIndex >= 0 ? options[optionIndex] : null;
    if (firstOption) applySkillProficiencyOption(activeSkills, firstOption, { play, sourceKey, optionIndex });
    return activeSkills;
  }

  function collectSkillProficienciesFromClassEntry(classEntry, play, sourceKey = "class") {
    const activeSkills = new Set();
    const skillEntries = Array.isArray(classEntry?.startingProficiencies?.skills) ? classEntry.startingProficiencies.skills : [];
    skillEntries.forEach((entry, optionIndex) => {
      if (typeof entry === "string") {
        const skillKey = normalizeSkillKey(entry);
        if (skillKey) activeSkills.add(skillKey);
        return;
      }
      const choose = isRecordObject(entry?.choose) ? entry.choose : null;
      if (!choose) return;
      const from = (Array.isArray(choose.from) ? choose.from : [])
        .map((value) => normalizeSkillKey(value))
        .filter(Boolean)
        .filter((skillKey, index, list) => list.indexOf(skillKey) === index);
      if (!from.length) return;
      const count = Math.max(1, Math.min(from.length, toNumber(choose.count, 1)));
      const choiceId = `cs:${optionIndex}:choose`;
      const selected = getAutoChoiceSelectedValues(play, sourceKey, choiceId, from, count);
      selected.forEach((skillKey) => activeSkills.add(skillKey));
    });
    return activeSkills;
  }

  function getAutomaticSaveProficiencies(catalogs, character) {
    const auto = { ...getClassSaveProficiencies(catalogs, character?.class) };
    const sourceOrder = getPreferredSourceOrder(character);
    const raceEntry = getEffectiveRaceEntry(catalogs, character, sourceOrder);
    const backgroundEntry = findCatalogEntryByNameWithSelectedSourcePreference(
      catalogs?.backgrounds,
      character?.background,
      character?.backgroundSource,
      sourceOrder
    );
    const { featEntries, optionalFeatureEntries } = getSelectedFeatAndOptionalFeatureEntries(catalogs, character, sourceOrder);
    [raceEntry, backgroundEntry, ...featEntries.map((item) => item.entry), ...optionalFeatureEntries.map((item) => item.entry)].forEach((entry) => {
      const saveOptions = Array.isArray(entry?.saveProficiencies) ? entry.saveProficiencies : [];
      const selected = saveOptions.find((option) => isRecordObject(option)) ?? null;
      if (!selected) return;
      Object.entries(selected).forEach(([key, value]) => {
        const ability = normalizeAbilityKey(key);
        if (!ability || value !== true) return;
        auto[ability] = true;
      });
    });
    return saveAbilities.reduce((acc, ability) => {
      acc[ability] = Boolean(auto?.[ability]);
      return acc;
    }, {});
  }

  function getAutomaticSkillProficiencies(catalogs, character, play) {
    const sourceOrder = getPreferredSourceOrder(character);
    const classEntry = getClassCatalogEntry(catalogs, character?.class, character?.classSource, sourceOrder);
    const raceEntry = getEffectiveRaceEntry(catalogs, character, sourceOrder);
    const backgroundEntry = findCatalogEntryByNameWithSelectedSourcePreference(
      catalogs?.backgrounds,
      character?.background,
      character?.backgroundSource,
      sourceOrder
    );
    const { featEntries, optionalFeatureEntries } = getSelectedFeatAndOptionalFeatureEntries(catalogs, character, sourceOrder);
    const activeSkills = new Set();
    if (classEntry) {
      const className = String(classEntry?.name ?? character?.class ?? "").trim().toLowerCase();
      collectSkillProficienciesFromClassEntry(classEntry, play, `class:${className || "primary"}`).forEach((skillKey) => activeSkills.add(skillKey));
    }
    [raceEntry, backgroundEntry].forEach((entry) => {
      const sourceKey = entry === raceEntry ? "race" : "background";
      collectSkillProficienciesFromEntity(entry, sourceKey, play).forEach((skillKey) => activeSkills.add(skillKey));
    });
    featEntries.forEach(({ entry, sourceKey }) => {
      collectSkillProficienciesFromEntity(entry, sourceKey, play).forEach((skillKey) => activeSkills.add(skillKey));
    });
    optionalFeatureEntries.forEach(({ entry, sourceKey }) => {
      collectSkillProficienciesFromEntity(entry, sourceKey, play).forEach((skillKey) => activeSkills.add(skillKey));
    });
    return skills.reduce((acc, skill) => {
      acc[skill.key] = activeSkills.has(skill.key);
      return acc;
    }, {});
  }

  function getAutomaticSkillProficiencyModes(catalogs, character, play) {
    const baseProficiencies = getAutomaticSkillProficiencies(catalogs, character, play);
    const modes = skills.reduce((acc, skill) => {
      acc[skill.key] = baseProficiencies?.[skill.key] ? skillProficiencyProficient : skillProficiencyNone;
      return acc;
    }, {});
    const bardLevel = getClassLevelByName(character, "bard");
    if (bardLevel >= 2) {
      skills.forEach((skill) => {
        if (modes[skill.key] === skillProficiencyNone) modes[skill.key] = skillProficiencyHalf;
      });
    }
    return modes;
  }

  return {
    normalizeAbilityKey,
    normalizeSkillKey,
    getEmptyAbilityMap,
    getAutoChoiceSelectionMap,
    normalizeChoiceToken,
    getAutoChoiceSelectedValues,
    getStoredAutoChoiceSelectedValues,
    applyAbilityChoiceBonuses,
    getAbilityBonusesFromEntity,
    getSelectedFeatAndOptionalFeatureEntries,
    getAutomaticAbilityBonuses,
    mergeProficienciesWithOverrides,
    deriveLegacyProficiencyOverrides,
    hasStoredProficiencyState,
    normalizeSkillProficiencyMode,
    isSkillModeProficient,
    hasStoredSkillModeState,
    mapSkillModesToProficiencyMap,
    mergeSkillModesWithOverrides,
    getClassLevelByName,
    applySkillProficiencyOption,
    collectSkillProficienciesFromEntity,
    collectSkillProficienciesFromClassEntry,
    getAutomaticSaveProficiencies,
    getAutomaticSkillProficiencies,
    getAutomaticSkillProficiencyModes,
  };
}

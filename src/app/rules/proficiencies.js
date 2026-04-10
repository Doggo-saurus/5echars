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

  function getAsiChoiceSourceKey(slot, slotIndex = 0) {
    const slotId = String(slot?.id ?? "").trim();
    if (slotId) return `asi:${slotId}`;
    const className = String(slot?.className ?? "").trim().toLowerCase();
    const classSource = String(slot?.classSource ?? "").trim().toLowerCase();
    const slotType = String(slot?.slotType ?? "").trim().toLowerCase();
    const level = toNumber(slot?.level, 0);
    return `asi:fallback:${className}|${classSource}|${slotType}|${level}|${Math.max(0, toNumber(slotIndex, 0))}`;
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

  function collectEntryTextLines(entry, out = []) {
    if (entry == null) return out;
    if (typeof entry === "string") {
      const line = String(entry).trim();
      if (line) out.push(line);
      return out;
    }
    if (Array.isArray(entry)) {
      entry.forEach((value) => collectEntryTextLines(value, out));
      return out;
    }
    if (!isRecordObject(entry)) return out;
    if (typeof entry.name === "string" && entry.name.trim()) out.push(entry.name.trim());
    collectEntryTextLines(entry.entry, out);
    collectEntryTextLines(entry.text, out);
    collectEntryTextLines(entry.entries, out);
    collectEntryTextLines(entry.items, out);
    return out;
  }

  function parseCountToken(value) {
    const token = String(value ?? "").trim().toLowerCase();
    if (!token) return 1;
    if (token === "a" || token === "an" || token === "one") return 1;
    if (token === "two") return 2;
    if (token === "three") return 3;
    if (token === "four") return 4;
    if (token === "five") return 5;
    return Math.max(0, Math.floor(toNumber(token, 0)));
  }

  function getFeatureModeSelectedEntryDescriptors(catalogs, character, play, featureModes) {
    const classFeatures = Array.isArray(catalogs?.classFeatures) ? catalogs.classFeatures : [];
    const className = String(character?.class ?? "").trim().toLowerCase();
    if (!className || !classFeatures.length) return [];
    const sourceOrder = getPreferredSourceOrder(character).map((source) => String(source ?? "").trim().toLowerCase());
    const sourceRank = new Map(sourceOrder.map((source, index) => [source, index]));
    const unknownRank = sourceRank.size + 1000;
    const seen = new Set();
    const descriptors = [];
    (Array.isArray(featureModes) ? featureModes : []).forEach((mode) => {
      const modeId = String(mode?.id ?? "").trim();
      if (!modeId) return;
      const raw = play?.featureModes?.[modeId];
      const selectedValues = Array.isArray(raw) ? raw : [raw];
      selectedValues
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
        .forEach((label) => {
          const normalizedLabel = label.toLowerCase();
          const candidates = classFeatures
            .filter((entry) => String(entry?.name ?? "").trim().toLowerCase() === normalizedLabel)
            .filter((entry) => String(entry?.className ?? "").trim().toLowerCase() === className)
            .sort((a, b) => {
              const aRank = sourceRank.get(String(a?.source ?? "").trim().toLowerCase()) ?? unknownRank;
              const bRank = sourceRank.get(String(b?.source ?? "").trim().toLowerCase()) ?? unknownRank;
              if (aRank !== bRank) return aRank - bRank;
              return toNumber(a?.level, 0) - toNumber(b?.level, 0);
            });
          const entry = candidates[0] ?? null;
          if (!entry) return;
          const sourceKey = `feature-mode:${modeId}:${normalizeChoiceToken(label)}`;
          const key = `${sourceKey}:${normalizeChoiceToken(entry?.name)}:${String(entry?.source ?? "").trim().toLowerCase()}`;
          if (seen.has(key)) return;
          seen.add(key);
          descriptors.push({ sourceKey, entry });
        });
    });
    return descriptors;
  }

  function getCantripLimitBonusFromFeatureModeEntries(descriptors) {
    let total = 0;
    descriptors.forEach(({ entry }) => {
      const text = collectEntryTextLines(entry?.entries ?? []).join(" ").toLowerCase();
      if (!text) return;
      const matches = text.matchAll(
        /\b(?:learn|know|gain)\b[^.]{0,140}?\b(?:(a|an|one|two|three|four|five|\d+)\s+)?(?:extra|additional)\s+cantrips?\b/gi
      );
      for (const match of matches) {
        total += parseCountToken(match?.[1]);
      }
    });
    return Math.max(0, total);
  }

  function getEmptySkillCheckBonusMap() {
    return skills.reduce((acc, skill) => {
      acc[skill.key] = 0;
      return acc;
    }, {});
  }

  function getSkillCheckBonusesFromFeatureModeEntries(character, play, descriptors) {
    const bonuses = getEmptySkillCheckBonusMap();
    const abilityKeyByName = {
      strength: "str",
      dexterity: "dex",
      constitution: "con",
      intelligence: "int",
      wisdom: "wis",
      charisma: "cha",
    };
    descriptors.forEach(({ sourceKey, entry }) => {
      const text = collectEntryTextLines(entry?.entries ?? []).join(" ");
      const abilityMatch = text.match(
        /\bbonus equals your\s+(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+modifier(?:\s*\(minimum of \+?(\d+)\))?/i
      );
      if (!abilityMatch?.[1]) return;
      const abilityKey = abilityKeyByName[String(abilityMatch[1]).trim().toLowerCase()] ?? "";
      if (!abilityKey) return;
      const minimum = Math.max(0, toNumber(abilityMatch?.[2], 0));
      const score = toNumber(character?.abilities?.[abilityKey], 10);
      const modifier = Math.floor((score - 10) / 2);
      const amount = Math.max(1, minimum, modifier);
      if (amount <= 0) return;
      const checkClauseMatch = text.match(/\bbonus to your\s+([^.]*?)checks?/i) ?? text.match(/\bbonus to\s+([^.]*?)checks?/i);
      const clause = String(checkClauseMatch?.[1] ?? "");
      if (!clause) return;
      const options = skills
        .filter((skill) => new RegExp(`\\b${String(skill.label ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(clause))
        .map((skill) => skill.key)
        .filter(Boolean);
      const uniqueOptions = [...new Set(options)];
      if (!uniqueOptions.length) return;
      const selected = uniqueOptions.length > 1
        ? getStoredAutoChoiceSelectedValues(play, sourceKey, "skill-bonus:0", uniqueOptions, 1)
        : uniqueOptions;
      selected.forEach((skillKey) => {
        bonuses[skillKey] = Math.max(0, toNumber(bonuses?.[skillKey], 0) + amount);
      });
    });
    return bonuses;
  }

  function getAutomaticFeatureModeBonuses(catalogs, character, play, featureModes) {
    const descriptors = getFeatureModeSelectedEntryDescriptors(catalogs, character, play, featureModes);
    return {
      cantripLimitBonus: getCantripLimitBonusFromFeatureModeEntries(descriptors),
      skillCheckBonuses: getSkillCheckBonusesFromFeatureModeEntries(character, play, descriptors),
    };
  }

  function applyAbilityChoiceBonuses(choice, bonuses, context) {
    if (!choice) return;
    const weighted = isRecordObject(choice.weighted) ? choice.weighted : null;
    const fromRaw = Array.isArray(weighted?.from) ? weighted.from : Array.isArray(choice.from) ? choice.from : [];
    const from = fromRaw
      .map((entry) => normalizeAbilityKey(entry))
      .filter(Boolean)
      .filter((ability, index, list) => list.indexOf(ability) === index);
    if (!from.length) return;
    const weightValues = Array.isArray(weighted?.weights)
      ? weighted.weights.map((entry) => Math.max(0, toNumber(entry, 0))).filter((entry) => entry > 0)
      : [];
    const fallbackAmount = Math.max(1, toNumber(choice.amount ?? weighted?.amount, 1));
    const countFromWeights = weightValues.length;
    const countFromChoice = Math.max(0, toNumber(choice.count ?? weighted?.count, 0));
    const count = Math.max(1, Math.min(from.length, countFromChoice || countFromWeights || 1));
    const choiceId = `a:${context.optionIndex}:choose:${context.choiceIndex}`;
    const selected = getStoredAutoChoiceSelectedValues(context.play, context.sourceKey, choiceId, from, count, {
      allowDuplicates: weightValues.length > 1,
      preserveStoredOrder: weightValues.length > 1,
    });
    selected.forEach((ability, index) => {
      const amount = Math.max(1, toNumber(weightValues[index], fallbackAmount));
      bonuses[ability] = Math.max(0, toNumber(bonuses[ability], 0) + amount);
    });
  }

  function getAbilityBonusesFromEntity(entry, sourceKey, play) {
    const bonuses = getEmptyAbilityMap();
    const options = Array.isArray(entry?.ability) ? entry.ability : [];
    const optionIndex = options.findIndex((option) => isRecordObject(option));
    const selected = optionIndex >= 0 ? options[optionIndex] : null;
    if (!selected) return bonuses;
    let abilityChoiceIndex = 0;
    Object.entries(selected).forEach(([key, value]) => {
      const ability = normalizeAbilityKey(key);
      if (ability) {
        const amount = Math.max(0, toNumber(value, 0));
        bonuses[ability] = Math.max(0, toNumber(bonuses[ability], 0) + amount);
        return;
      }
      if (key === "choose") {
        if (Array.isArray(value)) {
          value.forEach((choice) => {
            applyAbilityChoiceBonuses(choice, bonuses, { play, sourceKey, optionIndex, choiceIndex: abilityChoiceIndex });
            abilityChoiceIndex += 1;
          });
        } else if (isRecordObject(value)) {
          applyAbilityChoiceBonuses(value, bonuses, { play, sourceKey, optionIndex, choiceIndex: abilityChoiceIndex });
          abilityChoiceIndex += 1;
        }
      }
    });
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
      .forEach((slot, slotIndex) => {
        const sourceKey = getAsiChoiceSourceKey(slot, slotIndex);
        if (!sourceKey) return;
        const selectedAbilities = getStoredAutoChoiceSelectedValues(play, sourceKey, "a:0:choose:0", saveAbilities, 2, {
          allowDuplicates: true,
          preserveStoredOrder: true,
          allowFallback: false,
        });
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

  function collectLinkedAbilityChoicesFromEntity(entry, sourceKey, play) {
    const selectedAbilities = [];
    const abilityOptions = Array.isArray(entry?.ability) ? entry.ability : [];
    const optionIndex = abilityOptions.findIndex((option) => isRecordObject(option));
    const selectedOption = optionIndex >= 0 ? abilityOptions[optionIndex] : null;
    if (!selectedOption) return selectedAbilities;
    const chooseOptions = Array.isArray(selectedOption?.choose) ? selectedOption.choose : [selectedOption?.choose];
    let choiceIndex = 0;
    chooseOptions.forEach((choice) => {
      if (!isRecordObject(choice)) return;
      const weighted = isRecordObject(choice?.weighted) ? choice.weighted : null;
      const fromRaw = Array.isArray(weighted?.from) ? weighted.from : Array.isArray(choice?.from) ? choice.from : [];
      const from = fromRaw
        .map((value) => normalizeAbilityKey(value))
        .filter(Boolean)
        .filter((ability, index, list) => list.indexOf(ability) === index);
      if (!from.length) {
        choiceIndex += 1;
        return;
      }
      const count = Math.max(1, Math.min(from.length, toNumber(choice?.count ?? weighted?.count, 1)));
      const choiceId = `a:${optionIndex}:choose:${choiceIndex}`;
      getStoredAutoChoiceSelectedValues(play, sourceKey, choiceId, from, count, {
        allowDuplicates: false,
        preserveStoredOrder: true,
      }).forEach((ability) => selectedAbilities.push(ability));
      choiceIndex += 1;
    });
    return selectedAbilities.filter((ability, index, list) => list.indexOf(ability) === index);
  }

  function collectSaveProficienciesFromEntity(entry, sourceKey, play) {
    const activeSaves = new Set();
    const saveOptions = Array.isArray(entry?.savingThrowProficiencies)
      ? entry.savingThrowProficiencies
      : Array.isArray(entry?.saveProficiencies)
        ? entry.saveProficiencies
        : [];
    const optionIndex = saveOptions.findIndex((option) => isRecordObject(option));
    const selected = optionIndex >= 0 ? saveOptions[optionIndex] : null;
    if (!selected) return activeSaves;
    Object.entries(selected).forEach(([key, value]) => {
      const ability = normalizeAbilityKey(key);
      if (!ability || value !== true) return;
      activeSaves.add(ability);
    });
    const choose = isRecordObject(selected?.choose) ? selected.choose : null;
    if (!choose) return activeSaves;
    const from = (Array.isArray(choose?.from) ? choose.from : [])
      .map((value) => normalizeAbilityKey(value))
      .filter(Boolean)
      .filter((ability, index, list) => list.indexOf(ability) === index);
    if (!from.length) return activeSaves;
    const count = Math.max(1, Math.min(from.length, toNumber(choose?.count, 1)));
    const choiceId = `sv:${optionIndex}:choose`;
    const fromSet = new Set(from);
    let selectedFromChoose = getStoredAutoChoiceSelectedValues(play, sourceKey, choiceId, from, count, { allowFallback: false });
    if (!selectedFromChoose.length) {
      selectedFromChoose = collectLinkedAbilityChoicesFromEntity(entry, sourceKey, play)
        .filter((ability) => fromSet.has(ability))
        .slice(0, count);
    }
    if (!selectedFromChoose.length) {
      selectedFromChoose = getStoredAutoChoiceSelectedValues(play, sourceKey, choiceId, from, count);
    }
    selectedFromChoose.forEach((ability) => activeSaves.add(ability));
    return activeSaves;
  }

  function getAutomaticSaveProficiencies(catalogs, character) {
    const auto = { ...getClassSaveProficiencies(catalogs, character?.class) };
    const play = isRecordObject(character?.play) ? character.play : {};
    const sourceOrder = getPreferredSourceOrder(character);
    const raceEntry = getEffectiveRaceEntry(catalogs, character, sourceOrder);
    const backgroundEntry = findCatalogEntryByNameWithSelectedSourcePreference(
      catalogs?.backgrounds,
      character?.background,
      character?.backgroundSource,
      sourceOrder
    );
    const { featEntries, optionalFeatureEntries } = getSelectedFeatAndOptionalFeatureEntries(catalogs, character, sourceOrder);
    const saveSources = [
      { entry: raceEntry, sourceKey: "race" },
      { entry: backgroundEntry, sourceKey: "background" },
      ...featEntries,
      ...optionalFeatureEntries,
    ];
    saveSources.forEach(({ entry, sourceKey }) => {
      collectSaveProficienciesFromEntity(entry, sourceKey, play).forEach((ability) => {
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
    getAutomaticFeatureModeBonuses,
  };
}

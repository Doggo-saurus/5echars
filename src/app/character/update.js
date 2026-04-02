export function createCharacterUpdater({
  toNumber,
  isRecordObject,
  normalizeSourceTag,
  saveAbilities,
  skills,
  skillProficiencyNone,
  skillProficiencyProficient,
  spellSlotLevels,
  getPreferredSourceOrder,
  findCatalogEntryByNameWithSelectedSourcePreference,
  getSubraceCatalogEntries,
  resolveImportedCharacterSelections,
  getAutomaticAbilityBonuses,
  getAutomaticSaveProficiencies,
  getAutomaticSkillProficiencyModes,
  mapSkillModesToProficiencyMap,
  hasStoredProficiencyState,
  deriveLegacyProficiencyOverrides,
  hasStoredSkillModeState,
  isSkillModeProficient,
  mergeSkillModesWithOverrides,
  mergeProficienciesWithOverrides,
  getCharacterSpellSlotDefaults,
  recomputeCharacterProgression,
  getAutoGrantedSpellData,
  getAutoClassListSpellNames,
  getAutoResourcesFromRules,
  getAutoResourcesFromClassTableEffects,
  syncAutoFeatureUses,
  getSelectedSubclassEntry,
  getClassCatalogEntry,
  store,
}) {
  function syncSpellSlotsWithDefaults(play, defaults, options = {}) {
    const preserveUserOverrides = options.preserveUserOverrides !== false;
    const nextSlots = { ...(play.spellSlots ?? {}) };
    const nextMaxOverrides = { ...(play.spellSlotMaxOverrides ?? {}) };
    const nextUserOverrides = { ...(play.spellSlotUserOverrides ?? {}) };
    const nextAutoDefaults = { ...(play.spellSlotAutoDefaults ?? {}) };

    spellSlotLevels.forEach((level) => {
      const key = String(level);
      const defaultMax = Math.max(0, toNumber(defaults?.[key], 0));
      const previousSlot = nextSlots[key] ?? { max: defaultMax, used: 0 };
      const legacyOverride = nextMaxOverrides[key];
      const hasExplicitOverride = Boolean(nextUserOverrides[key]) || (nextUserOverrides[key] == null && legacyOverride != null);
      const shouldUseOverride = preserveUserOverrides && hasExplicitOverride;
      const overrideMax = toNumber(legacyOverride, defaultMax);
      const nextMax = shouldUseOverride ? Math.max(0, overrideMax) : defaultMax;

      if (shouldUseOverride) {
        nextMaxOverrides[key] = nextMax;
        nextUserOverrides[key] = true;
      } else {
        delete nextMaxOverrides[key];
        delete nextUserOverrides[key];
      }

      nextAutoDefaults[key] = defaultMax;
      nextSlots[key] = {
        max: nextMax,
        used: Math.max(0, Math.min(nextMax, toNumber(previousSlot.used, 0))),
      };
    });

    play.spellSlots = nextSlots;
    play.spellSlotMaxOverrides = nextMaxOverrides;
    play.spellSlotUserOverrides = nextUserOverrides;
    play.spellSlotAutoDefaults = nextAutoDefaults;
  }

  function updateCharacterWithRequiredSettings(state, patch, options = {}) {
    let nextCharacter = { ...state.character, ...patch };
    const sourceOrder = getPreferredSourceOrder(nextCharacter);
    const resolvedRace = findCatalogEntryByNameWithSelectedSourcePreference(
      state.catalogs?.races,
      nextCharacter?.race,
      nextCharacter?.raceSource,
      sourceOrder
    );
    const subraceOptions = getSubraceCatalogEntries(state.catalogs, resolvedRace?.name, resolvedRace?.source, sourceOrder);
    const resolvedSubrace = findCatalogEntryByNameWithSelectedSourcePreference(
      subraceOptions,
      nextCharacter?.subrace,
      nextCharacter?.subraceSource,
      sourceOrder
    );
    const resolvedBackground = findCatalogEntryByNameWithSelectedSourcePreference(
      state.catalogs?.backgrounds,
      nextCharacter?.background,
      nextCharacter?.backgroundSource,
      sourceOrder
    );
    const resolvedClass = findCatalogEntryByNameWithSelectedSourcePreference(
      state.catalogs?.classes,
      nextCharacter?.class,
      nextCharacter?.classSource,
      sourceOrder
    );
    nextCharacter.raceSource = resolvedRace ? normalizeSourceTag(resolvedRace?.source) : "";
    nextCharacter.subrace = resolvedSubrace ? String(resolvedSubrace?.name ?? "").trim() : "";
    nextCharacter.subraceSource = resolvedSubrace ? normalizeSourceTag(resolvedSubrace?.source) : "";
    nextCharacter.backgroundSource = resolvedBackground ? normalizeSourceTag(resolvedBackground?.source) : "";
    nextCharacter.classSource = resolvedClass ? normalizeSourceTag(resolvedClass?.source) : "";
    nextCharacter = {
      ...nextCharacter,
      ...resolveImportedCharacterSelections(state.catalogs, nextCharacter),
    };
    const nextPlaySeed = isRecordObject(patch.play) ? patch.play : state.character.play;
    const nextPlay = structuredClone(nextPlaySeed ?? {});
    const autoAbilityBonuses = getAutomaticAbilityBonuses(state.catalogs, nextCharacter, nextPlay);
    const previousAutoBonuses = isRecordObject(state.character?.play?.autoAbilityBonuses) ? state.character.play.autoAbilityBonuses : {};
    const baseAbilities = saveAbilities.reduce((acc, ability) => {
      const explicitBase = nextCharacter?.abilityBase?.[ability];
      if (Number.isFinite(toNumber(explicitBase, NaN))) {
        acc[ability] = Math.max(1, Math.min(30, toNumber(explicitBase, 10)));
        return acc;
      }
      const currentFinal = toNumber(nextCharacter?.abilities?.[ability], 10);
      const previousAuto = toNumber(previousAutoBonuses?.[ability], 0);
      acc[ability] = Math.max(1, Math.min(30, currentFinal - previousAuto));
      return acc;
    }, {});
    const nextAbilities = saveAbilities.reduce((acc, ability) => {
      acc[ability] = Math.max(1, Math.min(30, toNumber(baseAbilities?.[ability], 10) + toNumber(autoAbilityBonuses?.[ability], 0)));
      return acc;
    }, {});

    const autoSaveProficiencies = getAutomaticSaveProficiencies(state.catalogs, nextCharacter);
    const autoSkillProficiencyModes = getAutomaticSkillProficiencyModes(state.catalogs, nextCharacter, nextPlay);
    const autoSkillProficiencies = mapSkillModesToProficiencyMap(autoSkillProficiencyModes, skills.map((skill) => skill.key));
    let saveOverrides = isRecordObject(nextPlay.saveProficiencyOverrides) ? { ...nextPlay.saveProficiencyOverrides } : {};
    let skillOverrides = isRecordObject(nextPlay.skillProficiencyOverrides) ? { ...nextPlay.skillProficiencyOverrides } : {};
    let skillModeOverrides = isRecordObject(nextPlay.skillProficiencyModeOverrides) ? { ...nextPlay.skillProficiencyModeOverrides } : {};
    const hasLegacySaveSnapshot = hasStoredProficiencyState(nextPlay.saveProficiencies, saveAbilities);
    const hasSavedAutoSaveState = hasStoredProficiencyState(nextPlay.autoSaveProficiencies, saveAbilities);
    if (!Object.keys(saveOverrides).length && hasLegacySaveSnapshot && !hasSavedAutoSaveState) {
      saveOverrides = deriveLegacyProficiencyOverrides(nextPlay.saveProficiencies, autoSaveProficiencies, saveAbilities);
    }
    const skillKeys = skills.map((skill) => skill.key);
    const hasLegacySkillSnapshot = hasStoredProficiencyState(nextPlay.skillProficiencies, skillKeys);
    const hasSavedAutoSkillState = hasStoredProficiencyState(nextPlay.autoSkillProficiencies, skillKeys);
    const hasSavedSkillModeOverrides = hasStoredSkillModeState(nextPlay.skillProficiencyModeOverrides, skillKeys);
    if (!hasSavedSkillModeOverrides && Object.keys(skillOverrides).length) {
      const migrated = {};
      Object.entries(skillOverrides).forEach(([key, value]) => {
        if (!skillKeys.includes(key) || typeof value !== "boolean") return;
        migrated[key] = value ? skillProficiencyProficient : skillProficiencyNone;
      });
      skillModeOverrides = migrated;
    }
    if (!Object.keys(skillModeOverrides).length && hasLegacySkillSnapshot && !hasSavedAutoSkillState) {
      const legacySkillOverrides = deriveLegacyProficiencyOverrides(nextPlay.skillProficiencies, autoSkillProficiencies, skillKeys);
      skillModeOverrides = Object.fromEntries(
        Object.entries(legacySkillOverrides).map(([key, value]) => [
          key,
          value ? skillProficiencyProficient : skillProficiencyNone,
        ])
      );
    }
    const nextSkillModes = mergeSkillModesWithOverrides(autoSkillProficiencyModes, skillModeOverrides, skillKeys);
    skillOverrides = Object.fromEntries(
      skillKeys
        .map((key) => {
          const currentIsProf = isSkillModeProficient(nextSkillModes[key]);
          const autoIsProf = isSkillModeProficient(autoSkillProficiencyModes[key]);
          if (currentIsProf === autoIsProf) return null;
          return [key, currentIsProf];
        })
        .filter(Boolean)
    );
    nextPlay.autoAbilityBonuses = autoAbilityBonuses;
    nextPlay.autoSaveProficiencies = autoSaveProficiencies;
    nextPlay.autoSkillProficiencyModes = autoSkillProficiencyModes;
    nextPlay.autoSkillProficiencies = autoSkillProficiencies;
    nextPlay.saveProficiencyOverrides = saveOverrides;
    nextPlay.skillProficiencyModeOverrides = skillModeOverrides;
    nextPlay.skillProficiencyOverrides = skillOverrides;
    nextPlay.saveProficiencies = mergeProficienciesWithOverrides(autoSaveProficiencies, saveOverrides, saveAbilities);
    nextPlay.skillProficiencyModes = nextSkillModes;
    nextPlay.skillProficiencies = mapSkillModesToProficiencyMap(nextSkillModes, skillKeys);
    const defaultSpellSlots = getCharacterSpellSlotDefaults(state.catalogs, nextCharacter);
    syncSpellSlotsWithDefaults(nextPlay, defaultSpellSlots, { preserveUserOverrides: options.preserveUserOverrides !== false });
    const nextProgression = recomputeCharacterProgression(state.catalogs, nextCharacter);
    const autoGrantedSpellData = getAutoGrantedSpellData(state.catalogs, nextCharacter);
    const autoGrantedSpells = autoGrantedSpellData.names;
    const autoClassListSpells = getAutoClassListSpellNames(state.catalogs, nextCharacter);
    const previousAutoSpells = Array.isArray(nextPlay.autoGrantedSpells) ? nextPlay.autoGrantedSpells : [];
    const previousClassListSpells = Array.isArray(nextPlay.autoClassListSpells) ? nextPlay.autoClassListSpells : [];
    const previousAutoSet = new Set(previousAutoSpells.map((name) => String(name ?? "").trim().toLowerCase()).filter(Boolean));
    const previousClassListSet = new Set(previousClassListSpells.map((name) => String(name ?? "").trim().toLowerCase()).filter(Boolean));
    const manualSpells = (Array.isArray(nextCharacter.spells) ? nextCharacter.spells : []).filter(
      (name) =>
        !previousAutoSet.has(String(name ?? "").trim().toLowerCase())
        && !previousClassListSet.has(String(name ?? "").trim().toLowerCase())
    );
    const mergedSpellMap = new Map();
    [...manualSpells, ...autoGrantedSpells, ...autoClassListSpells].forEach((name) => {
      const normalized = String(name ?? "").trim();
      if (!normalized) return;
      const key = normalized.toLowerCase();
      if (!mergedSpellMap.has(key)) mergedSpellMap.set(key, normalized);
    });
    const nextSpells = [...mergedSpellMap.values()];
    nextPlay.autoGrantedSpells = autoGrantedSpells;
    nextPlay.autoClassListSpells = autoClassListSpells;
    nextPlay.autoPreparedSpells = autoGrantedSpellData.autoPreparedSpells;
    nextPlay.autoSpellGrantTypes = autoGrantedSpellData.autoSpellGrantTypes;
    nextPlay.preparedSpells = Object.fromEntries(
      Object.entries(nextPlay.preparedSpells ?? {}).filter(([name]) =>
        mergedSpellMap.has(String(name ?? "").trim().toLowerCase())
      )
    );
    const autoTrackers = [
      ...getAutoResourcesFromRules(
        state.catalogs,
        nextCharacter,
        nextProgression.unlockedFeatures,
        nextCharacter.feats,
        nextCharacter.optionalFeatures
      ),
      ...getAutoResourcesFromClassTableEffects(
        state.catalogs,
        nextCharacter,
        nextProgression.unlockedFeatures,
        nextProgression.classTableEffects
      ),
    ];
    nextPlay.featureUses = syncAutoFeatureUses(nextPlay, autoTrackers);
    const allowedFeatureModeIds = new Set((nextProgression.featureModes ?? []).map((mode) => mode.id));
    const nextFeatureModes = isRecordObject(nextPlay.featureModes) ? { ...nextPlay.featureModes } : {};
    Object.keys(nextFeatureModes).forEach((modeId) => {
      if (!allowedFeatureModeIds.has(modeId)) delete nextFeatureModes[modeId];
    });
    (nextProgression.featureModes ?? []).forEach((mode) => {
      const optionsList = Array.isArray(mode?.optionValues) ? mode.optionValues : [];
      if (!optionsList.length) return;
      const maxCount = Math.max(1, Math.min(optionsList.length, Math.floor(toNumber(mode?.count, 1))));
      const raw = nextFeatureModes[mode.id];
      const currentValues = Array.isArray(raw)
        ? raw.map((entry) => String(entry ?? "").trim())
        : [String(raw ?? "").trim()];
      const selected = [...new Set(currentValues.filter((value) => value && optionsList.includes(value)))];
      if (!selected.length) selected.push(optionsList[0]);
      nextFeatureModes[mode.id] = maxCount <= 1 ? selected[0] : selected.slice(0, maxCount);
    });
    nextPlay.featureModes = nextFeatureModes;
    const selectedSubclass = getSelectedSubclassEntry(state.catalogs, nextCharacter);
    const classEntry = getClassCatalogEntry(state.catalogs, nextCharacter.class, nextCharacter?.classSource, sourceOrder);
    const classSource = normalizeSourceTag(classEntry?.source);
    const classSelection = {
      subclass: {
        name: selectedSubclass?.name ?? "",
        source: selectedSubclass?.source ?? "",
        className: selectedSubclass?.className ?? String(nextCharacter.class ?? "").trim(),
        classSource: selectedSubclass?.classSource ?? classSource,
      },
    };
    const subclassName = classSelection.subclass.name || "";
    store.updateCharacter({
      ...patch,
      raceSource: nextCharacter.raceSource,
      backgroundSource: nextCharacter.backgroundSource,
      classSource: nextCharacter.classSource,
      abilities: nextAbilities,
      abilityBase: baseAbilities,
      subclass: subclassName,
      classSelection,
      progression: nextProgression,
      feats: nextCharacter.feats,
      optionalFeatures: nextCharacter.optionalFeatures,
      spells: nextSpells,
      play: nextPlay,
    });
  }

  return {
    syncSpellSlotsWithDefaults,
    updateCharacterWithRequiredSettings,
  };
}

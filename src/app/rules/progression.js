export function createProgressionRules({
  toNumber,
  spellSlotLevels,
  getCharacterClassLevels,
  getCharacterSpellSlotDefaults,
  getAutomaticSaveProficiencies,
  recomputeCharacterProgression,
  getAutoGrantedSpellData,
  buildLevelUpHitPointPlan,
}) {
  function createLevelUpDraft(character) {
    const { totalLevel, multiclass } = getCharacterClassLevels(character);
    return {
      totalLevel,
      primaryClass: String(character?.class ?? "").trim(),
      multiclass: multiclass.map((entry) => ({ ...entry })),
      hitPointChoices: {},
    };
  }

  function sanitizeLevelUpDraft(draft) {
    const totalLevel = Math.max(1, Math.min(20, toNumber(draft?.totalLevel, 1)));
    const primaryClass = String(draft?.primaryClass ?? "").trim();
    const multiclass = (Array.isArray(draft?.multiclass) ? draft.multiclass : [])
      .map((entry) => ({
        class: String(entry?.class ?? "").trim(),
        level: Math.max(1, Math.min(20, toNumber(entry?.level, 1))),
      }))
      .filter((entry) => entry.class);
    const hitPointChoicesRaw = draft?.hitPointChoices;
    const hitPointChoices =
      hitPointChoicesRaw && typeof hitPointChoicesRaw === "object" && !Array.isArray(hitPointChoicesRaw)
        ? Object.fromEntries(
            Object.entries(hitPointChoicesRaw).map(([key, choice]) => {
              const normalizedKey = String(key ?? "").trim();
              const method = choice?.method === "roll" ? "roll" : "fixed";
              const rollValue = Math.floor(toNumber(choice?.rollValue, NaN));
              return [
                normalizedKey,
                {
                  method,
                  rollValue: Number.isFinite(rollValue) && rollValue > 0 ? rollValue : null,
                },
              ];
            })
          )
        : {};
    return { totalLevel, primaryClass, multiclass, hitPointChoices };
  }

  function getLevelUpPreview(state, draft) {
    const currentCharacter = state.character;
    const nextCharacter = {
      ...currentCharacter,
      class: draft.primaryClass,
      level: draft.totalLevel,
      multiclass: draft.multiclass,
    };
    const currentSlots = getCharacterSpellSlotDefaults(state.catalogs, currentCharacter);
    const nextSlots = getCharacterSpellSlotDefaults(state.catalogs, nextCharacter);
    const changedSlotLevels = spellSlotLevels.filter((level) => toNumber(currentSlots[String(level)], 0) !== toNumber(nextSlots[String(level)], 0));
    const currentSaves = getAutomaticSaveProficiencies(state.catalogs, currentCharacter);
    const nextSaves = getAutomaticSaveProficiencies(state.catalogs, nextCharacter);
    const currentProgression = recomputeCharacterProgression(state.catalogs, currentCharacter);
    const nextProgression = recomputeCharacterProgression(state.catalogs, nextCharacter);
    const currentAutoSpells = getAutoGrantedSpellData(state.catalogs, currentCharacter).names;
    const nextAutoSpells = getAutoGrantedSpellData(state.catalogs, nextCharacter).names;
    const currentSpellSet = new Set(currentAutoSpells.map((name) => name.toLowerCase()));
    const nextSpellSet = new Set(nextAutoSpells.map((name) => name.toLowerCase()));
    const addedAutoSpells = nextAutoSpells.filter((name) => !currentSpellSet.has(name.toLowerCase()));
    const removedAutoSpells = currentAutoSpells.filter((name) => !nextSpellSet.has(name.toLowerCase()));
    const currentFeatureIds = new Set((currentProgression.unlockedFeatures ?? []).map((feature) => feature.id));
    const nextFeatureIds = new Set((nextProgression.unlockedFeatures ?? []).map((feature) => feature.id));
    const addedFeatures = (nextProgression.unlockedFeatures ?? []).filter((feature) => !currentFeatureIds.has(feature.id));
    const removedFeatures = (currentProgression.unlockedFeatures ?? []).filter((feature) => !nextFeatureIds.has(feature.id));
    const currentEffects = new Map((currentProgression.classTableEffects ?? []).map((effect) => [effect.id, effect]));
    const nextEffects = new Map((nextProgression.classTableEffects ?? []).map((effect) => [effect.id, effect]));
    const changedClassTableEffects = [...nextEffects.values()].filter((effect) => {
      const previous = currentEffects.get(effect.id);
      if (!previous) return true;
      return String(previous.value) !== String(effect.value);
    });
    const hitPointPlan = buildLevelUpHitPointPlan(state.catalogs, currentCharacter, draft);
    return {
      currentSlots,
      nextSlots,
      changedSlotLevels,
      currentSaves,
      nextSaves,
      currentProgression,
      nextProgression,
      addedFeatures,
      removedFeatures,
      addedAutoSpells,
      removedAutoSpells,
      changedClassTableEffects,
      classLevels: getCharacterClassLevels(nextCharacter),
      hitPointPlan,
    };
  }

  return {
    createLevelUpDraft,
    sanitizeLevelUpDraft,
    getLevelUpPreview,
  };
}

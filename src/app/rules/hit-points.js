export function createHitPointRules({
  toNumber,
  getHitPointBreakdown,
  getCharacterClassLevels,
  getClassHitDieFaces,
  getClassKey,
  rollDie,
}) {
  function getFixedHitPointGain(faces) {
    return Math.max(1, Math.floor(Math.max(1, faces) / 2) + 1);
  }

  function sanitizeHitPointRollOverrides(rawOverrides) {
    if (!rawOverrides || typeof rawOverrides !== "object" || Array.isArray(rawOverrides)) return {};
    return Object.fromEntries(
      Object.entries(rawOverrides)
        .map(([key, value]) => [String(key ?? "").trim(), Math.floor(toNumber(value, Number.NaN))])
        .filter(([key, value]) => key && Number.isFinite(value) && value > 0)
    );
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
        className: primaryClassName || "Primary class",
        classLevel: level,
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
          className,
          classLevel: level,
          faces,
        });
      }
    });
    return entries;
  }

  function getCharacterMaxHp(catalogs, character, options = {}) {
    return getHitPointBreakdown(catalogs, character, options).total;
  }

  function buildLevelUpHitPointPlan(catalogs, currentCharacter, draft) {
    const currentCharacterDraft = {
      ...currentCharacter,
      class: draft.primaryClass,
      level: draft.totalLevel,
      multiclass: draft.multiclass,
    };
    const currentOverrides = sanitizeHitPointRollOverrides(currentCharacter?.hitPointRollOverrides);
    const currentEntries = getAdditionalHitPointEntries(catalogs, currentCharacter);
    const nextEntries = getAdditionalHitPointEntries(catalogs, currentCharacterDraft);
    const currentEntryKeys = new Set(currentEntries.map((entry) => entry.key));
    const nextEntryKeys = new Set(nextEntries.map((entry) => entry.key));
    const gainedEntries = nextEntries.filter((entry) => !currentEntryKeys.has(entry.key));
    const lostEntries = currentEntries.filter((entry) => !nextEntryKeys.has(entry.key));
    const choicesRaw = draft?.hitPointChoices;
    const draftChoices = choicesRaw && typeof choicesRaw === "object" && !Array.isArray(choicesRaw) ? choicesRaw : {};
    const nextRollOverrides = Object.fromEntries(Object.entries(currentOverrides).filter(([key]) => nextEntryKeys.has(key)));
    const resolvedGainedEntries = gainedEntries.map((entry) => {
      const draftChoice = draftChoices?.[entry.key];
      const method = draftChoice?.method === "roll" ? "roll" : "fixed";
      let rollValue = Math.floor(toNumber(draftChoice?.rollValue, Number.NaN));
      if (!(Number.isFinite(rollValue) && rollValue >= 1 && rollValue <= entry.faces)) {
        rollValue = method === "roll" ? rollDie(entry.faces) : null;
      }
      const fixedValue = getFixedHitPointGain(entry.faces);
      const baseGain = method === "roll" ? rollValue : fixedValue;
      if (method === "roll" && Number.isFinite(rollValue)) nextRollOverrides[entry.key] = rollValue;
      else delete nextRollOverrides[entry.key];
      return {
        ...entry,
        method,
        rollValue,
        fixedValue,
        baseGain,
      };
    });
    const { totalLevel: currentTotalLevel } = getCharacterClassLevels(currentCharacter);
    const { totalLevel: nextTotalLevel } = getCharacterClassLevels(currentCharacterDraft);
    const levelDelta = nextTotalLevel - currentTotalLevel;
    const conMod = Math.floor((toNumber(currentCharacter?.abilities?.con, 10) - 10) / 2);
    const baseDelta = resolvedGainedEntries.reduce((sum, entry) => sum + Math.max(1, toNumber(entry.baseGain, 0)), 0)
      - lostEntries.reduce((sum, entry) => {
        const rolled = Math.floor(toNumber(currentOverrides[entry.key], Number.NaN));
        if (Number.isFinite(rolled) && rolled >= 1 && rolled <= entry.faces) return sum + rolled;
        return sum + getFixedHitPointGain(entry.faces);
      }, 0);
    const conDelta = conMod * levelDelta;
    const currentHpBreakdown = getHitPointBreakdown(catalogs, currentCharacter, { rollOverrides: currentOverrides });
    const nextHpBreakdown = getHitPointBreakdown(catalogs, currentCharacterDraft, { rollOverrides: nextRollOverrides });
    const currentMaxHp = currentHpBreakdown.total;
    const nextMaxHp = nextHpBreakdown.total;
    const featDelta = nextHpBreakdown.featBonusHp - currentHpBreakdown.featBonusHp;
    return {
      levelDelta,
      conMod,
      currentMaxHp,
      nextMaxHp,
      totalDelta: nextMaxHp - currentMaxHp,
      baseDelta,
      conDelta,
      featDelta,
      gainedEntries: resolvedGainedEntries,
      nextRollOverrides,
    };
  }

  return {
    getFixedHitPointGain,
    sanitizeHitPointRollOverrides,
    getAdditionalHitPointEntries,
    getCharacterMaxHp,
    buildLevelUpHitPointPlan,
  };
}

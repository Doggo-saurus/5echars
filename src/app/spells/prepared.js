export function createPreparedSpellRules({
  toNumber,
  catalogLookupDomain,
  spellcastingRules,
  normalizeAbilityKey,
  getSpellByName,
}) {
  function getClassEntry(catalogs, character) {
    const preferredSources =
      typeof catalogLookupDomain.getPreferredSourceOrder === "function"
        ? catalogLookupDomain.getPreferredSourceOrder(character)
        : [];
    return catalogLookupDomain.getClassCatalogEntry(
      catalogs,
      character?.class,
      character?.classSource,
      preferredSources
    );
  }

  function classHasPreparedSpellRules(classEntry) {
    return Boolean(classEntry?.preparedSpells)
      || (Array.isArray(classEntry?.preparedSpellsProgression) && classEntry.preparedSpellsProgression.length > 0);
  }

  function getPreparedSpellLimitFromProgression(classEntry, classLevel) {
    if (!Array.isArray(classEntry?.preparedSpellsProgression) || !classEntry.preparedSpellsProgression.length) return Number.NaN;
    const index = Math.max(0, Math.min(classEntry.preparedSpellsProgression.length - 1, Math.floor(toNumber(classLevel, 1)) - 1));
    return toNumber(classEntry.preparedSpellsProgression[index], Number.NaN);
  }

  function getPreparedSpellLimitFromFormula(preparedSpellsFormula, classLevel, abilityMod) {
    if (typeof preparedSpellsFormula !== "string") return Number.NaN;
    const expression = preparedSpellsFormula
      .replace(/<\$level\$>/gi, String(classLevel))
      .replace(/<\$[a-z]{3}_mod\$>/gi, String(abilityMod))
      .replace(/\s+/g, " ")
      .trim();
    if (!expression || !/^[0-9+\-*/().\s]+$/.test(expression)) return Number.NaN;
    try {
      const raw = Function(`"use strict"; return (${expression});`)();
      if (!Number.isFinite(raw)) return Number.NaN;
      return Math.floor(toNumber(raw, Number.NaN));
    } catch {
      return Number.NaN;
    }
  }

  function getClassSpellcastingAbility(catalogs, character) {
    const classEntry = getClassEntry(catalogs, character);
    if (!classEntry) return null;
    const raw = classEntry.spellcastingAbility;
    if (typeof raw === "string") return normalizeAbilityKey(raw);
    if (Array.isArray(raw)) {
      for (const value of raw) {
        const ability = normalizeAbilityKey(value);
        if (ability) return ability;
      }
      return null;
    }
    return null;
  }

  function doesClassUsePreparedSpells(catalogs, character) {
    return classHasPreparedSpellRules(getClassEntry(catalogs, character));
  }

  function getPreparedSpellcastingAbility(catalogs, character) {
    if (!doesClassUsePreparedSpells(catalogs, character)) return null;
    return getClassSpellcastingAbility(catalogs, character);
  }

  function getPreparedSpellLimit(state) {
    const classEntry = getClassEntry(state?.catalogs, state?.character);
    if (!classHasPreparedSpellRules(classEntry)) return Number.POSITIVE_INFINITY;
    const ability = getPreparedSpellcastingAbility(state?.catalogs, state?.character);
    const { primaryLevel } = spellcastingRules.getCharacterClassLevels(state?.character);
    const classLevel = Math.max(1, toNumber(primaryLevel, 1));
    const abilityMod = ability ? toNumber(state?.derived?.mods?.[ability], 0) : 0;
    const progressionLimit = getPreparedSpellLimitFromProgression(classEntry, classLevel);
    if (Number.isFinite(progressionLimit)) return Math.max(1, progressionLimit);
    const formulaLimit = getPreparedSpellLimitFromFormula(classEntry?.preparedSpells, classLevel, abilityMod);
    if (Number.isFinite(formulaLimit)) return Math.max(1, formulaLimit);
    return Math.max(1, classLevel + abilityMod);
  }

  function isSpellAlwaysPrepared(state, spellName, playOverride = null) {
    const play = playOverride ?? state?.character?.play ?? {};
    const key = String(spellName ?? "").trim().toLowerCase();
    if (!key || !catalogLookupDomain.isRecordObject(play?.autoPreparedSpells)) return false;
    return Boolean(play.autoPreparedSpells[key]);
  }

  function countPreparedSpells(state, playOverride = null) {
    const play = playOverride ?? state?.character?.play ?? {};
    const selectedSpells = Array.isArray(state?.character?.spells) ? state.character.spells : [];
    return selectedSpells.reduce((count, spellName) => {
      const spell = getSpellByName(state, spellName);
      const isCantrip = toNumber(spell?.level, 0) === 0;
      if (!isCantrip && !isSpellAlwaysPrepared(state, spellName, play) && Boolean(play.preparedSpells?.[spellName])) {
        return count + 1;
      }
      return count;
    }, 0);
  }

  return {
    getClassSpellcastingAbility,
    doesClassUsePreparedSpells,
    getPreparedSpellcastingAbility,
    getPreparedSpellLimit,
    countPreparedSpells,
    isSpellAlwaysPrepared,
  };
}

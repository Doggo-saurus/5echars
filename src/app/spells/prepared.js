export function createPreparedSpellRules({
  toNumber,
  catalogLookupDomain,
  spellcastingRules,
  normalizeAbilityKey,
  getSpellByName,
}) {
  function getClassSpellcastingAbility(catalogs, character) {
    const classEntry = catalogLookupDomain.getClassCatalogEntry(catalogs, character?.class);
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
    const classEntry = catalogLookupDomain.getClassCatalogEntry(catalogs, character?.class);
    return Boolean(classEntry?.preparedSpells);
  }

  function getPreparedSpellcastingAbility(catalogs, character) {
    if (!doesClassUsePreparedSpells(catalogs, character)) return null;
    return getClassSpellcastingAbility(catalogs, character);
  }

  function getPreparedSpellLimit(state) {
    if (!doesClassUsePreparedSpells(state?.catalogs, state?.character)) return Number.POSITIVE_INFINITY;
    const ability = getPreparedSpellcastingAbility(state?.catalogs, state?.character);
    const { primaryLevel } = spellcastingRules.getCharacterClassLevels(state?.character);
    const abilityMod = ability ? toNumber(state?.derived?.mods?.[ability], 0) : 0;
    return Math.max(1, primaryLevel + abilityMod);
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

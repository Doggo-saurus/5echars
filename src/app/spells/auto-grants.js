import { getActiveInventoryCatalogItems } from "../catalog/inventory-item-rules.js";

const AUTO_SPELL_GRANT_PRIORITY = {
  expanded: 1,
  innate: 2,
  known: 3,
  prepared: 4,
};

const FULL_LIST_PREPARED_CASTER_KEYS = new Set(["cleric", "druid", "paladin", "artificer"]);

export function getClassKey(className) {
  return String(className ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function createAutoGrantedSpellRules({
  toNumber,
  cleanSpellInlineTags,
  catalogLookupDomain,
  progressionCore,
  characterProgressionDomain,
  spellcastingRules,
  spellSlotLevels,
}) {
  function extractSpellNameFromGrant(value) {
    if (typeof value === "string") return cleanSpellInlineTags(value.split("|")[0].replace(/#c$/i, "").trim());
    if (catalogLookupDomain.isRecordObject(value) && typeof value.spell === "string") {
      return cleanSpellInlineTags(value.spell.split("|")[0].replace(/#c$/i, "").trim());
    }
    return "";
  }

  function collectAdditionalSpellGrantsFromEntries(entries, classLevel) {
    const grants = new Map();
    const addFromSpellList = (list, grantType) => {
      (Array.isArray(list) ? list : []).forEach((entry) => {
        const name = extractSpellNameFromGrant(entry);
        if (!name) return;
        const key = name.toLowerCase();
        const current = grants.get(key);
        const currentPriority = AUTO_SPELL_GRANT_PRIORITY[current?.grantType] ?? 0;
        const nextPriority = AUTO_SPELL_GRANT_PRIORITY[grantType] ?? 0;
        if (!current || nextPriority >= currentPriority) grants.set(key, { name, grantType });
      });
    };
    (Array.isArray(entries) ? entries : []).forEach((block) => {
      if (!catalogLookupDomain.isRecordObject(block)) return;
      ["prepared", "known", "innate", "expanded"].forEach((key) => {
        const bucket = block[key];
        if (!catalogLookupDomain.isRecordObject(bucket)) return;
        Object.entries(bucket).forEach(([levelRaw, list]) => {
          const unlockLevel = toNumber(levelRaw, Number.NaN);
          if (!Number.isFinite(unlockLevel) || unlockLevel > classLevel) return;
          addFromSpellList(list, key);
        });
      });
    });
    return [...grants.values()];
  }

  function getAutoGrantedSpellData(catalogs, character) {
    const catalogNameByLower = new Map(
      (Array.isArray(catalogs?.spells) ? catalogs.spells : [])
        .map((spell) => String(spell?.name ?? "").trim())
        .filter(Boolean)
        .map((name) => [name.toLowerCase(), name])
    );
    const grants = new Map();
    const addGrant = (rawName, grantType) => {
      const cleaned = cleanSpellInlineTags(rawName);
      if (!cleaned) return;
      const key = cleaned.toLowerCase();
      const canonical = catalogNameByLower.get(key) ?? cleaned;
      const current = grants.get(key);
      const currentPriority = AUTO_SPELL_GRANT_PRIORITY[current?.grantType] ?? 0;
      const nextPriority = AUTO_SPELL_GRANT_PRIORITY[grantType] ?? 0;
      if (!current || nextPriority >= currentPriority) grants.set(key, { name: canonical, grantType });
    };
    const tracks = progressionCore.getClassLevelTracks(character);
    const raceEntry = catalogLookupDomain.getEffectiveRaceEntry(catalogs, character, catalogLookupDomain.getPreferredSourceOrder(character));
    collectAdditionalSpellGrantsFromEntries(raceEntry?.additionalSpells, Math.max(1, toNumber(character?.level, 1))).forEach((grant) =>
      addGrant(grant.name, grant.grantType)
    );
    tracks.forEach((track) => {
      const classEntry = catalogLookupDomain.getClassCatalogEntry(catalogs, track.className);
      if (!classEntry) return;
      collectAdditionalSpellGrantsFromEntries(classEntry.additionalSpells, track.level).forEach((grant) => addGrant(grant.name, grant.grantType));
      if (!track.isPrimary) return;
      const subclassEntry = catalogLookupDomain.getSelectedSubclassEntry(catalogs, character);
      if (!subclassEntry) return;
      collectAdditionalSpellGrantsFromEntries(subclassEntry.additionalSpells, track.level).forEach((grant) =>
        addGrant(grant.name, grant.grantType)
      );
    });
    const classLevelMap = getClassLevelMap(character);
    characterProgressionDomain.getUnlockedFeatures(catalogs, character).forEach((feature) => {
      const detail = characterProgressionDomain.resolveFeatureEntryFromCatalogs(catalogs, feature);
      if (!detail) return;
      const classLevel = toNumber(
        classLevelMap.get(String(feature?.className ?? "").trim().toLowerCase()),
        toNumber(character?.level, 1)
      );
      collectAdditionalSpellGrantsFromEntries(detail?.additionalSpells, Math.max(1, classLevel)).forEach((grant) =>
        addGrant(grant.name, grant.grantType)
      );
    });
    const sourceOrder = catalogLookupDomain.getPreferredSourceOrder(character);
    const selectedFeats = Array.isArray(character?.feats) ? character.feats : [];
    selectedFeats.forEach((feat) => {
      const entry = catalogLookupDomain.findCatalogEntryByNameWithSelectedSourcePreference(
        catalogs?.feats,
        feat?.name,
        feat?.source,
        sourceOrder
      );
      if (!entry) return;
      collectAdditionalSpellGrantsFromEntries(entry?.additionalSpells, Math.max(1, toNumber(character?.level, 1))).forEach((grant) =>
        addGrant(grant.name, grant.grantType)
      );
    });
    const selectedOptionalFeatures = Array.isArray(character?.optionalFeatures) ? character.optionalFeatures : [];
    selectedOptionalFeatures.forEach((feature) => {
      const entry = catalogLookupDomain.findCatalogEntryByNameWithSelectedSourcePreference(
        catalogs?.optionalFeatures,
        feature?.name,
        feature?.source,
        sourceOrder
      );
      if (!entry) return;
      collectAdditionalSpellGrantsFromEntries(entry?.additionalSpells, Math.max(1, toNumber(character?.level, 1))).forEach((grant) =>
        addGrant(grant.name, grant.grantType)
      );
    });
    getActiveInventoryCatalogItems(catalogs, character).forEach(({ catalogItem }) => {
      collectAdditionalSpellGrantsFromEntries(catalogItem?.additionalSpells, Math.max(1, toNumber(character?.level, 1))).forEach((grant) =>
        addGrant(grant.name, grant.grantType)
      );
    });
    const autoPreparedSpells = {};
    const autoSpellGrantTypes = {};
    [...grants.entries()].forEach(([key, grant]) => {
      autoPreparedSpells[key] = true;
      autoSpellGrantTypes[key] = grant.grantType;
    });
    return {
      names: [...grants.values()].map((grant) => grant.name),
      autoPreparedSpells,
      autoSpellGrantTypes,
    };
  }

  function getClassLevelMap(character) {
    const map = new Map();
    progressionCore.getClassLevelTracks(character).forEach((track) => {
      const key = String(track.className ?? "").trim().toLowerCase();
      if (!key) return;
      map.set(key, Math.max(toNumber(map.get(key), 0), toNumber(track.level, 0)));
    });
    return map;
  }

  function classUsesFullPreparedSpellList(classEntry) {
    const hasPreparedRules = Boolean(classEntry?.preparedSpells)
      || (Array.isArray(classEntry?.preparedSpellsProgression) && classEntry.preparedSpellsProgression.length > 0);
    if (!catalogLookupDomain.isRecordObject(classEntry) || !hasPreparedRules) return false;
    const classKey = getClassKey(classEntry.name);
    if (!FULL_LIST_PREPARED_CASTER_KEYS.has(classKey)) return false;
    if (Array.isArray(classEntry.spellsKnownProgression) && classEntry.spellsKnownProgression.length) return false;
    if (Array.isArray(classEntry.spellsKnownProgressionFixed) && classEntry.spellsKnownProgressionFixed.length) return false;
    if (
      catalogLookupDomain.isRecordObject(classEntry.spellsKnownProgressionFixedByLevel)
      && Object.keys(classEntry.spellsKnownProgressionFixedByLevel).length
    ) {
      return false;
    }
    return true;
  }

  function getClassMaxPreparedSpellLevel(catalogs, className, classLevel) {
    const defaults = spellcastingRules.getClassSpellSlotDefaults(catalogs, className, classLevel);
    return spellSlotLevels.reduce((highest, slotLevel) => {
      if (toNumber(defaults?.[String(slotLevel)], 0) > 0) return slotLevel;
      return highest;
    }, 0);
  }

  function doesSpellListClass(spell, classKey) {
    if (!spell || !classKey) return false;
    const classLookup = spell?.spellSourceEntry?.class;
    if (!catalogLookupDomain.isRecordObject(classLookup)) return false;
    return Object.values(classLookup).some((sourceMap) =>
      Object.keys(sourceMap ?? {}).some((className) => getClassKey(className) === classKey)
    );
  }

  function getAutoClassListSpellNames(catalogs, character) {
    const classAutoSpellRulesByKey = new Map();
    progressionCore.getClassLevelTracks(character).forEach((track) => {
      const classEntry = catalogLookupDomain.getClassCatalogEntry(catalogs, track.className);
      if (!classUsesFullPreparedSpellList(classEntry)) return;
      const classKey = getClassKey(classEntry.name);
      if (!classKey) return;
      const maxSpellLevel = getClassMaxPreparedSpellLevel(catalogs, classEntry.name, track.level);
      const hasCantripProgression = Array.isArray(classEntry?.cantripProgression) && classEntry.cantripProgression.length > 0;
      const previousRule = classAutoSpellRulesByKey.get(classKey) ?? { maxSpellLevel: 0, autoIncludeCantrips: !hasCantripProgression };
      classAutoSpellRulesByKey.set(classKey, {
        maxSpellLevel: Math.max(previousRule.maxSpellLevel, maxSpellLevel),
        autoIncludeCantrips: previousRule.autoIncludeCantrips || !hasCantripProgression,
      });
    });
    if (!classAutoSpellRulesByKey.size) return [];

    const spells = Array.isArray(catalogs?.spells) ? catalogs.spells : [];
    const names = new Map();
    spells.forEach((spell) => {
      const spellLevel = Math.max(0, toNumber(spell?.level, 0));
      const isAvailable = [...classAutoSpellRulesByKey.entries()].some(([classKey, rule]) => {
        if (!doesSpellListClass(spell, classKey)) return false;
        if (spellLevel === 0) return Boolean(rule?.autoIncludeCantrips);
        return spellLevel <= toNumber(rule?.maxSpellLevel, 0);
      });
      if (!isAvailable) return;
      const name = String(spell?.name ?? "").trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (!names.has(key)) names.set(key, name);
    });
    return [...names.values()];
  }

  return {
    getAutoGrantedSpellData,
    getAutoClassListSpellNames,
    getClassKey,
  };
}

import {
  getActiveInventoryCatalogItems,
  isInventoryItemActiveForBonuses,
  itemRequiresAttunement,
  mergeCatalogItemWithInherits,
  resolveInventoryCatalogItem,
} from "./inventory-item-rules.js";

export function createCatalogLookupDomain({
  toNumber,
  normalizeSourceTag,
  sourceLabels,
  saveAbilities,
  getCharacterAllowedSources,
  buildEntityId,
}) {
  function isRecordObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function findCatalogEntriesByName(entries, selectedName) {
    if (!Array.isArray(entries)) return [];
    const normalized = String(selectedName ?? "").trim().toLowerCase();
    if (!normalized) return [];
    return entries.filter((entry) => String(entry?.name ?? "").trim().toLowerCase() === normalized);
  }

  function findCatalogEntryByName(entries, selectedName) {
    return findCatalogEntriesByName(entries, selectedName)[0] ?? null;
  }

  function findCatalogEntryByNameWithSourcePreference(entries, selectedName, preferredSources = []) {
    const matches = findCatalogEntriesByName(entries, selectedName);
    if (!matches.length) return null;
    if (matches.length === 1) return matches[0];
    const sourceOrder = (Array.isArray(preferredSources) ? preferredSources : [])
      .map((entry) => normalizeSourceTag(entry))
      .filter(Boolean);
    for (const source of sourceOrder) {
      const match = matches.find((entry) => normalizeSourceTag(entry?.source) === source);
      if (match) return match;
    }
    return matches[0];
  }

  function findCatalogEntryByNameWithSelectedSourcePreference(entries, selectedName, selectedSource = "", preferredSources = []) {
    const matches = findCatalogEntriesByName(entries, selectedName);
    if (!matches.length) return null;
    if (matches.length === 1) return matches[0];
    const normalizedSource = normalizeSourceTag(selectedSource);
    if (normalizedSource) {
      const selectedMatch = matches.find((entry) => normalizeSourceTag(entry?.source) === normalizedSource);
      if (selectedMatch) return selectedMatch;
    }
    return findCatalogEntryByNameWithSourcePreference(matches, selectedName, preferredSources);
  }

  function findCatalogEntryByNameAndSource(entries, selectedName, selectedSource = "") {
    const byName = findCatalogEntriesByName(entries, selectedName);
    if (!byName.length) return null;
    const source = normalizeSourceTag(selectedSource);
    if (!source) return byName.length === 1 ? byName[0] : null;
    return byName.find((entry) => normalizeSourceTag(entry?.source) === source) ?? null;
  }

  function getPreferredSourceOrder(character) {
    const allowedSources = getCharacterAllowedSources(character).map((source) => normalizeSourceTag(source)).filter(Boolean);
    const sourcePreset = String(character?.sourcePreset ?? "").trim();
    const preferred = [...allowedSources];
    const hasPhb = preferred.includes("PHB");
    const hasXphb = preferred.includes("XPHB");
    if (!hasPhb || !hasXphb) return preferred;
    const xphbFirst = sourcePreset === "set2024";
    const ordered = preferred.filter((source) => source !== "PHB" && source !== "XPHB");
    if (xphbFirst) return ["XPHB", "PHB", ...ordered];
    return ["PHB", "XPHB", ...ordered];
  }

  function getClassCatalogEntry(catalogs, className, classSource = "", preferredSources = []) {
    return findCatalogEntryByNameWithSelectedSourcePreference(catalogs?.classes, className, classSource, preferredSources);
  }

  function getClassHitDieFaces(catalogs, className) {
    const classEntry = getClassCatalogEntry(catalogs, className);
    const faces = Math.max(0, toNumber(classEntry?.hd?.faces, 0));
    return faces > 0 ? faces : 8;
  }

  function getPrimarySubclassSelection(character) {
    const subclass = character?.classSelection?.subclass;
    if (subclass && typeof subclass === "object" && String(subclass.name ?? "").trim()) {
      return {
        name: String(subclass.name ?? "").trim(),
        source: normalizeSourceTag(subclass.source),
        className: String(subclass.className ?? "").trim(),
        classSource: normalizeSourceTag(subclass.classSource),
      };
    }
    const legacyName = String(character?.subclass ?? "").trim();
    if (!legacyName) return null;
    return {
      name: legacyName,
      source: "",
      className: String(character?.class ?? "").trim(),
      classSource: "",
    };
  }

  function getSubclassCatalogEntries(catalogs, className, classSource = "", preferredSources = []) {
    if (!Array.isArray(catalogs?.subclasses)) return [];
    const normalizedClass = String(className ?? "").trim().toLowerCase();
    if (!normalizedClass) return [];
    const normalizedClassSource = normalizeSourceTag(classSource);
    const sourceOrder = new Map(
      (Array.isArray(preferredSources) ? preferredSources : [])
        .map((source, index) => [normalizeSourceTag(source), index])
        .filter(([source]) => source)
    );
    const unknownSourceOrder = sourceOrder.size + 1000;
    return catalogs.subclasses
      .filter((entry) => String(entry?.className ?? "").trim().toLowerCase() === normalizedClass)
      .filter((entry) => {
        if (!normalizedClassSource) return true;
        const entryClassSource = normalizeSourceTag(entry?.classSource);
        return !entryClassSource || entryClassSource === normalizedClassSource;
      })
      .sort((a, b) => {
        const nameDelta = String(a?.name ?? "").localeCompare(String(b?.name ?? ""));
        if (nameDelta !== 0) return nameDelta;
        const aSource = normalizeSourceTag(a?.source);
        const bSource = normalizeSourceTag(b?.source);
        const aOrder = sourceOrder.get(aSource) ?? unknownSourceOrder;
        const bOrder = sourceOrder.get(bSource) ?? unknownSourceOrder;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return aSource.localeCompare(bSource);
      });
  }

  function getSelectedSubclassEntry(catalogs, character) {
    const selected = getPrimarySubclassSelection(character);
    if (!selected?.name) return null;
    const classEntry = getClassCatalogEntry(catalogs, character?.class);
    const classSource = normalizeSourceTag(classEntry?.source);
    const sourceOrder = getPreferredSourceOrder(character);
    const candidates = getSubclassCatalogEntries(catalogs, character?.class, classSource, sourceOrder);
    const selectedName = selected.name.toLowerCase();
    const selectedSource = normalizeSourceTag(selected.source);
    const nameMatches = candidates.filter((entry) => String(entry?.name ?? "").trim().toLowerCase() === selectedName);
    if (!nameMatches.length) return null;
    if (selectedSource) {
      const sourceMatch = nameMatches.find((entry) => normalizeSourceTag(entry?.source) === selectedSource);
      if (sourceMatch) return sourceMatch;
    }
    const preferredSource = normalizeSourceTag(selected.classSource || classSource);
    if (preferredSource) {
      const preferredSourceMatch = nameMatches.find((entry) => normalizeSourceTag(entry?.source) === preferredSource);
      if (preferredSourceMatch) return preferredSourceMatch;
    }
    for (const source of sourceOrder) {
      const sourceMatch = nameMatches.find((entry) => normalizeSourceTag(entry?.source) === normalizeSourceTag(source));
      if (sourceMatch) return sourceMatch;
    }
    return nameMatches[0] ?? null;
  }

  function getClassSaveProficiencies(catalogs, className) {
    const classEntry = getClassCatalogEntry(catalogs, className);
    const profs = classEntry?.proficiency;
    if (!Array.isArray(profs)) return {};
    return saveAbilities.reduce((acc, ability) => {
      acc[ability] = profs.includes(ability);
      return acc;
    }, {});
  }

  function getSubraceCatalogEntries(catalogs, raceName, raceSource = "", preferredSources = []) {
    const subraces = Array.isArray(catalogs?.subraces) ? catalogs.subraces : [];
    const normalizedRaceName = String(raceName ?? "").trim().toLowerCase();
    if (!normalizedRaceName) return [];
    const normalizedRaceSource = normalizeSourceTag(raceSource);
    const filtered = subraces.filter((entry) => {
      const entryRaceName = String(entry?.raceName ?? "").trim().toLowerCase();
      if (!entryRaceName || entryRaceName !== normalizedRaceName) return false;
      if (!normalizedRaceSource) return true;
      return normalizeSourceTag(entry?.raceSource ?? entry?.source) === normalizedRaceSource;
    });
    if (!filtered.length) return [];
    const sourceOrder = new Map(
      (Array.isArray(preferredSources) ? preferredSources : [])
        .map((source, index) => [normalizeSourceTag(source), index])
        .filter(([source]) => source)
    );
    const fallbackOrder = sourceOrder.size + 1000;
    return [...filtered].sort((a, b) => {
      const nameDelta = String(a?.name ?? "").localeCompare(String(b?.name ?? ""));
      if (nameDelta !== 0) return nameDelta;
      const aSource = normalizeSourceTag(a?.source);
      const bSource = normalizeSourceTag(b?.source);
      const aOrder = sourceOrder.get(aSource) ?? fallbackOrder;
      const bOrder = sourceOrder.get(bSource) ?? fallbackOrder;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return aSource.localeCompare(bSource);
    });
  }

  function getDefaultUnnamedSubraceEntry(entries) {
    const list = Array.isArray(entries) ? entries : [];
    return list.find((entry) => !String(entry?.name ?? "").trim()) ?? null;
  }

  function mergeAbilityScoreData(baseAbility, subraceAbility, options = {}) {
    const shouldOverride = options.override === true;
    const baseOption = Array.isArray(baseAbility) ? baseAbility.find((entry) => isRecordObject(entry)) : null;
    const subraceOption = Array.isArray(subraceAbility) ? subraceAbility.find((entry) => isRecordObject(entry)) : null;
    if (shouldOverride || !baseOption) return subraceOption ? [structuredClone(subraceOption)] : [];
    if (!subraceOption) return [structuredClone(baseOption)];
    const mergedOption = {};
    saveAbilities.forEach((ability) => {
      const total = Math.max(0, toNumber(baseOption?.[ability], 0) + toNumber(subraceOption?.[ability], 0));
      if (total > 0) mergedOption[ability] = total;
    });
    const baseChoose = Array.isArray(baseOption?.choose)
      ? baseOption.choose.filter((entry) => isRecordObject(entry))
      : isRecordObject(baseOption?.choose)
        ? [baseOption.choose]
        : [];
    const subraceChoose = Array.isArray(subraceOption?.choose)
      ? subraceOption.choose.filter((entry) => isRecordObject(entry))
      : isRecordObject(subraceOption?.choose)
        ? [subraceOption.choose]
        : [];
    const combinedChoose = [...baseChoose, ...subraceChoose].map((entry) => structuredClone(entry));
    if (combinedChoose.length === 1) mergedOption.choose = combinedChoose[0];
    else if (combinedChoose.length > 1) mergedOption.choose = combinedChoose;
    return Object.keys(mergedOption).length ? [mergedOption] : [];
  }

  function mergeRaceAndSubrace(baseRace, subrace) {
    if (!isRecordObject(baseRace)) return null;
    if (!isRecordObject(subrace)) return { ...baseRace };
    const overwrite = isRecordObject(subrace?.overwrite) ? subrace.overwrite : {};
    const merged = { ...baseRace };
    const isHumanVariant =
      String(subrace?.name ?? "").trim().toLowerCase() === "variant"
      && String(subrace?.raceName ?? "").trim().toLowerCase() === "human";
    const concatArrayKeys = new Set([
      "entries",
      "skillProficiencies",
      "toolProficiencies",
      "weaponProficiencies",
      "armorProficiencies",
      "languageProficiencies",
      "resist",
      "immune",
      "conditionImmune",
      "vulnerable",
      "traitTags",
      "feats",
    ]);
    Object.entries(subrace).forEach(([key, value]) => {
      if ([
        "name",
        "source",
        "raceName",
        "raceSource",
        "overwrite",
        "_versions",
        "hasFluff",
        "hasFluffImages",
      ].includes(key)) return;
      if (key === "ability") {
        const shouldOverride = overwrite?.ability === true || isHumanVariant;
        merged.ability = mergeAbilityScoreData(baseRace?.ability, value, { override: shouldOverride });
        return;
      }
      if (key === "additionalSpells") {
        merged.additionalSpells = Array.isArray(value) ? structuredClone(value) : [];
        return;
      }
      if (overwrite?.[key] === true) {
        merged[key] = Array.isArray(value) ? structuredClone(value) : isRecordObject(value) ? { ...value } : value;
        return;
      }
      if (concatArrayKeys.has(key) && Array.isArray(value)) {
        const baseValue = Array.isArray(baseRace?.[key]) ? baseRace[key] : [];
        merged[key] = [...baseValue, ...value];
        return;
      }
      if (isRecordObject(value) && isRecordObject(baseRace?.[key])) {
        merged[key] = { ...baseRace[key], ...value };
        return;
      }
      merged[key] = Array.isArray(value) ? structuredClone(value) : isRecordObject(value) ? { ...value } : value;
    });
    merged.subrace = String(subrace?.name ?? "").trim();
    merged.subraceSource = normalizeSourceTag(subrace?.source);
    merged.subraceSourceLabel = subrace?.sourceLabel ?? sourceLabels[normalizeSourceTag(subrace?.source)] ?? subrace?.source ?? "";
    return merged;
  }

  function getEffectiveRaceEntry(catalogs, character, preferredSources = []) {
    const sourceOrder = preferredSources.length ? preferredSources : getPreferredSourceOrder(character);
    const baseRace = findCatalogEntryByNameWithSelectedSourcePreference(
      catalogs?.races,
      character?.race,
      character?.raceSource,
      sourceOrder
    );
    if (!baseRace) return null;
    const subraceOptions = getSubraceCatalogEntries(catalogs, baseRace?.name, baseRace?.source, sourceOrder);
    const selectedSubrace = findCatalogEntryByNameWithSelectedSourcePreference(
      subraceOptions,
      character?.subrace,
      character?.subraceSource,
      sourceOrder
    );
    const implicitBaseSubrace = getDefaultUnnamedSubraceEntry(subraceOptions);
    return mergeRaceAndSubrace(baseRace, selectedSubrace ?? implicitBaseSubrace);
  }

  function resolveImportedFeats(catalogs, feats) {
    if (!Array.isArray(feats)) return [];
    const entries = Array.isArray(catalogs?.feats) ? catalogs.feats : [];
    return feats
      .map((feat) => {
        const name = String(feat?.name ?? "").trim();
        if (!name) return null;
        const source = String(feat?.source ?? "").trim();
        const matched = findCatalogEntryByNameAndSource(entries, name, source);
        const canonical = matched
          ? {
              name: String(matched.name ?? "").trim(),
              source: normalizeSourceTag(matched.source),
              id: buildEntityId(["feat", matched.name, matched.source]),
            }
          : {
              name,
              source,
              id: String(feat?.id ?? "").trim() || buildEntityId(["feat", name, source || "unknown"]),
            };
        return { ...feat, ...canonical };
      })
      .filter((feat) => feat && feat.name);
  }

  function resolveImportedOptionalFeatures(catalogs, optionalFeatures) {
    if (!Array.isArray(optionalFeatures)) return [];
    const entries = Array.isArray(catalogs?.optionalFeatures) ? catalogs.optionalFeatures : [];
    return optionalFeatures
      .map((feature) => {
        const name = String(feature?.name ?? "").trim();
        if (!name) return null;
        const source = String(feature?.source ?? "").trim();
        const matched = findCatalogEntryByNameAndSource(entries, name, source);
        const canonical = matched
          ? {
              name: String(matched.name ?? "").trim(),
              source: normalizeSourceTag(matched.source),
              id: buildEntityId(["optionalfeature", matched.name, matched.source]),
            }
          : {
              name,
              source,
              id: String(feature?.id ?? "").trim() || buildEntityId(["optionalfeature", name, source || "unknown"]),
            };
        return { ...feature, ...canonical };
      })
      .filter((feature) => feature && feature.name);
  }

  function resolveImportedCharacterSelections(catalogs, character) {
    return {
      feats: resolveImportedFeats(catalogs, character?.feats),
      optionalFeatures: resolveImportedOptionalFeatures(catalogs, character?.optionalFeatures),
    };
  }

  return {
    getClassCatalogEntry,
    getClassHitDieFaces,
    getPrimarySubclassSelection,
    getSubclassCatalogEntries,
    getSelectedSubclassEntry,
    getClassSaveProficiencies,
    isRecordObject,
    findCatalogEntryByName,
    getPreferredSourceOrder,
    findCatalogEntryByNameWithSourcePreference,
    findCatalogEntryByNameWithSelectedSourcePreference,
    findCatalogEntriesByName,
    findCatalogEntryByNameAndSource,
    getSubraceCatalogEntries,
    getDefaultUnnamedSubraceEntry,
    mergeAbilityScoreData,
    mergeRaceAndSubrace,
    getEffectiveRaceEntry,
    resolveImportedFeats,
    resolveImportedOptionalFeatures,
    resolveImportedCharacterSelections,
    mergeCatalogItemWithInherits,
    resolveInventoryCatalogItem,
    itemRequiresAttunement,
    isInventoryItemActiveForBonuses,
    getActiveInventoryCatalogItems,
  };
}

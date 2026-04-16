function isRecordObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeLookupValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeInventoryItemName(value) {
  return String(value ?? "").trim();
}

function getInventoryLookupNameCandidates(name) {
  const normalized = normalizeInventoryItemName(name);
  if (!normalized) return [];
  const withoutBonusPrefix = normalized.replace(/^\+\d+\s+/u, "").trim();
  if (!withoutBonusPrefix || withoutBonusPrefix.toLowerCase() === normalized.toLowerCase()) return [normalized];
  return [normalized, withoutBonusPrefix];
}

function dedupeLookupCandidates(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").trim())
    .filter((value) => {
      if (!value) return false;
      const key = normalizeLookupValue(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function parseVariantAndBaseNames(name) {
  const normalized = normalizeInventoryItemName(name);
  if (!normalized) return { variantName: "", baseName: "" };
  const hyphenIndex = normalized.lastIndexOf(" - ");
  if (hyphenIndex > 0 && hyphenIndex < normalized.length - 3) {
    return {
      variantName: normalized.slice(0, hyphenIndex).trim(),
      baseName: normalized.slice(hyphenIndex + 3).trim(),
    };
  }
  const parenMatch = normalized.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (parenMatch) {
    return {
      variantName: String(parenMatch[1] ?? "").trim(),
      baseName: String(parenMatch[2] ?? "").trim(),
    };
  }
  return { variantName: "", baseName: "" };
}

function findCatalogItemByName(items, nameValue, sourceValues, requireSource) {
  const normalizedName = normalizeLookupValue(nameValue);
  if (!normalizedName) return null;
  const normalizedSources = dedupeLookupCandidates(sourceValues).map((value) => normalizeLookupValue(value));
  return (
    items.find((item) => {
      if (normalizeLookupValue(item?.name) !== normalizedName) return false;
      if (!requireSource || !normalizedSources.length) return true;
      const itemSource = normalizeLookupValue(item?.source);
      return normalizedSources.includes(itemSource);
    }) ?? null
  );
}

function mergeVariantWithBaseCatalogItem(variantItem, baseItem) {
  const mergedVariant = mergeCatalogItemWithInherits(variantItem);
  const mergedBase = mergeCatalogItemWithInherits(baseItem);
  if (!mergedVariant) return mergedBase;
  if (!mergedBase) return mergedVariant;
  const variantEntries = Array.isArray(mergedVariant?.entries) ? mergedVariant.entries : [];
  const baseEntries = Array.isArray(mergedBase?.entries) ? mergedBase.entries : [];
  const combinedEntries = [...variantEntries, ...baseEntries];
  return {
    ...mergedBase,
    ...mergedVariant,
    entries: combinedEntries.length ? combinedEntries : mergedVariant.entries ?? mergedBase.entries,
  };
}

export function mergeCatalogItemWithInherits(item) {
  if (!isRecordObject(item)) return null;
  const inherits = isRecordObject(item?.inherits) ? item.inherits : {};
  const merged = {
    ...inherits,
    ...item,
  };
  merged.name = String(item?.name ?? inherits?.name ?? "").trim();
  merged.source = String(item?.source ?? inherits?.source ?? "").trim();
  merged.sourceLabel = String(item?.sourceLabel ?? inherits?.sourceLabel ?? merged.source).trim();
  return merged;
}

export function resolveInventoryCatalogItem(catalogs, inventoryEntry) {
  if (!isRecordObject(inventoryEntry)) return null;
  const items = Array.isArray(catalogs?.items) ? catalogs.items : [];
  if (!items.length) return null;
  const parsedNames = parseVariantAndBaseNames(inventoryEntry?.name);
  const names = dedupeLookupCandidates([
    ...getInventoryLookupNameCandidates(inventoryEntry?.name),
    ...getInventoryLookupNameCandidates(inventoryEntry?.catalogName),
    ...getInventoryLookupNameCandidates(parsedNames.variantName),
  ]);
  if (!names.length) return null;
  const sourceCandidates = dedupeLookupCandidates([
    inventoryEntry?.catalogSource,
    inventoryEntry?.source,
  ]);
  const tryMatch = (nameValue, requireSource) => {
    return findCatalogItemByName(items, nameValue, sourceCandidates, requireSource);
  };
  let matched = null;
  for (const name of names) {
    matched = tryMatch(name, true);
    if (matched) break;
  }
  if (!matched) {
    for (const name of names) {
      matched = tryMatch(name, false);
      if (matched) break;
    }
  }
  if (!matched) return null;
  const baseNameCandidates = dedupeLookupCandidates([
    inventoryEntry?.baseItemName,
    parsedNames.baseName,
  ]);
  if (!baseNameCandidates.length) return mergeCatalogItemWithInherits(matched);
  const baseSourceCandidates = dedupeLookupCandidates([
    inventoryEntry?.baseItemSource,
    inventoryEntry?.source,
  ]);
  let matchedBase = null;
  for (const baseName of baseNameCandidates) {
    matchedBase = findCatalogItemByName(items, baseName, baseSourceCandidates, true);
    if (matchedBase) break;
  }
  if (!matchedBase) {
    for (const baseName of baseNameCandidates) {
      matchedBase = findCatalogItemByName(items, baseName, baseSourceCandidates, false);
      if (matchedBase) break;
    }
  }
  if (!matchedBase) return mergeCatalogItemWithInherits(matched);
  return mergeVariantWithBaseCatalogItem(matched, matchedBase);
}

export function itemRequiresAttunement(item) {
  if (!isRecordObject(item)) return false;
  const reqAttune = item?.reqAttune;
  if (typeof reqAttune === "boolean") {
    if (reqAttune) return true;
  } else if (typeof reqAttune === "string") {
    if (reqAttune.trim()) return true;
  }
  if (Array.isArray(item?.reqAttuneTags) && item.reqAttuneTags.length > 0) return true;
  if (Array.isArray(item?.reqAttuneAltTags) && item.reqAttuneAltTags.length > 0) return true;
  return false;
}

export function isInventoryItemActiveForBonuses(inventoryEntry, catalogItem) {
  if (!isRecordObject(inventoryEntry)) return false;
  if (!inventoryEntry.equipped) return false;
  const requiresAttunement = itemRequiresAttunement(catalogItem) || Boolean(inventoryEntry?.requiresAttunement);
  if (!requiresAttunement) return true;
  return Boolean(inventoryEntry?.attuned);
}

export function getActiveInventoryCatalogItems(catalogs, character) {
  const inventory = Array.isArray(character?.inventory) ? character.inventory : [];
  return inventory
    .filter((entry) => isRecordObject(entry))
    .map((inventoryEntry) => {
      const catalogItem = resolveInventoryCatalogItem(catalogs, inventoryEntry);
      if (!catalogItem) return null;
      if (!isInventoryItemActiveForBonuses(inventoryEntry, catalogItem)) return null;
      return {
        inventoryEntry,
        catalogItem,
      };
    })
    .filter(Boolean);
}

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
  const names = getInventoryLookupNameCandidates(inventoryEntry?.name);
  if (!names.length) return null;
  const source = normalizeLookupValue(inventoryEntry?.source);
  const tryMatch = (nameValue, requireSource) => {
    const normalizedName = normalizeLookupValue(nameValue);
    if (!normalizedName) return null;
    return (
      items.find((item) => {
        if (normalizeLookupValue(item?.name) !== normalizedName) return false;
        if (!requireSource || !source) return true;
        return normalizeLookupValue(item?.source) === source;
      }) ?? null
    );
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
  return mergeCatalogItemWithInherits(matched);
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

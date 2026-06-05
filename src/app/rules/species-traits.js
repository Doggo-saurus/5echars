const ignoredSpeciesTraitNames = new Set([
  "age",
  "alignment",
  "size",
  "language",
  "languages",
  "creature type",
]);

function hasStructuredGrant(value) {
  return Array.isArray(value) && value.length > 0;
}

export function isSpeciesTraitGrantDescriptor(raceEntry, traitName) {
  const normalizedName = String(traitName ?? "").trim().toLowerCase();
  if (!normalizedName) return false;
  if (normalizedName === "skills") return hasStructuredGrant(raceEntry?.skillProficiencies);
  if (normalizedName === "feat") return hasStructuredGrant(raceEntry?.feats);
  return false;
}

export function shouldShowSpeciesTraitEntry(raceEntry, entry) {
  if (!entry || typeof entry !== "object") return false;
  const name = String(entry?.name ?? "").trim();
  if (!name) return false;
  const normalizedName = name.toLowerCase();
  if (ignoredSpeciesTraitNames.has(normalizedName)) return false;
  return !isSpeciesTraitGrantDescriptor(raceEntry, normalizedName);
}

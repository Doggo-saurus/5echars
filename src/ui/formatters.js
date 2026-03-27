export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

export function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim();
}

export function matchesSearchQuery(query, ...parts) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const haystack = parts.map((part) => normalizeSearchText(part)).join(" ");
  return tokens.every((token) => haystack.includes(token));
}

export function signed(value) {
  const num = toNumber(value, 0);
  return num >= 0 ? `+${num}` : `${num}`;
}

export function toTitleCase(value) {
  return String(value ?? "")
    .replace(/[_-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function normalizeAbilityLabel(value, abilityLabels = {}) {
  const key = String(value ?? "").trim().toLowerCase();
  if (abilityLabels[key]) return abilityLabels[key];
  return toTitleCase(key);
}

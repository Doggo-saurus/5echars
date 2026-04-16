// Keep homebrew items here so they stay outside vendor catalog data.
// Each entry can include the same fields as standard item catalog entries.
export const HOMEBREW_ITEMS = [
  {
    name: "Sentinal Weapon",
    source: "HOMEBREW",
    rarity: "uncommon",
    tier: "major",
    requires: [{ weapon: true }],
    inherits: {
      bonusWeaponAttack: 0,
      bonusWeaponDamage: 0,
    },
    entries: [
      "While holding this weapon, you have advantage on initiative rolls and Wisdom ({@skill Perception}) checks. The weapon is emblazoned with a symbol of an eye.",
    ],
  },
];

function normalizeHomebrewItemSource(item) {
  const source = String(item?.source ?? "").trim();
  return source || "HOMEBREW";
}

export function getHomebrewItems() {
  return HOMEBREW_ITEMS
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const source = normalizeHomebrewItemSource(item);
      const sourceLabel = String(item?.sourceLabel ?? "").trim();
      return {
        ...item,
        source,
        sourceLabel: sourceLabel || "Homebrew",
      };
    })
    .filter((item) => String(item?.name ?? "").trim());
}

export const SOURCE_PRESETS = {
  set2014: ["PHB", "XGE", "TCE", "DMG"],
  set2024: ["XPHB", "XGE", "TCE", "XDMG"],
  core: ["PHB"],
  expanded: ["PHB", "XGE", "TCE", "SCAG", "MPMM", "DMG", "XDMG"],
};

export const SOURCE_PRESET_LABELS = {
  set2014: "2014 (PHB, XGE, Tasha's, DMG)",
  set2024: "2024 (PHB, XGE, Tasha's, XDMG)",
  core: "Core (PHB)",
  expanded: "Expanded (incl. DMG + XDMG)",
};

export const SOURCE_LABELS = {
  PHB: "Player's Handbook",
  XPHB: "Player's Handbook (2024)",
  DMG: "Dungeon Master's Guide",
  XDMG: "Dungeon Master's Guide (2024)",
  XGE: "Xanathar's Guide to Everything",
  TCE: "Tasha's Cauldron of Everything",
  SCAG: "Sword Coast Adventurer's Guide",
  MPMM: "Mordenkainen Presents: Monsters of the Multiverse",
};

export const DEFAULT_SOURCE_PRESET = "set2014";

export function getAllowedSources(presetKey) {
  return SOURCE_PRESETS[presetKey] ?? SOURCE_PRESETS[DEFAULT_SOURCE_PRESET];
}

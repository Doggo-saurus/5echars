export const SOURCE_PRESETS = {
  set2014: ["PHB", "XGE", "TCE"],
  set2024: ["XPHB", "XGE", "TCE"],
  core: ["PHB"],
  expanded: ["PHB", "XGE", "TCE", "SCAG", "MPMM"],
};

export const SOURCE_PRESET_LABELS = {
  set2014: "2014 (PHB, XGE, Tasha's)",
  set2024: "2024 (PHB, XGE, Tasha's)",
  core: "Core (PHB)",
  expanded: "Expanded",
};

export const SOURCE_LABELS = {
  PHB: "Player's Handbook",
  XPHB: "Player's Handbook (2024)",
  XGE: "Xanathar's Guide to Everything",
  TCE: "Tasha's Cauldron of Everything",
  SCAG: "Sword Coast Adventurer's Guide",
  MPMM: "Mordenkainen Presents: Monsters of the Multiverse",
};

export const DEFAULT_SOURCE_PRESET = "expanded";

export function getAllowedSources(presetKey) {
  return SOURCE_PRESETS[presetKey] ?? SOURCE_PRESETS[DEFAULT_SOURCE_PRESET];
}

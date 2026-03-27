export const SOURCE_PRESETS = {
  core: ["PHB"],
  expanded: ["PHB", "XGE", "TCE", "SCAG", "MPMM"],
};

export const SOURCE_LABELS = {
  PHB: "Player's Handbook",
  XGE: "Xanathar's Guide to Everything",
  TCE: "Tasha's Cauldron of Everything",
  SCAG: "Sword Coast Adventurer's Guide",
  MPMM: "Mordenkainen Presents: Monsters of the Multiverse",
};

export const DEFAULT_SOURCE_PRESET = "expanded";

export function getAllowedSources(presetKey) {
  return SOURCE_PRESETS[presetKey] ?? SOURCE_PRESETS[DEFAULT_SOURCE_PRESET];
}

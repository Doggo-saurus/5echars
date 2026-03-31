export const SOURCE_PRESETS = {
  srd: ["PHB", "XPHB", "DMG", "XDMG", "XGE", "TCE", "SCAG", "MPMM"],
  set2014: ["PHB", "XGE", "TCE", "DMG"],
  set2024: ["XPHB", "XGE", "TCE", "XDMG"],
  core: ["PHB"],
  expanded: ["PHB", "XGE", "TCE", "SCAG", "MPMM", "DMG", "XDMG"],
};

export const SOURCE_PRESET_LABELS = {
  srd: "SRD",
  set2014: "2014 (PHB, XGE, Tasha's, DMG)",
  set2024: "2024 (PHB, XGE, Tasha's, XDMG)",
  core: "Core (PHB)",
  expanded: "Expanded (incl. DMG + XDMG)",
};

export const SOURCE_LABELS = {
  PHB: "PHB",
  XPHB: "XPHB",
  DMG: "DMG",
  XDMG: "XDMG",
  XGE: "XGE",
  TCE: "TCE",
  SCAG: "SCAG",
  MPMM: "MPMM",
};

export const DEFAULT_SOURCE_PRESET = "set2014";

export function getAllowedSources(presetKey) {
  return SOURCE_PRESETS[presetKey] ?? SOURCE_PRESETS[DEFAULT_SOURCE_PRESET];
}

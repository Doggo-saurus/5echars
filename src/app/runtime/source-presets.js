export function createRuntimeSourcePresets({
  defaultSourcePreset,
  sourcePresets,
  sourcePresetLabels,
  isCatalogDataSrdOnly,
}) {
  const { srd: srdPresetSources = [], ...nonSrdSourcePresets } = sourcePresets;
  const { srd: srdPresetLabel = "SRD", ...nonSrdSourcePresetLabels } = sourcePresetLabels;
  let runtimeSourcePresets = { ...nonSrdSourcePresets };
  let runtimeSourcePresetLabels = { ...nonSrdSourcePresetLabels };
  let sourcePresetRuntimeReady = false;

  function getRuntimeDefaultSourcePreset() {
    if (runtimeSourcePresets[defaultSourcePreset]) return defaultSourcePreset;
    const [firstPreset] = Object.keys(runtimeSourcePresets);
    return firstPreset ?? defaultSourcePreset;
  }

  function resolveRuntimeSourcePreset(presetKey) {
    const normalized = String(presetKey ?? "").trim();
    if (normalized && runtimeSourcePresets[normalized]) return normalized;
    return getRuntimeDefaultSourcePreset();
  }

  async function ensureRuntimeSourcePresets() {
    if (sourcePresetRuntimeReady) return;
    const srdOnly = await isCatalogDataSrdOnly();
    if (srdOnly) {
      runtimeSourcePresets = { srd: srdPresetSources };
      runtimeSourcePresetLabels = { srd: srdPresetLabel };
    }
    sourcePresetRuntimeReady = true;
  }

  return {
    getRuntimeDefaultSourcePreset,
    resolveRuntimeSourcePreset,
    ensureRuntimeSourcePresets,
    getRuntimeSourcePresets: () => runtimeSourcePresets,
    getRuntimeSourcePresetLabels: () => runtimeSourcePresetLabels,
  };
}

export function createCharacterViewHelpers({
  esc,
  toNumber,
  normalizeSourceTag,
  sourceLabels,
  defaultSourcePreset,
  getAllowedSources,
  runtimeSourcePresetsState,
  catalogLookupDomain,
  spellcastingRules,
  saveAbilities,
  abilityLabels,
}) {
  function getModeToggle(mode) {
    const playButtonClass = mode === "play" ? "mode-toggle-btn is-active" : "mode-toggle-btn";
    const buildButtonClass = mode === "build" ? "mode-toggle-btn is-active" : "mode-toggle-btn";
    return `
      <div class="mode-toggle" role="group" aria-label="Character mode">
        <button type="button" data-mode="play" class="${playButtonClass}">Play</button>
        <button type="button" data-mode="build" class="${buildButtonClass}">Edit</button>
      </div>
    `;
  }

  function optionList(options, selected, config = {}) {
    const includeSourceInValue = Boolean(config?.includeSourceInValue);
    const selectedSource = normalizeSourceTag(config?.selectedSource);
    const entries = Array.isArray(options) ? options : [];
    const selectedName = String(selected ?? "").trim().toLowerCase();
    const selectedIndex = entries.findIndex((entry) => {
      const entryName = String(entry?.name ?? "").trim().toLowerCase();
      if (!selectedName || entryName !== selectedName) return false;
      if (!selectedSource) return true;
      return normalizeSourceTag(entry?.source) === selectedSource;
    });
    return entries
      .map(
        (opt, index) =>
          `<option value="${esc(includeSourceInValue ? `${String(opt?.name ?? "")}|${String(opt?.source ?? "")}` : opt.name)}" ${
            index === selectedIndex ? "selected" : ""
          }>${esc(opt.name)} (${esc(
            opt.sourceLabel ?? opt.source ?? "Unknown Source"
          )})</option>`
      )
      .join("");
  }

  function getSubclassSelectOptions(state) {
    const sourceOrder = catalogLookupDomain.getPreferredSourceOrder(state.character);
    const classEntry = catalogLookupDomain.getClassCatalogEntry(state.catalogs, state.character.class, state.character?.classSource, sourceOrder);
    const selected = catalogLookupDomain.getPrimarySubclassSelection(state.character);
    const classSource = normalizeSourceTag(classEntry?.source);
    const options = catalogLookupDomain.getSubclassCatalogEntries(state.catalogs, state.character.class, classSource, sourceOrder);
    return options.map((entry) => {
      const isSelected =
        selected
        && String(selected.name ?? "").trim().toLowerCase() === String(entry?.name ?? "").trim().toLowerCase()
        && (!selected.source || normalizeSourceTag(selected.source) === normalizeSourceTag(entry?.source));
      const subclassSource = normalizeSourceTag(entry?.source);
      const subclassSourceLabel = entry?.sourceLabel ?? sourceLabels[subclassSource] ?? entry?.source ?? "";
      const subclassClassSource = normalizeSourceTag(entry?.classSource);
      const subclassClassSourceLabel = sourceLabels[subclassClassSource] ?? entry?.classSource ?? "";
      const sourceLabel =
        subclassClassSource && subclassClassSource !== subclassSource && subclassClassSourceLabel
          ? `${subclassSourceLabel} | Class: ${subclassClassSourceLabel}`
          : subclassSourceLabel;
      return {
        name: String(entry?.name ?? ""),
        source: String(entry?.source ?? ""),
        sourceLabel,
        isSelected,
      };
    });
  }

  function getFeatSlotsWithSelection(character) {
    const progression = character?.progression ?? {};
    const slots = Array.isArray(progression.featSlots) ? progression.featSlots : [];
    const feats = Array.isArray(character?.feats) ? character.feats : [];
    return slots.map((slot) => ({
      ...slot,
      feat: feats.find((feat) => feat.slotId === slot.id) ?? null,
    }));
  }

  function getOptionalFeatureSlotsWithSelection(character) {
    const progression = character?.progression ?? {};
    const slots = Array.isArray(progression.optionalFeatureSlots) ? progression.optionalFeatureSlots : [];
    const selected = Array.isArray(character?.optionalFeatures) ? character.optionalFeatures : [];
    return slots.map((slot) => ({
      ...slot,
      optionalFeature: selected.find((feature) => feature.slotId === slot.id) ?? null,
    }));
  }

  function getSpellSlotValues(play, defaults, level) {
    const key = String(level);
    const slot = play.spellSlots?.[key] ?? { max: 0, used: 0 };
    const hasUserOverride = Boolean(play.spellSlotUserOverrides?.[key]);
    const overrideMax = hasUserOverride ? play.spellSlotMaxOverrides?.[key] : null;
    const baseMax = overrideMax == null ? toNumber(defaults?.[key], toNumber(slot.max, 0)) : toNumber(overrideMax, 0);
    const max = Math.max(0, baseMax);
    const used = Math.max(0, Math.min(max, toNumber(slot.used, 0)));
    const isOverridden = hasUserOverride && overrideMax != null;
    return { max, used, isOverridden };
  }

  function getSpellSlotRow(play, defaults, level) {
    const { max, used } = getSpellSlotValues(play, defaults, level);
    return `
      <div class="spell-slot-card">
        <div class="spell-slot-top">
          <span class="spell-slot-level">Level ${level}</span>
          <div class="spell-slot-inline">
            <span class="spell-slot-used">Slots <strong>${Math.max(0, max - used)}/${max}</strong></span>
          <div class="spell-slot-actions">
              <button type="button" class="spell-slot-btn" data-slot-delta="${level}" data-delta="1" aria-label="Spend one level ${level} slot">-</button>
              <button type="button" class="spell-slot-btn" data-slot-delta="${level}" data-delta="-1" aria-label="Recover one level ${level} slot">+</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function getSaveProficiencyLabelMap(saveProficiencies) {
    return saveAbilities.filter((ability) => Boolean(saveProficiencies?.[ability])).map((ability) => abilityLabels[ability]);
  }

  function getCharacterAllowedSources(character) {
    const sourcePreset = runtimeSourcePresetsState.resolveRuntimeSourcePreset(character?.sourcePreset ?? defaultSourcePreset);
    const presetSources = runtimeSourcePresetsState.getRuntimeSourcePresets()[sourcePreset] ?? getAllowedSources(sourcePreset);
    const customSources = Array.isArray(character?.customSources)
      ? character.customSources.map((entry) => String(entry ?? "").trim()).filter(Boolean)
      : [];
    return [...new Set([...presetSources, ...customSources])];
  }

  function getSpellProgressionRows(catalogs, className) {
    if (!catalogs || !Array.isArray(catalogs.classes)) return null;
    const normalizedClassName = String(className ?? "").trim().toLowerCase();
    if (!normalizedClassName) return null;
    const classEntry = catalogs.classes.find((entry) => String(entry?.name ?? "").trim().toLowerCase() === normalizedClassName);
    if (!classEntry || !Array.isArray(classEntry.classTableGroups)) return null;
    const progressionGroup = classEntry.classTableGroups.find((group) => Array.isArray(group?.rowsSpellProgression));
    return Array.isArray(progressionGroup?.rowsSpellProgression) ? progressionGroup.rowsSpellProgression : null;
  }

  return {
    getModeToggle,
    optionList,
    getSubclassSelectOptions,
    getFeatSlotsWithSelection,
    getOptionalFeatureSlotsWithSelection,
    getSpellSlotValues,
    getSpellSlotRow,
    getSaveProficiencyLabelMap,
    getCharacterAllowedSources,
    getSpellProgressionRows,
  };
}

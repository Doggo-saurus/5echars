export function createRenderers(deps) {
  const {
    STEPS,
    esc,
    toNumber,
    signed,
    saveAbilities,
    abilityLabels,
    skills,
    spellSlotLevels,
    sourcePresets,
    sourcePresetLabels,
    getCharacterAllowedSources,
    sourceLabels,
    optionList,
    getSubraceCatalogEntries,
    getEffectiveRaceEntry,
    getSubclassSelectOptions,
    getFeatSlotsWithSelection,
    getOptionalFeatureSlotsWithSelection,
    getCharacterSpellSlotDefaults,
    getSpellSlotValues,
    getSpellByName,
    getSpellCombatContext,
    getSpellPrimaryDiceNotation,
    getSpellLevelLabel,
    spellSchoolLabels,
    getRuleDescriptionLines,
    doesClassUsePreparedSpells,
    getPreparedSpellLimit,
    countPreparedSpells,
    isSpellAlwaysPrepared,
    getSaveProficiencyLabelMap,
    getCharacterToolAndDefenseSummary,
    getLevelUpPreview,
    getClassCasterContribution,
    defaultDiceResultMessage,
    renderDiceStyleOptions,
    getSpellSlotRow,
    autoResourceIdPrefix,
    latestSpellCastStatus,
    renderCharacterHistorySelector,
    renderPersistenceNotice,
    getModeToggle,
    getAutoAttacks,
    getCharacterChangeLog,
    extractSimpleNotation,
  } = deps;

  function getPlayManualLinks(state) {
    const character = state?.character ?? {};
    const catalogs = state?.catalogs ?? {};
    const preferredSources = getPreferredSourceOrder(character);
    const classEntry = findCatalogEntryByNameWithSelectedSourcePreference(
      catalogs?.classes,
      character?.class,
      character?.classSource,
      preferredSources
    );
    const selectedSubclass = character?.classSelection?.subclass ?? {};
    const selectedSubclassName = String(selectedSubclass?.name ?? character?.subclass ?? "").trim();
    const selectedSubclassSource = String(selectedSubclass?.source ?? character?.subclassSource ?? "").trim();
    const subclassEntry = findCatalogEntryByNameWithSelectedSourcePreference(
      catalogs?.subclasses,
      selectedSubclassName,
      selectedSubclassSource,
      preferredSources
    );
    const links = [];
    if (classEntry?.name && classEntry?.source) {
      links.push({
        href: buildClassesManualUrl(classEntry),
        label: `${classEntry.name} class`,
        meta: formatSourceMeta(classEntry.source),
      });
    }
    if (classEntry?.name && classEntry?.source && subclassEntry?.name && subclassEntry?.source) {
      links.push({
        href: buildClassesManualUrl(classEntry, subclassEntry),
        label: `${subclassEntry.name} subclass`,
        meta: formatSourceMeta(subclassEntry.source),
      });
    }
    const allowedSources = getCharacterAllowedSources(character).map((source) => normalizeSourceTag(source)).filter(Boolean);
    allowedSources.forEach((source) => {
      links.push({
        href: `https://5e.tools/book.html#${source.toLowerCase()}`,
        label: sourceLabels?.[source] ?? source,
        meta: "Source book",
      });
    });
    links.push({
      href: "https://5e.tools/conditionsdiseases.html",
      label: "Status conditions",
      meta: "Conditions reference",
    });
    const deduped = [];
    const seen = new Set();
    links.forEach((entry) => {
      const href = String(entry?.href ?? "").trim();
      if (!href || seen.has(href)) return;
      seen.add(href);
      deduped.push({
        href,
        label: String(entry?.label ?? "").trim() || "Rule reference",
        meta: String(entry?.meta ?? "").trim() || "Reference",
      });
    });
    return deduped;
  }

  function toManualSlug(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function formatSourceMeta(source) {
    const normalized = normalizeSourceTag(source);
    if (!normalized) return "Reference";
    return sourceLabels?.[normalized] ?? normalized;
  }

  function buildClassesManualUrl(classEntry, subclassEntry = null) {
    const classNameSlug = toManualSlug(classEntry?.name);
    const classSourceSlug = toManualSlug(normalizeSourceTag(classEntry?.source));
    const classHash = `${classNameSlug}_${classSourceSlug}`;
    if (!subclassEntry?.name || !subclassEntry?.source) {
      return `https://5e.tools/classes.html#${classHash}`;
    }
    const subclassName = String(subclassEntry?.shortName ?? subclassEntry?.name ?? "").trim();
    const subclassNameSlug = toManualSlug(subclassName);
    const subclassSourceSlug = toManualSlug(normalizeSourceTag(subclassEntry?.source));
    return `https://5e.tools/classes.html#${classHash},state:sub_${subclassNameSlug}_${subclassSourceSlug}=b1`;
  }

  function formatCharacterLogTime(isoTimestamp) {
    if (typeof isoTimestamp !== "string" || !isoTimestamp) return "";
    const parsed = new Date(isoTimestamp);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function formatCharacterLogTimestamp(isoTimestamp) {
    if (typeof isoTimestamp !== "string" || !isoTimestamp) {
      return { datetime: "", label: "", title: "" };
    }
    const parsed = new Date(isoTimestamp);
    if (Number.isNaN(parsed.getTime())) {
      return { datetime: "", label: "", title: "" };
    }
    const timeLabel = formatCharacterLogTime(isoTimestamp);
    const dateLabel = parsed.toLocaleDateString([], { month: "short", day: "numeric" });
    const title = parsed.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    return {
      datetime: parsed.toISOString(),
      label: `${timeLabel} · ${dateLabel}`,
      title,
    };
  }

  function getCharacterLogToneClass(sectionKey) {
    const normalized = String(sectionKey ?? "").trim().toLowerCase();
    if (normalized === "dice") return "character-log-entry-tone-dice";
    if (normalized === "play") return "character-log-entry-tone-play";
    return "character-log-entry-tone-character";
  }

  function renderCharacterLogSummaryParts(summaryParts) {
    const parts = Array.isArray(summaryParts) && summaryParts.length
      ? summaryParts
      : [{ text: "Updated character", style: "plain" }];
    return parts
      .map((part) => {
        const text = esc(part?.text ?? "");
        const style = String(part?.style ?? "plain");
        const className =
          style === "bold"
            ? "character-log-part character-log-part-bold"
            : style === "highlight"
              ? "character-log-part character-log-part-highlight"
              : "character-log-part";
        return `<span class="${className}">${text}</span>`;
      })
      .join("");
  }

  function renderCharacterLogDetails(details) {
    if (!Array.isArray(details) || !details.length) return "";
    const rowsHtml = details
      .map((row) => `
        <div class="character-log-row">
          <span class="character-log-row-key">${esc(row?.label ?? "")}</span>
          <span class="character-log-row-value">
            <span class="character-log-before">${esc(row?.before ?? "empty")}</span>
            <span class="character-log-arrow" aria-hidden="true">→</span>
            <span class="character-log-after">${esc(row?.after ?? "empty")}</span>
          </span>
        </div>
      `)
      .join("");
    return `<div class="character-log-details">${rowsHtml}</div>`;
  }

  function buildProficiencyEditState(keys, selectedMap, autoMap) {
    const autoByKey = {};
    const manualByKey = {};
    let removedAutoCount = 0;
    let manualSelectedCount = 0;
    keys.forEach((key) => {
      const isSelected = Boolean(selectedMap?.[key]);
      const isAuto = Boolean(autoMap?.[key]);
      const isManual = isSelected && !isAuto;
      autoByKey[key] = isSelected && isAuto;
      manualByKey[key] = isManual;
      if (isAuto && !isSelected) removedAutoCount += 1;
      if (isManual) manualSelectedCount += 1;
    });
    const overBy = Math.max(0, manualSelectedCount - removedAutoCount);
    const invalidByKey = {};
    keys.forEach((key) => {
      invalidByKey[key] = overBy > 0 && manualByKey[key];
    });
    return {
      autoByKey,
      manualByKey,
      invalidByKey,
      removedAutoCount,
      manualSelectedCount,
      overBy,
    };
  }

  function getProficiencyEditMeta(character) {
    const play = character?.play ?? {};
    const saveKeys = saveAbilities;
    const skillKeys = skills.map((skill) => skill.key);
    const saves = buildProficiencyEditState(saveKeys, play.saveProficiencies, play.autoSaveProficiencies);
    const skill = buildProficiencyEditState(skillKeys, play.skillProficiencies, play.autoSkillProficiencies);
    return { saves, skill };
  }

  function normalizeSkillProficiencyMode(value) {
    const mode = String(value ?? "").trim().toLowerCase();
    if (mode === "half" || mode === "proficient" || mode === "expertise") return mode;
    return "none";
  }

  function getSkillProficiencyBonus(proficiencyBonus, mode) {
    if (mode === "expertise") return proficiencyBonus * 2;
    if (mode === "proficient") return proficiencyBonus;
    if (mode === "half") return Math.floor(proficiencyBonus / 2);
    return 0;
  }

  function getSkillModeLabel(mode) {
    if (mode === "expertise") return "E";
    if (mode === "proficient") return "P";
    if (mode === "half") return "1/2";
    return "-";
  }

  function renderSaveRowsImpl(state, options = {}) {
    const { character, derived } = state;
    const { canToggle = false, includeRollButtons = false } = options;
    const play = character.play ?? {};
    const saveEditState = canToggle ? options?.proficiencyEditMeta?.saves : null;

    return saveAbilities
      .map((ability) => {
        const score = toNumber(character.abilities?.[ability], 10);
        const mod = derived.mods[ability];
        const isProf = Boolean(play.saveProficiencies?.[ability]);
        const isAutoProf = Boolean(saveEditState?.autoByKey?.[ability]);
        const isOverLimit = Boolean(saveEditState?.invalidByKey?.[ability]);
        const total = mod + (isProf ? derived.proficiencyBonus : 0);
        const abilityLabel = abilityLabels[ability] ?? ability.toUpperCase();
        const saveName = `${abilityLabel} Save`;
        const profControl = canToggle
          ? `
            <button
              type="button"
              class="save-prof-btn ${isProf ? "is-active" : ""} ${isAutoProf ? "is-auto" : ""} ${isOverLimit ? "is-over-limit" : ""}"
              data-save-prof-btn="${ability}"
              aria-pressed="${isProf ? "true" : "false"}"
              ${isAutoProf ? "disabled aria-disabled='true' title='Auto-granted proficiency'" : ""}
            >
              ${isProf ? "P" : "-"}
            </button>
          `
          : `
            <span class="save-prof-btn is-readonly ${isProf ? "is-active" : ""} ${isAutoProf ? "is-auto" : ""}" aria-hidden="true">
              ${isProf ? "P" : "-"}
            </span>
          `;
        const modControl = includeRollButtons
          ? `
            <button
              type="button"
              class="save-mod-btn"
              data-save-roll-btn="${ability}"
              title="Roll ${saveName}"
            >
              ${signed(total)}
            </button>
          `
          : `<span class="save-mod-btn">${signed(total)}</span>`;

        return `
      <div class="ability-save-row ${isOverLimit ? "is-over-limit" : ""}">
        <button type="button" class="pill pill-btn" data-ability-roll="${ability}" title="Roll ${abilityLabel} check">
          ${abilityLabel} ${score} / ${signed(mod)}
        </button>
        <div class="save-label">
          <span class="save-left">
            <span class="save-name">Save</span>
            ${profControl}
            ${modControl}
          </span>
        </div>
      </div>
    `;
      })
      .join("");
  }

  function renderSkillRowsImpl(state, options = {}) {
    const { character, derived } = state;
    const { canToggle = false, includeRollButtons = false } = options;
    const play = character.play ?? {};
    const skillEditState = canToggle ? options?.proficiencyEditMeta?.skill : null;

    return skills
      .map((skill) => {
        const skillMode = normalizeSkillProficiencyMode(play.skillProficiencyModes?.[skill.key] ?? (play.skillProficiencies?.[skill.key] ? "proficient" : "none"));
        const autoSkillMode = normalizeSkillProficiencyMode(
          play.autoSkillProficiencyModes?.[skill.key] ?? (play.autoSkillProficiencies?.[skill.key] ? "proficient" : "none")
        );
        const isProf = skillMode === "proficient" || skillMode === "expertise";
        const isAutoProf = autoSkillMode === "proficient" || autoSkillMode === "expertise";
        const isOverLimit = Boolean(skillEditState?.invalidByKey?.[skill.key]);
        const total = derived.mods[skill.ability] + getSkillProficiencyBonus(derived.proficiencyBonus, skillMode);
        const profControl = canToggle
          ? `
            <button
              type="button"
              class="skill-prof-btn ${isProf ? "is-active" : ""} ${isAutoProf ? "is-auto" : ""} ${isOverLimit ? "is-over-limit" : ""} ${skillMode === "half" ? "is-half" : ""} ${skillMode === "expertise" ? "is-expertise" : ""}"
              data-skill-prof-btn="${skill.key}"
              aria-pressed="${isProf ? "true" : "false"}"
              title="Cycle proficiency mode"
            >
              ${getSkillModeLabel(skillMode)}
            </button>
          `
          : `
            <span class="skill-prof-btn is-readonly ${isProf ? "is-active" : ""} ${isAutoProf ? "is-auto" : ""} ${skillMode === "half" ? "is-half" : ""} ${skillMode === "expertise" ? "is-expertise" : ""}" aria-hidden="true">
              ${getSkillModeLabel(skillMode)}
            </span>
          `;
        const rollControl = includeRollButtons
          ? `
        <button
          type="button"
          class="save-mod-btn skill-roll-btn"
          data-skill-roll-btn="${skill.key}"
          title="Roll ${esc(skill.label)} check"
        >
          ${signed(total)}
        </button>
      `
          : `<span class="save-mod-btn skill-roll-btn">${signed(total)}</span>`;

        return `
      <div class="skill-row">
        <div class="skill-btn ${isProf ? "is-active" : ""} ${isAutoProf ? "is-auto" : ""} ${isOverLimit ? "is-over-limit" : ""}">
          <span class="skill-left">
            ${profControl}
            <span class="skill-name">${esc(skill.label)} <span class="muted">(${skill.ability.toUpperCase()})</span></span>
          </span>
        </div>
        ${rollControl}
      </div>
    `;
      })
      .join("");
  }

  function findCatalogEntryByName(entries, selectedName) {
    if (!Array.isArray(entries)) return null;
    const normalized = String(selectedName ?? "").trim().toLowerCase();
    if (!normalized) return null;
    return entries.find((entry) => String(entry?.name ?? "").trim().toLowerCase() === normalized) ?? null;
  }

  function normalizeSourceTag(value) {
    return String(value ?? "").trim().toUpperCase();
  }

  function getPreferredSourceOrder(character) {
    const allowedSources = getCharacterAllowedSources(character).map((source) => normalizeSourceTag(source)).filter(Boolean);
    const sourcePreset = String(character?.sourcePreset ?? "").trim();
    const preferred = [...allowedSources];
    const hasPhb = preferred.includes("PHB");
    const hasXphb = preferred.includes("XPHB");
    if (!hasPhb || !hasXphb) return preferred;
    const xphbFirst = sourcePreset === "set2024";
    const ordered = preferred.filter((source) => source !== "PHB" && source !== "XPHB");
    if (xphbFirst) return ["XPHB", "PHB", ...ordered];
    return ["PHB", "XPHB", ...ordered];
  }

  function findCatalogEntryByNameWithSourcePreference(entries, selectedName, preferredSources = []) {
    if (!Array.isArray(entries)) return null;
    const normalized = String(selectedName ?? "").trim().toLowerCase();
    if (!normalized) return null;
    const matches = entries.filter((entry) => String(entry?.name ?? "").trim().toLowerCase() === normalized);
    if (!matches.length) return null;
    if (matches.length === 1) return matches[0];
    const sourceOrder = (Array.isArray(preferredSources) ? preferredSources : [])
      .map((source) => normalizeSourceTag(source))
      .filter(Boolean);
    for (const source of sourceOrder) {
      const match = matches.find((entry) => normalizeSourceTag(entry?.source) === source);
      if (match) return match;
    }
    return matches[0];
  }

  function findCatalogEntryByNameWithSelectedSourcePreference(entries, selectedName, selectedSource = "", preferredSources = []) {
    if (!Array.isArray(entries)) return null;
    const normalized = String(selectedName ?? "").trim().toLowerCase();
    if (!normalized) return null;
    const matches = entries.filter((entry) => String(entry?.name ?? "").trim().toLowerCase() === normalized);
    if (!matches.length) return null;
    if (matches.length === 1) return matches[0];
    const normalizedSource = normalizeSourceTag(selectedSource);
    if (normalizedSource) {
      const selectedMatch = matches.find((entry) => normalizeSourceTag(entry?.source) === normalizedSource);
      if (selectedMatch) return selectedMatch;
    }
    return findCatalogEntryByNameWithSourcePreference(matches, selectedName, preferredSources);
  }

  function getSpeciesTraitRows(raceEntry) {
    if (!raceEntry || typeof raceEntry !== "object") return [];
    const ignoredTraitNames = new Set(["age", "alignment", "size", "language", "languages", "creature type"]);
    const entries = Array.isArray(raceEntry?.entries) ? raceEntry.entries : [];
    return entries
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const name = String(entry?.name ?? "").trim();
        if (!name) return null;
        if (ignoredTraitNames.has(name.toLowerCase())) return null;
        return {
          id: `species:${normalizeSourceTag(raceEntry?.source)}:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          name,
        };
      })
      .filter(Boolean);
  }

  function normalizeAbilityKey(value) {
    const key = String(value ?? "").trim().toLowerCase();
    return saveAbilities.includes(key) ? key : "";
  }

  function normalizeSkillKey(value) {
    const token = String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, "");
    const skillMatch =
      skills.find((skill) => String(skill.key ?? "").toLowerCase().replace(/[^a-z]/g, "") === token)
      ?? skills.find((skill) => String(skill.label ?? "").toLowerCase().replace(/[^a-z]/g, "") === token);
    return skillMatch?.key ?? "";
  }

  function isAbilityScoreImprovementSlot(slot) {
    return /ability score improvement/i.test(String(slot?.slotType ?? ""));
  }

  function getAsiChoiceSourceKey(slotId) {
    return `asi:${String(slotId ?? "").trim()}`;
  }

  function getAutoChoiceSelectionMap(character, sourceKey) {
    const selections = character?.play?.autoChoiceSelections;
    if (!selections || typeof selections !== "object" || Array.isArray(selections)) return {};
    const sourceSelections = selections[sourceKey];
    if (!sourceSelections || typeof sourceSelections !== "object" || Array.isArray(sourceSelections)) return {};
    return sourceSelections;
  }

  function normalizeChoiceToken(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function getSelectedChoiceValues(character, sourceKey, choiceId, from, count) {
    const selectionMap = getAutoChoiceSelectionMap(character, sourceKey);
    const storedRaw = selectionMap[choiceId];
    const fromByToken = new Map(
      from
        .map((entry) => [normalizeChoiceToken(entry), entry])
        .filter(([token, entry]) => token && entry)
    );
    const stored = (Array.isArray(storedRaw) ? storedRaw : [])
      .map((entry) => normalizeChoiceToken(entry))
      .filter((token) => fromByToken.has(token));
    const uniqueStored = stored.filter((token, index) => stored.indexOf(token) === index);
    const normalizedByOrder = from.filter((entry) => uniqueStored.includes(normalizeChoiceToken(entry)));
    if (!normalizedByOrder.length) return from.slice(0, Math.max(0, Math.min(from.length, count)));
    return normalizedByOrder.slice(0, Math.max(0, Math.min(from.length, count)));
  }

  function getStoredChoiceValuesOnly(character, sourceKey, choiceId, from, count, options = {}) {
    const allowDuplicates = Boolean(options?.allowDuplicates);
    const preserveStoredOrder = Boolean(options?.preserveStoredOrder);
    const selectionMap = getAutoChoiceSelectionMap(character, sourceKey);
    const storedRaw = selectionMap[choiceId];
    const fromByToken = new Map(
      from
        .map((entry) => [normalizeChoiceToken(entry), entry])
        .filter(([token, entry]) => token && entry)
    );
    const stored = (Array.isArray(storedRaw) ? storedRaw : [])
      .map((entry) => normalizeChoiceToken(entry))
      .filter((token) => fromByToken.has(token));
    if (allowDuplicates || preserveStoredOrder) {
      if (!stored.length) return from.slice(0, Math.max(0, Math.min(from.length, count)));
      const ordered = stored
        .map((token) => fromByToken.get(token))
        .filter(Boolean);
      if (allowDuplicates) {
        return ordered.slice(0, Math.max(0, count));
      }
      const seen = new Set();
      const uniqueOrdered = ordered.filter((entry) => {
        const token = normalizeChoiceToken(entry);
        if (!token || seen.has(token)) return false;
        seen.add(token);
        return true;
      });
      return uniqueOrdered.slice(0, Math.max(0, count));
    }
    const uniqueStored = stored.filter((token, index) => stored.indexOf(token) === index);
    const normalizedByOrder = from.filter((entry) => uniqueStored.includes(normalizeChoiceToken(entry)));
    if (!normalizedByOrder.length) return from.slice(0, Math.max(0, Math.min(from.length, count)));
    return normalizedByOrder.slice(0, Math.max(0, Math.min(from.length, count)));
  }

  function applyAbilityChoiceBonuses(choice, bonuses, context = {}) {
    if (!choice || typeof choice !== "object") return;
    const weighted = choice.weighted && typeof choice.weighted === "object" ? choice.weighted : null;
    const fromRaw = Array.isArray(weighted?.from) ? weighted.from : Array.isArray(choice.from) ? choice.from : [];
    const from = fromRaw
      .map((entry) => normalizeAbilityKey(entry))
      .filter(Boolean)
      .filter((ability, index, list) => list.indexOf(ability) === index);
    if (!from.length) return;
    const weightValues = Array.isArray(weighted?.weights)
      ? weighted.weights.map((entry) => Math.max(0, toNumber(entry, 0))).filter((entry) => entry > 0)
      : [];
    const fallbackAmount = Math.max(1, toNumber(choice.amount ?? weighted?.amount, 1));
    const count = Math.max(1, Math.min(from.length, toNumber(choice.count ?? weighted?.count, weightValues.length || 1)));
    const choiceId = `a:${context.optionIndex ?? 0}:choose:${context.choiceIndex ?? 0}`;
    const selected = getStoredChoiceValuesOnly(context.character, context.sourceKey, choiceId, from, count, {
      allowDuplicates: false,
      preserveStoredOrder: weightValues.length > 1,
    });
    for (let idx = 0; idx < selected.length; idx += 1) {
      const ability = selected[idx];
      if (!ability) continue;
      const amount = Math.max(1, toNumber(weightValues[idx], fallbackAmount));
      bonuses[ability] = Math.max(0, toNumber(bonuses[ability], 0) + amount);
    }
  }

  function getAbilityBonusesMap(entry, sourceKey, character) {
    const bonuses = saveAbilities.reduce((acc, ability) => {
      acc[ability] = 0;
      return acc;
    }, {});
    const abilityOptions = Array.isArray(entry?.ability) ? entry.ability : [];
    const optionIndex = abilityOptions.findIndex((option) => option && typeof option === "object");
    const selected = optionIndex >= 0 ? abilityOptions[optionIndex] : null;
    if (!selected) return bonuses;
    let abilityChoiceIndex = 0;
    Object.entries(selected).forEach(([key, value]) => {
      const ability = normalizeAbilityKey(key);
      if (ability) {
        bonuses[ability] = Math.max(0, toNumber(bonuses[ability], 0) + Math.max(0, toNumber(value, 0)));
        return;
      }
      if (key !== "choose") return;
      if (Array.isArray(value)) {
        value.forEach((choice) => {
          applyAbilityChoiceBonuses(choice, bonuses, { character, sourceKey, optionIndex, choiceIndex: abilityChoiceIndex });
          abilityChoiceIndex += 1;
        });
      } else if (value && typeof value === "object") {
        applyAbilityChoiceBonuses(value, bonuses, { character, sourceKey, optionIndex, choiceIndex: abilityChoiceIndex });
      }
    });
    return bonuses;
  }

  function getAbilityBonusesSummary(entry, sourceKey, character) {
    const bonuses = getAbilityBonusesMap(entry, sourceKey, character);
    return saveAbilities
      .filter((ability) => toNumber(bonuses[ability], 0) > 0)
      .map((ability) => `${abilityLabels[ability] ?? ability.toUpperCase()} +${toNumber(bonuses[ability], 0)}`)
      .join(", ");
  }

  function getAbilityBonusTotal(map) {
    return saveAbilities.reduce((sum, ability) => sum + Math.max(0, toNumber(map?.[ability], 0)), 0);
  }

  function getSkillProficiencySummary(entry, sourceKey, character) {
    const options = Array.isArray(entry?.skillProficiencies) ? entry.skillProficiencies : [];
    const optionIndex = options.findIndex((option) => option && typeof option === "object");
    const selected = optionIndex >= 0 ? options[optionIndex] : null;
    if (!selected) return "";
    const activeSkills = new Set();
    Object.entries(selected).forEach(([key, value]) => {
      if (key === "choose" || key === "any") return;
      if (value !== true) return;
      const skillKey = normalizeSkillKey(key);
      if (skillKey) activeSkills.add(skillKey);
    });
    const anyCount = Math.max(0, toNumber(selected.any, 0));
    if (anyCount > 0) {
      const available = skills.map((skill) => skill.key).filter((skillKey) => !activeSkills.has(skillKey));
      const selectedAny = getSelectedChoiceValues(character, sourceKey, `s:${optionIndex}:any`, available, anyCount);
      selectedAny.forEach((skillKey) => activeSkills.add(skillKey));
    }
    const choose = selected.choose && typeof selected.choose === "object" ? selected.choose : null;
    if (choose) {
      const from = (Array.isArray(choose.from) ? choose.from : [])
        .map((item) => normalizeSkillKey(item))
        .filter(Boolean)
        .filter((skillKey, index, list) => list.indexOf(skillKey) === index);
      const count = Math.max(1, toNumber(choose.count, 1));
      const available = from.filter((skillKey) => !activeSkills.has(skillKey));
      const selectedChoose = getSelectedChoiceValues(character, sourceKey, `s:${optionIndex}:choose`, available, count);
      selectedChoose.forEach((skillKey) => activeSkills.add(skillKey));
    }
    return skills
      .filter((skill) => activeSkills.has(skill.key))
      .map((skill) => skill.label)
      .join(", ");
  }

  function renderChoiceCheckboxes(sourceKey, choiceId, count, options, selectedValues, labelFn, config = {}) {
    const metaByOption = config?.metaByOption && typeof config.metaByOption === "object" ? config.metaByOption : {};
    const disabledValues = config?.disabledValues instanceof Set ? config.disabledValues : new Set();
    const selectedTokens = new Set((Array.isArray(selectedValues) ? selectedValues : []).map((entry) => normalizeChoiceToken(entry)).filter(Boolean));
    return `
      <div class="auto-choice-group">
        <p class="muted auto-choice-label">Pick ${count}</p>
        <div class="auto-choice-options">
          ${options
            .map((optionValue) => {
              const option = String(optionValue ?? "").trim();
              if (!option) return "";
              const checked = selectedTokens.has(normalizeChoiceToken(option));
              const optionMeta = Array.isArray(metaByOption?.[option]) ? metaByOption[option].filter(Boolean) : [];
              const isDisabled = disabledValues.has(option);
              const metaHtml = optionMeta.length
                ? `<span class="auto-choice-option-meta">${optionMeta.map((label) => `<span class="auto-choice-badge">${esc(label)}</span>`).join("")}</span>`
                : "";
              return `
                <label class="auto-choice-option ${isDisabled ? "is-disabled" : ""}">
                  <input
                    type="checkbox"
                    data-auto-choice-input="1"
                    data-auto-choice-source="${esc(sourceKey)}"
                    data-auto-choice-id="${esc(choiceId)}"
                    data-auto-choice-value="${esc(option)}"
                    data-auto-choice-max="${esc(count)}"
                    ${checked ? "checked" : ""}
                    ${isDisabled ? "disabled" : ""}
                  >
                  <span class="auto-choice-option-label">${esc(labelFn(option))}</span>
                  ${metaHtml}
                </label>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function renderChoiceSelects(sourceKey, choiceId, count, options, selectedValues, labelFn, config = {}) {
    const pointLabels = Array.isArray(config?.pointLabels) ? config.pointLabels : [];
    const allowDuplicates = config?.allowDuplicates !== false;
    return `
      <div class="auto-choice-group">
        <p class="muted auto-choice-label">Spend ${count} points</p>
        <div class="auto-choice-selects ${count <= 2 ? "is-inline" : ""}" data-choice-count="${esc(count)}">
          ${Array.from({ length: count }, (_, index) => {
            const selected = String(selectedValues[index] ?? "").trim();
            const selectedToken = normalizeChoiceToken(selected);
            return `
              <label class="auto-choice-select">
                <span class="muted">${esc(pointLabels[index] ?? `Point ${index + 1}`)}</span>
                <select
                  data-asi-choice-select="1"
                  data-auto-choice-source="${esc(sourceKey)}"
                  data-auto-choice-id="${esc(choiceId)}"
                  data-auto-choice-max="${esc(count)}"
                  data-auto-choice-allow-duplicates="${allowDuplicates ? "true" : "false"}"
                >
                  <option value="">(none)</option>
                  ${options
                    .map((optionValue) => {
                      const option = String(optionValue ?? "").trim();
                      if (!option) return "";
                      const isSelected = normalizeChoiceToken(option) === selectedToken;
                      return `<option value="${esc(option)}" ${isSelected ? "selected" : ""}>${esc(labelFn(option))}</option>`;
                    })
                    .join("")}
                </select>
              </label>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  function normalizeToolTypeCode(value) {
    return String(value ?? "")
      .split("|")[0]
      .trim()
      .toUpperCase();
  }

  function isMundaneToolCatalogItem(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const rarity = String(entry?.rarity ?? "").trim().toLowerCase();
    const hasAttunement = String(entry?.reqAttune ?? "").trim().length > 0;
    const isMundaneRarity = !rarity || rarity === "none" || rarity === "unknown";
    return isMundaneRarity && !hasAttunement;
  }

  function getToolPools(catalogs) {
    const items = Array.isArray(catalogs?.items) ? catalogs.items : [];
    const dedupeByName = (list) =>
      list.filter((entry, index, arr) => arr.findIndex((other) => normalizeChoiceToken(other) === normalizeChoiceToken(entry)) === index);
    const allTools = dedupeByName(
      items
        .filter((entry) => ["AT", "INS", "GS", "T"].includes(normalizeToolTypeCode(entry?.type ?? entry?.itemType)))
        .filter((entry) => isMundaneToolCatalogItem(entry))
        .map((entry) => String(entry?.name ?? "").trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    );
    const artisans = dedupeByName(
      items
        .filter((entry) => normalizeToolTypeCode(entry?.type ?? entry?.itemType) === "AT")
        .filter((entry) => isMundaneToolCatalogItem(entry))
        .map((entry) => String(entry?.name ?? "").trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    );
    const instruments = dedupeByName(
      items
        .filter((entry) => normalizeToolTypeCode(entry?.type ?? entry?.itemType) === "INS")
        .filter((entry) => isMundaneToolCatalogItem(entry))
        .map((entry) => String(entry?.name ?? "").trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    );
    const gamingSets = dedupeByName(
      items
        .filter((entry) => normalizeToolTypeCode(entry?.type ?? entry?.itemType) === "GS")
        .filter((entry) => isMundaneToolCatalogItem(entry))
        .map((entry) => String(entry?.name ?? "").trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    );
    return { allTools, artisans, instruments, gamingSets };
  }

  function normalizeToolCategoryKey(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const compact = raw.replace(/['’]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (compact === "any") return "any";
    if (compact === "anytool") return "anytool";
    if (compact === "anyartisantool" || compact === "anyartisanstool") return "anyartisantool";
    if (compact === "anymusicalinstrument") return "anymusicalinstrument";
    if (compact === "anygamingset") return "anygamingset";
    const words = raw
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/['’]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map((word) => (word.endsWith("s") && word.length > 3 ? word.slice(0, -1) : word));
    if (!words.length) return "";
    if (words.length === 1 && words[0] === "any") return "any";
    if (!words.includes("any")) return words.join("");
    if (words.includes("artisan") && words.includes("tool")) return "anyartisantool";
    if (words.includes("musical") && words.includes("instrument")) return "anymusicalinstrument";
    if (words.includes("gaming") && words.includes("set")) return "anygamingset";
    if (words.includes("tool")) return "anytool";
    return words.join("");
  }

  function getToolPoolForCategoryKey(key, pools) {
    const normalized = normalizeToolCategoryKey(key);
    if (normalized === "any" || normalized === "anytool") return pools.allTools;
    if (normalized === "anyartisantool") return pools.artisans;
    if (normalized === "anymusicalinstrument") return pools.instruments;
    if (normalized === "anygamingset") return pools.gamingSets;
    return [];
  }

  function getToolCategoryTitle(key, count = 1) {
    const normalized = normalizeToolCategoryKey(key);
    const qty = Math.max(1, toNumber(count, 1));
    if (normalized === "any" || normalized === "anytool") return `Any tool${qty > 1 ? "s" : ""}`;
    if (normalized === "anyartisantool") return `Any artisan's tool${qty > 1 ? "s" : ""}`;
    if (normalized === "anymusicalinstrument") return `Any musical instrument${qty > 1 ? "s" : ""}`;
    if (normalized === "anygamingset") return `Any gaming set${qty > 1 ? "s" : ""}`;
    return String(key ?? "").trim();
  }

  function getAutoChoiceSourceLabel(sourceKey) {
    const normalized = String(sourceKey ?? "").trim().toLowerCase();
    if (normalized === "race") return "Race";
    if (normalized === "background") return "Background";
    if (normalized.startsWith("class:")) return "Class";
    if (normalized.startsWith("multiclass:")) return "Multiclass";
    return "Source";
  }

  function formatDefenseTypeLabel(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized) return "";
    const words = normalized.split(/[^a-z0-9]+/).filter(Boolean);
    if (!words.length) return "";
    return words
      .map((word) => (word.length <= 2 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)))
      .join(" ");
  }

  function renderAutoChoiceEditorsForEntity(entry, sourceKey, character, catalogs) {
    const blocks = [];
    const sourceLabel = getAutoChoiceSourceLabel(sourceKey);
    const abilityOptions = Array.isArray(entry?.ability) ? entry.ability : [];
    const abilityOptionIndex = abilityOptions.findIndex((option) => option && typeof option === "object");
    const abilityOption = abilityOptionIndex >= 0 ? abilityOptions[abilityOptionIndex] : null;
    if (abilityOption && abilityOption.choose) {
      const choices = Array.isArray(abilityOption.choose) ? abilityOption.choose : [abilityOption.choose];
      choices.forEach((choice, choiceIndex) => {
        if (!choice || typeof choice !== "object") return;
        const weighted = choice.weighted && typeof choice.weighted === "object" ? choice.weighted : null;
        const fromRaw = Array.isArray(weighted?.from) ? weighted.from : Array.isArray(choice.from) ? choice.from : [];
        const from = fromRaw
          .map((entryValue) => normalizeAbilityKey(entryValue))
          .filter(Boolean)
          .filter((ability, index, list) => list.indexOf(ability) === index);
        if (!from.length) return;
        const weightValues = Array.isArray(weighted?.weights)
          ? weighted.weights.map((entryValue) => Math.max(0, toNumber(entryValue, 0))).filter((entryValue) => entryValue > 0)
          : [];
        const count = Math.max(1, Math.min(from.length, toNumber(choice.count ?? weighted?.count, weightValues.length || 1)));
        const choiceId = `a:${abilityOptionIndex}:choose:${choiceIndex}`;
        const weightedPointLabels = weightValues.length > 1 ? weightValues.map((amount, index) => `Bonus ${signed(amount)} (${index + 1})`) : [];
        if (weightedPointLabels.length) {
          const selected = getStoredChoiceValuesOnly(character, sourceKey, choiceId, from, count, {
            allowDuplicates: false,
            preserveStoredOrder: true,
          });
          blocks.push(`
            <div class="auto-choice-card">
              <p class="muted"><strong>${esc(sourceLabel)} ability choice</strong></p>
              ${renderChoiceSelects(
                sourceKey,
                choiceId,
                count,
                from,
                selected,
                (ability) => abilityLabels[ability] ?? ability.toUpperCase(),
                { pointLabels: weightedPointLabels, allowDuplicates: false }
              )}
            </div>
          `);
        } else {
          const selected = getSelectedChoiceValues(character, sourceKey, choiceId, from, count);
          blocks.push(`
            <div class="auto-choice-card">
              <p class="muted"><strong>${esc(sourceLabel)} ability choice</strong></p>
              ${renderChoiceCheckboxes(sourceKey, choiceId, count, from, selected, (ability) => abilityLabels[ability] ?? ability.toUpperCase())}
            </div>
          `);
        }
      });
    }

    const skillOptions = Array.isArray(entry?.skillProficiencies) ? entry.skillProficiencies : [];
    const skillOptionIndex = skillOptions.findIndex((option) => option && typeof option === "object");
    const skillOption = skillOptionIndex >= 0 ? skillOptions[skillOptionIndex] : null;
    if (skillOption && typeof skillOption === "object") {
      const choose = skillOption.choose && typeof skillOption.choose === "object" ? skillOption.choose : null;
      const anyCount = Math.max(0, toNumber(skillOption.any, 0));
      const fixedSkills = Object.entries(skillOption)
        .filter(([key, value]) => key !== "choose" && key !== "any" && value === true)
        .map(([key]) => normalizeSkillKey(key))
        .filter(Boolean);
      const taken = new Set(fixedSkills);
      if (anyCount > 0) {
        const pool = skills.map((skill) => skill.key).filter((skillKey) => !taken.has(skillKey));
        const choiceId = `s:${skillOptionIndex}:any`;
        const selected = getSelectedChoiceValues(character, sourceKey, choiceId, pool, anyCount);
        selected.forEach((skillKey) => taken.add(skillKey));
        blocks.push(`
          <div class="auto-choice-card">
            <p class="muted"><strong>${esc(sourceLabel)} skill choice</strong></p>
            ${renderChoiceCheckboxes(sourceKey, choiceId, anyCount, pool, selected, (skillKey) => skills.find((skill) => skill.key === skillKey)?.label ?? skillKey)}
          </div>
        `);
      }
      if (choose) {
        const from = (Array.isArray(choose.from) ? choose.from : [])
          .map((entryValue) => normalizeSkillKey(entryValue))
          .filter(Boolean)
          .filter((skillKey, index, list) => list.indexOf(skillKey) === index)
          .filter((skillKey) => !taken.has(skillKey));
        const count = Math.max(1, Math.min(from.length, toNumber(choose.count, 1)));
        if (from.length && count > 0) {
          const choiceId = `s:${skillOptionIndex}:choose`;
          const selected = getSelectedChoiceValues(character, sourceKey, choiceId, from, count);
          blocks.push(`
            <div class="auto-choice-card">
              <p class="muted"><strong>${esc(sourceLabel)} skill choice</strong></p>
              ${renderChoiceCheckboxes(
                sourceKey,
                choiceId,
                count,
                from,
                selected,
                (skillKey) => skills.find((skill) => skill.key === skillKey)?.label ?? skillKey
              )}
            </div>
          `);
        }
      }
    }

    const toolOptions = Array.isArray(entry?.toolProficiencies) ? entry.toolProficiencies : [];
    const toolPools = getToolPools(catalogs);
    toolOptions.forEach((toolOption, optionIndex) => {
      if (!toolOption || typeof toolOption !== "object") return;
      const choose = toolOption.choose && typeof toolOption.choose === "object" ? toolOption.choose : null;
      if (choose) {
        const from = (Array.isArray(choose.from) ? choose.from : [])
          .map((entryValue) => String(entryValue ?? "").trim())
          .filter(Boolean)
          .filter((toolName, index, list) => list.findIndex((entryName) => normalizeChoiceToken(entryName) === normalizeChoiceToken(toolName)) === index);
        const count = Math.max(1, Math.min(from.length, toNumber(choose.count, 1)));
        if (from.length && count > 0) {
          const choiceId = `t:${optionIndex}:choose`;
          const selected = getSelectedChoiceValues(character, sourceKey, choiceId, from, count);
          blocks.push(`
            <div class="auto-choice-card">
              <p class="muted"><strong>${esc(sourceLabel)} tool choice</strong></p>
              ${renderChoiceCheckboxes(sourceKey, choiceId, count, from, selected, (toolName) => toolName)}
            </div>
          `);
        }
      }
      Object.entries(toolOption).forEach(([key, value]) => {
        if (key === "choose") return;
        if (!(Number.isFinite(toNumber(value, NaN)) && toNumber(value, 0) > 0)) return;
        const count = Math.max(1, toNumber(value, 1));
        const pool = getToolPoolForCategoryKey(key, toolPools);
        if (!pool.length) return;
        const choiceId = `t:${optionIndex}:${String(key ?? "").trim().toLowerCase()}`;
        const selected = getSelectedChoiceValues(character, sourceKey, choiceId, pool, count);
        blocks.push(`
          <div class="auto-choice-card">
            <p class="muted"><strong>${esc(sourceLabel)} tool choice</strong> - ${esc(
              getToolCategoryTitle(key, count)
            )}</p>
            ${renderChoiceCheckboxes(sourceKey, choiceId, count, pool, selected, (toolName) => toolName)}
          </div>
        `);
      });
    });

    const defenseChoiceSpecs = [
      { key: "resist", singular: "resistance" },
      { key: "immune", singular: "immunity" },
      { key: "conditionImmune", singular: "condition immunity" },
      { key: "vulnerable", singular: "vulnerability" },
    ];
    defenseChoiceSpecs.forEach((spec) => {
      const defenseEntries = Array.isArray(entry?.[spec.key]) ? entry[spec.key] : [];
      defenseEntries.forEach((defenseEntry, optionIndex) => {
        if (!defenseEntry || typeof defenseEntry !== "object" || Array.isArray(defenseEntry)) return;
        const choose = defenseEntry.choose && typeof defenseEntry.choose === "object" ? defenseEntry.choose : null;
        if (!choose) return;
        const from = (Array.isArray(choose.from) ? choose.from : [])
          .map((entryValue) => formatDefenseTypeLabel(entryValue))
          .filter(Boolean)
          .filter(
            (defenseType, index, list) =>
              list.findIndex((entryName) => normalizeChoiceToken(entryName) === normalizeChoiceToken(defenseType)) === index
          );
        const count = Math.max(1, Math.min(from.length, toNumber(choose.count, 1)));
        if (!from.length || count < 1) return;
        const choiceId = `d:${spec.key}:${optionIndex}:choose`;
        const selected = getSelectedChoiceValues(character, sourceKey, choiceId, from, count);
        blocks.push(`
          <div class="auto-choice-card">
            <p class="muted"><strong>${esc(sourceLabel)} ${esc(spec.singular)} choice</strong></p>
            ${renderChoiceCheckboxes(sourceKey, choiceId, count, from, selected, (defenseType) => defenseType)}
          </div>
        `);
      });
    });

    return blocks.join("");
  }

  function collectEntitySkillSelections(entry, sourceKey, character) {
    const activeSkills = new Set();
    if (!entry || typeof entry !== "object") return activeSkills;
    const skillOptions = Array.isArray(entry?.skillProficiencies) ? entry.skillProficiencies : [];
    const skillOptionIndex = skillOptions.findIndex((option) => option && typeof option === "object");
    const skillOption = skillOptionIndex >= 0 ? skillOptions[skillOptionIndex] : null;
    if (!skillOption) return activeSkills;
    Object.entries(skillOption).forEach(([key, value]) => {
      if (key === "choose" || key === "any") return;
      if (value !== true) return;
      const skillKey = normalizeSkillKey(key);
      if (skillKey) activeSkills.add(skillKey);
    });
    const anyCount = Math.max(0, toNumber(skillOption.any, 0));
    if (anyCount > 0) {
      const pool = skills.map((skill) => skill.key).filter((skillKey) => !activeSkills.has(skillKey));
      const selected = getSelectedChoiceValues(character, sourceKey, `s:${skillOptionIndex}:any`, pool, anyCount);
      selected.forEach((skillKey) => activeSkills.add(skillKey));
    }
    const choose = skillOption?.choose && typeof skillOption.choose === "object" ? skillOption.choose : null;
    if (choose) {
      const from = (Array.isArray(choose.from) ? choose.from : [])
        .map((entryValue) => normalizeSkillKey(entryValue))
        .filter(Boolean)
        .filter((skillKey, index, list) => list.indexOf(skillKey) === index);
      const count = Math.max(1, toNumber(choose.count, 1));
      const available = from.filter((skillKey) => !activeSkills.has(skillKey));
      const selected = getSelectedChoiceValues(character, sourceKey, `s:${skillOptionIndex}:choose`, available, count);
      selected.forEach((skillKey) => activeSkills.add(skillKey));
    }
    return activeSkills;
  }

  function getAutoGrantedSkillSourceMap(catalogs, character) {
    const map = {};
    const addSkillSource = (skillKey, label) => {
      if (!skillKey || !label) return;
      const current = Array.isArray(map[skillKey]) ? map[skillKey] : [];
      if (!current.includes(label)) current.push(label);
      map[skillKey] = current;
    };
    const sourceOrder = getPreferredSourceOrder(character);
    const raceEntry = getEffectiveRaceEntry(catalogs, character, sourceOrder);
    const backgroundEntry = findCatalogEntryByNameWithSelectedSourcePreference(
      catalogs?.backgrounds,
      character?.background,
      character?.backgroundSource,
      sourceOrder
    );
    collectEntitySkillSelections(raceEntry, "race", character).forEach((skillKey) => addSkillSource(skillKey, "Race"));
    collectEntitySkillSelections(backgroundEntry, "background", character).forEach((skillKey) => addSkillSource(skillKey, "Background"));
    return map;
  }

  function renderClassSkillChoiceEditors(classEntry, character, catalogs) {
    if (!classEntry || typeof classEntry !== "object") return "";
    const skillEntries = Array.isArray(classEntry?.startingProficiencies?.skills) ? classEntry.startingProficiencies.skills : [];
    const classSourceKey = `class:${String(classEntry?.name ?? "").trim().toLowerCase() || "primary"}`;
    const autoSourceMap = getAutoGrantedSkillSourceMap(catalogs, character);
    const blocks = [];
    skillEntries.forEach((entry, optionIndex) => {
      const choose = entry && typeof entry === "object" ? entry.choose : null;
      if (!choose || typeof choose !== "object") return;
      const from = (Array.isArray(choose.from) ? choose.from : [])
        .map((value) => normalizeSkillKey(value))
        .filter(Boolean)
        .filter((skillKey, index, list) => list.indexOf(skillKey) === index);
      if (!from.length) return;
      const blocked = new Set(from.filter((skillKey) => Array.isArray(autoSourceMap?.[skillKey]) && autoSourceMap[skillKey].length));
      const selectable = from.filter((skillKey) => !blocked.has(skillKey));
      const count = Math.max(0, Math.min(selectable.length, toNumber(choose.count, 1)));
      const choiceId = `cs:${optionIndex}:choose`;
      const selected = count > 0 ? getSelectedChoiceValues(character, classSourceKey, choiceId, selectable, count) : [];
      const helperText = blocked.size
        ? `<p class="muted auto-choice-help">Unavailable: already granted by ${[...new Set([...blocked].flatMap((skillKey) => autoSourceMap[skillKey] ?? []))]
            .join(" / ")
            .toLowerCase()}.</p>`
        : "";
      blocks.push(`
        <div class="auto-choice-card">
          <p class="muted"><strong>Class skill choice</strong></p>
          ${helperText}
          ${renderChoiceCheckboxes(
            classSourceKey,
            choiceId,
            count,
            from,
            selected,
            (skillKey) => skills.find((skill) => skill.key === skillKey)?.label ?? skillKey,
            { metaByOption: autoSourceMap, disabledValues: blocked }
          )}
        </div>
      `);
    });
    return blocks.join("");
  }

  function normalizeInventoryEntry(entry, index) {
    if (typeof entry === "string") {
      return {
        id: "",
        index,
        name: entry,
        equipped: false,
        isLegacy: true,
      };
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const name = String(entry.name ?? "").trim();
    if (!name) return null;
    return {
      id: String(entry.id ?? "").trim(),
      index,
      name,
      equipped: Boolean(entry.equipped),
      isLegacy: false,
    };
  }

  function renderInventoryRowsImpl(character) {
    const entries = (Array.isArray(character?.inventory) ? character.inventory : [])
      .map((entry, index) => normalizeInventoryEntry(entry, index))
      .filter(Boolean);
    if (!entries.length) return "<span class='muted'>No items selected.</span>";
    return entries
      .map((entry) => {
        return `
        <div class="inventory-row">
          <div class="inventory-row-main">
            <span class="inventory-item-name">${esc(entry.name)}</span>
          </div>
          <div class="inventory-row-actions">
            ${
              entry.isLegacy
                ? `<button type="button" class="btn secondary" disabled title="Legacy entries do not support equip state">Legacy</button>`
                : `<button type="button" class="btn secondary" data-toggle-item-equipped="${esc(entry.id)}">${entry.equipped ? "Unequip" : "Equip"}</button>`
            }
            <button type="button" class="btn secondary" data-remove-item-index="${esc(entry.index)}">Remove</button>
          </div>
        </div>
      `;
      })
      .join("");
  }

  function renderBuildSpellSlotRowImpl(play, defaults, level) {
    const { max, used, isOverridden } = getSpellSlotValues(play, defaults, level);
    const defaultMax = Math.max(0, toNumber(defaults?.[String(level)], 0));
    return `
    <div class="spell-slot-card">
      <div class="spell-slot-top">
        <span class="spell-slot-level">Level ${level}</span>
        <span class="spell-slot-used">Default ${defaultMax}</span>
      </div>
      <div class="spell-slot-controls">
        <label class="spell-slot-max">Max
          <input id="build-slot-max-${level}" type="number" min="0" max="9" data-build-slot-max="${level}" value="${esc(max)}">
        </label>
        <div class="spell-slot-actions">
          <button type="button" class="spell-slot-btn spell-slot-btn-reset" data-build-slot-default="${level}" ${isOverridden ? "" : "disabled"} aria-label="Reset level ${level} slots to class defaults">Default</button>
          <span class="muted">Used ${used}/${max}</span>
        </div>
      </div>
    </div>
  `;
  }

  function renderBuildSpellListImpl(state) {
    const { character, catalogs } = state;
    const play = character?.play ?? {};
    const usesPreparedSpells = doesClassUsePreparedSpells(catalogs, character);
    const canTogglePreparedVisibility = false;
    const levelVisibilityMap =
      play?.showAllPreparedCasterSpellsByLevel && typeof play.showAllPreparedCasterSpellsByLevel === "object" && !Array.isArray(play.showAllPreparedCasterSpellsByLevel)
        ? play.showAllPreparedCasterSpellsByLevel
        : {};
    const getShowAllForLevel = (level) => {
      if (!canTogglePreparedVisibility) return true;
      const key = String(level);
      const levelValue = levelVisibilityMap[key];
      if (typeof levelValue === "boolean") return levelValue;
      return false;
    };
    const selectedSpells = Array.isArray(character?.spells) ? character.spells : [];
    if (!selectedSpells.length) return "<span class='muted'>No spells selected.</span>";

    const spellByName = new Map((catalogs?.spells ?? []).map((spell) => [spell.name, spell]));
    const groupedByLevel = new Map();

    selectedSpells.forEach((spellName) => {
      const spell = spellByName.get(spellName);
      const level = spell ? Math.max(0, toNumber(spell.level, 0)) : 99;
      const isCantrip = level === 0;
      const alwaysPrepared = usesPreparedSpells ? isSpellAlwaysPrepared(state, spellName, play) : false;
      const isPrepared = usesPreparedSpells ? (isCantrip ? true : alwaysPrepared || Boolean(play.preparedSpells?.[spellName])) : true;
      const list = groupedByLevel.get(level) ?? [];
      list.push({ name: spellName, isPrepared });
      groupedByLevel.set(level, list);
    });

    if (!groupedByLevel.size) return "<span class='muted'>No spells selected.</span>";

    return [...groupedByLevel.entries()]
      .sort(([a], [b]) => a - b)
      .map(([level, rows]) => {
        const levelLabel = level === 99 ? "Unknown Level" : getSpellLevelLabel(level);
        const showAllPreparedCasterSpells = getShowAllForLevel(level);
        const showPreparedOnly = canTogglePreparedVisibility && !showAllPreparedCasterSpells;
        const visibleRows = showPreparedOnly ? rows.filter((row) => row.isPrepared) : rows;
        const levelToggleHtml = canTogglePreparedVisibility
          ? `
          <div class="spell-visibility-toggle" role="group" aria-label="Spell list visibility for ${esc(levelLabel)}">
            <button
              type="button"
              class="spell-visibility-btn ${showAllPreparedCasterSpells ? "" : "is-active"}"
              data-spell-list-visibility="prepared"
              data-spell-list-level="${esc(level)}"
              aria-pressed="${showAllPreparedCasterSpells ? "false" : "true"}"
            >
              Prepared
            </button>
            <button
              type="button"
              class="spell-visibility-btn ${showAllPreparedCasterSpells ? "is-active" : ""}"
              data-spell-list-visibility="all"
              data-spell-list-level="${esc(level)}"
              aria-pressed="${showAllPreparedCasterSpells ? "true" : "false"}"
            >
              All Spells
            </button>
          </div>
        `
          : "";
        const sortedNames = visibleRows.map((row) => row.name).sort((a, b) => a.localeCompare(b));
        const hasVisibleSpells = sortedNames.length > 0;
        const emptyInlineNote = hasVisibleSpells
          ? ""
          : "<span class='spell-level-empty-note muted'>No prepared spells at this level.</span>";
        const bodyHtml = hasVisibleSpells
          ? sortedNames
              .map(
                (name) =>
                  `<button type="button" class="pill pill-btn build-spell-pill-btn" data-build-spell-open="${esc(name)}" title="View spell details">${esc(name)}</button>`
              )
              .join("")
          : "";
        return `
        <section class="build-spell-level-card">
          <div class="build-spell-level-head">
            <h5 class="build-spell-level-title">${esc(levelLabel)}</h5>
            ${emptyInlineNote}
            <span class="pill build-spell-count">${sortedNames.length}</span>
            ${levelToggleHtml}
          </div>
          ${hasVisibleSpells ? `<div class="build-spell-chip-row">${bodyHtml}</div>` : ""}
        </section>
      `;
      })
      .join("");
  }

  function renderSpellGroupsByLevelImpl(state) {
    const isSpellRitualCast = (spell) => {
      if (!spell || typeof spell !== "object") return false;
      if (spell.ritual === true) return true;
      const ritualMeta = spell.meta?.ritual;
      if (ritualMeta === true) return true;
      if (typeof ritualMeta === "string" && ritualMeta.trim().toLowerCase() === "true") return true;
      return false;
    };

    const play = state.character.play ?? {};
    const defaultSpellSlots = getCharacterSpellSlotDefaults(state.catalogs, state.character);
    const usesPreparedSpells = doesClassUsePreparedSpells(state.catalogs, state.character);
    const canTogglePreparedVisibility = usesPreparedSpells;
    const levelVisibilityMap =
      play?.showAllPreparedCasterSpellsByLevel && typeof play.showAllPreparedCasterSpellsByLevel === "object" && !Array.isArray(play.showAllPreparedCasterSpellsByLevel)
        ? play.showAllPreparedCasterSpellsByLevel
        : {};
    const getShowAllForLevel = (level) => {
      if (!canTogglePreparedVisibility) return true;
      const key = String(level);
      const levelValue = levelVisibilityMap[key];
      if (typeof levelValue === "boolean") return levelValue;
      return false;
    };
    const preparedLimit = usesPreparedSpells ? getPreparedSpellLimit(state) : Infinity;
    const preparedCount = usesPreparedSpells ? countPreparedSpells(state) : 0;
    const grouped = new Map();

    (state.character.spells ?? []).forEach((spellEntry) => {
      const name = String(spellEntry ?? "").trim();
      if (!name) return;
      const spell = getSpellByName(state, name);
      const level = spell ? toNumber(spell.level, 0) : 99;
      const isCantrip = level === 0;
      const existing = play.preparedSpells?.[name];
      const alwaysPrepared = usesPreparedSpells ? isSpellAlwaysPrepared(state, name, play) : false;
      const isPrepared = usesPreparedSpells ? (isCantrip ? true : alwaysPrepared || Boolean(existing)) : true;
      const slotInfo = level > 0 ? getSpellSlotValues(play, defaultSpellSlots, level) : { max: Infinity, used: 0 };
      const hasSlotsAvailable = level === 0 || toNumber(slotInfo.max, 0) - toNumber(slotInfo.used, 0) > 0;
      const stateClass = !isPrepared ? "is-unprepared" : hasSlotsAvailable ? "is-prepared-available" : "is-prepared-unavailable";
      const canTogglePrepared = !isCantrip && !alwaysPrepared && (isPrepared || preparedCount < preparedLimit);
      const row = { name, spell, level, isPrepared, canTogglePrepared, isCantrip, alwaysPrepared };
      const list = grouped.get(level) ?? [];
      list.push({ ...row, stateClass, hasSlotsAvailable });
      grouped.set(level, list);
    });

    if (!grouped.size) return "<span class='muted'>No spells selected.</span>";

    return [...grouped.entries()]
      .sort(([a], [b]) => a - b)
      .map(([level, rows]) => {
        const title = level === 99 ? "Unknown Level" : getSpellLevelLabel(level);
        const showAllPreparedCasterSpells = getShowAllForLevel(level);
        const showPreparedOnly = canTogglePreparedVisibility && !showAllPreparedCasterSpells;
        const levelToggleHtml = canTogglePreparedVisibility
          ? `
          <div class="spell-visibility-toggle" role="group" aria-label="Spell list visibility for ${esc(title)}">
            <button
              type="button"
              class="spell-visibility-btn ${showAllPreparedCasterSpells ? "" : "is-active"}"
              data-spell-list-visibility="prepared"
              data-spell-list-level="${esc(level)}"
              aria-pressed="${showAllPreparedCasterSpells ? "false" : "true"}"
            >
              Prepared
            </button>
            <button
              type="button"
              class="spell-visibility-btn ${showAllPreparedCasterSpells ? "is-active" : ""}"
              data-spell-list-visibility="all"
              data-spell-list-level="${esc(level)}"
              aria-pressed="${showAllPreparedCasterSpells ? "true" : "false"}"
            >
              All Spells
            </button>
          </div>
        `
          : "";
        const visibleRows = showPreparedOnly ? rows.filter((row) => row.isPrepared) : rows;
        const body = visibleRows
          .sort((a, b) => String(a?.name ?? "").localeCompare(String(b?.name ?? "")))
          .map(({ name, spell, isPrepared, stateClass, hasSlotsAvailable, canTogglePrepared, isCantrip, alwaysPrepared }) => {
            const spellCombat = getSpellCombatContext(state, spell);
            const school = spell?.school ? spellSchoolLabels[spell.school] ?? spell.school : "";
            const source = spell?.sourceLabel ?? spell?.source ?? "";
            const saveMeta =
              !spellCombat.hasSpellAttack && spellCombat.saveDc != null && spellCombat.saveText
                ? `DC ${spellCombat.saveDc} ${spellCombat.saveText}`
                : "";
            const meta = [school, source, saveMeta].filter(Boolean).join(" - ");
            const knownTag = usesPreparedSpells
              ? alwaysPrepared
                ? "Always Prepared"
                : isPrepared
                  ? "Prepared"
                  : "Unprepared"
              : "Known";
            const slotTag = toNumber(spell?.level, 0) > 0 && isPrepared ? (hasSlotsAvailable ? "Slots Available" : "No Slots Left") : "";
            const knownAndSlotTag = slotTag ? `${knownTag} · ${slotTag}` : knownTag;
            const prepButtonTitle = isCantrip
              ? "Cantrips are always prepared"
              : alwaysPrepared
                ? "Automatically prepared from class feature"
              : !isPrepared && !canTogglePrepared
                ? "Preparation limit reached"
                : "Toggle prepared";
            const castDisabled = usesPreparedSpells && toNumber(spell?.level, 0) > 0 && !isPrepared;
            const spellDamageNotation = extractSimpleNotation(getSpellPrimaryDiceNotation(spell));
            const spellAttackButtonHtml =
              spellCombat.hasSpellAttack && spellCombat.attackBonus != null
                ? `<button type="button" class="btn secondary spell-cast-btn" data-spell-attack-roll="${esc(name)}" ${castDisabled ? "disabled" : ""}>To Hit ${esc(
                    signed(spellCombat.attackBonus)
                  )}</button>`
                : "";
            const castLabel = spellCombat.hasSpellAttack
              ? spellDamageNotation
                ? `Damage ${spellDamageNotation}`
                : "Cast"
              : "Cast";
            const ritualBadgeHtml = isSpellRitualCast(spell)
              ? '<span class="spell-ritual-pill" title="Can be cast as a ritual">R</span>'
              : "";
            return `
            <div class="spell-row ${stateClass}">
              ${
                usesPreparedSpells
                  ? `
                <button
                  type="button"
                  class="spell-prep-btn ${isPrepared ? "is-active" : ""}"
                  data-spell-prepared-btn="${esc(name)}"
                  aria-pressed="${isPrepared ? "true" : "false"}"
                  title="${prepButtonTitle}"
                  ${!canTogglePrepared ? "disabled" : ""}
                >
                  ${isPrepared ? "P" : "-"}
                </button>
              `
                  : '<span class="spell-prep-static">K</span>'
              }
              <button type="button" class="spell-name-btn" data-spell-open="${esc(name)}">${esc(name)}</button>
              <span class="spell-known-tag muted">${knownAndSlotTag}</span>
              <span class="spell-meta muted">${esc(meta || "")}</span>
              <div class="spell-action-group">
                ${spellAttackButtonHtml}
                ${ritualBadgeHtml}
                <button type="button" class="btn secondary spell-cast-btn" data-spell-cast="${esc(name)}" ${castDisabled ? "disabled" : ""}>${castLabel}</button>
              </div>
            </div>
          `;
          })
          .join("");
        const hasVisibleSpells = body.length > 0;
        const emptyInlineNote = hasVisibleSpells
          ? ""
          : "<span class='spell-level-empty-note muted'>No prepared spells at this level.</span>";
        return `
        <section class="spell-level-group">
          <div class="spell-level-head">
            <h5 class="spell-level-title">${esc(title)}</h5>
            ${emptyInlineNote}
            ${levelToggleHtml}
          </div>
          ${hasVisibleSpells ? `<div class="spell-level-list">${body}</div>` : ""}
        </section>
      `;
      })
      .join("");
  }

  function resolveFeatureModeSelections(mode, play) {
    const options = Array.isArray(mode?.optionValues) ? mode.optionValues : [];
    if (!options.length) return [];
    const maxCount = Math.max(1, Math.min(options.length, Math.floor(toNumber(mode?.count, 1))));
    const raw = play?.featureModes?.[mode.id];
    const currentValues = Array.isArray(raw)
      ? raw.map((entry) => String(entry ?? "").trim())
      : [String(raw ?? "").trim()];
    const selected = [...new Set(currentValues.filter((value) => value && options.includes(value)))];
    while (selected.length < maxCount) {
      const nextOption = options.find((option) => !selected.includes(option));
      if (!nextOption) break;
      selected.push(nextOption);
    }
    if (!selected.length) selected.push(options[0]);
    return maxCount <= 1 ? [selected[0]] : selected.slice(0, maxCount);
  }

  function isFeatureModeHandledByOptionalFeatures(mode, optionalFeatureSlots, selectedOptionalFeatures) {
    const normalize = (value) =>
      String(value ?? "")
        .toLowerCase()
        .replace(/\([^)]*\)/g, " ")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const modeName = normalize(mode?.featureName);
    if (!modeName) return false;
    const slotTypes = [
      ...(Array.isArray(optionalFeatureSlots) ? optionalFeatureSlots : []).map((slot) => slot?.slotType),
      ...(Array.isArray(selectedOptionalFeatures) ? selectedOptionalFeatures : []).map((feature) => feature?.slotType),
    ]
      .map((value) => normalize(value))
      .filter(Boolean);
    return slotTypes.some((slotType) => slotType.includes(modeName) || modeName.includes(slotType));
  }

  function renderPlayViewImpl(state) {
    const { character, derived } = state;
    const play = character.play ?? {};
    const classTableEffects = Array.isArray(character?.progression?.classTableEffects) ? character.progression.classTableEffects : [];
    const defaultSpellSlots = getCharacterSpellSlotDefaults(state.catalogs, character);
    const hpTotal = derived.hp;
    const hpCurrent = play.hpCurrent == null ? hpTotal : play.hpCurrent;
    const hpTemp = toNumber(play.hpTemp, 0);
    const initiativeBonus = toNumber(derived?.mods?.dex, 0);
    const raceSourceOrder = getPreferredSourceOrder(character);
    const raceEntry = getEffectiveRaceEntry(state.catalogs, character, raceSourceOrder);
    const speedRaw = raceEntry?.speed;
    const baseSpeed =
      Number.isFinite(toNumber(speedRaw, Number.NaN))
        ? Math.max(0, Math.floor(toNumber(speedRaw, 30)))
        : speedRaw && typeof speedRaw === "object" && !Array.isArray(speedRaw) && Number.isFinite(toNumber(speedRaw.walk, Number.NaN))
          ? Math.max(0, Math.floor(toNumber(speedRaw.walk, 30)))
          : 30;
    const classTableSpeedBonus = classTableEffects.reduce((sum, effect) => {
      const label = String(effect?.label ?? "").trim().toLowerCase();
      if (!label || (!label.includes("movement") && !label.includes("speed"))) return sum;
      const delta = toNumber(String(effect?.value ?? "").match(/[+\-]?\d+/)?.[0], Number.NaN);
      if (!Number.isFinite(delta)) return sum;
      return sum + delta;
    }, 0);
    const speed = Math.max(0, baseSpeed + classTableSpeedBonus);
    const normalizeConditionName = (value) => String(value ?? "").trim().toLowerCase();
    const catalogConditionsRaw = Array.isArray(state.catalogs?.conditions) ? state.catalogs.conditions : [];
    const catalogConditionEntries = catalogConditionsRaw
      .filter((entry) => entry && typeof entry === "object")
      .filter((entry) => String(entry?.name ?? "").trim())
      .sort((a, b) => String(a?.name ?? "").localeCompare(String(b?.name ?? "")));
    const catalogConditionNames = [...new Set(catalogConditionEntries.map((entry) => String(entry.name).trim()))];
    const activeConditions = Array.isArray(play.conditions)
      ? play.conditions.map((entry) => String(entry ?? "").trim()).filter(Boolean)
      : [];
    const activeConditionSet = new Set(activeConditions.map((entry) => normalizeConditionName(entry)).filter(Boolean));
    const knownConditionSet = new Set(catalogConditionNames.map((entry) => normalizeConditionName(entry)).filter(Boolean));
    const activeKnownCount = catalogConditionNames.filter((entry) => activeConditionSet.has(normalizeConditionName(entry))).length;
    const conditionButtonsHtml = catalogConditionEntries.length
      ? catalogConditionEntries
          .map((entry) => {
            const conditionName = String(entry?.name ?? "").trim();
            if (!conditionName) return "";
            const normalized = normalizeConditionName(conditionName);
            const isActive = activeConditionSet.has(normalized);
            const summaryLines = getRuleDescriptionLines(entry).filter(Boolean);
            const summary = String(summaryLines[0] ?? "").trim();
            const title = summary || `Toggle ${conditionName}`;
            return `
              <button
                type="button"
                class="condition-pill-btn ${isActive ? "is-active" : ""}"
                data-toggle-condition-name="${esc(conditionName)}"
                aria-pressed="${isActive ? "true" : "false"}"
                title="${esc(title)}"
              >
                <span class="condition-pill-label">${esc(conditionName)}</span>
              </button>
            `;
          })
          .join("")
      : "<p class='muted'>Conditions data unavailable. You can still track conditions from saved characters.</p>";
    const extraConditions = activeConditions.filter((entry) => !knownConditionSet.has(normalizeConditionName(entry)));
    const extraConditionsHtml = extraConditions.length
      ? `
        <div class="condition-extra-list">
          ${extraConditions
            .map(
              (condition) => `
                <button type="button" class="condition-extra-chip" data-remove-condition-name="${esc(condition)}" title="Remove ${esc(condition)}">
                  ${esc(condition)} <span aria-hidden="true">x</span>
                </button>
              `
            )
            .join("")}
        </div>
      `
      : "";

    const savesHtml = renderSaveRowsImpl(state, { canToggle: false, includeRollButtons: true });
    const skillsHtml = renderSkillRowsImpl(state, { canToggle: false, includeRollButtons: true });
    const traitSummary = getCharacterToolAndDefenseSummary(state.catalogs, character);
    const renderTraitChip = (entry) =>
      `<span class="play-trait-chip">${esc(entry.label)}${
        entry.sources?.length ? `<span class="play-trait-chip-meta">${esc(entry.sources.join(" / "))}</span>` : ""
      }</span>`;
    const renderTraitGroup = (title, entries) => {
      if (!entries.length) return "";
      return `
        <div class="play-trait-group">
          <h4>${esc(title)}</h4>
          <div class="play-trait-chip-list">${entries.map((entry) => renderTraitChip(entry)).join("")}</div>
        </div>
      `;
    };
    const traitSectionHtml = [
      renderTraitGroup("Tool Proficiencies", traitSummary.tools),
      renderTraitGroup("Resistances", traitSummary.resistances),
      renderTraitGroup("Immunities", traitSummary.immunities),
      renderTraitGroup("Condition Immunities", traitSummary.conditionImmunities),
      renderTraitGroup("Vulnerabilities", traitSummary.vulnerabilities),
    ]
      .filter(Boolean)
      .join("");

    const attackMode = play.attackMode === "edit" ? "edit" : "view";
    const autoAttacksRaw = getAutoAttacks?.(state);
    const autoAttacks = Array.isArray(autoAttacksRaw) ? autoAttacksRaw : [];
    const manualAttacks = Array.isArray(play.attacks) ? play.attacks : [];
    const attacksHtml = [...autoAttacks, ...manualAttacks]
      .map((attack, idx) => {
        const isAutoAttack = attack?.source === "auto" || attack?.source === "auto-feature";
        const attackName = attack.name?.trim() || `Attack ${idx + 1}`;
        if (attackMode === "edit") {
          if (isAutoAttack) {
            const autoSourceDetail =
              attack?.source === "auto-feature"
                ? `Auto from class feature (${String(attack.autoSourceLabel ?? "feature")}).`
                : `Auto from equipped weapon (${String(attack.ability ?? "").toUpperCase()}${attack.proficient ? ", proficient" : ", not proficient"}).`;
            return `
          <div class="attack-card attack-card-view">
            <div class="attack-row-top">
              <span class="attack-title-inline">
                <strong class="attack-title">${esc(attackName)}</strong>
                ${attack.proficient ? '<span class="attack-prof-pill" title="Proficient">P</span>' : ""}
              </span>
            </div>
            <p class="attack-help muted">${esc(autoSourceDetail)}</p>
            <div class="attack-row-stats attack-row-stats-view">
              <button
                type="button"
                class="pill pill-btn attack-pill"
                data-auto-attack-roll="${esc(idx)}:toHit"
                data-auto-attack-name="${esc(attackName)}"
                data-auto-attack-to-hit="${esc(attack.toHit || "")}"
                data-auto-attack-damage="${esc(attack.damage || "")}"
                aria-label="Roll ${esc(attackName)} to hit"
              >
                To Hit: ${esc(attack.toHit || "-")}
              </button>
              <button
                type="button"
                class="pill pill-btn attack-pill"
                data-auto-attack-roll="${esc(idx)}:damage"
                data-auto-attack-name="${esc(attackName)}"
                data-auto-attack-to-hit="${esc(attack.toHit || "")}"
                data-auto-attack-damage="${esc(attack.damage || "")}"
                aria-label="Roll ${esc(attackName)} damage"
              >
                Damage: ${esc(attack.damage || "-")}
              </button>
            </div>
          </div>
        `;
          }
          const manualIdx = idx - autoAttacks.length;
          return `
          <div class="attack-card">
            <div class="attack-row-top">
              <input
                id="attack-name-${manualIdx}"
                placeholder="Attack (e.g. Longsword)"
                value="${esc(attack.name ?? "")}"
                data-attack-field="${manualIdx}:name"
              >
              <div class="attack-row-actions">
                <button type="button" class="btn secondary" data-remove-attack="${manualIdx}">Remove</button>
              </div>
            </div>
            <div class="attack-row-stats">
              <input
                id="attack-hit-${manualIdx}"
                placeholder="To hit bonus (e.g. +5)"
                value="${esc(attack.toHit ?? "")}"
                data-attack-field="${manualIdx}:toHit"
              >
              <input
                id="attack-dmg-${manualIdx}"
                placeholder="Damage roll (e.g. 1d8+3)"
                value="${esc(attack.damage ?? "")}"
                data-attack-field="${manualIdx}:damage"
              >
            </div>
          </div>
        `;
        }

        return `
        <div class="attack-card attack-card-view">
          <div class="attack-row-top">
            <span class="attack-title-inline">
              <strong class="attack-title">${esc(attackName)}</strong>
              ${attack.proficient ? '<span class="attack-prof-pill" title="Proficient">P</span>' : ""}
            </span>
          </div>
          <div class="attack-row-stats attack-row-stats-view">
            <button
              type="button"
              class="pill pill-btn attack-pill"
              ${isAutoAttack ? `data-auto-attack-roll="${esc(idx)}:toHit"` : `data-attack-roll="${esc(idx - autoAttacks.length)}:toHit"`}
              ${isAutoAttack ? `data-auto-attack-name="${esc(attackName)}" data-auto-attack-to-hit="${esc(attack.toHit || "")}" data-auto-attack-damage="${esc(attack.damage || "")}"` : ""}
              aria-label="Roll ${esc(attackName)} to hit"
            >
              To Hit: ${esc(attack.toHit || "-")}
            </button>
            <button
              type="button"
              class="pill pill-btn attack-pill"
              ${isAutoAttack ? `data-auto-attack-roll="${esc(idx)}:damage"` : `data-attack-roll="${esc(idx - autoAttacks.length)}:damage"`}
              ${isAutoAttack ? `data-auto-attack-name="${esc(attackName)}" data-auto-attack-to-hit="${esc(attack.toHit || "")}" data-auto-attack-damage="${esc(attack.damage || "")}"` : ""}
              aria-label="Roll ${esc(attackName)} damage"
            >
              Damage: ${esc(attack.damage || "-")}
            </button>
          </div>
        </div>
      `;
      })
      .join("");

    const unlockedFeatures = Array.isArray(character?.progression?.unlockedFeatures) ? character.progression.unlockedFeatures : [];
    const featSlots = Array.isArray(character?.progression?.featSlots) ? character.progression.featSlots : [];
    const selectedFeats = Array.isArray(character?.feats) ? character.feats : [];
    const selectedOptionalFeatures = Array.isArray(character?.optionalFeatures) ? character.optionalFeatures : [];
    const optionalFeatureSlots = Array.isArray(character?.progression?.optionalFeatureSlots) ? character.progression.optionalFeatureSlots : [];
    const featureModesRaw = Array.isArray(character?.progression?.featureModes) ? character.progression.featureModes : [];
    const featureModes = featureModesRaw.filter(
      (mode) => !isFeatureModeHandledByOptionalFeatures(mode, optionalFeatureSlots, selectedOptionalFeatures)
    );
    const speciesTraits = getSpeciesTraitRows(raceEntry);
    const attacksPerAttackActionFromFeatures = unlockedFeatures.reduce((maxAttacks, feature) => {
      const featureName = String(feature?.name ?? "").trim();
      if (!featureName || !featureName.toLowerCase().startsWith("extra attack")) return maxAttacks;
      const extraAttackCount = toNumber(featureName.match(/\((\d+)\)/)?.[1], NaN);
      const attacksFromFeature = Number.isFinite(extraAttackCount) && extraAttackCount >= 1 ? extraAttackCount + 1 : 2;
      return Math.max(maxAttacks, attacksFromFeature);
    }, 1);
    const attacksPerAttackActionFromTable = classTableEffects.reduce((maxAttacks, effect) => {
      const label = String(effect?.label ?? "").trim().toLowerCase();
      if (!label || !label.includes("attack")) return maxAttacks;
      const numericValue = toNumber(String(effect?.value ?? "").match(/\d+/)?.[0], NaN);
      if (!Number.isFinite(numericValue) || numericValue <= 0) return maxAttacks;
      return Math.max(maxAttacks, numericValue);
    }, 1);
    const attacksPerAttackAction = Math.max(1, attacksPerAttackActionFromFeatures, attacksPerAttackActionFromTable);
    const selectedFeatSlotIds = new Set(
      selectedFeats
        .map((feat) => String(feat?.slotId ?? "").trim())
        .filter(Boolean)
    );
    const selectedAsiSlotKeys = new Set(
      featSlots
        .filter((slot) => isAbilityScoreImprovementSlot(slot) && selectedFeatSlotIds.has(String(slot?.id ?? "").trim()))
        .map((slot) => `${String(slot?.className ?? "").trim().toLowerCase()}|${toNumber(slot?.level, 0)}`)
    );
    const featureUses =
      play.featureUses && typeof play.featureUses === "object" && !Array.isArray(play.featureUses) ? play.featureUses : {};
    const formatRecharge = (recharge) => {
      const key = String(recharge ?? "").trim();
      if (key === "shortOrLong") return "SR/LR";
      if (key === "short") return "SR";
      if (key === "long") return "LR";
      if (key === "day") return "Day";
      return "";
    };
    const featureListHtml = unlockedFeatures.length
      ? unlockedFeatures
          .map((feature) => {
            const subtitle = feature.type === "subclass" && feature.subclassName ? ` (${feature.subclassName})` : "";
            const isAsiFeature = isAbilityScoreImprovementSlot({ slotType: feature?.name ?? "" });
            const asiFeatureKey = `${String(feature?.className ?? "").trim().toLowerCase()}|${toNumber(feature?.level, 0)}`;
            const displayName = isAsiFeature && selectedAsiSlotKeys.has(asiFeatureKey) ? "Feat" : String(feature?.name ?? "");
            const useKey = `${autoResourceIdPrefix}${feature.id}`;
            const tracker = featureUses[useKey];
            const trackerHtml = tracker
              ? `
              <span class="feature-use-controls">
                <span class="pill">${esc(tracker.current)}/${esc(tracker.max)}${formatRecharge(tracker.recharge) ? ` ${esc(formatRecharge(tracker.recharge))}` : ""}</span>
                <button type="button" class="save-mod-btn" data-feature-use-delta="${esc(useKey)}|inc:-1" ${tracker.current <= 0 ? "disabled" : ""}>Use</button>
                <button type="button" class="save-mod-btn" data-feature-use-delta="${esc(useKey)}|inc:1" ${tracker.current >= tracker.max ? "disabled" : ""}>+</button>
              </span>
            `
              : "";
            return `
            <li class="feature-row">
              <span class="class-feature-level">Lv ${esc(feature.level ?? "?")}</span>
              <div class="feature-main">
                <button type="button" class="spell-name-btn feature-name-btn" data-open-feature="${esc(feature.id)}">${esc(
                  `${displayName}${subtitle}`
                )}</button>
                ${trackerHtml}
              </div>
            </li>
          `;
          })
          .join("")
      : "";
    const classTableEffectListHtml = classTableEffects.length
      ? classTableEffects
          .map((effect) => {
            const effectLabel = `${String(effect?.className ?? "").trim()} - ${String(effect?.label ?? "").trim()}`.trim();
            const tableResourceKey = `${autoResourceIdPrefix}${effect.id}`;
            const tableResourceTracker = featureUses[tableResourceKey];
            const rollNotation = extractSimpleNotation(effect?.rollNotation ?? effect?.value ?? "");
            const trackerHtml = tableResourceTracker
              ? `
              <span class="feature-use-controls">
                <span class="pill">${esc(tableResourceTracker.current)}/${esc(tableResourceTracker.max)}${
                  formatRecharge(tableResourceTracker.recharge) ? ` ${esc(formatRecharge(tableResourceTracker.recharge))}` : ""
                }</span>
                <button type="button" class="save-mod-btn" data-feature-use-delta="${esc(tableResourceKey)}|inc:-1" ${
                  tableResourceTracker.current <= 0 ? "disabled" : ""
                }>Use</button>
                <button type="button" class="save-mod-btn" data-feature-use-delta="${esc(tableResourceKey)}|inc:1" ${
                  tableResourceTracker.current >= tableResourceTracker.max ? "disabled" : ""
                }>+</button>
              </span>
            `
              : "";
            const valueHtml = trackerHtml
              || (effect?.kind === "dice" && rollNotation
                ? `<button type="button" class="pill pill-btn class-table-effect-roll-btn" data-class-table-roll="${esc(
                    rollNotation
                  )}" data-class-table-roll-label="${esc(effectLabel)}">${esc(effect.value ?? "")}</button>`
                : `<span class="muted">${esc(effect.value ?? "")}</span>`);
            return `
            <li class="feature-row feature-row-table-effect">
              <span class="class-feature-level">Class</span>
              <div class="feature-main">
                <strong>${esc(effectLabel)}</strong>
                ${valueHtml}
              </div>
            </li>
          `;
          })
          .join("")
      : "";
    const featListHtml = selectedFeats.length
      ? selectedFeats
          .map((feat) => {
            const featName = String(feat?.name ?? "").trim();
            const featSource = String(feat?.source ?? "").trim();
            const normalizedFeatName = featName.toLowerCase();
            const normalizedFeatSource = featSource.toLowerCase();
            const featCatalog = Array.isArray(state.catalogs?.feats) ? state.catalogs.feats : [];
            const detail =
              featCatalog.find((entry) => {
                const entryName = String(entry?.name ?? "").trim().toLowerCase();
                if (entryName !== normalizedFeatName) return false;
                const entrySource = String(entry?.source ?? "").trim().toLowerCase();
                if (!normalizedFeatSource) return true;
                return entrySource === normalizedFeatSource;
              })
              ?? featCatalog.find((entry) => String(entry?.name ?? "").trim().toLowerCase() === normalizedFeatName)
              ?? null;
            const sourceLabel = String((detail?.sourceLabel ?? detail?.source ?? featSource) || "Unknown Source");
            const prerequisites = Array.isArray(detail?.prerequisite) ? detail.prerequisite : [];
            const descriptionLines = getRuleDescriptionLines(detail);
            const summaryRaw = String(descriptionLines.find(Boolean) ?? "").trim();
            const summaryText = summaryRaw
              ? (summaryRaw.length > 180 ? `${summaryRaw.slice(0, 177).trimEnd()}...` : summaryRaw)
              : "No preview available. Click to open full feat details.";
            const useKey = `${autoResourceIdPrefix}${feat.id}`;
            const tracker = featureUses[useKey];
            const trackerHtml = tracker
              ? `
              <span class="feature-use-controls">
                <span class="pill">${esc(tracker.current)}/${esc(tracker.max)}${formatRecharge(tracker.recharge) ? ` ${esc(formatRecharge(tracker.recharge))}` : ""}</span>
                <button type="button" class="save-mod-btn" data-feature-use-delta="${esc(useKey)}|inc:-1" ${tracker.current <= 0 ? "disabled" : ""}>Use</button>
                <button type="button" class="save-mod-btn" data-feature-use-delta="${esc(useKey)}|inc:1" ${tracker.current >= tracker.max ? "disabled" : ""}>+</button>
              </span>
            `
              : "";
            return `
            <div class="feature-row feature-row-feat">
              <div class="feature-main">
                <button type="button" class="feat-tile-btn" data-open-feat="${esc(feat.id)}" aria-label="Open ${esc(featName)} details">
                  <span class="feat-tile-head">
                    <strong class="feat-tile-title">${esc(featName)}</strong>
                    <span class="pill">${esc(sourceLabel)}</span>
                  </span>
                  <span class="feat-tile-meta">
                    ${feat.levelGranted ? `Lv ${esc(feat.levelGranted)}` : "Level ?"} - ${esc(feat.via || "feat slot")}${
                      prerequisites.length ? ` - Prerequisite (${esc(prerequisites.length)})` : ""
                    }
                  </span>
                  <span class="feat-tile-summary">${esc(summaryText)}</span>
                </button>
                ${trackerHtml}
              </div>
            </div>
          `;
          })
          .join("")
      : "<span class='muted'>No feats selected.</span>";
    const optionalFeatureListHtml = selectedOptionalFeatures.length
      ? selectedOptionalFeatures
          .map((feature) => {
            const featureName = String(feature?.name ?? "").trim();
            const featureSource = String(feature?.source ?? "").trim();
            const normalizedFeatureName = featureName.toLowerCase();
            const normalizedFeatureSource = featureSource.toLowerCase();
            const optionalFeatureCatalog = Array.isArray(state.catalogs?.optionalFeatures) ? state.catalogs.optionalFeatures : [];
            const detail =
              optionalFeatureCatalog.find((entry) => {
                const entryName = String(entry?.name ?? "").trim().toLowerCase();
                if (entryName !== normalizedFeatureName) return false;
                const entrySource = String(entry?.source ?? "").trim().toLowerCase();
                if (!normalizedFeatureSource) return true;
                return entrySource === normalizedFeatureSource;
              })
              ?? optionalFeatureCatalog.find((entry) => String(entry?.name ?? "").trim().toLowerCase() === normalizedFeatureName)
              ?? null;
            const sourceLabel = String((detail?.sourceLabel ?? detail?.source ?? featureSource) || "Unknown Source");
            const prerequisites = Array.isArray(detail?.prerequisite) ? detail.prerequisite : [];
            const descriptionLines = getRuleDescriptionLines(detail);
            const summaryRaw = String(descriptionLines.find(Boolean) ?? "").trim();
            const summaryText = summaryRaw
              ? (summaryRaw.length > 180 ? `${summaryRaw.slice(0, 177).trimEnd()}...` : summaryRaw)
              : "No preview available. Click to open full optional feature details.";
            const useKey = `${autoResourceIdPrefix}${feature.id}`;
            const tracker = featureUses[useKey];
            const trackerHtml = tracker
              ? `
              <span class="feature-use-controls">
                <span class="pill">${esc(tracker.current)}/${esc(tracker.max)}${formatRecharge(tracker.recharge) ? ` ${esc(formatRecharge(tracker.recharge))}` : ""}</span>
                <button type="button" class="save-mod-btn" data-feature-use-delta="${esc(useKey)}|inc:-1" ${tracker.current <= 0 ? "disabled" : ""}>Use</button>
                <button type="button" class="save-mod-btn" data-feature-use-delta="${esc(useKey)}|inc:1" ${tracker.current >= tracker.max ? "disabled" : ""}>+</button>
              </span>
            `
              : "";
            return `
            <div class="feature-row feature-row-feat">
              <div class="feature-main">
                <button
                  type="button"
                  class="feat-tile-btn"
                  data-open-optional-feature="${esc(feature.id)}"
                  aria-label="Open ${esc(featureName)} details"
                >
                  <span class="feat-tile-head">
                    <strong class="feat-tile-title">${esc(featureName)}</strong>
                    <span class="pill">${esc(sourceLabel)}</span>
                  </span>
                  <span class="feat-tile-meta">
                    ${feature.levelGranted ? `Lv ${esc(feature.levelGranted)}` : "Level ?"} - ${esc(feature.slotType || "optional feature")}${
                      prerequisites.length ? ` - Prerequisite (${esc(prerequisites.length)})` : ""
                    }
                  </span>
                  <span class="feat-tile-summary">${esc(summaryText)}</span>
                </button>
                ${trackerHtml}
              </div>
            </div>
          `;
          })
          .join("")
      : "";
    const featureModeSelectionsListHtml = featureModes.length
      ? featureModes
          .map((mode) => {
            const selectedValues = resolveFeatureModeSelections(mode, play);
            return `
            <li class="feature-row">
              <span class="class-feature-level">Choice</span>
              <div class="feature-main">
                <strong>${esc(mode.featureName)}</strong>
                <span class="feature-mode-selected-pills">
                  ${selectedValues.map((value) => `<span class="pill">${esc(value)}</span>`).join("")}
                </span>
              </div>
            </li>
          `;
          })
          .join("")
      : "";
    const classAndTableFeatureListHtml = `${classTableEffectListHtml}${featureModeSelectionsListHtml}${featureListHtml}`;
    const speciesTraitListHtml = speciesTraits.length
      ? speciesTraits
          .map(
            (trait) => `
            <li class="feature-row">
              <span class="class-feature-level">Species</span>
              <div class="feature-main">
                <button type="button" class="spell-name-btn feature-name-btn" data-open-species-trait="${esc(trait.name)}">${esc(
                  trait.name
                )}</button>
              </div>
            </li>
          `
          )
          .join("")
      : "";

    const selectedSpells = Array.isArray(character?.spells) ? character.spells.filter(Boolean) : [];
    const hasSelectedSpells = selectedSpells.length > 0;
    const usesPreparedSpells = doesClassUsePreparedSpells(state.catalogs, character);
    const canTogglePreparedVisibility = usesPreparedSpells;
    const spellHelpText = canTogglePreparedVisibility
      ? ""
      : usesPreparedSpells
        ? "Toggle P to mark prepared. Auto-granted spells are always prepared and do not count against your preparation limit."
        : "Known casters track known spells here. Click a spell name to view details and roll from its description.";
    const visibleSpellSlotLevels = spellSlotLevels.filter((level) => {
      const values = getSpellSlotValues(play, defaultSpellSlots, level);
      return toNumber(values.max, 0) > 0;
    });
    const spellStatus = hasSelectedSpells ? latestSpellCastStatus() : { isError: false, message: "" };

    return `
    <section class="play-sheet-shell">
      <section class="card play-sheet-dice-card">
        <div class="play-sheet-head">
          <div class="dice-result-wrap" tabindex="0" aria-label="Recent roll history">
            <div id="dice-result-inline" class="dice-result muted">${esc(defaultDiceResultMessage)}</div>
            <div id="dice-history-popover" class="dice-history-popover" role="status" aria-live="polite">
              <div class="dice-history-title">Recent Rolls</div>
              <div id="dice-history-list" class="dice-history-list">
                <div class="dice-history-empty muted">No rolls yet.</div>
              </div>
            </div>
          </div>
          <div class="dice-style-row">
            <select id="dice-style-select" aria-label="Dice style">${renderDiceStyleOptions()}</select>
            <button type="button" class="btn secondary" id="reroll-last-roll">Reroll</button>
            <button type="button" class="btn secondary custom-roll-open-btn" id="open-custom-roll">Custom</button>
          </div>
        </div>
      </section>
      <div class="play-grid">
        <article class="card core-stats-card">
          <h3 class="title">Health</h3>
          <div class="play-inline-row hp-pair-row">
            <label class="inline-field hp-control">HP <span class="muted hp-meta">(Current / Total ${hpTotal})</span>
              <div class="num-input-wrap">
                <input id="play-hp-current" type="number" min="0" value="${esc(hpCurrent)}">
                <div class="num-stepper">
                  <button type="button" class="num-step-btn" data-step-target="hp-current" data-step-delta="1">+</button>
                  <button type="button" class="num-step-btn" data-step-target="hp-current" data-step-delta="-1">-</button>
                </div>
              </div>
              <div class="hp-quick-row">
                <button type="button" class="btn secondary hp-quick-btn" data-hp-delta="-5" data-hp-delta-target="current">-5</button>
                <button type="button" class="btn secondary hp-quick-btn" data-hp-delta="-1" data-hp-delta-target="current">-1</button>
                <button type="button" class="btn secondary hp-quick-btn" data-hp-delta="1" data-hp-delta-target="current">+1</button>
                <button type="button" class="btn secondary hp-quick-btn" data-hp-delta="5" data-hp-delta-target="current">+5</button>
              </div>
            </label>
            <label class="inline-field hp-control hp-control-right">Temp HP
              <div class="num-input-wrap">
                <input id="play-hp-temp" type="number" min="0" value="${esc(hpTemp)}">
                <div class="num-stepper">
                  <button type="button" class="num-step-btn" data-step-target="hp-temp" data-step-delta="1">+</button>
                  <button type="button" class="num-step-btn" data-step-target="hp-temp" data-step-delta="-1">-</button>
                </div>
              </div>
              <div class="hp-quick-row">
                <button type="button" class="btn secondary hp-quick-btn" data-hp-delta="-5" data-hp-delta-target="temp">-5</button>
                <button type="button" class="btn secondary hp-quick-btn" data-hp-delta="-1" data-hp-delta-target="temp">-1</button>
                <button type="button" class="btn secondary hp-quick-btn" data-hp-delta="1" data-hp-delta-target="temp">1</button>
                <button type="button" class="btn secondary hp-quick-btn" data-hp-delta="5" data-hp-delta-target="temp">5</button>
              </div>
            </label>
          </div>
          <div class="play-inline-row death-save-row">
            <div class="death-save-meters">
              <div class="death-save-head">
                <span class="death-save-label">Death Saves</span>
                <button type="button" class="btn secondary death-save-roll-btn" data-roll-death-save>Roll</button>
              </div>
              <label class="inline-field">Success
                <div class="num-input-wrap">
                  <input id="play-ds-success" type="number" min="0" max="3" value="${esc(toNumber(play.deathSavesSuccess, 0))}">
                  <div class="num-stepper">
                    <button type="button" class="num-step-btn" data-step-target="ds-success" data-step-delta="1">+</button>
                    <button type="button" class="num-step-btn" data-step-target="ds-success" data-step-delta="-1">-</button>
                  </div>
                </div>
              </label>
              <label class="inline-field">Fail
                <div class="num-input-wrap">
                  <input id="play-ds-fail" type="number" min="0" max="3" value="${esc(toNumber(play.deathSavesFail, 0))}">
                  <div class="num-stepper">
                    <button type="button" class="num-step-btn" data-step-target="ds-fail" data-step-delta="1">+</button>
                    <button type="button" class="num-step-btn" data-step-target="ds-fail" data-step-delta="-1">-</button>
                  </div>
                </div>
              </label>
            </div>
          </div>
        </article>

        <article class="card">
          <h3 class="title">Abilities & Saves</h3>
          <div class="play-list ability-save-grid">${savesHtml}</div>
          ${traitSectionHtml ? `<div class="play-trait-shell">${traitSectionHtml}</div>` : ""}
        </article>

        <article class="card">
          <h3 class="title">Skills</h3>
          <div class="play-list skill-grid">${skillsHtml}</div>
        </article>

        <article class="card">
          <div class="attack-title-row">
            <h3 class="title attack-title-heading">
              Attacks & Actions
              <span class="attack-action-indicator" title="Attacks you can make when you take the Attack action">
                ${esc(`${attacksPerAttackAction}/Attack action`)}
              </span>
            </h3>
            <button type="button" class="btn secondary attack-mode-btn" data-attack-mode-toggle>
              ${attackMode === "edit" ? "View" : "Edit"}
            </button>
          </div>
          ${attackMode === "edit" ? '<div class="toolbar attack-mode-toolbar"><button class="btn secondary" id="add-attack">Add Attack</button></div>' : ""}
          <div class="play-list">
            ${attacksHtml || "<p class='muted'>No attack entries yet.</p>"}
          </div>
        </article>

        ${
          hasSelectedSpells
            ? `
        <article class="card">
          <h3 class="title">Spells & Slots</h3>
          <div class="play-list spell-slot-grid">
            ${visibleSpellSlotLevels.length
              ? visibleSpellSlotLevels.map((level) => getSpellSlotRow(play, defaultSpellSlots, level)).join("")
              : "<p class='muted'>No spell slots available yet.</p>"}
          </div>
          <h4>Prepared/Known Spells</h4>
          ${spellHelpText ? `<p class="muted spell-prep-help">${esc(spellHelpText)}</p>` : ""}
          <div id="spell-cast-status" class="spell-cast-status ${spellStatus.isError ? "is-error" : ""}" ${spellStatus.message ? "" : "hidden"}>${esc(
              spellStatus.message
            )}</div>
          <div class="spell-level-groups">${renderSpellGroupsByLevelImpl(state)}</div>
        </article>
        `
            : ""
        }

        <article class="card">
          <h3 class="title">Features</h3>
          <h4>Class/Subclass Features</h4>
          ${
            classAndTableFeatureListHtml
              ? `<ul class="class-feature-list">${classAndTableFeatureListHtml}</ul>`
              : "<p class='muted'>No unlocked class features.</p>"
          }
          <h4>Species Traits</h4>
          ${speciesTraitListHtml ? `<ul class="class-feature-list">${speciesTraitListHtml}</ul>` : "<p class='muted'>No species traits found.</p>"}
        </article>

        <article class="card">
          <h3 class="title">Feats</h3>
          <h4>Feats</h4>
          <div>${featListHtml}</div>
          ${
            optionalFeatureListHtml
              ? `
          <h4>Class Features</h4>
          ${optionalFeatureListHtml ? `<div>${optionalFeatureListHtml}</div>` : ""}
          `
              : ""
          }
        </article>

        <article class="card">
          <div class="inventory-head">
            <h3 class="title">Inventory</h3>
            <button class="btn secondary" id="play-open-items">Add Item</button>
          </div>
          <div class="inventory-list">${renderInventoryRowsImpl(character)}</div>
        </article>

        <article class="card">
          <h3 class="title">Notes</h3>
          <label>Character Notes
            <textarea id="play-character-notes" class="play-notes-textarea" rows="3">${esc(character.notes ?? "")}</textarea>
          </label>
          <label>Combat Notes
            <textarea id="play-notes" class="play-notes-textarea" rows="3">${esc(play.notes ?? "")}</textarea>
          </label>
        </article>

        <article class="card">
          <h3 class="title">Conditions</h3>
          <div class="condition-panel">
            <div class="condition-panel-head">
              <span class="condition-count-pill">${activeKnownCount}/${catalogConditionNames.length || 0} active</span>
              <button type="button" class="btn secondary condition-clear-btn" data-clear-conditions ${activeConditions.length ? "" : "disabled"}>
                Clear All
              </button>
            </div>
            <div class="condition-grid">
              ${conditionButtonsHtml}
            </div>
            ${extraConditionsHtml}
          </div>
        </article>

        <article class="card">
          <h3 class="title">Rest</h3>
          <p class="muted">Apply short or long rest to refresh tracked class feature uses and reset rest-dependent state.</p>
          <div class="toolbar">
            <button class="btn secondary" id="short-rest">Short Rest</button>
            <button class="btn" id="long-rest">Long Rest</button>
          </div>
        </article>
      </div>
    </section>
  `;
  }

  function renderBuildEditorImpl(state) {
    const { character, stepIndex, catalogs } = state;
    if (stepIndex === 0) {
      const effectiveSources = getCharacterAllowedSources(character);
      const sourceText = effectiveSources
        .map((source) => sourceLabels?.[source] ?? source)
        .join(", ");
      const resolvedSourcePresets =
        typeof sourcePresets === "function" ? sourcePresets() ?? {} : sourcePresets ?? {};
      const resolvedSourcePresetLabels =
        typeof sourcePresetLabels === "function" ? sourcePresetLabels() ?? {} : sourcePresetLabels ?? {};
      const presetKeys = Object.keys(resolvedSourcePresets);
      const selectedPreset = presetKeys.includes(character.sourcePreset)
        ? character.sourcePreset
        : (presetKeys[0] ?? character.sourcePreset);
      return `
      <h2 class="title">Source Preset</h2>
      <p class="subtitle">Choose which books and options this character can use.</p>
      <label>Preset
        <select id="source-preset">
          ${presetKeys
            .map((key) => `<option value="${key}" ${key === selectedPreset ? "selected" : ""}>${esc(resolvedSourcePresetLabels[key] ?? key)}</option>`)
            .join("")}
        </select>
      </label>
      <div class="toolbar">
        <button type="button" class="btn secondary" id="source-customize">Customize</button>
      </div>
      <p class="muted">Allowed sources: ${esc(sourceText)}</p>
    `;
    }
    if (stepIndex === 1) {
      return `
      <h2 class="title">Basics</h2>
      <div class="row">
        <label>Name <input id="name" value="${esc(character.name)}"></label>
      </div>
      <label>Character Password: Setting this will prevent any character edits without the matching password
        <div class="edit-password-inline-row">
          <input id="edit-password" value="${esc(character.editPassword)}" type="text" autocomplete="off">
          <button type="button" class="btn secondary" id="edit-password-confirm" disabled>Confirm</button>
        </div>
      </label>
      <label>Notes
        <textarea id="notes" rows="5">${esc(character.notes)}</textarea>
      </label>
    `;
    }
    if (stepIndex === 2) {
      const raceSourceOrder = getPreferredSourceOrder(character);
      const selectedRace = getEffectiveRaceEntry(catalogs, character, raceSourceOrder);
      const selectedBaseRace = findCatalogEntryByNameWithSelectedSourcePreference(
        catalogs.races,
        character.race,
        character.raceSource,
        raceSourceOrder
      );
      const subraceOptions = selectedBaseRace
        ? getSubraceCatalogEntries(catalogs, selectedBaseRace.name, selectedBaseRace.source, raceSourceOrder)
            .filter((entry) => String(entry?.name ?? "").trim())
        : [];
      const selectedBackground = findCatalogEntryByNameWithSelectedSourcePreference(
        catalogs.backgrounds,
        character.background,
        character.backgroundSource,
        raceSourceOrder
      );
      const raceAbilitySummary = getAbilityBonusesSummary(selectedRace, "race", character);
      const raceSkillSummary = getSkillProficiencySummary(selectedRace, "race", character);
      const backgroundAbilitySummary = getAbilityBonusesSummary(selectedBackground, "background", character);
      const backgroundSkillSummary = getSkillProficiencySummary(selectedBackground, "background", character);
      const raceAbilityMap = getAbilityBonusesMap(selectedRace, "race", character);
      const backgroundAbilityMap = getAbilityBonusesMap(selectedBackground, "background", character);
      const raceAbilityTotal = getAbilityBonusTotal(raceAbilityMap);
      const backgroundAbilityTotal = getAbilityBonusTotal(backgroundAbilityMap);
      const hasRaceAbilityBonuses = Boolean(String(raceAbilitySummary ?? "").trim());
      const hasBackgroundAbilityBonuses = Boolean(String(backgroundAbilitySummary ?? "").trim());
      const abilityRulesHint = hasRaceAbilityBonuses && hasBackgroundAbilityBonuses
        ? "<strong>Rules mix detected:</strong> both race and background grant ability bonuses. This stacks bonuses and can exceed standard 2014/2024 assumptions."
        : hasRaceAbilityBonuses
          ? "<strong>2014-style active:</strong> race is currently providing ability bonuses."
          : hasBackgroundAbilityBonuses
            ? "<strong>2024-style active:</strong> background is currently providing ability bonuses."
            : "No automatic ability score bonuses detected from race/background.";
      const raceChoiceEditors = renderAutoChoiceEditorsForEntity(selectedRace, "race", character, catalogs);
      const backgroundChoiceEditors = renderAutoChoiceEditorsForEntity(selectedBackground, "background", character, catalogs);
      return `
      <h2 class="title">Ancestry & Background</h2>
      <div class="row">
        <label>Race
          <select id="race">
            <option value="">Select race</option>
            ${optionList(catalogs.races, character.race, { includeSourceInValue: true, selectedSource: character.raceSource })}
          </select>
        </label>
        <label>Subrace
          <select id="subrace" ${subraceOptions.length ? "" : "disabled"}>
            <option value="">None</option>
            ${optionList(subraceOptions, character.subrace, { includeSourceInValue: true, selectedSource: character.subraceSource })}
          </select>
        </label>
        <label>Background
          <select id="background">
            <option value="">Select background</option>
            ${optionList(catalogs.backgrounds, character.background, {
              includeSourceInValue: true,
              selectedSource: character.backgroundSource,
            })}
          </select>
        </label>
      </div>
      <p class="muted ability-rules-note ${raceAbilityTotal > 0 && backgroundAbilityTotal > 0 ? "is-warning" : ""}">
        ${abilityRulesHint}
      </p>
      <div class="play-list">
        <p class="muted">
          <strong>Race bonuses:</strong>
          ${
            raceAbilitySummary || raceSkillSummary
              ? [raceAbilitySummary ? `Abilities ${raceAbilitySummary}` : "", raceSkillSummary ? `Skills ${raceSkillSummary}` : ""]
                  .filter(Boolean)
                  .join(" - ")
              : "No automatic ability or skill bonuses."
          }
        </p>
        ${raceChoiceEditors ? `<div class="auto-choice-shell">${raceChoiceEditors}</div>` : ""}
        <p class="muted">
          <strong>Background bonuses:</strong>
          ${
            backgroundAbilitySummary || backgroundSkillSummary
              ? [backgroundAbilitySummary ? `Abilities ${backgroundAbilitySummary}` : "", backgroundSkillSummary ? `Skills ${backgroundSkillSummary}` : ""]
                  .filter(Boolean)
                  .join(" - ")
              : "No automatic ability or skill bonuses."
          }
        </p>
        ${backgroundChoiceEditors ? `<div class="auto-choice-shell">${backgroundChoiceEditors}</div>` : ""}
      </div>
    `;
    }
    if (stepIndex === 3) {
      const subclassOptions = getSubclassSelectOptions(state);
      const progressionOptionalFeatureSlots = Array.isArray(character?.progression?.optionalFeatureSlots) ? character.progression.optionalFeatureSlots : [];
      const selectedOptionalFeatures = Array.isArray(character?.optionalFeatures) ? character.optionalFeatures : [];
      const progressionFeatureModesRaw = Array.isArray(character?.progression?.featureModes) ? character.progression.featureModes : [];
      const progressionFeatureModes = progressionFeatureModesRaw.filter(
        (mode) => !isFeatureModeHandledByOptionalFeatures(mode, progressionOptionalFeatureSlots, selectedOptionalFeatures)
      );
      const buildFeatureChoicesHtml = progressionFeatureModes.length
        ? progressionFeatureModes
            .map((mode) => {
              const selectedValues = resolveFeatureModeSelections(mode, character?.play ?? {});
              const maxCount = Math.max(1, Math.min(mode.optionValues.length, Math.floor(toNumber(mode?.count, 1))));
              return `
              <div class="feature-row feature-row-feat">
                <div class="feature-main">
                  <div class="feature-mode-tile">
                    <span class="feat-tile-head">
                      <strong class="feat-tile-title">${esc(mode.featureName)}</strong>
                      <span class="pill">${maxCount > 1 ? `Choose ${esc(maxCount)}` : "Choice"}</span>
                    </span>
                    <span class="feat-tile-meta">${maxCount > 1 ? `Select up to ${esc(maxCount)} options` : "Select one option"}</span>
                    <div class="feature-mode-option-list">
                      ${mode.optionValues
                        .map(
                          (option) => `
                        <button
                          type="button"
                          class="pill pill-btn feature-mode-option-btn ${selectedValues.includes(option) ? "is-active" : ""}"
                          data-feature-mode-choice="true"
                          data-feature-mode-id="${esc(mode.id)}"
                          data-feature-mode-value="${esc(option)}"
                          data-feature-mode-max="${esc(maxCount)}"
                          aria-pressed="${selectedValues.includes(option) ? "true" : "false"}"
                          title="Choose ${esc(option)}"
                        >
                          ${esc(option)}
                        </button>
                      `
                        )
                        .join("")}
                    </div>
                  </div>
                </div>
              </div>
            `;
            })
            .join("")
        : "";
      const sourceOrder = getPreferredSourceOrder(character);
      const classEntry = findCatalogEntryByNameWithSelectedSourcePreference(
        catalogs.classes,
        character.class,
        character.classSource,
        sourceOrder
      );
      const classSkillChoiceEditors = renderClassSkillChoiceEditors(classEntry, character, catalogs);
      const classChoiceSourceKey = `class:${String(classEntry?.name ?? character?.class ?? "").trim().toLowerCase() || "primary"}`;
      const classToolChoiceEditors = renderAutoChoiceEditorsForEntity(
        { toolProficiencies: classEntry?.startingProficiencies?.toolProficiencies },
        classChoiceSourceKey,
        character,
        catalogs
      );
      return `
      <h2 class="title">Class & Multiclass</h2>
      <div class="row">
        <label>Class
          <select id="class">
            <option value="">Select class</option>
            ${optionList(catalogs.classes, character.class, { includeSourceInValue: true, selectedSource: character.classSource })}
          </select>
        </label>
        <label>Subclass
          <select id="subclass-select">
            <option value="">Select subclass</option>
            ${subclassOptions
              .map(
                (entry) =>
                  `<option value="${esc(entry.name)}|${esc(entry.source)}" ${entry.isSelected ? "selected" : ""}>${esc(entry.name)} (${esc(
                    entry.sourceLabel || entry.source || "Unknown Source"
                  )})</option>`
              )
              .join("")}
          </select>
        </label>
      </div>
      <div class="toolbar">
        <button class="btn secondary" id="open-multiclass">Edit Multiclass</button>
        <button class="btn secondary" type="button" data-open-levelup>Level Up</button>
      </div>
      ${classSkillChoiceEditors ? `<div class="auto-choice-shell">${classSkillChoiceEditors}</div>` : ""}
      ${classToolChoiceEditors ? `<div class="auto-choice-shell">${classToolChoiceEditors}</div>` : ""}
      <h3 class="title">Feat Slots</h3>
      <p class="subtitle">Feat slots come from your class levels. Pick a feat for each slot.</p>
      <div class="option-list slot-list">
        ${renderBuildFeatSlotsImpl(character)}
      </div>
      <h3 class="title">Optional Feature Slots</h3>
      <p class="subtitle">Optional feature slots come from your class levels. Pick an option for each slot.</p>
      <div class="option-list slot-list">
        ${renderBuildOptionalFeatureSlotsImpl(character)}
      </div>
      ${
        buildFeatureChoicesHtml
          ? `
      <h3 class="title">Class Feature Choices</h3>
      <p class="subtitle">Choose class feature options earned from class progression.</p>
      <div class="option-list slot-list">
        ${buildFeatureChoicesHtml}
      </div>
      `
          : ""
      }
    `;
    }
    if (stepIndex === 4) {
      const proficiencyEditMeta = getProficiencyEditMeta(character);
      const saveRows = renderSaveRowsImpl(state, { canToggle: true, includeRollButtons: false, proficiencyEditMeta });
      const skillRows = renderSkillRowsImpl(state, { canToggle: true, includeRollButtons: false, proficiencyEditMeta });
      return `
      <h2 class="title">Abilities</h2>
      <div class="row ability-edit-grid">
        ${Object.entries(character.abilities)
          .map(
            ([key, val]) => `
          <label class="ability-edit-field">${esc(key.toUpperCase())}${toNumber(character.play?.autoAbilityBonuses?.[key], 0) > 0 ? ` <span class="muted">(auto +${esc(
            toNumber(character.play?.autoAbilityBonuses?.[key], 0)
          )})</span>` : ""}
            <div class="num-input-wrap">
              <input id="ability-${esc(key)}" type="number" min="1" max="30" data-ability="${esc(key)}" value="${esc(val)}">
              <div class="num-stepper">
                <button type="button" class="num-step-btn" data-ability-step="${esc(key)}" data-step-delta="1" aria-label="Increase ${esc(
                  key.toUpperCase()
                )}">+</button>
                <button type="button" class="num-step-btn" data-ability-step="${esc(key)}" data-step-delta="-1" aria-label="Decrease ${esc(
                  key.toUpperCase()
                )}">-</button>
              </div>
            </div>
          </label>
        `
          )
          .join("")}
      </div>
      <p class="muted">Ability scores shown here include automatic race/background bonuses.</p>
      <h3 class="title">Proficiencies</h3>
      <p class="subtitle">Toggle skill and save proficiencies for your character sheet.</p>
      <div class="play-grid">
        <article class="card">
          <h4 class="title">Abilities & Saves</h4>
          <div class="play-list ability-save-grid edit-save-grid">${saveRows}</div>
        </article>
        <article class="card">
          <h4 class="title">Skills</h4>
          <div class="play-list skill-grid">${skillRows}</div>
        </article>
      </div>
    `;
    }
    if (stepIndex === 5) {
      return `
      <h2 class="title">Equipment</h2>
      <p class="subtitle">Choose and track the items your character is carrying.</p>
      <div class="toolbar">
        <button class="btn secondary" id="open-items">Pick Items</button>
      </div>
      <div class="inventory-list">${renderInventoryRowsImpl(character)}</div>
    `;
    }
    if (stepIndex === 6) {
      const play = character.play ?? {};
      const defaultSpellSlots = getCharacterSpellSlotDefaults(catalogs, character);
      const usesPreparedSpells = doesClassUsePreparedSpells(catalogs, character);
      const hasAutoClassListSpells = Array.isArray(play?.autoClassListSpells) && play.autoClassListSpells.length > 0;
      const subtitle = hasAutoClassListSpells
        ? "Your class spell list is auto-managed for this caster. Use the picker to browse details or add non-class extras."
        : usesPreparedSpells
          ? "Manage your spell list here, then use Prepared or All Spells to control what you see during play."
        : "Search and add spells to your spell list.";
      const pickerLabel = hasAutoClassListSpells ? "Browse Spells" : "Pick Spells";
      return `
      <h2 class="title">Spells</h2>
      <p class="subtitle">${esc(subtitle)}</p>
      <div class="toolbar">
        <button class="btn secondary" id="open-spells">${esc(pickerLabel)}</button>
      </div>
      <div class="build-spell-list">
        ${renderBuildSpellListImpl(state)}
      </div>
      <h4>Spell Slots (Edit Max)</h4>
      <p class="muted spell-prep-help">Spell slots are auto-calculated from your classes. Change these only if your table uses house rules.</p>
      <div class="play-list spell-slot-grid">
        ${spellSlotLevels.map((level) => renderBuildSpellSlotRowImpl(play, defaultSpellSlots, level)).join("")}
      </div>
    `;
    }
    if (stepIndex === 7) {
      return `
      <h2 class="title">Import & Export</h2>
      <p class="subtitle">Import a character backup file or export the current character as JSON.</p>
      <div class="toolbar import-export-toolbar">
        <input type="file" id="import-character-json-file" class="file-input-hidden" accept=".json,application/json" />
        <button class="btn secondary" id="import-character-json" type="button">Import</button>
        <button class="btn secondary" id="export-character-json" type="button">Export</button>
      </div>
      <p class="muted">
        Import checks the JSON UUID. You will be warned before replacing the current character or any existing character.
      </p>
      <section class="dndbeyond-import-guide card">
        <h3 class="title">Import from D&amp;D Beyond</h3>
        <p class="muted">Follow these steps to convert a D&amp;D Beyond character export into this builder's JSON format.</p>
        <ol class="dndbeyond-import-steps">
          <li>
            In D&amp;D Beyond, open your character, click <strong>Manage</strong>, then choose <strong>Export to PDF</strong>.
          </li>
          <li>
            Open ChatGPT or Claude and upload/paste the exported PDF document.
          </li>
          <li>
            Use this prompt:
            <pre class="dndbeyond-import-prompt">Convert the supplied PDF document to the character builder JSON format described at https://characterbuild.duckdns.org/JSON_FORMAT_REFERENCE.md. Output only valid JSON. Use human-readable names directly from the source document (class, spells, feats, optional features) and do not invent internal IDs. Provide the result as a downloadable JSON file.</pre>
          </li>
          <li>
            Download the JSON file provided by the LLM, then import it using the <strong>Import</strong> button above.
          </li>
        </ol>
      </section>
    `;
    }
    return "";
  }

  function renderSummaryImpl(state) {
    const { character, derived } = state;
    return `
    <h3 class="title">Character Snapshot</h3>
    <p class="subtitle">${esc(character.name || "Unnamed Hero")} - Level ${esc(character.level)} ${esc(character.class || "Adventurer")}</p>
    <div class="summary-grid">
      <div class="pill">AC ${derived.ac}</div>
      <div class="pill">HP ${derived.hp}</div>
      <div class="pill">Prof +${derived.proficiencyBonus}</div>
      <div class="pill">Passive Perception ${derived.passivePerception}</div>
    </div>
    <h4>Ability Mods</h4>
    <div class="summary-grid">
      ${Object.entries(derived.mods)
        .map(([k, v]) => `<div class="pill">${esc(k.toUpperCase())} ${v >= 0 ? "+" : ""}${v}</div>`)
        .join("")}
    </div>
    <h4>Multiclass</h4>
    <p class="muted">${
      character.multiclass.length
        ? character.multiclass.map((m) => `${esc(m.class)} ${esc(m.level)}`).join(", ")
        : "None"
    }</p>
  `;
  }

  function renderStepperImpl(stepIndex) {
    return `
    <div class="stepper">
      ${STEPS.map((step, i) => {
        const isCogStep = i === 7;
        const label = isCogStep ? "⚙" : `${i + 1}. ${esc(step)}`;
        const ariaLabel = isCogStep ? ` aria-label="${i + 1}. ${esc(step)}" title="${i + 1}. ${esc(step)}"` : "";
        const className = `${i === stepIndex ? "active " : ""}${isCogStep ? "stepper-cog-btn" : ""}`.trim();
        return `<button data-step="${i}" class="${className}"${ariaLabel}>${label}</button>`;
      }).join("")}
    </div>
  `;
  }

  function renderBuildFeatSlotsImpl(character) {
    const slots = getFeatSlotsWithSelection(character);
    if (!slots.length) return "<p class='muted'>No feat slots available from current class progression.</p>";
    return slots
      .map((slot) => {
        const isAsiSlot = isAbilityScoreImprovementSlot(slot);
        const hasSelectedFeat = Boolean(slot.feat);
        const slotTypeLabel = isAsiSlot && hasSelectedFeat ? "Feat" : (slot.slotType || "Feat");
        const slotLabel = `${slot.className} Lv ${slot.level} - ${slotTypeLabel}`;
        const asiChoiceId = "a:0:choose:0";
        const asiSourceKey = getAsiChoiceSourceKey(slot.id);
        const asiSelected = !hasSelectedFeat && isAsiSlot
          ? getStoredChoiceValuesOnly(character, asiSourceKey, asiChoiceId, saveAbilities, 2, { allowDuplicates: true })
          : [];
        const asiEditorHtml = !hasSelectedFeat && isAsiSlot
          ? `
            <div class="asi-inline-row">
              ${Array.from({ length: 2 }, (_, index) => {
                const selected = String(asiSelected[index] ?? "").trim();
                const selectedToken = normalizeChoiceToken(selected);
                return `
                  <select
                    class="asi-inline-select"
                    data-asi-choice-select="1"
                    data-auto-choice-source="${esc(asiSourceKey)}"
                    data-auto-choice-id="${esc(asiChoiceId)}"
                    data-auto-choice-max="2"
                    data-auto-choice-allow-duplicates="true"
                    aria-label="ASI point ${index + 1}"
                  >
                    <option value="">-</option>
                    ${saveAbilities
                      .map((abilityValue) => {
                        const ability = String(abilityValue ?? "").trim();
                        if (!ability) return "";
                        const isSelected = normalizeChoiceToken(ability) === selectedToken;
                        return `<option value="${esc(ability)}" ${isSelected ? "selected" : ""}>${esc(
                          `+1 ${abilityLabels[ability] ?? ability.toUpperCase()}`
                        )}</option>`;
                      })
                      .join("")}
                  </select>
                `;
              }).join("")}
            </div>
          `
          : "";
        return `
        <div class="option-row">
          <div class="slot-row-main">
            <div class="slot-row-head">
              <strong>${esc(slotLabel)}</strong>
              <span class="muted">${slot.feat ? `${esc(slot.feat.name)} (${esc(slot.feat.source || "Unknown Source")})` : "No feat selected."}</span>
            </div>
            ${asiEditorHtml}
          </div>
          <div class="option-row-actions">
            <button type="button" class="btn secondary" data-open-feat-picker="${esc(slot.id)}">${slot.feat ? "Replace" : "Pick Feat"}</button>
            ${slot.feat ? `<button type="button" class="btn secondary" data-remove-feat-slot="${esc(slot.id)}">Clear</button>` : ""}
          </div>
        </div>
      `;
      })
      .join("");
  }

  function renderBuildOptionalFeatureSlotsImpl(character) {
    const slots = getOptionalFeatureSlotsWithSelection(character);
    if (!slots.length) return "<p class='muted'>No optional feature slots available from current class progression.</p>";
    return slots
      .map((slot) => {
        const selected = slot.optionalFeature;
        const slotLabel = `${slot.className} Lv ${slot.level} - ${slot.slotType || "Optional Feature"}${
          slot.featureType ? ` (${slot.featureType})` : ""
        }`;
        return `
        <div class="option-row">
          <div class="slot-row-main">
            <div class="slot-row-head">
              <strong>${esc(slotLabel)}</strong>
              <span class="muted">${selected ? `${esc(selected.name)} (${esc(selected.source || "Unknown Source")})` : "No optional feature selected."}</span>
            </div>
          </div>
          <div class="option-row-actions">
            <button type="button" class="btn secondary" data-open-optional-feature-picker="${esc(slot.id)}">${
              selected ? "Replace" : "Pick Feature"
            }</button>
            ${selected ? `<button type="button" class="btn secondary" data-remove-optional-feature-slot="${esc(slot.id)}">Clear</button>` : ""}
          </div>
        </div>
      `;
      })
      .join("");
  }

  function renderLevelUpContributionRowsImpl(catalogs, draft, classLevels) {
    const rows = [];
    const primaryContribution = getClassCasterContribution(catalogs, draft.primaryClass, classLevels.primaryLevel);
    rows.push(
      `<div class="levelup-contrib-row"><span>${esc(draft.primaryClass || "Primary class")} ${esc(classLevels.primaryLevel)}</span><span>${esc(primaryContribution)}</span></div>`
    );

    classLevels.multiclass.forEach((entry) => {
      const contribution = getClassCasterContribution(catalogs, entry.class, entry.level);
      rows.push(`<div class="levelup-contrib-row"><span>${esc(entry.class)} ${esc(entry.level)}</span><span>${esc(contribution)}</span></div>`);
    });

    const totalCasterLevel = [primaryContribution, ...classLevels.multiclass.map((entry) => getClassCasterContribution(catalogs, entry.class, entry.level))]
      .reduce((sum, value) => sum + value, 0);
    rows.push(`<div class="levelup-contrib-row is-total"><span>Total caster level</span><span>${esc(totalCasterLevel)}</span></div>`);
    return rows.join("");
  }

  function renderLevelUpBodyImpl(state, draft) {
    const preview = getLevelUpPreview(state, draft);
    const hitPointPlan = preview.hitPointPlan ?? {
      currentMaxHp: toNumber(state?.derived?.hp, 1),
      nextMaxHp: toNumber(state?.derived?.hp, 1),
      totalDelta: 0,
      baseDelta: 0,
      conDelta: 0,
      featDelta: 0,
      gainedEntries: [],
      levelDelta: 0,
      conMod: 0,
    };
    const classOptions = optionList(state.catalogs.classes, "");
    const multiclassTotal = draft.multiclass.reduce((sum, entry) => sum + Math.max(1, toNumber(entry.level, 1)), 0);
    const budgetRemaining = draft.totalLevel - multiclassTotal;
    const slotChangesHtml = preview.changedSlotLevels.length
      ? preview.changedSlotLevels
          .map((level) => {
            const key = String(level);
            const from = toNumber(preview.currentSlots[key], 0);
            const to = toNumber(preview.nextSlots[key], 0);
            return `<div class="levelup-slot-change"><span>Level ${level}</span><span>${from} -> ${to}</span></div>`;
          })
          .join("")
      : "<p class='muted levelup-empty'>No spell slot changes.</p>";
    const currentSaveLabels = getSaveProficiencyLabelMap(preview.currentSaves);
    const nextSaveLabels = getSaveProficiencyLabelMap(preview.nextSaves);
    const featureChangesHtml = preview.addedFeatures.length || preview.removedFeatures.length
      ? `
          <div class="levelup-save-row"><span class="muted">Unlocked</span><span>${esc(preview.addedFeatures.map((feature) => feature.name).join(", ") || "None")}</span></div>
          <div class="levelup-save-row"><span class="muted">Lost</span><span>${esc(preview.removedFeatures.map((feature) => feature.name).join(", ") || "None")}</span></div>
        `
      : "<p class='muted levelup-empty'>No class feature unlock changes.</p>";
    const autoSpellChangesHtml = preview.addedAutoSpells.length || preview.removedAutoSpells.length
      ? `
          <div class="levelup-save-row"><span class="muted">Added</span><span>${esc(preview.addedAutoSpells.join(", ") || "None")}</span></div>
          <div class="levelup-save-row"><span class="muted">Removed</span><span>${esc(preview.removedAutoSpells.join(", ") || "None")}</span></div>
        `
      : "<p class='muted levelup-empty'>No auto-granted spell changes.</p>";
    const classTableChangesHtml = preview.changedClassTableEffects.length
      ? preview.changedClassTableEffects
          .slice(0, 12)
          .map((effect) => `<div class="levelup-slot-change"><span>${esc(effect.className)}: ${esc(effect.label)}</span><span>${esc(effect.value)}</span></div>`)
          .join("")
      : "<p class='muted levelup-empty'>No class table effect changes.</p>";
    const currentOptionalSlots = Array.isArray(preview.currentProgression?.optionalFeatureSlots) ? preview.currentProgression.optionalFeatureSlots.length : 0;
    const nextOptionalSlots = Array.isArray(preview.nextProgression?.optionalFeatureSlots) ? preview.nextProgression.optionalFeatureSlots.length : 0;
    const currentFeatSlots = Array.isArray(preview.currentProgression?.featSlots) ? preview.currentProgression.featSlots.length : 0;
    const nextFeatSlots = Array.isArray(preview.nextProgression?.featSlots) ? preview.nextProgression.featSlots.length : 0;
    const hitPointRowsHtml = hitPointPlan.gainedEntries.length
      ? hitPointPlan.gainedEntries
          .map((entry) => {
            const isRoll = entry.method === "roll";
            const gainValue = isRoll ? toNumber(entry.rollValue, entry.fixedValue) : entry.fixedValue;
            return `
              <div class="levelup-hp-row">
                <div class="levelup-hp-head">
                  <strong>${esc(entry.className)} ${esc(entry.classLevel)}</strong>
                  <span class="muted">Hit Die d${esc(entry.faces)}</span>
                </div>
                <div class="levelup-hp-choice">
                  <label class="levelup-hp-method">
                    <input
                      type="radio"
                      name="levelup-hp-method-${esc(entry.key)}"
                      value="fixed"
                      data-levelup-hp-method
                      data-levelup-hp-key="${esc(entry.key)}"
                      data-levelup-hp-faces="${esc(entry.faces)}"
                      ${isRoll ? "" : "checked"}
                    >
                    <span>Average (+${esc(entry.fixedValue)})</span>
                  </label>
                  <label class="levelup-hp-method">
                    <input
                      type="radio"
                      name="levelup-hp-method-${esc(entry.key)}"
                      value="roll"
                      data-levelup-hp-method
                      data-levelup-hp-key="${esc(entry.key)}"
                      data-levelup-hp-faces="${esc(entry.faces)}"
                      ${isRoll ? "checked" : ""}
                    >
                    <span>Roll</span>
                  </label>
                  ${
                    isRoll
                      ? `<button type="button" class="btn secondary levelup-hp-reroll" data-levelup-hp-reroll="${esc(entry.key)}" data-levelup-hp-faces="${esc(entry.faces)}">Reroll d${esc(entry.faces)}</button>`
                      : ""
                  }
                </div>
                <div class="levelup-hp-gain">
                  <span class="muted">${isRoll ? `Rolled ${esc(entry.rollValue)}` : `Fixed ${esc(entry.fixedValue)}`}</span>
                  <strong>+${esc(gainValue)} base HP</strong>
                </div>
              </div>
            `;
          })
          .join("")
      : "<p class='muted levelup-empty'>No new levels to assign hit dice for.</p>";
    const hpDeltaPrefix = hitPointPlan.totalDelta > 0 ? "+" : "";

    return `
    <div class="levelup-shell">
      <p class="subtitle">Preview level changes before applying them to your character.</p>
      <div class="levelup-grid">
        <section class="levelup-card">
          <h4>Class Levels</h4>
          <div class="row">
            <label>Total Level
              <div class="num-input-wrap num-input-wrap-inline">
                <input id="levelup-total-level" type="number" min="1" max="20" value="${esc(draft.totalLevel)}">
                <div class="num-stepper num-stepper-inline">
                  <button type="button" class="num-step-btn" data-levelup-step-target="total-level" data-step-delta="-1" aria-label="Decrease total level">-</button>
                  <button type="button" class="num-step-btn" data-levelup-step-target="total-level" data-step-delta="1" aria-label="Increase total level">+</button>
                </div>
              </div>
            </label>
            <label>Primary Class
              <select id="levelup-primary-class">
                <option value="">Select class</option>
                ${classOptions}
              </select>
            </label>
          </div>
          <div class="levelup-budget ${budgetRemaining < 1 ? "is-invalid" : ""}">
            <span>Primary class level</span>
            <strong>${esc(preview.classLevels.primaryLevel)}</strong>
          </div>
          <div class="levelup-budget ${budgetRemaining < 1 ? "is-invalid" : ""}">
            <span>Secondary levels allocated</span>
            <strong>${esc(multiclassTotal)}</strong>
          </div>
          <div class="levelup-budget ${budgetRemaining < 1 ? "is-invalid" : ""}">
            <span>Remaining primary level budget</span>
            <strong>${esc(budgetRemaining)}</strong>
          </div>
          <h5>Secondary Classes</h5>
          <div class="levelup-rows">
            ${
              draft.multiclass.length
                ? draft.multiclass
                    .map(
                      (entry, idx) => `
                <div class="levelup-row">
                  <label>Class
                    <select data-levelup-mc-class="${idx}">
                      <option value="">Select class</option>
                      ${optionList(state.catalogs.classes, entry.class)}
                    </select>
                  </label>
                  <label>Level
                    <div class="num-input-wrap num-input-wrap-inline">
                      <input type="number" min="1" max="20" data-levelup-mc-level="${idx}" value="${esc(entry.level)}">
                      <div class="num-stepper num-stepper-inline">
                        <button type="button" class="num-step-btn" data-levelup-step-target="mc-level" data-levelup-step-index="${idx}" data-step-delta="-1" aria-label="Decrease secondary class level">-</button>
                        <button type="button" class="num-step-btn" data-levelup-step-target="mc-level" data-levelup-step-index="${idx}" data-step-delta="1" aria-label="Increase secondary class level">+</button>
                      </div>
                    </div>
                  </label>
                  <button type="button" class="btn secondary" data-levelup-mc-remove="${idx}">Remove</button>
                </div>
              `
                    )
                    .join("")
                : "<p class='muted levelup-empty'>No secondary class levels yet.</p>"
            }
          </div>
          <div class="toolbar">
            <button type="button" class="btn secondary" data-levelup-add-mc>Add Secondary Class</button>
          </div>
          <h5>Hit Dice (New Levels)</h5>
          <p class="muted levelup-empty">Choose per-level HP gain: take average or roll. Constitution is applied automatically per level.</p>
          <div class="levelup-hp-list">${hitPointRowsHtml}</div>
        </section>
        <section class="levelup-card">
          <h4>Required Updates Preview</h4>
          <div class="levelup-preview-block">
            <h5>Hit Points</h5>
            <div class="levelup-save-row"><span class="muted">Max HP</span><span>${esc(hitPointPlan.currentMaxHp)} -> ${esc(hitPointPlan.nextMaxHp)}</span></div>
            <div class="levelup-save-row"><span class="muted">Net Change</span><span>${esc(hpDeltaPrefix)}${esc(hitPointPlan.totalDelta)}</span></div>
            <div class="levelup-save-row"><span class="muted">Hit Die Contribution</span><span>${hitPointPlan.baseDelta > 0 ? "+" : ""}${esc(hitPointPlan.baseDelta)}</span></div>
            <div class="levelup-save-row"><span class="muted">Constitution (${hitPointPlan.conMod >= 0 ? "+" : ""}${esc(hitPointPlan.conMod)} x ${esc(hitPointPlan.levelDelta)})</span><span>${hitPointPlan.conDelta > 0 ? "+" : ""}${esc(hitPointPlan.conDelta)}</span></div>
            <div class="levelup-save-row"><span class="muted">Feat Contribution</span><span>${hitPointPlan.featDelta > 0 ? "+" : ""}${esc(hitPointPlan.featDelta)}</span></div>
          </div>
          <div class="levelup-preview-block">
            <h5>Save Proficiencies</h5>
            <div class="levelup-save-row">
              <span class="muted">Current</span>
              <span>${esc(currentSaveLabels.join(", ") || "None")}</span>
            </div>
            <div class="levelup-save-row">
              <span class="muted">After Apply</span>
              <span>${esc(nextSaveLabels.join(", ") || "None")}</span>
            </div>
          </div>
          <div class="levelup-preview-block">
            <h5>Spell Slot Default Changes</h5>
            <div class="levelup-slot-list">${slotChangesHtml}</div>
          </div>
          <div class="levelup-preview-block">
            <h5>Feature Unlock Changes</h5>
            <div class="levelup-slot-list">${featureChangesHtml}</div>
          </div>
          <div class="levelup-preview-block">
            <h5>Auto-Granted Spell Changes</h5>
            <div class="levelup-slot-list">${autoSpellChangesHtml}</div>
          </div>
          <div class="levelup-preview-block">
            <h5>Slot Surface Changes</h5>
            <div class="levelup-save-row"><span class="muted">Feat Slots</span><span>${esc(currentFeatSlots)} -> ${esc(nextFeatSlots)}</span></div>
            <div class="levelup-save-row"><span class="muted">Optional Feature Slots</span><span>${esc(currentOptionalSlots)} -> ${esc(nextOptionalSlots)}</span></div>
          </div>
          <div class="levelup-preview-block">
            <h5>Class Table Effect Changes</h5>
            <div class="levelup-slot-list">${classTableChangesHtml}</div>
          </div>
          <div class="levelup-preview-block">
            <h5>Caster Contribution</h5>
            <div class="levelup-contrib-list">
              ${renderLevelUpContributionRowsImpl(state.catalogs, draft, preview.classLevels)}
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
  }

  function renderTopLogoLink() {
    return `<span data-brand-logo-slot></span>`;
  }

  function renderBuildMode(state) {
    return `
    <main class="layout layout-build">
      <section class="card">
        <div class="title-with-history">
          ${renderTopLogoLink()}
          <h1 class="title">Character Editor</h1>
          ${renderCharacterHistorySelector("build-character-history-select", state.character?.id ?? null, {
            className: "character-history-control character-history-control-inline",
          })}
        </div>
        ${renderPersistenceNotice()}
        <div class="build-controls-row">
          ${getModeToggle(state.mode)}
          ${renderStepperImpl(state.stepIndex)}
        </div>
        <div id="editor">${renderBuildEditorImpl(state)}</div>
        <div class="toolbar">
          <button class="btn secondary" id="prev-step" ${state.stepIndex === 0 ? "disabled" : ""}>Previous</button>
          <button class="btn" id="next-step" ${state.stepIndex === STEPS.length - 1 ? "disabled" : ""}>Next</button>
        </div>
      </section>
      <aside class="card sticky">
        ${renderSummaryImpl(state)}
      </aside>
    </main>
  `;
  }

  function renderPlayMode(state) {
    const { character, derived } = state;
    const play = character?.play ?? {};
    const hpTotal = toNumber(derived?.hp, 0);
    const hpCurrent = play.hpCurrent == null ? hpTotal : toNumber(play.hpCurrent, hpTotal);
    const initiativeBonus = toNumber(derived?.mods?.dex, 0);
    const classTableEffects = Array.isArray(character?.progression?.classTableEffects) ? character.progression.classTableEffects : [];
    const raceSourceOrder = getPreferredSourceOrder(character);
    const raceEntry = getEffectiveRaceEntry(state.catalogs, character, raceSourceOrder);
    const speedRaw = raceEntry?.speed;
    const baseSpeed =
      Number.isFinite(toNumber(speedRaw, Number.NaN))
        ? Math.max(0, Math.floor(toNumber(speedRaw, 30)))
        : speedRaw && typeof speedRaw === "object" && !Array.isArray(speedRaw) && Number.isFinite(toNumber(speedRaw.walk, Number.NaN))
          ? Math.max(0, Math.floor(toNumber(speedRaw.walk, 30)))
          : 30;
    const classTableSpeedBonus = classTableEffects.reduce((sum, effect) => {
      const label = String(effect?.label ?? "").trim().toLowerCase();
      if (!label || (!label.includes("movement") && !label.includes("speed"))) return sum;
      const delta = toNumber(String(effect?.value ?? "").match(/[+\-]?\d+/)?.[0], Number.NaN);
      if (!Number.isFinite(delta)) return sum;
      return sum + delta;
    }, 0);
    const speed = Math.max(0, baseSpeed + classTableSpeedBonus);
    const proficiencyBonus = toNumber(derived?.proficiencyBonus, 0);
    const getPassiveSkillValue = (skillKey, fallbackAbility = "wis") => {
      const skillEntry = skills.find((entry) => entry?.key === skillKey);
      const abilityKey = String(skillEntry?.ability ?? fallbackAbility).trim().toLowerCase();
      const mode = normalizeSkillProficiencyMode(
        play.skillProficiencyModes?.[skillKey] ?? (play.skillProficiencies?.[skillKey] ? "proficient" : "none")
      );
      const skillBonus = getSkillProficiencyBonus(proficiencyBonus, mode);
      return 10 + toNumber(derived?.mods?.[abilityKey], 0) + skillBonus;
    };
    const passivePerception = Number.isFinite(toNumber(derived?.passivePerception, Number.NaN))
      ? toNumber(derived?.passivePerception, 10)
      : getPassiveSkillValue("perception", "wis");
    const passiveInsight = getPassiveSkillValue("insight", "wis");
    const passiveInvestigation = getPassiveSkillValue("investigation", "int");
    const className = String(state.character.class ?? "").trim();
    const subclassName = String(state.character.classSelection?.subclass?.name ?? state.character.subclass ?? "").trim();
    const classHtml = className
      ? `<button type="button" class="pill pill-btn play-character-chip-btn" data-open-class-info title="View class details">${esc(className)}</button>`
      : `<span class="pill play-character-chip-btn is-static">Adventurer</span>`;
    const manualLinks = getPlayManualLinks(state);
    const manualLinksHtml = manualLinks.length
      ? manualLinks
          .map(
            (entry) => `
            <a href="${entry.href}" target="_blank" rel="noopener noreferrer">
              <span class="play-manual-link-label">${esc(entry.label)}</span>
              <span class="play-manual-link-meta">${esc(entry.meta)}</span>
            </a>
          `
          )
          .join("")
      : `<span class="play-manual-empty">No rulebook links available.</span>`;
    const characterLogEntries = Array.isArray(getCharacterChangeLog?.()) ? getCharacterChangeLog() : [];
    const characterLogHtml = characterLogEntries.length
      ? characterLogEntries
          .map((entry) => {
            const timestamp = formatCharacterLogTimestamp(entry?.at ?? "");
            const toneClass = getCharacterLogToneClass(entry?.sectionKey);
            return `
            <article class="character-log-entry ${toneClass}">
              <div class="character-log-meta">
                <span class="character-log-section">${esc(entry?.sectionLabel ?? "Character")}</span>
                <time class="character-log-time" datetime="${esc(timestamp.datetime)}" title="${esc(timestamp.title)}">${esc(timestamp.label)}</time>
              </div>
              <div class="character-log-summary">${renderCharacterLogSummaryParts(entry?.summaryParts)}</div>
              ${renderCharacterLogDetails(entry?.details)}
            </article>
          `;
          })
          .join("")
      : `<span class="character-log-empty">No character changes yet.</span>`;
    return `
    <main class="layout layout-play">
      <section>
        <div class="card">
          <div class="play-header">
            <div class="title-with-history">
              ${renderTopLogoLink()}
              <h1 class="title">Character Sheet</h1>
              ${renderCharacterHistorySelector("play-character-history-select", state.character?.id ?? null, {
                className: "character-history-control character-history-control-inline",
              })}
              <details class="play-manual-menu">
                <summary class="btn secondary play-manual-trigger" title="Open character manual links">
                  <span class="play-manual-icon" aria-hidden="true">📖</span>
                  <span>Manual</span>
                </summary>
                <div class="play-manual-links">
                  ${manualLinksHtml}
                </div>
              </details>
              <details class="play-character-log-menu">
                <summary class="btn secondary play-character-log-trigger" title="Open character change log" aria-label="Open character change log">
                  <span class="play-character-log-icon" aria-hidden="true">📜</span>
                </summary>
                <div class="play-character-log-panel">
                  <div class="character-log-panel-head">
                    <div>
                      <strong>Character Log</strong>
                      <p>Recent rolls and sheet updates</p>
                    </div>
                    <span class="character-log-count">${esc(characterLogEntries.length)}</span>
                  </div>
                  <div class="character-log-list">
                    ${characterLogHtml}
                  </div>
                </div>
              </details>
            </div>
            ${renderPersistenceNotice()}
            <div class="play-header-lower">
              <div class="play-header-main">
                <div class="play-character-summary">
                  <div class="play-character-summary-top">
                    ${getModeToggle(state.mode)}
                    <p class="play-character-inline">
                      <span class="play-character-name">${esc(state.character.name || "Unnamed Hero")}</span>
                      <button type="button" class="pill pill-btn play-character-chip-btn" data-open-levelup>
                        Level ${esc(state.character.level)}
                      </button>
                      ${classHtml}
                      ${
                        subclassName
                          ? `<button type="button" class="pill pill-btn play-character-chip-btn" data-open-subclass-info title="View subclass details">${esc(
                              subclassName
                            )}</button>`
                          : ""
                      }
                    </p>
                  </div>
                  <div class="play-character-summary-main">
                    <div class="play-header-quick-stats">
                      <div class="play-header-quick-stats-col">
                        <div class="pill core-stat-pill">
                          <span class="core-stat-name"><span class="core-stat-icon" aria-hidden="true">❤️</span>HP</span>
                          <span class="core-stat-value">${hpCurrent}/${hpTotal}</span>
                        </div>
                        <div class="pill core-stat-pill">
                          <span class="core-stat-name"><span class="core-stat-icon" aria-hidden="true">🛡️</span>AC</span>
                          <span class="core-stat-value">${derived.ac}</span>
                        </div>
                        <button type="button" class="pill pill-btn core-stat-pill" data-roll-proficiency title="Roll proficiency check">
                          <span class="core-stat-name"><span class="core-stat-icon" aria-hidden="true">🎯</span>Proficiency</span>
                          <span class="core-stat-value">+${derived.proficiencyBonus}</span>
                        </button>
                        <div class="pill core-stat-pill">
                          <span class="core-stat-name"><span class="core-stat-icon" aria-hidden="true">💨</span>Speed</span>
                          <span class="core-stat-value">${speed}</span>
                        </div>
                        <button
                          type="button"
                          class="pill pill-btn core-stat-pill inspiration-pill ${play.inspiration ? "is-active" : ""}"
                          data-toggle-inspiration
                          aria-pressed="${play.inspiration ? "true" : "false"}"
                          title="Toggle inspiration"
                        >
                          <span class="core-stat-name"><span class="core-stat-icon" aria-hidden="true">✨</span>Inspiration</span>
                          <span class="core-stat-value">${play.inspiration ? "Yes" : "No"}</span>
                        </button>
                        <button type="button" class="pill pill-btn core-stat-pill" data-roll-initiative title="Roll initiative">
                          <span class="core-stat-name"><span class="core-stat-icon" aria-hidden="true">⚡</span>Initiative</span>
                          <span class="core-stat-value">${initiativeBonus >= 0 ? "+" : ""}${initiativeBonus}</span>
                        </button>
                      </div>
                      <div class="play-header-quick-stats-col">
                        <div class="pill core-stat-pill">
                          <span class="core-stat-name"><span class="core-stat-icon" aria-hidden="true">👀</span>Passive Perception</span>
                          <span class="core-stat-value">${passivePerception}</span>
                        </div>
                        <div class="pill core-stat-pill">
                          <span class="core-stat-name"><span class="core-stat-icon" aria-hidden="true">🧠</span>Passive Insight</span>
                          <span class="core-stat-value">${passiveInsight}</span>
                        </div>
                        <div class="pill core-stat-pill">
                          <span class="core-stat-name"><span class="core-stat-icon" aria-hidden="true">🔎</span>Passive Investigation</span>
                          <span class="core-stat-value">${passiveInvestigation}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div id="play-header-dice-slot" class="play-header-dice-slot"></div>
            </div>
          </div>
        </div>
        ${renderPlayViewImpl(state)}
      </section>
    </main>
  `;
  }

  return {
    renderBuildMode,
    renderPlayMode,
    renderSaveRows: renderSaveRowsImpl,
    renderSkillRows: renderSkillRowsImpl,
    renderBuildEditor: renderBuildEditorImpl,
    renderSummary: renderSummaryImpl,
    renderBuildSpellSlotRow: renderBuildSpellSlotRowImpl,
    renderBuildSpellList: renderBuildSpellListImpl,
    renderSpellGroupsByLevel: renderSpellGroupsByLevelImpl,
    renderPlayView: renderPlayViewImpl,
    renderStepper: renderStepperImpl,
    renderBuildFeatSlots: renderBuildFeatSlotsImpl,
    renderLevelUpContributionRows: renderLevelUpContributionRowsImpl,
    renderLevelUpBody: renderLevelUpBodyImpl,
  };
}

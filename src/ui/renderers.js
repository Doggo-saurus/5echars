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
    getAllowedSources,
    optionList,
    getSubclassSelectOptions,
    getFeatSlotsWithSelection,
    getCharacterSpellSlotDefaults,
    getSpellSlotValues,
    getSpellByName,
    getSpellLevelLabel,
    spellSchoolLabels,
    getRuleDescriptionLines,
    doesClassUsePreparedSpells,
    getPreparedSpellLimit,
    countPreparedSpells,
    getSaveProficiencyLabelMap,
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
  } = deps;

  function renderSaveRowsImpl(state, options = {}) {
    const { character, derived } = state;
    const { canToggle = false, includeRollButtons = false } = options;
    const play = character.play ?? {};

    return saveAbilities
      .map((ability) => {
        const score = toNumber(character.abilities?.[ability], 10);
        const mod = derived.mods[ability];
        const isProf = Boolean(play.saveProficiencies?.[ability]);
        const total = mod + (isProf ? derived.proficiencyBonus : 0);
        const abilityLabel = abilityLabels[ability] ?? ability.toUpperCase();
        const saveName = `${abilityLabel} Save`;
        const profControl = canToggle
          ? `
            <button
              type="button"
              class="save-prof-btn ${isProf ? "is-active" : ""}"
              data-save-prof-btn="${ability}"
              aria-pressed="${isProf ? "true" : "false"}"
            >
              ${isProf ? "P" : "-"}
            </button>
          `
          : `
            <span class="save-prof-btn is-readonly ${isProf ? "is-active" : ""}" aria-hidden="true">
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
      <div class="ability-save-row">
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

    return skills
      .map((skill) => {
        const isProf = Boolean(play.skillProficiencies?.[skill.key]);
        const total = derived.mods[skill.ability] + (isProf ? derived.proficiencyBonus : 0);
        const profControl = canToggle
          ? `
            <button
              type="button"
              class="skill-prof-btn ${isProf ? "is-active" : ""}"
              data-skill-prof-btn="${skill.key}"
              aria-pressed="${isProf ? "true" : "false"}"
              title="Toggle proficiency"
            >
              ${isProf ? "P" : "-"}
            </button>
          `
          : `
            <span class="skill-prof-btn is-readonly ${isProf ? "is-active" : ""}" aria-hidden="true">
              ${isProf ? "P" : "-"}
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
        <div class="skill-btn ${isProf ? "is-active" : ""}">
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

  function getSelectedChoiceValues(character, sourceKey, choiceId, from, count) {
    const selectionMap = getAutoChoiceSelectionMap(character, sourceKey);
    const storedRaw = selectionMap[choiceId];
    const stored = (Array.isArray(storedRaw) ? storedRaw : [])
      .map((entry) => String(entry ?? "").trim().toLowerCase())
      .filter((entry) => from.includes(entry));
    const uniqueStored = stored.filter((entry, index) => stored.indexOf(entry) === index);
    const normalizedByOrder = from.filter((entry) => uniqueStored.includes(entry));
    if (!normalizedByOrder.length) return from.slice(0, Math.max(0, Math.min(from.length, count)));
    return normalizedByOrder.slice(0, Math.max(0, Math.min(from.length, count)));
  }

  function getStoredChoiceValuesOnly(character, sourceKey, choiceId, from, count, options = {}) {
    const allowDuplicates = Boolean(options?.allowDuplicates);
    const selectionMap = getAutoChoiceSelectionMap(character, sourceKey);
    const storedRaw = selectionMap[choiceId];
    const stored = (Array.isArray(storedRaw) ? storedRaw : [])
      .map((entry) => String(entry ?? "").trim().toLowerCase())
      .filter((entry) => from.includes(entry));
    if (allowDuplicates) return stored.slice(0, Math.max(0, Math.min(from.length, count)));
    const uniqueStored = stored.filter((entry, index) => stored.indexOf(entry) === index);
    const normalizedByOrder = from.filter((entry) => uniqueStored.includes(entry));
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
    const selected = getSelectedChoiceValues(context.character, context.sourceKey, choiceId, from, count);
    for (let idx = 0; idx < selected.length; idx += 1) {
      const ability = selected[idx];
      if (!ability) continue;
      const amount = Math.max(1, toNumber(weightValues[idx], fallbackAmount));
      bonuses[ability] = Math.max(0, toNumber(bonuses[ability], 0) + amount);
    }
  }

  function getAbilityBonusesSummary(entry, sourceKey, character) {
    const bonuses = saveAbilities.reduce((acc, ability) => {
      acc[ability] = 0;
      return acc;
    }, {});
    const abilityOptions = Array.isArray(entry?.ability) ? entry.ability : [];
    const optionIndex = abilityOptions.findIndex((option) => option && typeof option === "object");
    const selected = optionIndex >= 0 ? abilityOptions[optionIndex] : null;
    if (!selected) return "";
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
    return saveAbilities
      .filter((ability) => toNumber(bonuses[ability], 0) > 0)
      .map((ability) => `${abilityLabels[ability] ?? ability.toUpperCase()} +${toNumber(bonuses[ability], 0)}`)
      .join(", ");
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

  function renderChoiceCheckboxes(sourceKey, choiceId, count, options, selectedValues, labelFn) {
    return `
      <div class="auto-choice-group">
        <p class="muted auto-choice-label">Pick ${count}</p>
        <div class="auto-choice-options">
          ${options
            .map((optionValue) => {
              const option = String(optionValue ?? "").trim().toLowerCase();
              if (!option) return "";
              const checked = selectedValues.includes(option);
              return `
                <label class="auto-choice-option">
                  <input
                    type="checkbox"
                    data-auto-choice-input="1"
                    data-auto-choice-source="${esc(sourceKey)}"
                    data-auto-choice-id="${esc(choiceId)}"
                    data-auto-choice-value="${esc(option)}"
                    data-auto-choice-max="${esc(count)}"
                    ${checked ? "checked" : ""}
                  >
                  <span>${esc(labelFn(option))}</span>
                </label>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function renderChoiceSelects(sourceKey, choiceId, count, options, selectedValues, labelFn) {
    return `
      <div class="auto-choice-group">
        <p class="muted auto-choice-label">Spend ${count} points</p>
        <div class="auto-choice-selects">
          ${Array.from({ length: count }, (_, index) => {
            const selected = String(selectedValues[index] ?? "").trim().toLowerCase();
            return `
              <label class="auto-choice-select">
                <span class="muted">Point ${index + 1}</span>
                <select
                  data-asi-choice-select="1"
                  data-auto-choice-source="${esc(sourceKey)}"
                  data-auto-choice-id="${esc(choiceId)}"
                  data-auto-choice-max="${esc(count)}"
                >
                  <option value="">(none)</option>
                  ${options
                    .map((optionValue) => {
                      const option = String(optionValue ?? "").trim().toLowerCase();
                      if (!option) return "";
                      const isSelected = option === selected;
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

  function renderAutoChoiceEditorsForEntity(entry, sourceKey, character) {
    const blocks = [];
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
        const selected = getSelectedChoiceValues(character, sourceKey, choiceId, from, count);
        blocks.push(`
          <div class="auto-choice-card">
            <p class="muted"><strong>${esc(sourceKey === "race" ? "Race" : "Background")} ability choice</strong></p>
            ${renderChoiceCheckboxes(sourceKey, choiceId, count, from, selected, (ability) => abilityLabels[ability] ?? ability.toUpperCase())}
          </div>
        `);
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
            <p class="muted"><strong>${esc(sourceKey === "race" ? "Race" : "Background")} skill choice</strong></p>
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
              <p class="muted"><strong>${esc(sourceKey === "race" ? "Race" : "Background")} skill choice</strong></p>
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
          <button type="button" class="spell-slot-btn" data-build-slot-default="${level}" ${isOverridden ? "" : "disabled"} aria-label="Reset level ${level} slots to class defaults">Default</button>
          <span class="muted">Used ${used}/${max}</span>
        </div>
      </div>
    </div>
  `;
  }

  function renderBuildSpellListImpl(character, catalogs) {
    const selectedSpells = Array.isArray(character?.spells) ? character.spells : [];
    if (!selectedSpells.length) return "<span class='muted'>No spells selected.</span>";

    const spellByName = new Map((catalogs?.spells ?? []).map((spell) => [spell.name, spell]));
    const groupedByLevel = new Map();

    selectedSpells.forEach((spellName) => {
      const spell = spellByName.get(spellName);
      const level = spell ? Math.max(0, toNumber(spell.level, 0)) : 99;
      const list = groupedByLevel.get(level) ?? [];
      list.push(spellName);
      groupedByLevel.set(level, list);
    });

    return [...groupedByLevel.entries()]
      .sort(([a], [b]) => a - b)
      .map(([level, names]) => {
        const levelLabel = level === 99 ? "Unknown Level" : getSpellLevelLabel(level);
        const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
        return `
        <section class="build-spell-level-card">
          <div class="build-spell-level-head">
            <h5 class="build-spell-level-title">${esc(levelLabel)}</h5>
            <span class="pill build-spell-count">${sortedNames.length}</span>
          </div>
          <div class="build-spell-chip-row">
            ${sortedNames
              .map(
                (name) =>
                  `<button type="button" class="pill pill-btn build-spell-pill-btn" data-build-spell-open="${esc(name)}" title="View spell details">${esc(name)}</button>`
              )
              .join("")}
          </div>
        </section>
      `;
      })
      .join("");
  }

  function renderSpellGroupsByLevelImpl(state) {
    const play = state.character.play ?? {};
    const defaultSpellSlots = getCharacterSpellSlotDefaults(state.catalogs, state.character);
    const usesPreparedSpells = doesClassUsePreparedSpells(state.catalogs, state.character);
    const preparedLimit = usesPreparedSpells ? getPreparedSpellLimit(state) : Infinity;
    const preparedCount = usesPreparedSpells ? countPreparedSpells(state) : 0;
    const grouped = new Map();

    (state.character.spells ?? []).forEach((name) => {
      const spell = getSpellByName(state, name);
      const level = spell ? toNumber(spell.level, 0) : 99;
      const isCantrip = level === 0;
      const existing = play.preparedSpells?.[name];
      const isPrepared = usesPreparedSpells ? (isCantrip ? true : Boolean(existing)) : true;
      const slotInfo = level > 0 ? getSpellSlotValues(play, defaultSpellSlots, level) : { max: Infinity, used: 0 };
      const hasSlotsAvailable = level === 0 || toNumber(slotInfo.max, 0) - toNumber(slotInfo.used, 0) > 0;
      const stateClass = !isPrepared ? "is-unprepared" : hasSlotsAvailable ? "is-prepared-available" : "is-prepared-unavailable";
      const canTogglePrepared = !isCantrip && (isPrepared || preparedCount < preparedLimit);
      const row = { name, spell, level, isPrepared, canTogglePrepared, isCantrip };
      const list = grouped.get(level) ?? [];
      list.push({ ...row, stateClass, hasSlotsAvailable });
      grouped.set(level, list);
    });

    if (!grouped.size) return "<span class='muted'>No spells selected.</span>";

    return [...grouped.entries()]
      .sort(([a], [b]) => a - b)
      .map(([level, rows]) => {
        const title = level === 99 ? "Unknown Level" : getSpellLevelLabel(level);
        const body = rows
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(({ name, spell, isPrepared, stateClass, hasSlotsAvailable, canTogglePrepared, isCantrip }) => {
            const school = spell?.school ? spellSchoolLabels[spell.school] ?? spell.school : "";
            const source = spell?.sourceLabel ?? spell?.source ?? "";
            const meta = [school, source].filter(Boolean).join(" - ");
            const knownTag = usesPreparedSpells ? (isPrepared ? "Prepared" : "Unprepared") : "Known";
            const slotTag = toNumber(spell?.level, 0) > 0 && isPrepared ? (hasSlotsAvailable ? "Slots OK" : "No Slots") : "";
            const knownAndSlotTag = slotTag ? `${knownTag} · ${slotTag}` : knownTag;
            const prepButtonTitle = isCantrip
              ? "Cantrips are always prepared"
              : !isPrepared && !canTogglePrepared
                ? "Preparation limit reached"
                : "Toggle prepared";
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
              <span class="spell-meta muted">${esc(meta || "No metadata")}</span>
              <button type="button" class="btn secondary spell-cast-btn" data-spell-cast="${esc(name)}">Cast</button>
            </div>
          `;
          })
          .join("");
        return `
        <section class="spell-level-group">
          <h5 class="spell-level-title">${esc(title)}</h5>
          <div class="spell-level-list">${body}</div>
        </section>
      `;
      })
      .join("");
  }

  function renderPlayViewImpl(state) {
    const { character, derived } = state;
    const play = character.play ?? {};
    const defaultSpellSlots = getCharacterSpellSlotDefaults(state.catalogs, character);
    const hpTotal = derived.hp;
    const hpCurrent = play.hpCurrent == null ? hpTotal : play.hpCurrent;
    const hpTemp = toNumber(play.hpTemp, 0);
    const speed = toNumber(play.speed, 30);
    const initiativeBonus = toNumber(play.initiativeBonus, 0);
    const conditionText = (play.conditions ?? []).map((c) => `<span class="pill">${esc(c)}</span>`).join(" ");

    const savesHtml = renderSaveRowsImpl(state, { canToggle: false, includeRollButtons: true });
    const skillsHtml = renderSkillRowsImpl(state, { canToggle: false, includeRollButtons: true });

    const attackMode = play.attackMode === "edit" ? "edit" : "view";
    const autoAttacksRaw = getAutoAttacks?.(state);
    const autoAttacks = Array.isArray(autoAttacksRaw) ? autoAttacksRaw : [];
    const manualAttacks = Array.isArray(play.attacks) ? play.attacks : [];
    const attacksHtml = [...autoAttacks, ...manualAttacks]
      .map((attack, idx) => {
        const isAutoAttack = attack?.source === "auto";
        const attackName = attack.name?.trim() || `Attack ${idx + 1}`;
        if (attackMode === "edit") {
          if (isAutoAttack) {
            return `
          <div class="attack-card attack-card-view">
            <div class="attack-row-top">
              <strong class="attack-title">${esc(attackName)}</strong>
            </div>
            <p class="attack-help muted">Auto from equipped weapon (${String(attack.ability ?? "").toUpperCase()}${attack.proficient ? ", proficient" : ", not proficient"}).</p>
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
                To Hit: ${esc(attack.toHit || "n/a")}
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
                Damage: ${esc(attack.damage || "n/a")}
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
                placeholder="Attack name"
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
                placeholder="+To hit"
                value="${esc(attack.toHit ?? "")}"
                data-attack-field="${manualIdx}:toHit"
              >
              <input
                id="attack-dmg-${manualIdx}"
                placeholder="Damage"
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
            <strong class="attack-title">${esc(attackName)}</strong>
          </div>
          <div class="attack-row-stats attack-row-stats-view">
            <button
              type="button"
              class="pill pill-btn attack-pill"
              ${isAutoAttack ? `data-auto-attack-roll="${esc(idx)}:toHit"` : `data-attack-roll="${esc(idx - autoAttacks.length)}:toHit"`}
              ${isAutoAttack ? `data-auto-attack-name="${esc(attackName)}" data-auto-attack-to-hit="${esc(attack.toHit || "")}" data-auto-attack-damage="${esc(attack.damage || "")}"` : ""}
              aria-label="Roll ${esc(attackName)} to hit"
            >
              To Hit: ${esc(attack.toHit || "n/a")}
            </button>
            <button
              type="button"
              class="pill pill-btn attack-pill"
              ${isAutoAttack ? `data-auto-attack-roll="${esc(idx)}:damage"` : `data-attack-roll="${esc(idx - autoAttacks.length)}:damage"`}
              ${isAutoAttack ? `data-auto-attack-name="${esc(attackName)}" data-auto-attack-to-hit="${esc(attack.toHit || "")}" data-auto-attack-damage="${esc(attack.damage || "")}"` : ""}
              aria-label="Roll ${esc(attackName)} damage"
            >
              Damage: ${esc(attack.damage || "n/a")}
            </button>
          </div>
        </div>
      `;
      })
      .join("");

    const resourcesHtml = (play.resources ?? [])
      .map(
        (resource, idx) => `
    <div class="play-grid-4">
      <input id="resource-name-${idx}" placeholder="Resource name" value="${esc(resource.name ?? "")}" data-resource-field="${idx}:name">
      <input id="resource-current-${idx}" type="number" min="0" placeholder="Current" value="${esc(resource.current ?? 0)}" data-resource-field="${idx}:current">
      <input id="resource-max-${idx}" type="number" min="0" placeholder="Max" value="${esc(resource.max ?? 0)}" data-resource-field="${idx}:max">
      <button class="btn secondary" data-remove-resource="${idx}">Remove</button>
    </div>
  `
      )
      .join("");
    const unlockedFeatures = Array.isArray(character?.progression?.unlockedFeatures) ? character.progression.unlockedFeatures : [];
    const featSlots = Array.isArray(character?.progression?.featSlots) ? character.progression.featSlots : [];
    const selectedFeats = Array.isArray(character?.feats) ? character.feats : [];
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
            const sourceLabel = String((detail?.sourceLabel ?? detail?.source ?? featSource) || "UNK");
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
                    ${feat.levelGranted ? `Lv ${esc(feat.levelGranted)}` : "Level n/a"} - ${esc(feat.via || "feat slot")}${
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

    const spellStatus = latestSpellCastStatus();

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
        <article class="card">
          <h3 class="title">Core Stats</h3>
          <div class="summary-grid">
            <div class="pill">HP ${hpCurrent}/${hpTotal}</div>
            <div class="pill">AC ${derived.ac}</div>
            <div class="pill">Proficiency +${derived.proficiencyBonus}</div>
            <div class="pill">Passive Perception ${derived.passivePerception}</div>
            <button type="button" class="pill pill-btn" data-roll-initiative title="Roll initiative">
              Initiative ${initiativeBonus >= 0 ? "+" : ""}${initiativeBonus}
            </button>
          </div>
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
          <div class="play-inline-row hp-pair-row">
            <label class="inline-field hp-control">Speed
              <div class="num-input-wrap">
                <input id="play-speed" type="number" min="0" value="${esc(speed)}">
                <div class="num-stepper">
                  <button type="button" class="num-step-btn" data-step-target="speed" data-step-delta="1">+</button>
                  <button type="button" class="num-step-btn" data-step-target="speed" data-step-delta="-1">-</button>
                </div>
              </div>
            </label>
            <label class="inline-field hp-control hp-control-right">Initiative Bonus
              <div class="num-input-wrap">
                <input id="play-initiative-bonus" type="number" value="${esc(initiativeBonus)}">
                <div class="num-stepper">
                  <button type="button" class="num-step-btn" data-step-target="initiative-bonus" data-step-delta="1">+</button>
                  <button type="button" class="num-step-btn" data-step-target="initiative-bonus" data-step-delta="-1">-</button>
                </div>
              </div>
            </label>
          </div>
          <div class="play-inline-row death-save-row">
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
        </article>

        <article class="card">
          <h3 class="title">Abilities & Saves</h3>
          <div class="play-list ability-save-grid">${savesHtml}</div>
        </article>

        <article class="card">
          <h3 class="title">Skills</h3>
          <div class="play-list skill-grid">${skillsHtml}</div>
        </article>

        <article class="card">
          <div class="attack-title-row">
            <h3 class="title">Attacks & Actions</h3>
            <button type="button" class="btn secondary attack-mode-btn" data-attack-mode-toggle>
              ${attackMode === "edit" ? "View" : "Edit"}
            </button>
          </div>
          ${attackMode === "edit" ? '<div class="toolbar attack-mode-toolbar"><button class="btn secondary" id="add-attack">Add Attack</button></div>' : ""}
          <div class="play-list">
            ${attacksHtml || "<p class='muted'>No attack entries yet.</p>"}
          </div>
        </article>

        <article class="card">
          <h3 class="title">Spells & Slots</h3>
          <div class="play-list spell-slot-grid">
            ${spellSlotLevels.map((level) => getSpellSlotRow(play, defaultSpellSlots, level)).join("")}
          </div>
          <h4>Prepared/Known Spells</h4>
          <p class="muted spell-prep-help">Toggle P to mark prepared. Click a spell name to view details and roll from its description.</p>
          <div id="spell-cast-status" class="spell-cast-status ${spellStatus.isError ? "is-error" : ""}" ${spellStatus.message ? "" : "hidden"}>${esc(
            spellStatus.message
          )}</div>
          <div class="spell-level-groups">${renderSpellGroupsByLevelImpl(state)}</div>
        </article>

        <article class="card">
          <h3 class="title">Features & Feats</h3>
          <h4>Class/Subclass Features</h4>
          ${featureListHtml ? `<ul class="class-feature-list">${featureListHtml}</ul>` : "<p class='muted'>No unlocked class features.</p>"}
          <h4>Feats</h4>
          <div>${featListHtml}</div>
        </article>

        <article class="card">
          <h3 class="title">Inventory & Conditions</h3>
          <h4>Inventory</h4>
          <div class="toolbar">
            <button class="btn secondary" id="play-open-items">Add Item</button>
          </div>
          <div class="inventory-list">${renderInventoryRowsImpl(character)}</div>
          <div class="play-inline-row">
            <input id="play-condition-input" placeholder="Add condition (e.g. Poisoned)">
            <button class="btn secondary" id="add-condition">Add</button>
          </div>
          <div class="pill-list">${conditionText || "<span class='muted'>No conditions tracked.</span>"}</div>
          <div class="play-inline-row">
            ${(play.conditions ?? []).map((condition, idx) => `<button class="btn secondary" data-remove-condition="${idx}">Remove ${esc(condition)}</button>`).join("")}
          </div>
          <label>Combat Notes
            <textarea id="play-notes" rows="4" style="width:100%; background:#0b1220; color:#e5e7eb; border:1px solid rgba(255,255,255,0.2); border-radius:10px; padding:0.6rem;">${esc(
              play.notes ?? ""
            )}</textarea>
          </label>
        </article>

        <article class="card">
          <h3 class="title">Resources & Rest</h3>
          <div class="play-list">
            ${resourcesHtml || "<p class='muted'>No resource trackers yet.</p>"}
          </div>
          <div class="toolbar">
            <button class="btn secondary" id="add-resource">Add Resource</button>
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
      return `
      <h2 class="title">Source Preset</h2>
      <p class="subtitle">Choose what books are legal in this builder run.</p>
      <label>Preset
        <select id="source-preset">
          ${Object.keys(sourcePresets)
            .map((key) => `<option value="${key}" ${key === character.sourcePreset ? "selected" : ""}>${esc(sourcePresetLabels[key] ?? key)}</option>`)
            .join("")}
        </select>
      </label>
      <p class="muted">Allowed sources: ${getAllowedSources(character.sourcePreset).join(", ")}</p>
    `;
    }
    if (stepIndex === 1) {
      return `
      <h2 class="title">Basics</h2>
      <div class="row">
        <label>Name <input id="name" value="${esc(character.name)}"></label>
        <label>Level <input type="number" min="1" max="20" id="level" value="${esc(character.level)}"></label>
      </div>
      <div class="toolbar">
        <button class="btn secondary" type="button" data-open-levelup>Level Up</button>
      </div>
      <label>Notes <input id="notes" value="${esc(character.notes)}"></label>
    `;
    }
    if (stepIndex === 2) {
      const selectedRace = findCatalogEntryByName(catalogs.races, character.race);
      const selectedBackground = findCatalogEntryByName(catalogs.backgrounds, character.background);
      const raceAbilitySummary = getAbilityBonusesSummary(selectedRace, "race", character);
      const raceSkillSummary = getSkillProficiencySummary(selectedRace, "race", character);
      const backgroundAbilitySummary = getAbilityBonusesSummary(selectedBackground, "background", character);
      const backgroundSkillSummary = getSkillProficiencySummary(selectedBackground, "background", character);
      const raceChoiceEditors = renderAutoChoiceEditorsForEntity(selectedRace, "race", character);
      const backgroundChoiceEditors = renderAutoChoiceEditorsForEntity(selectedBackground, "background", character);
      return `
      <h2 class="title">Ancestry & Background</h2>
      <div class="row">
        <label>Race
          <select id="race">
            <option value="">Select race</option>
            ${optionList(catalogs.races, character.race)}
          </select>
        </label>
        <label>Background
          <select id="background">
            <option value="">Select background</option>
            ${optionList(catalogs.backgrounds, character.background)}
          </select>
        </label>
      </div>
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
      return `
      <h2 class="title">Class & Multiclass</h2>
      <div class="row">
        <label>Class
          <select id="class">
            <option value="">Select class</option>
            ${optionList(catalogs.classes, character.class)}
          </select>
        </label>
        <label>Subclass
          <select id="subclass-select">
            <option value="">Select subclass</option>
            ${subclassOptions
              .map(
                (entry) =>
                  `<option value="${esc(entry.name)}|${esc(entry.source)}" ${entry.isSelected ? "selected" : ""}>${esc(entry.name)} (${esc(
                    entry.sourceLabel || entry.source || "UNK"
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
      <h3 class="title">Feat Slots</h3>
      <p class="subtitle">Feat slots are generated from class progression. Fill each slot from the 5etools feat catalog.</p>
      <div class="option-list">
        ${renderBuildFeatSlotsImpl(character)}
      </div>
    `;
    }
    if (stepIndex === 4) {
      const saveRows = renderSaveRowsImpl(state, { canToggle: true, includeRollButtons: false });
      const skillRows = renderSkillRowsImpl(state, { canToggle: true, includeRollButtons: false });
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
      <p class="subtitle">Simple inventory list with modal picker.</p>
      <div class="toolbar">
        <button class="btn secondary" id="open-items">Pick Items</button>
      </div>
      <div class="inventory-list">${renderInventoryRowsImpl(character)}</div>
    `;
    }
    if (stepIndex === 6) {
      const play = character.play ?? {};
      const defaultSpellSlots = getCharacterSpellSlotDefaults(catalogs, character);
      return `
      <h2 class="title">Spells</h2>
      <p class="subtitle">Use modal for quick search and selection.</p>
      <div class="toolbar">
        <button class="btn secondary" id="open-spells">Pick Spells</button>
      </div>
      <div class="build-spell-list">
        ${renderBuildSpellListImpl(character, catalogs)}
      </div>
      <h4>Spell Slots (Edit Max)</h4>
      <p class="muted spell-prep-help">Defaults come from 5etools class progression, including multiclass caster-level rules when secondary classes are set. Override only when needed.</p>
      <div class="play-list spell-slot-grid">
        ${spellSlotLevels.map((level) => renderBuildSpellSlotRowImpl(play, defaultSpellSlots, level)).join("")}
      </div>
    `;
    }
    const permalinkUrl = character.id ? `${window.location.origin}${window.location.pathname}?char=${encodeURIComponent(character.id)}` : "";
    return `
    <h2 class="title">Review & Export</h2>
    <p class="subtitle">Copy JSON to move this sheet between machines. Permanent links use UUID URLs.</p>
    <div class="toolbar">
      <button class="btn" id="create-permanent-character">${character.id ? "Save Character Link" : "Create Permanent Character Link"}</button>
      <button class="btn secondary" id="copy-character-link" ${character.id ? "" : "disabled"}>Copy Character Link</button>
    </div>
    ${
      character.id
        ? `<p class="muted">Bookmark this URL to reopen: <code>${esc(permalinkUrl)}</code></p>`
        : `<p class="muted">No UUID link yet. Create one, then bookmark that page URL.</p>`
    }
    <textarea id="export-json" rows="12" style="width:100%; background:#0b1220; color:#e5e7eb; border:1px solid rgba(255,255,255,0.2); border-radius:10px; padding:0.6rem;">${esc(
      JSON.stringify(character, null, 2)
    )}</textarea>
    <div class="toolbar">
      <button class="btn secondary" id="import-json">Import JSON</button>
    </div>
  `;
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
    <p class="muted">${character.multiclass.length ? character.multiclass.map((m) => `${m.class} ${m.level}`).join(", ") : "None"}</p>
  `;
  }

  function renderStepperImpl(stepIndex) {
    return `
    <div class="stepper">
      ${STEPS.map(
        (step, i) => `
        <button data-step="${i}" class="${i === stepIndex ? "active" : ""}">${i + 1}. ${esc(step)}</button>
      `
      ).join("")}
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
            <div class="auto-choice-shell">
              <p class="muted"><strong>ASI choice</strong> Pick up to two abilities to gain +1 each.</p>
              ${renderChoiceSelects(
                asiSourceKey,
                asiChoiceId,
                2,
                saveAbilities,
                asiSelected,
                (ability) => abilityLabels[ability] ?? ability.toUpperCase()
              )}
            </div>
          `
          : "";
        return `
        <div class="option-row">
          <div>
            <strong>${esc(slotLabel)}</strong>
            <div class="muted">${slot.feat ? `${esc(slot.feat.name)} (${esc(slot.feat.source || "UNK")})` : "No feat selected."}</div>
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

    return `
    <div class="levelup-shell">
      <p class="subtitle">Plan level changes for both play and edit mode. Required class settings are updated from 5etools data.</p>
      <div class="levelup-grid">
        <section class="levelup-card">
          <h4>Class Levels</h4>
          <div class="row">
            <label>Total Level
              <input id="levelup-total-level" type="number" min="1" max="20" value="${esc(draft.totalLevel)}">
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
                    <input type="number" min="1" max="20" data-levelup-mc-level="${idx}" value="${esc(entry.level)}">
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
        </section>
        <section class="levelup-card">
          <h4>Required Updates Preview</h4>
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

  function renderBuildMode(state) {
    return `
    <main class="layout">
      <section class="card">
        <div class="title-with-history">
          <h1 class="title">Character Editor</h1>
          ${renderCharacterHistorySelector("build-character-history-select", state.character?.id ?? null, {
            className: "character-history-control character-history-control-inline",
          })}
        </div>
        ${renderPersistenceNotice()}
        ${getModeToggle(state.mode)}
        ${renderStepperImpl(state.stepIndex)}
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
    const className = String(state.character.class ?? "").trim();
    const subclassName = String(state.character.classSelection?.subclass?.name ?? state.character.subclass ?? "").trim();
    const classHtml = className
      ? `<button type="button" class="class-info-btn" data-open-class-info title="View class details">${esc(className)}</button>`
      : "Adventurer";
    return `
    <main class="layout layout-play">
      <section>
        <div class="card">
          <div class="play-header">
            <div class="play-header-main">
              <div class="title-with-history">
                <h1 class="title">Character Sheet</h1>
                ${renderCharacterHistorySelector("play-character-history-select", state.character?.id ?? null, {
                  className: "character-history-control character-history-control-inline",
                })}
              </div>
              ${renderPersistenceNotice()}
              ${getModeToggle(state.mode)}
              <p class="muted">
                ${esc(state.character.name || "Unnamed Hero")} - Level ${esc(state.character.level)}
                ${classHtml}
                ${subclassName ? ` (${esc(subclassName)})` : ""}
              </p>
              <div class="toolbar">
                <button class="btn secondary" type="button" data-open-levelup>Level Up</button>
              </div>
            </div>
            <div id="play-header-dice-slot" class="play-header-dice-slot"></div>
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

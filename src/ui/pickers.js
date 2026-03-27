export function createPickers(deps) {
  const {
    openModal,
    store,
    esc,
    toNumber,
    matchesSearchQuery,
    buildEntityId,
    doesCharacterMeetFeatPrerequisites,
    updateCharacterWithRequiredSettings,
    getSpellByName,
    getSpellLevelLabel,
    spellSchoolLabels,
    formatSpellTime,
    formatSpellRange,
    formatSpellDuration,
    formatSpellComponents,
    getSpellDescriptionLines,
    renderTextWithInlineDiceButtons,
    rollVisualNotation,
    setDiceResult,
  } = deps;

  function openSpellDetailsModal(state, spellName) {
    const spell = getSpellByName(state, spellName);
    if (!spell) {
      setDiceResult(`Spell details unavailable: ${spellName}`, true);
      return;
    }

    const metaRows = [
      { label: "Level", value: getSpellLevelLabel(spell.level) },
      { label: "School", value: spellSchoolLabels[spell.school] ?? spell.school ?? "" },
      { label: "Casting Time", value: formatSpellTime(spell) },
      { label: "Range", value: formatSpellRange(spell) },
      { label: "Duration", value: formatSpellDuration(spell) },
      { label: "Components", value: formatSpellComponents(spell) },
      { label: "Source", value: spell.sourceLabel ?? spell.source ?? "" },
    ].filter((row) => row.value);

    const descriptionLines = getSpellDescriptionLines(spell);
    const descriptionHtml = descriptionLines.length
      ? descriptionLines
          .map((line) => {
            const body = renderTextWithInlineDiceButtons(line);
            return `<p>${body}</p>`;
          })
          .join("")
      : "<p class='muted'>No description text available for this spell.</p>";

    openModal({
      title: spell.name,
      bodyHtml: `
      <div class="spell-meta-grid">
        ${metaRows.map((row) => `<div><strong>${esc(row.label)}:</strong> ${esc(row.value)}</div>`).join("")}
      </div>
      <p class="muted spell-detail-help">Click a dice expression in the text to roll it.</p>
      <div class="spell-description">${descriptionHtml}</div>
    `,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });

    document.querySelectorAll("[data-spell-roll]").forEach((button) => {
      button.addEventListener("click", () => {
        const notation = button.dataset.spellRoll;
        if (!notation) return;
        close();
        rollVisualNotation(`${spell.name}`, notation);
      });
    });
  }

  function openSpellModal(state) {
    const normalizeName = (value) => String(value ?? "").trim().toLowerCase();
    const getCharacterClasses = (character) => {
      const classes = [];
      const primaryClass = String(character?.class ?? "").trim();
      if (primaryClass) classes.push(primaryClass);
      const multiclass = Array.isArray(character?.multiclass) ? character.multiclass : [];
      multiclass.forEach((entry) => {
        const className = String(entry?.class ?? "").trim();
        if (className) classes.push(className);
      });
      return [...new Set(classes.map((name) => normalizeName(name)).filter(Boolean))];
    };
    const getSelectedSubclass = (character) => {
      const subclassSelection = character?.classSelection?.subclass;
      if (subclassSelection && typeof subclassSelection === "object") {
        const subclassName = String(subclassSelection.name ?? "").trim();
        const className = String(subclassSelection.className ?? character?.class ?? "").trim();
        if (subclassName && className) return { subclassName, className };
      }
      const legacySubclassName = String(character?.subclass ?? "").trim();
      const className = String(character?.class ?? "").trim();
      if (legacySubclassName && className) return { subclassName: legacySubclassName, className };
      return null;
    };
    const doesLookupListClass = (lookup, className) => {
      const normalizedClass = normalizeName(className);
      if (!normalizedClass || !lookup || typeof lookup !== "object") return false;
      return Object.values(lookup).some((sourceMap) =>
        Object.keys(sourceMap ?? {}).some((listedClass) => normalizeName(listedClass) === normalizedClass)
      );
    };
    const doesLookupListSubclass = (lookup, className, subclassName) => {
      const normalizedClass = normalizeName(className);
      const normalizedSubclass = normalizeName(subclassName);
      if (!normalizedClass || !normalizedSubclass || !lookup || typeof lookup !== "object") return false;
      return Object.values(lookup).some((classMap) =>
        Object.entries(classMap ?? {}).some(([listedClass, subclassBySource]) => {
          if (normalizeName(listedClass) !== normalizedClass) return false;
          return Object.values(subclassBySource ?? {}).some((subclassMap) =>
            Object.keys(subclassMap ?? {}).some((listedSubclass) => normalizeName(listedSubclass) === normalizedSubclass)
          );
        })
      );
    };
    const isSpellAvailableToCharacter = (spell, character) => {
      const classNames = getCharacterClasses(character);
      if (!classNames.length) return true;
      const spellSourceEntry = spell?.spellSourceEntry;
      const classLookup = spellSourceEntry?.class;
      const subclassLookup = spellSourceEntry?.subclass;
      if (!classLookup && !subclassLookup) return true;
      if (classNames.some((className) => doesLookupListClass(classLookup, className))) return true;
      const selectedSubclass = getSelectedSubclass(character);
      if (!selectedSubclass) return false;
      return doesLookupListSubclass(subclassLookup, selectedSubclass.className, selectedSubclass.subclassName);
    };
    const getEligibilityHint = (character) => {
      const classNames = getCharacterClasses(character);
      if (!classNames.length) return "Showing all spells (no class selected).";
      const classLabel = classNames.map((name) => name.slice(0, 1).toUpperCase() + name.slice(1)).join(", ");
      const selectedSubclass = getSelectedSubclass(character);
      if (selectedSubclass) {
        return `Showing spells for ${classLabel} and ${selectedSubclass.subclassName}.`;
      }
      return `Showing spells for ${classLabel}.`;
    };

    const allSpells = state.catalogs.spells;
    const sourceOptions = [...new Set(allSpells.map((it) => it.source).filter(Boolean))].sort();
    openModal({
      title: "Spell Picker",
      bodyHtml: `
      <div class="row">
        <label>Search
          <input id="spell-search" placeholder="Type spell name...">
        </label>
        <label>Level
          <select id="spell-level">
            <option value="">All levels</option>
            ${Array.from({ length: 10 }, (_, i) => `<option value="${i}">${i}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="row">
        <label>Source
          <select id="spell-source">
            <option value="">All sources</option>
            ${sourceOptions.map((src) => `<option value="${esc(src)}">${esc(src)}</option>`).join("")}
          </select>
        </label>
      </div>
      <p class="muted">${esc(getEligibilityHint(state.character))}</p>
      <div class="option-list" id="spell-list"></div>
    `,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });

    const searchEl = document.getElementById("spell-search");
    const levelEl = document.getElementById("spell-level");
    const sourceEl = document.getElementById("spell-source");
    const listEl = document.getElementById("spell-list");

    function renderSpellRows() {
      const searchValue = searchEl.value.trim();
      const levelValue = levelEl.value;
      const sourceValue = sourceEl.value;
      const filtered = allSpells
        .filter((spell) => isSpellAvailableToCharacter(spell, state.character))
        .filter((spell) => matchesSearchQuery(searchValue, spell.name, spell.sourceLabel, spell.source))
        .filter((spell) => !levelValue || String(spell.level ?? 0) === levelValue)
        .filter((spell) => !sourceValue || spell.source === sourceValue)
        .sort((a, b) => {
          const levelDelta = toNumber(a?.level, 0) - toNumber(b?.level, 0);
          if (levelDelta !== 0) return levelDelta;
          return String(a?.name ?? "").localeCompare(String(b?.name ?? ""));
        })
        .slice(0, 200);

      listEl.innerHTML = filtered.length
        ? filtered
            .map(
              (spell) => `
            <div class="option-row">
              <div>
                <button type="button" class="spell-picker-name-btn" data-spell-view="${esc(spell.name)}">${esc(spell.name)}</button>
                <div class="muted">Level ${esc(spell.level ?? 0)} - ${esc(spell.sourceLabel ?? spell.source)}</div>
              </div>
              <div class="option-row-actions">
                <button type="button" class="btn secondary" data-spell-view="${esc(spell.name)}">View</button>
                <button type="button" class="btn secondary" data-pick="${esc(spell.name)}">${store.getState().character.spells.includes(spell.name) ? "Remove" : "Add"}</button>
              </div>
            </div>
          `
            )
            .join("")
        : "<p class='muted'>No spells match these filters or your class/subclass spell list.</p>";

      listEl.querySelectorAll("[data-spell-view]").forEach((button) => {
        button.addEventListener("click", () => {
          const spellName = button.dataset.spellView;
          if (!spellName) return;
          openSpellDetailsModal(state, spellName);
        });
      });

      listEl.querySelectorAll("[data-pick]").forEach((button) => {
        button.addEventListener("click", () => {
          const spellName = button.dataset.pick;
          if (!spellName) return;
          const selectedSpells = store.getState().character.spells ?? [];
          if (selectedSpells.includes(spellName)) store.removeSpell(spellName);
          else store.addSpell(spellName);
          renderSpellRows();
        });
      });
    }

    [searchEl, levelEl, sourceEl].forEach((el) => {
      el.addEventListener("input", renderSpellRows);
      el.addEventListener("change", renderSpellRows);
    });
    renderSpellRows();
  }

  function openItemModal(state) {
    const allItems = state.catalogs.items;
    const sourceOptions = [...new Set(allItems.map((it) => it.source).filter(Boolean))].sort();
    const close = openModal({
      title: "Inventory Picker",
      bodyHtml: `
      <div class="row">
        <label>Search
          <input id="item-search" placeholder="Type item name...">
        </label>
        <label>Source
          <select id="item-source">
            <option value="">All sources</option>
            ${sourceOptions.map((src) => `<option value="${esc(src)}">${esc(src)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="option-list" id="item-list"></div>
    `,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });

    const searchEl = document.getElementById("item-search");
    const sourceEl = document.getElementById("item-source");
    const listEl = document.getElementById("item-list");

    function normalizeItemType(value) {
      return String(value ?? "")
        .split("|")[0]
        .trim()
        .toLowerCase();
    }

    function matchesRequirement(item, requirement) {
      if (!requirement || typeof requirement !== "object") return false;
      return Object.entries(requirement).every(([key, expected]) => {
        if (key === "type") {
          const expectedType = normalizeItemType(expected);
          const itemType = normalizeItemType(item?.type);
          if (!expectedType || !itemType) return false;
          return itemType === expectedType;
        }

        if (expected === true) {
          if (key === "weapon") return Boolean(item?.weapon) || Boolean(item?.dmg1) || Boolean(item?.weaponCategory);
          if (key === "armor") return Boolean(item?.armor) || ["la", "ma", "ha"].includes(normalizeItemType(item?.type));
          return Boolean(item?.[key]);
        }

        if (expected === false) return !item?.[key];
        return String(item?.[key] ?? "").toLowerCase() === String(expected ?? "").toLowerCase();
      });
    }

    function isExcludedByVariant(item, excludes) {
      if (!excludes || typeof excludes !== "object") return false;
      return Object.entries(excludes).some(([key, expected]) => {
        if (expected === true) return Boolean(item?.[key]);
        if (key === "type") return normalizeItemType(item?.type) === normalizeItemType(expected);
        return String(item?.[key] ?? "").toLowerCase() === String(expected ?? "").toLowerCase();
      });
    }

    function getVariantBaseItemCandidates(variant) {
      const requirements = Array.isArray(variant?.requires) ? variant.requires : [];
      if (!requirements.length) return [];

      return allItems
        .filter((item) => item && !Array.isArray(item.requires))
        .filter((item) => requirements.some((requirement) => matchesRequirement(item, requirement)))
        .filter((item) => !isExcludedByVariant(item, variant?.excludes))
        .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))
        .slice(0, 500);
    }

    function buildVariantItemName(variant, baseItem) {
      const prefix = String(variant?.inherits?.namePrefix ?? "");
      const suffix = String(variant?.inherits?.nameSuffix ?? "");
      const baseName = String(baseItem?.name ?? "").trim();
      const combined = `${prefix}${baseName}${suffix}`.replace(/\s+/g, " ").trim();
      if (combined) return combined;
      return `${String(variant?.name ?? "Magic Variant").trim()} (${baseName})`.trim();
    }

    function openVariantBasePicker(variantItem) {
      const candidateItems = getVariantBaseItemCandidates(variantItem);
      const variantLabel = String(variantItem?.name ?? "Magic Variant");
      if (!candidateItems.length) {
        alert(`No compatible base items found for ${variantLabel}.`);
        return;
      }

      const variantSources = [...new Set(candidateItems.map((item) => String(item.source ?? "").trim()).filter(Boolean))].sort();

      const closeVariantPicker = openModal({
        title: `${variantLabel} - Choose Base Item`,
        bodyHtml: `
        <p class="subtitle">Select which base item to apply this variant to.</p>
        <div class="row">
          <label>Search
            <input id="variant-base-search" placeholder="Type base item name...">
          </label>
          <label>Source
            <select id="variant-base-source">
              <option value="">All sources</option>
              ${variantSources.map((src) => `<option value="${esc(src)}">${esc(src)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="option-list" id="variant-base-list"></div>
      `,
        actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
      });

      const baseSearchEl = document.getElementById("variant-base-search");
      const baseSourceEl = document.getElementById("variant-base-source");
      const baseListEl = document.getElementById("variant-base-list");
      let filteredVariantCandidates = [];

      function renderVariantBaseRows() {
        const searchValue = String(baseSearchEl?.value ?? "").trim();
        const sourceValue = String(baseSourceEl?.value ?? "").trim();
        filteredVariantCandidates = candidateItems
          .filter((item) => matchesSearchQuery(searchValue, item.name, item.sourceLabel, item.source))
          .filter((item) => !sourceValue || item.source === sourceValue)
          .slice(0, 250);

        baseListEl.innerHTML = filteredVariantCandidates.length
          ? filteredVariantCandidates
              .map(
                (item, idx) => `
                <div class="option-row">
                  <div>
                    <strong>${esc(item.name)}</strong>
                    <div class="muted">${esc(item.sourceLabel ?? item.source)}</div>
                  </div>
                  <button class="btn secondary" data-variant-base-pick="${idx}">Use</button>
                </div>
              `
              )
              .join("")
          : "<p class='muted'>No base items match these filters.</p>";
      }

      baseListEl.addEventListener("click", (evt) => {
        const button = evt.target.closest("[data-variant-base-pick]");
        if (!button || !baseListEl.contains(button)) return;
        const idx = toNumber(button.dataset.variantBasePick, -1);
        const baseItem = filteredVariantCandidates[idx];
        if (!baseItem) return;
        const concreteName = buildVariantItemName(variantItem, baseItem);
        if (!concreteName) return;
        store.addItem(concreteName);
        closeVariantPicker();
      });

      [baseSearchEl, baseSourceEl].forEach((el) => {
        el.addEventListener("input", renderVariantBaseRows);
        el.addEventListener("change", renderVariantBaseRows);
      });
      renderVariantBaseRows();
    }

    function renderItemRows() {
      const searchValue = searchEl.value.trim();
      const sourceValue = sourceEl.value;
      filteredItems = allItems
        .filter((item) => matchesSearchQuery(searchValue, item.name, item.sourceLabel, item.source))
        .filter((item) => !sourceValue || item.source === sourceValue)
        .slice(0, 250);

      listEl.innerHTML = filteredItems.length
        ? filteredItems
            .map(
              (item, idx) => `
            <div class="option-row">
              <div>
                <strong>${esc(item.name)}</strong>
                <div class="muted">${esc(item.sourceLabel ?? item.source)}</div>
              </div>
              <button class="btn secondary" data-item-pick="${idx}">Add</button>
            </div>
          `
            )
            .join("")
        : "<p class='muted'>No items match these filters.</p>";
    }

    let filteredItems = [];
    listEl.addEventListener("click", (evt) => {
      const button = evt.target.closest("[data-item-pick]");
      if (!button || !listEl.contains(button)) return;
      const idx = toNumber(button.dataset.itemPick, -1);
      const item = filteredItems[idx];
      if (!item) return;
      const isMagicVariant = Array.isArray(item.requires) && item.requires.length > 0;
      if (isMagicVariant) {
        close();
        openVariantBasePicker(item);
        return;
      }
      store.addItem(item.name);
      close();
    });

    [searchEl, sourceEl].forEach((el) => {
      el.addEventListener("input", renderItemRows);
      el.addEventListener("change", renderItemRows);
    });
    renderItemRows();
  }

  function getFeatSlotById(character, slotId) {
    const slots = Array.isArray(character?.progression?.featSlots) ? character.progression.featSlots : [];
    return slots.find((slot) => slot.id === slotId) ?? null;
  }

  function upsertFeatForSlot(state, slotId, featEntry) {
    const slot = getFeatSlotById(state.character, slotId);
    if (!slot || !featEntry) return;
    const featId = buildEntityId(["feat", featEntry.name, featEntry.source]);
    const nextFeats = (state.character.feats ?? []).filter((feat) => feat.slotId !== slotId && feat.id !== featId);
    nextFeats.push({
      id: featId,
      name: featEntry.name,
      source: featEntry.source,
      via: slot.slotType || "feat",
      levelGranted: toNumber(slot.level, 0),
      slotId,
    });
    updateCharacterWithRequiredSettings(state, { feats: nextFeats }, { preserveUserOverrides: true });
  }

  function openFeatModal(state, slotId) {
    const slot = getFeatSlotById(state.character, slotId);
    if (!slot) return;
    const allFeats = Array.isArray(state.catalogs.feats) ? state.catalogs.feats : [];
    const sourceOptions = [...new Set(allFeats.map((it) => it.source).filter(Boolean))].sort();
    const close = openModal({
      title: `Pick Feat (${slot.className} Lv ${slot.level})`,
      bodyHtml: `
      <div class="row">
        <label>Search
          <input id="feat-search" placeholder="Type feat name...">
        </label>
        <label>Source
          <select id="feat-source">
            <option value="">All sources</option>
            ${sourceOptions.map((src) => `<option value="${esc(src)}">${esc(src)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="option-list" id="feat-list"></div>
    `,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });

    const searchEl = document.getElementById("feat-search");
    const sourceEl = document.getElementById("feat-source");
    const listEl = document.getElementById("feat-list");
    const selectedFeatId = (state.character.feats ?? []).find((feat) => feat.slotId === slot.id)?.id ?? "";

    function renderFeatRows() {
      const searchValue = String(searchEl?.value ?? "").trim();
      const sourceValue = String(sourceEl?.value ?? "").trim();
      const filtered = allFeats
        .filter((feat) => matchesSearchQuery(searchValue, feat.name, feat.sourceLabel, feat.source))
        .filter((feat) => !sourceValue || feat.source === sourceValue)
        .slice(0, 250);

      listEl.innerHTML = filtered.length
        ? filtered
            .map((feat) => {
              const featId = buildEntityId(["feat", feat.name, feat.source]);
              const isSelected = selectedFeatId === featId;
              const meetsPrereq = doesCharacterMeetFeatPrerequisites(state.character, feat);
              return `
              <div class="option-row">
                <div>
                  <strong>${esc(feat.name)}</strong>
                  <div class="muted">${esc(feat.sourceLabel ?? feat.source ?? "UNK")}${meetsPrereq ? "" : " - prerequisites not met"}</div>
                </div>
                <div class="option-row-actions">
                  <button type="button" class="btn secondary" data-pick-feat="${esc(featId)}" ${meetsPrereq ? "" : "disabled"}>
                    ${isSelected ? "Selected" : "Pick"}
                  </button>
                </div>
              </div>
            `;
            })
            .join("")
        : "<p class='muted'>No feats match these filters.</p>";

      listEl.querySelectorAll("[data-pick-feat]").forEach((button) => {
        button.addEventListener("click", () => {
          const featId = button.dataset.pickFeat;
          const feat = filtered.find((entry) => buildEntityId(["feat", entry.name, entry.source]) === featId);
          if (!feat) return;
          upsertFeatForSlot(state, slot.id, feat);
          close();
        });
      });
    }

    [searchEl, sourceEl].forEach((el) => {
      el?.addEventListener("input", renderFeatRows);
      el?.addEventListener("change", renderFeatRows);
    });
    renderFeatRows();
  }

  return { openSpellDetailsModal, openSpellModal, openItemModal, openFeatModal };
}

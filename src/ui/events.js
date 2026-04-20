import { resolveInventoryCatalogItem } from "../app/catalog/inventory-item-rules.js";

export function createEvents(deps) {
  const {
    app,
    store,
    toNumber,
    isUuid,
    SKILLS,
    DEFAULT_SOURCE_PRESET,
    getAllowedSources,
    getCharacterAllowedSources,
    sourceLabels,
    loadAvailableSourceEntries,
    loadAvailableSources,
    loadCatalogs,
    updateCharacterWithRequiredSettings,
    getCharacterFightingStyleSet,
    withUpdatedPlay,
    openModal,
    openSpellModal,
    openItemModal,
    openFeatModal,
    openOptionalFeatureModal,
    openRacePickerModal,
    openSubracePickerModal,
    openBackgroundPickerModal,
    openClassPickerModal,
    openSubclassPickerModal,
    openMulticlassModal,
    openLevelUpModal,
    openSpellDetailsModal,
    openItemDetailsModal,
    getCharacterSpellSlotDefaults,
    createOrSavePermanentCharacter,
    importCharacterFromJsonFile,
    exportCharacterToJsonFile,
    openClassDetailsModal,
    openSubclassDetailsModal,
    openFeatureDetailsModal,
    openFeatDetailsModal,
    openOptionalFeatureDetailsModal,
    openSpeciesTraitDetailsModal,
    applyDiceStyle,
    rerollLastRoll,
    openCustomRollModal,
    countPreparedSpells,
    getPreparedSpellLimit,
    doesClassUsePreparedSpells,
    isSpellAlwaysPrepared,
    getSpellByName,
    getSpellCombatContext,
    getFeatureActivationDescriptor,
    setDiceResult,
    setSpellCastStatus,
    getSpellSlotValues,
    rollVisualNotation,
    getSpellPrimaryDiceNotation,
    rollVisualD20,
    extractSimpleNotation,
    getArmorClassBreakdown,
    getHitPointBreakdown,
    autoResourceIdPrefix,
    uiState,
    diceStylePresets,
    forgetActiveCharacterAndRedirectHome,
  } = deps;
  let playManualMenuOutsideClickHandler = null;
  let playCharacterLogMenuOutsideClickHandler = null;

  function positionFloatingPanelWithinViewport(containerEl, panelEl) {
    if (!(containerEl instanceof HTMLElement) || !(panelEl instanceof HTMLElement)) return;
    const viewportWidth = Math.max(0, window.innerWidth || document.documentElement.clientWidth || 0);
    const viewportHeight = Math.max(0, window.innerHeight || document.documentElement.clientHeight || 0);
    if (viewportWidth <= 0 || viewportHeight <= 0) return;
    const margin = 8;
    containerEl.removeAttribute("data-overlay-direction");
    panelEl.style.removeProperty("--overlay-shift-x");
    panelEl.style.removeProperty("max-height");

    const triggerRect = containerEl.getBoundingClientRect();
    const spaceAbove = Math.max(0, triggerRect.top - margin);
    const spaceBelow = Math.max(0, viewportHeight - triggerRect.bottom - margin);
    const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
    containerEl.dataset.overlayDirection = openUp ? "up" : "down";

    const rect = panelEl.getBoundingClientRect();
    let shiftX = 0;
    if (rect.left < margin) shiftX = margin - rect.left;
    else if (rect.right > viewportWidth - margin) shiftX = (viewportWidth - margin) - rect.right;
    panelEl.style.setProperty("--overlay-shift-x", `${Math.round(shiftX)}px`);

    const availableHeight = Math.max(160, Math.floor((openUp ? spaceAbove : spaceBelow) - 10));
    panelEl.style.maxHeight = `${availableHeight}px`;
  }

  function positionDiceHistoryPopoverWithinViewport(wrapperEl, popoverEl) {
    if (!(wrapperEl instanceof HTMLElement) || !(popoverEl instanceof HTMLElement)) return;
    const viewportWidth = Math.max(0, window.innerWidth || document.documentElement.clientWidth || 0);
    const viewportHeight = Math.max(0, window.innerHeight || document.documentElement.clientHeight || 0);
    if (viewportWidth <= 0 || viewportHeight <= 0) return;
    const margin = 8;
    wrapperEl.removeAttribute("data-overlay-direction");
    popoverEl.style.removeProperty("--overlay-shift-x");
    popoverEl.style.removeProperty("max-height");

    const triggerRect = wrapperEl.getBoundingClientRect();
    const spaceAbove = Math.max(0, triggerRect.top - margin);
    const spaceBelow = Math.max(0, viewportHeight - triggerRect.bottom - margin);
    const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
    wrapperEl.dataset.overlayDirection = openUp ? "up" : "down";

    const rect = popoverEl.getBoundingClientRect();
    let shiftX = 0;
    if (rect.left < margin) shiftX = margin - rect.left;
    else if (rect.right > viewportWidth - margin) shiftX = (viewportWidth - margin) - rect.right;
    popoverEl.style.setProperty("--overlay-shift-x", `${Math.round(shiftX)}px`);

    const availableHeight = Math.max(140, Math.floor((openUp ? spaceAbove : spaceBelow) - 10));
    popoverEl.style.maxHeight = `${availableHeight}px`;
  }

  function clearPlayManualMenuOutsideClickHandler() {
    if (typeof playManualMenuOutsideClickHandler === "function") {
      document.removeEventListener("pointerdown", playManualMenuOutsideClickHandler, true);
      playManualMenuOutsideClickHandler = null;
    }
    if (typeof playCharacterLogMenuOutsideClickHandler === "function") {
      document.removeEventListener("pointerdown", playCharacterLogMenuOutsideClickHandler, true);
      playCharacterLogMenuOutsideClickHandler = null;
    }
  }

  function normalizeItemTypeCode(value) {
    return String(value ?? "")
      .split("|")[0]
      .trim()
      .toUpperCase();
  }

  function normalizeLanguageLabel(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ");
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");
  }

  function openArmorClassBreakdownModal(snapshot) {
    const dexMod = toNumber(snapshot.derived?.mods?.dex, 0);
    const breakdown = getArmorClassBreakdown(
      snapshot.character,
      dexMod,
      getCharacterFightingStyleSet(snapshot.character, snapshot.catalogs),
      snapshot.catalogs
    );
    const customModifier = Math.floor(toNumber(snapshot.character?.play?.customAcModifier, 0));
    const baseTotal = toNumber(breakdown.total, toNumber(snapshot.derived?.ac, 10)) - customModifier;
    const rowsHtml = breakdown.components
      .filter((entry) => String(entry?.source ?? "").trim().toLowerCase() !== "custom")
      .map((entry) => {
        const value = toNumber(entry?.value, 0);
        const signedValue = value > 0 ? `+${value}` : `${value}`;
        return `
          <div class="ac-breakdown-row">
            <span class="ac-breakdown-label">${esc(entry?.label ?? "Modifier")}</span>
            <span class="ac-breakdown-value">${esc(signedValue)}</span>
          </div>
        `;
      })
      .join("");
    openModal({
      title: "Armor Class Modifiers",
      bodyHtml: `
        <div class="ac-breakdown-shell">
          <div class="ac-breakdown-list">
            ${rowsHtml || "<p class='muted'>No AC modifiers found.</p>"}
          </div>
          <div class="ac-breakdown-row">
            <span class="ac-breakdown-label">Custom Modifier</span>
            <div class="num-input-wrap num-input-wrap-inline">
              <input id="ac-custom-modifier-input" type="number" min="-99" max="99" value="${esc(customModifier)}" aria-label="Custom armor class modifier">
              <div class="num-stepper num-stepper-inline">
                <button type="button" class="num-step-btn" data-ac-custom-modifier-step="-1" aria-label="Decrease custom armor class modifier">-</button>
                <button type="button" class="num-step-btn" data-ac-custom-modifier-step="1" aria-label="Increase custom armor class modifier">+</button>
              </div>
            </div>
          </div>
          <div class="ac-breakdown-total-row">
            <span>Total AC</span>
            <strong data-ac-breakdown-total>${esc(toNumber(breakdown.total, toNumber(snapshot.derived?.ac, 10)))}</strong>
          </div>
        </div>
      `,
      actions: [{ label: "Close", secondary: true, onClick: (close) => close() }],
    });
    const modal = document.querySelector(".modal");
    const input = modal?.querySelector("#ac-custom-modifier-input");
    const totalEl = modal?.querySelector("[data-ac-breakdown-total]");
    const setCustomModifier = (valueRaw) => {
      const next = Math.max(-99, Math.min(99, Math.floor(toNumber(valueRaw, 0))));
      if (input instanceof HTMLInputElement) input.value = String(next);
      if (totalEl) totalEl.textContent = String(baseTotal + next);
      withUpdatedPlay(store.getState(), (play) => {
        play.customAcModifier = next;
      });
    };
    if (input instanceof HTMLInputElement) {
      input.addEventListener("change", () => setCustomModifier(input.value));
      input.addEventListener("input", () => setCustomModifier(input.value));
    }
    modal?.querySelectorAll("[data-ac-custom-modifier-step]").forEach((button) => {
      button.addEventListener("click", () => {
        const delta = Math.floor(toNumber(button.dataset.acCustomModifierStep, 0));
        if (!delta || !(input instanceof HTMLInputElement)) return;
        const current = Math.floor(toNumber(input.value, 0));
        setCustomModifier(current + delta);
      });
    });
  }

  function openHitPointBreakdownModal(snapshot) {
    const breakdown = getHitPointBreakdown(snapshot.catalogs, snapshot.character);
    const additionalLevels = Math.max(0, toNumber(breakdown.totalLevel, 1) - 1);
    const fixedHitPointGain = (faces) => Math.max(1, Math.floor(Math.max(1, toNumber(faces, 1)) / 2) + 1);
    const character = snapshot.character ?? {};
    const rawOverrides =
      character.hitPointRollOverrides && typeof character.hitPointRollOverrides === "object" && !Array.isArray(character.hitPointRollOverrides)
        ? character.hitPointRollOverrides
        : {};
    const { primaryLevel, multiclass } = getCharacterClassLevels(character);
    const primaryClassName = String(character.class ?? "").trim() || "Class";
    const primaryFaces = getClassHitDieFaces(snapshot.catalogs, primaryClassName);
    const primaryClassKey = getClassKey(primaryClassName) || "primary";
    const levelRows = [];
    const createLevelRow = (className, classKey, level, faces) => {
      const rowKey = `${classKey}:${level}`;
      const rolledValue = Math.floor(toNumber(rawOverrides?.[rowKey], Number.NaN));
      const hasRolledValue = Number.isFinite(rolledValue) && rolledValue >= 1 && rolledValue <= faces;
      const gain = hasRolledValue ? rolledValue : fixedHitPointGain(faces);
      return {
        label: `${className} Lv ${level} hit die (d${faces}; ${hasRolledValue ? `rolled ${rolledValue}` : `fixed ${gain}`})`,
        value: gain,
      };
    };
    for (let level = 2; level <= primaryLevel; level += 1) {
      levelRows.push(createLevelRow(primaryClassName, primaryClassKey, level, primaryFaces));
    }
    multiclass.forEach((entry) => {
      const className = String(entry?.class ?? "").trim() || "Class";
      const faces = getClassHitDieFaces(snapshot.catalogs, className);
      const classKey = getClassKey(className) || "multiclass";
      for (let level = 1; level <= toNumber(entry?.level, 0); level += 1) {
        levelRows.push(createLevelRow(className, classKey, level, faces));
      }
    });
    const rows = [
      { label: "Level 1 hit points", value: toNumber(breakdown.firstLevelHp, 0) },
      ...levelRows,
      { label: `CON from levels 2+ (${additionalLevels} levels)`, value: toNumber(breakdown.conFromAdditionalLevels, 0) },
    ];
    if (toNumber(breakdown.featBonusHp, 0) !== 0) {
      rows.push({ label: "Feat bonuses", value: toNumber(breakdown.featBonusHp, 0) });
    }
    const rowsHtml = rows
      .map((entry) => {
        const value = toNumber(entry?.value, 0);
        const signedValue = value > 0 ? `+${value}` : `${value}`;
        return `
          <div class="ac-breakdown-row">
            <span class="ac-breakdown-label">${esc(entry?.label ?? "Modifier")}</span>
            <span class="ac-breakdown-value">${esc(signedValue)}</span>
          </div>
        `;
      })
      .join("");
    openModal({
      title: "Hit Point Breakdown",
      bodyHtml: `
        <div class="ac-breakdown-shell">
          <p class="muted">CON modifier: ${esc(toNumber(breakdown.conMod, 0))} - Character level: ${esc(toNumber(breakdown.totalLevel, 1))}</p>
          <div class="ac-breakdown-list">
            ${rowsHtml || "<p class='muted'>No HP breakdown found.</p>"}
          </div>
          <div class="ac-breakdown-total-row">
            <span>Total HP</span>
            <strong>${esc(toNumber(breakdown.total, toNumber(snapshot.derived?.hp, 1)))}</strong>
          </div>
        </div>
      `,
      actions: [{ label: "Close", secondary: true, onClick: (close) => close() }],
    });
  }

  function bindCoreStatBreakdownButtons() {
    app.querySelectorAll("[data-open-ac-breakdown]").forEach((button) => {
      button.addEventListener("click", () => openArmorClassBreakdownModal(store.getState()));
    });
    app.querySelectorAll("[data-open-hp-breakdown]").forEach((button) => {
      button.addEventListener("click", () => openHitPointBreakdownModal(store.getState()));
    });
  }

  function getClassKey(className) {
    return String(className ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, "");
  }

  function normalizeHitDiceSpent(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw)
        .map(([key, value]) => [String(key ?? "").trim(), Math.max(0, Math.floor(toNumber(value, 0)))])
        .filter(([key, value]) => key && value > 0)
    );
  }

  function normalizeChoiceToken(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
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

  function getClassLevelByName(character, className) {
    const target = String(className ?? "").trim().toLowerCase();
    if (!target) return 0;
    const { primaryLevel, multiclass } = getCharacterClassLevels(character);
    let total = 0;
    if (String(character?.class ?? "").trim().toLowerCase() === target) total += primaryLevel;
    multiclass.forEach((entry) => {
      if (String(entry?.class ?? "").trim().toLowerCase() === target) total += Math.max(0, toNumber(entry?.level, 0));
    });
    return total;
  }

  function getAllowedSkillModesForCharacter(character, autoMode) {
    const bardLevel = getClassLevelByName(character, "bard");
    const rogueLevel = getClassLevelByName(character, "rogue");
    const canHalf = bardLevel >= 2;
    const canExpertise = bardLevel >= 3 || rogueLevel >= 1;
    const modes = ["none"];
    if (canHalf) modes.push("half");
    modes.push("proficient");
    if (canExpertise) modes.push("expertise");
    if (autoMode === "proficient") {
      return canExpertise ? ["proficient", "expertise"] : ["proficient"];
    }
    if (autoMode === "half") {
      return canExpertise ? ["half", "proficient", "expertise"] : ["half", "proficient"];
    }
    return modes;
  }

  function getCharacterClassLevels(character) {
    const totalLevel = Math.max(1, Math.min(20, toNumber(character?.level, 1)));
    const multiclassEntries = Array.isArray(character?.multiclass) ? character.multiclass : [];
    const cleanedMulticlass = multiclassEntries
      .map((entry) => ({
        class: String(entry?.class ?? "").trim(),
        level: Math.max(1, Math.min(20, toNumber(entry?.level, 1))),
      }))
      .filter((entry) => entry.class);
    const multiclassTotal = cleanedMulticlass.reduce((sum, entry) => sum + entry.level, 0);
    const primaryLevel = Math.max(1, totalLevel - multiclassTotal);
    return { primaryLevel, multiclass: cleanedMulticlass };
  }

  function getClassHitDieFaces(catalogs, className) {
    const selectedName = String(className ?? "").trim().toLowerCase();
    if (!selectedName || !Array.isArray(catalogs?.classes)) return 8;
    const classEntry = catalogs.classes.find((entry) => String(entry?.name ?? "").trim().toLowerCase() === selectedName);
    const faces = Math.max(0, toNumber(classEntry?.hd?.faces, 0));
    return faces > 0 ? faces : 8;
  }

  function getHitDicePools(currentState) {
    const { character, catalogs } = currentState;
    const { primaryLevel, multiclass } = getCharacterClassLevels(character);
    const classEntries = [];
    const primaryClassName = String(character?.class ?? "").trim() || "Class";
    classEntries.push({ className: primaryClassName, level: primaryLevel, order: 0 });
    multiclass.forEach((entry, idx) => {
      classEntries.push({ className: String(entry.class ?? "").trim() || `Class ${idx + 2}`, level: entry.level, order: idx + 1 });
    });
    const poolMap = new Map();
    classEntries.forEach((entry) => {
      const key = getClassKey(entry.className) || `class${entry.order + 1}`;
      const existing = poolMap.get(key);
      const faces = getClassHitDieFaces(catalogs, entry.className);
      if (existing) {
        existing.max += entry.level;
        existing.faces = Math.max(existing.faces, faces);
        return;
      }
      poolMap.set(key, {
        key,
        className: entry.className,
        faces,
        max: entry.level,
        order: entry.order,
      });
    });
    return [...poolMap.values()];
  }

  function refreshShortRestResources(play) {
    play.deathSavesSuccess = 0;
    play.deathSavesFail = 0;
    const featureUses =
      play.featureUses && typeof play.featureUses === "object" && !Array.isArray(play.featureUses)
        ? { ...play.featureUses }
        : {};
    Object.entries(featureUses).forEach(([key, tracker]) => {
      if (!tracker || typeof tracker !== "object") return;
      const recharge = String(tracker.recharge ?? "");
      if (recharge === "short" || recharge === "shortOrLong") {
        const max = Math.max(0, toNumber(tracker.max, 0));
        featureUses[key] = { ...tracker, current: max };
      }
    });
    play.featureUses = featureUses;
  }

  function resolveCurrentHp(play, derivedMaxHp) {
    const maxHp = Math.max(1, toNumber(derivedMaxHp, 1));
    const raw = play?.hpCurrent;
    if (raw == null) return maxHp;
    if (typeof raw === "string" && !raw.trim()) return maxHp;
    const parsed = toNumber(raw, NaN);
    if (!Number.isFinite(parsed)) return maxHp;
    return Math.max(0, Math.min(maxHp, Math.floor(parsed)));
  }

  function buildShortRestHealingNotation(spends, pools, conMod) {
    const diceByFaces = {};
    let totalDice = 0;
    Object.entries(spends).forEach(([poolKey, spendCountRaw]) => {
      const spendCount = Math.max(0, Math.floor(toNumber(spendCountRaw, 0)));
      if (spendCount < 1) return;
      const pool = pools.find((entry) => entry.key === poolKey);
      if (!pool) return;
      const faces = Math.max(1, Math.floor(toNumber(pool.faces, 0)));
      diceByFaces[faces] = Math.max(0, toNumber(diceByFaces[faces], 0)) + spendCount;
      totalDice += spendCount;
    });
    const diceTerms = Object.entries(diceByFaces)
      .map(([faces, count]) => ({
        faces: Math.max(1, Math.floor(toNumber(faces, 0))),
        count: Math.max(0, Math.floor(toNumber(count, 0))),
      }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.faces - a.faces)
      .map((entry) => `${entry.count}d${entry.faces}`);
    if (!diceTerms.length || totalDice < 1) return "";
    const modifierTotal = Math.floor(toNumber(conMod, 0)) * totalDice;
    if (modifierTotal > 0) return `${diceTerms.join("+")}+${modifierTotal}`;
    if (modifierTotal < 0) return `${diceTerms.join("+")}${modifierTotal}`;
    return diceTerms.join("+");
  }

  function isBodyArmorEntry(entry) {
    const typeCode = normalizeItemTypeCode(entry?.itemType ?? entry?.type);
    return ["LA", "MA", "HA"].includes(typeCode);
  }

  function isShieldEntry(entry) {
    const typeCode = normalizeItemTypeCode(entry?.itemType ?? entry?.type);
    return typeCode === "S" || Boolean(entry?.isShield);
  }

  function toggleInventoryItemEquipped(itemId) {
    const id = String(itemId ?? "").trim();
    if (!id) return;
    const currentState = store.getState();
    const currentInventory = Array.isArray(currentState.character?.inventory) ? currentState.character.inventory : [];
    let shouldEquip = false;
    let toggledEntry = null;

    currentInventory.forEach((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
      if (String(entry.id ?? "").trim() !== id) return;
      shouldEquip = !Boolean(entry.equipped);
      toggledEntry = entry;
    });
    if (!toggledEntry) return;

    const nextInventory = currentInventory.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      const entryId = String(entry.id ?? "").trim();
      if (entryId === id) return { ...entry, equipped: shouldEquip, attuned: shouldEquip ? Boolean(entry?.attuned) : false };
      if (!shouldEquip) return entry;
      if (isBodyArmorEntry(toggledEntry) && isBodyArmorEntry(entry)) return { ...entry, equipped: false, attuned: false };
      if (isShieldEntry(toggledEntry) && isShieldEntry(entry)) return { ...entry, equipped: false, attuned: false };
      return entry;
    });
    store.updateCharacter({ inventory: nextInventory });
    updateCharacterWithRequiredSettings(store.getState(), {}, { preserveUserOverrides: true });
  }

  function toggleInventoryItemAttuned(itemId, indexRaw = "") {
    const id = String(itemId ?? "").trim();
    const index = toNumber(indexRaw, -1);
    if (!id && index < 0) return;
    const currentState = store.getState();
    const currentInventory = Array.isArray(currentState.character?.inventory) ? currentState.character.inventory : [];
    const nextInventory = currentInventory.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      const entryId = String(entry.id ?? "").trim();
      const matchesById = id && entryId === id;
      const matchesByIndex = !id && index >= 0 && currentInventory[index] === entry;
      if (!matchesById && !matchesByIndex) return entry;
      if (!entry.equipped) return entry;
      return { ...entry, attuned: !Boolean(entry.attuned) };
    });
    store.updateCharacter({ inventory: nextInventory });
    updateCharacterWithRequiredSettings(store.getState(), {}, { preserveUserOverrides: true });
  }

  function removeInventoryItemByIndex(indexRaw) {
    const index = toNumber(indexRaw, -1);
    const currentState = store.getState();
    const currentInventory = Array.isArray(currentState.character?.inventory) ? currentState.character.inventory : [];
    if (index < 0 || index >= currentInventory.length) return;
    const nextInventory = [...currentInventory];
    nextInventory.splice(index, 1);
    store.updateCharacter({ inventory: nextInventory });
    updateCharacterWithRequiredSettings(store.getState(), {}, { preserveUserOverrides: true });
  }

  function adjustInventoryItemCounter(itemId, deltaRaw) {
    const id = String(itemId ?? "").trim();
    if (!id) return;
    const delta = Math.floor(toNumber(deltaRaw, 0));
    if (!delta) return;
    const currentState = store.getState();
    const currentInventory = Array.isArray(currentState.character?.inventory) ? currentState.character.inventory : [];
    const nextInventory = currentInventory.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
      if (String(entry.id ?? "").trim() !== id) return entry;
      const kindRaw = String(entry.counterKind ?? "").trim().toLowerCase();
      const kind = kindRaw === "charges" || kindRaw === "quantity" ? kindRaw : "";
      if (!kind) return entry;
      const currentValue = Math.max(0, Math.floor(toNumber(entry.counter, 0)));
      const maxValue = Math.max(0, Math.floor(toNumber(entry.counterMax, 0)));
      let nextValue = Math.max(0, currentValue + delta);
      if (kind === "charges" && maxValue > 0) nextValue = Math.min(maxValue, nextValue);
      if (nextValue === currentValue) return entry;
      return { ...entry, counter: nextValue };
    });
    store.updateCharacter({ inventory: nextInventory });
  }

  function openInventoryItemDetails(indexRaw) {
    const index = toNumber(indexRaw, -1);
    const currentState = store.getState();
    const currentInventory = Array.isArray(currentState.character?.inventory) ? currentState.character.inventory : [];
    if (index < 0 || index >= currentInventory.length) return;
    const entry = currentInventory[index];
    if (typeof entry === "string") {
      openItemDetailsModal({ name: entry });
      return;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
    const entryName = String(entry.name ?? "").trim();
    const entrySource = String(entry.source ?? "").trim();
    const matchedItem = resolveInventoryCatalogItem(currentState.catalogs, entry);
    if (matchedItem) {
      openItemDetailsModal({
        ...matchedItem,
        name: entryName || matchedItem.name,
        source: entrySource || matchedItem.source,
        sourceLabel: String(entry.sourceLabel ?? matchedItem.sourceLabel ?? matchedItem.source ?? "").trim(),
      });
      return;
    }
    openItemDetailsModal({
      ...entry,
      type: entry.itemType ?? entry.type,
      source: String(entry.source ?? "").trim(),
      sourceLabel: String(entry.sourceLabel ?? entry.source ?? "").trim(),
    });
  }

  function bindBuildEvents(state) {
    clearPlayManualMenuOutsideClickHandler();
    bindCoreStatBreakdownButtons();
    app.querySelectorAll("[data-step]").forEach((btn) => {
      btn.addEventListener("click", () => store.setStep(Number(btn.dataset.step)));
    });
    app.querySelector("#prev-step")?.addEventListener("click", () => store.setStep(state.stepIndex - 1));
    app.querySelector("#next-step")?.addEventListener("click", () => store.setStep(state.stepIndex + 1));
    app.querySelector("#build-forget-active")?.addEventListener("click", () => {
      const activeName = String(store.getState().character?.name ?? "").trim() || "this character";
      const confirmed = window.confirm(
        `Forget "${activeName}" on this browser? This only removes local history and returns to home.`
      );
      if (!confirmed) return;
      forgetActiveCharacterAndRedirectHome();
    });

    const sourcePreset = app.querySelector("#source-preset");
    if (sourcePreset) {
      sourcePreset.addEventListener("change", async (evt) => {
        const currentPreset = String(store.getState().character?.sourcePreset ?? DEFAULT_SOURCE_PRESET).trim();
        const preset = evt.target.value || currentPreset || DEFAULT_SOURCE_PRESET;
        store.updateCharacter({ sourcePreset: preset });
        const nextCharacter = store.getState().character;
        const catalogs = await loadCatalogs(getCharacterAllowedSources(nextCharacter));
        store.setCatalogs(catalogs);
        updateCharacterWithRequiredSettings(store.getState(), {}, { preserveUserOverrides: true });
      });
    }

    app.querySelector("#source-customize")?.addEventListener("click", () => {
      const currentState = store.getState();
      const currentCharacter = currentState.character;
      const presetSources = new Set(getAllowedSources(currentCharacter?.sourcePreset ?? DEFAULT_SOURCE_PRESET));
      const selectedCustomSources = new Set(
        Array.isArray(currentCharacter?.customSources)
          ? currentCharacter.customSources.map((entry) => String(entry ?? "").trim()).filter(Boolean)
          : []
      );
      const renderCustomizeModal = async () => {
        const availableSourceEntries = typeof loadAvailableSourceEntries === "function"
          ? await loadAvailableSourceEntries()
          : (await loadAvailableSources()).map((sourceKey) => ({ key: sourceKey, label: sourceLabels?.[sourceKey] ?? sourceKey }));
        const sourceEntries = availableSourceEntries.map((entry) => [entry.key, entry.label]);
        openModal({
          title: "Customize Sources",
          bodyHtml: `
          <p class="muted">Preset sources stay enabled. Toggle extra books for this character.</p>
          <div class="option-list">
            ${sourceEntries
              .map(([sourceKey, sourceLabel]) => {
                const fromPreset = presetSources.has(sourceKey);
                const isChecked = fromPreset || selectedCustomSources.has(sourceKey);
                return `
                <label class="option-row">
                  <div>
                    <strong>${esc(sourceLabel)}</strong>
                    <div class="muted">${esc(sourceKey)}${fromPreset ? " - from preset" : ""}</div>
                  </div>
                  <div class="option-row-actions">
                    <input
                      type="checkbox"
                      data-source-custom-toggle="${esc(sourceKey)}"
                      ${isChecked ? "checked" : ""}
                      ${fromPreset ? "disabled" : ""}
                      aria-label="Enable ${esc(sourceLabel)}"
                    >
                  </div>
                </label>
              `;
              })
              .join("")}
          </div>
        `,
          actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
        });

        document.querySelectorAll("[data-source-custom-toggle]").forEach((checkbox) => {
          checkbox.addEventListener("change", async () => {
            const sourceKey = String(checkbox.dataset.sourceCustomToggle ?? "").trim();
            if (!sourceKey) return;
            if (checkbox.checked) selectedCustomSources.add(sourceKey);
            else selectedCustomSources.delete(sourceKey);

            store.updateCharacter({ customSources: [...selectedCustomSources] });
            const nextCharacter = store.getState().character;
            const catalogs = await loadCatalogs(getCharacterAllowedSources(nextCharacter));
            store.setCatalogs(catalogs);
            updateCharacterWithRequiredSettings(store.getState(), {}, { preserveUserOverrides: true });
          });
        });
      };
      renderCustomizeModal();
    });

    [["#name", "name"], ["#notes", "notes"], ["#crit-style", "critStyle"]].forEach(([sel, field]) => {
      const el = app.querySelector(sel);
      if (!el) return;
      const handler = () => store.updateCharacter({ [field]: el.value });
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    });
    const addAdditionalLanguage = () => {
      const languageSelect = app.querySelector("#additional-language-select");
      if (!(languageSelect instanceof HTMLSelectElement)) return;
      const nextLabel = normalizeLanguageLabel(languageSelect.value);
      if (!nextLabel) return;
      const currentLanguages = Array.isArray(store.getState().character?.languages)
        ? store.getState().character.languages
        : [];
      const hasLabel = currentLanguages.some((entry) => normalizeLanguageLabel(entry).toLowerCase() === nextLabel.toLowerCase());
      if (!hasLabel) {
        store.updateCharacter({ languages: [...currentLanguages, nextLabel] });
      }
      languageSelect.value = "";
    };
    app.querySelector("#add-additional-language")?.addEventListener("click", () => {
      addAdditionalLanguage();
    });
    app.querySelector("#additional-language-select")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      addAdditionalLanguage();
    });
    app.querySelectorAll("[data-remove-additional-language]").forEach((button) => {
      button.addEventListener("click", () => {
        const label = normalizeLanguageLabel(button.dataset.removeAdditionalLanguage);
        if (!label) return;
        const currentLanguages = Array.isArray(store.getState().character?.languages)
          ? store.getState().character.languages
          : [];
        const nextLanguages = currentLanguages.filter(
          (entry) => normalizeLanguageLabel(entry).toLowerCase() !== label.toLowerCase()
        );
        store.updateCharacter({ languages: nextLanguages });
      });
    });
    const showDiceTrayEl = app.querySelector("#show-dice-tray");
    if (showDiceTrayEl) {
      const handler = () => store.updateCharacter({ showDiceTray: Boolean(showDiceTrayEl.checked) });
      showDiceTrayEl.addEventListener("input", handler);
      showDiceTrayEl.addEventListener("change", handler);
    }
    const editPasswordEl = app.querySelector("#edit-password");
    const editPasswordConfirmEl = app.querySelector("#edit-password-confirm");
    if (editPasswordEl && editPasswordConfirmEl) {
      const getSavedEditPassword = () => String(store.getState().character?.editPassword ?? "");
      const syncEditPasswordConfirmState = () => {
        editPasswordConfirmEl.disabled = editPasswordEl.value === getSavedEditPassword();
      };
      const confirmEditPassword = () => {
        if (editPasswordConfirmEl.disabled) return;
        store.updateCharacter({ editPassword: editPasswordEl.value });
        editPasswordConfirmEl.disabled = true;
      };
      editPasswordEl.addEventListener("input", syncEditPasswordConfirmState);
      editPasswordEl.addEventListener("change", syncEditPasswordConfirmState);
      editPasswordEl.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        confirmEditPassword();
      });
      editPasswordConfirmEl.addEventListener("click", confirmEditPassword);
      syncEditPasswordConfirmState();
    }
    app.querySelectorAll("[data-open-build-picker]").forEach((button) => {
      button.addEventListener("click", () => {
        const picker = String(button.dataset.openBuildPicker ?? "").trim().toLowerCase();
        if (picker === "race") openRacePickerModal(state);
        else if (picker === "subrace") openSubracePickerModal(state);
        else if (picker === "background") openBackgroundPickerModal(state);
        else if (picker === "class") openClassPickerModal(state);
        else if (picker === "subclass") openSubclassPickerModal(state);
      });
    });
    const levelEl = app.querySelector("#level");
    if (levelEl) {
      const handleLevelChange = () => {
        updateCharacterWithRequiredSettings(
          state,
          {
            level: Math.max(1, Math.min(20, toNumber(levelEl.value, 1))),
          },
          { preserveUserOverrides: true }
        );
      };
      levelEl.addEventListener("input", handleLevelChange);
      levelEl.addEventListener("change", handleLevelChange);
    }

    app.querySelectorAll("[data-ability]").forEach((input) => {
      input.addEventListener("input", () => store.updateAbility(input.dataset.ability, input.value));
    });
    const pointBuyAbilityKeys = ["str", "dex", "con", "int", "wis", "cha"];
    const pointBuyCostByScore = {
      8: 0,
      9: 1,
      10: 2,
      11: 3,
      12: 4,
      13: 5,
      14: 7,
      15: 9,
    };
    const pointBuyMin = 8;
    const pointBuyMax = 15;
    const pointBuyBudget = 27;
    const getPointBuyBase = (character) => {
      const rawBase = character?.abilityBase && typeof character.abilityBase === "object" ? character.abilityBase : {};
      return pointBuyAbilityKeys.reduce((acc, ability) => {
        const raw = toNumber(rawBase?.[ability], toNumber(character?.abilities?.[ability], pointBuyMin));
        acc[ability] = Math.max(pointBuyMin, Math.min(pointBuyMax, Math.floor(raw)));
        return acc;
      }, {});
    };
    const getPointBuySpent = (scores) =>
      pointBuyAbilityKeys.reduce((sum, ability) => {
        const score = Math.max(pointBuyMin, Math.min(pointBuyMax, toNumber(scores?.[ability], pointBuyMin)));
        return sum + toNumber(pointBuyCostByScore[score], 0);
      }, 0);
    app.querySelectorAll("[data-point-buy-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        const mode = String(button.dataset.pointBuyMode ?? "").trim().toLowerCase();
        withUpdatedPlay(state, (play) => {
          play.pointBuyEnabled = mode === "pointbuy";
        });
      });
    });
    app.querySelectorAll("[data-point-buy-delta]").forEach((button) => {
      button.addEventListener("click", () => {
        const ability = String(button.dataset.pointBuyAbility ?? "").trim().toLowerCase();
        const delta = Math.floor(toNumber(button.dataset.pointBuyDelta, 0));
        if (!pointBuyAbilityKeys.includes(ability) || !delta) return;
        const currentCharacter = store.getState().character;
        if (!Boolean(currentCharacter?.play?.pointBuyEnabled)) {
          const autoBonus = toNumber(currentCharacter?.play?.autoAbilityBonuses?.[ability], 0);
          const currentRaw = Math.max(
            1,
            Math.min(
              30,
              toNumber(currentCharacter?.abilityBase?.[ability], toNumber(currentCharacter?.abilities?.[ability], 10) - autoBonus)
            )
          );
          const nextRaw = Math.max(1, Math.min(30, currentRaw + delta));
          if (nextRaw === currentRaw) return;
          const nextFinal = Math.max(1, Math.min(30, nextRaw + autoBonus));
          store.updateAbility(ability, nextFinal);
          return;
        }
        const nextBase = getPointBuyBase(currentCharacter);
        const current = toNumber(nextBase?.[ability], pointBuyMin);
        const target = Math.max(pointBuyMin, Math.min(pointBuyMax, current + delta));
        if (target === current) return;
        const currentSpent = getPointBuySpent(nextBase);
        const currentCost = toNumber(pointBuyCostByScore[current], 0);
        const nextCost = toNumber(pointBuyCostByScore[target], currentCost);
        const nextSpent = currentSpent - currentCost + nextCost;
        if (nextSpent > pointBuyBudget) return;
        nextBase[ability] = target;
        updateCharacterWithRequiredSettings(state, { abilityBase: nextBase }, { preserveUserOverrides: true });
      });
    });
    app.querySelectorAll("[data-auto-choice-input]").forEach((input) => {
      input.addEventListener("change", () => {
        const sourceKey = String(input.dataset.autoChoiceSource ?? "").trim();
        const choiceId = String(input.dataset.autoChoiceId ?? "").trim();
        const value = String(input.dataset.autoChoiceValue ?? "").trim();
        const valueToken = normalizeChoiceToken(value);
        if (!sourceKey || !choiceId || !value) return;
        if (!valueToken) return;
        const maxCount = Math.max(1, toNumber(input.dataset.autoChoiceMax, 1));
        const nextPlay =
          state.character.play && typeof state.character.play === "object" && !Array.isArray(state.character.play)
            ? structuredClone(state.character.play)
            : {};
        const selections =
          nextPlay.autoChoiceSelections && typeof nextPlay.autoChoiceSelections === "object" && !Array.isArray(nextPlay.autoChoiceSelections)
            ? { ...nextPlay.autoChoiceSelections }
            : {};
        const sourceSelections =
          selections[sourceKey] && typeof selections[sourceKey] === "object" && !Array.isArray(selections[sourceKey])
            ? { ...selections[sourceKey] }
            : {};
        const currentValues = Array.isArray(sourceSelections[choiceId])
          ? sourceSelections[choiceId].map((entry) => String(entry ?? "").trim()).filter(Boolean)
          : [];
        const isChecked = input.checked;
        const valueByToken = new Map();
        currentValues.forEach((entry) => {
          const token = normalizeChoiceToken(entry);
          if (!token) return;
          valueByToken.set(token, entry);
        });
        if (isChecked) valueByToken.set(valueToken, value);
        else valueByToken.delete(valueToken);
        let nextValues = [...valueByToken.values()];
        if (nextValues.length > maxCount) nextValues = nextValues.slice(nextValues.length - maxCount);
        sourceSelections[choiceId] = nextValues;
        selections[sourceKey] = sourceSelections;
        nextPlay.autoChoiceSelections = selections;
        updateCharacterWithRequiredSettings(state, { play: nextPlay }, { preserveUserOverrides: true });
      });
    });
    app.querySelectorAll("[data-asi-choice-select]").forEach((input) => {
      input.addEventListener("change", () => {
        const sourceKey = String(input.dataset.autoChoiceSource ?? "").trim();
        const choiceId = String(input.dataset.autoChoiceId ?? "").trim();
        if (!sourceKey || !choiceId) return;
        const maxCount = Math.max(1, toNumber(input.dataset.autoChoiceMax, 1));
        const allowDuplicates = String(input.dataset.autoChoiceAllowDuplicates ?? "true").trim().toLowerCase() !== "false";
        const nextPlay =
          state.character.play && typeof state.character.play === "object" && !Array.isArray(state.character.play)
            ? structuredClone(state.character.play)
            : {};
        const selections =
          nextPlay.autoChoiceSelections && typeof nextPlay.autoChoiceSelections === "object" && !Array.isArray(nextPlay.autoChoiceSelections)
            ? { ...nextPlay.autoChoiceSelections }
            : {};
        const sourceSelections =
          selections[sourceKey] && typeof selections[sourceKey] === "object" && !Array.isArray(selections[sourceKey])
            ? { ...selections[sourceKey] }
            : {};
        const localSelectGroup = input.closest(".auto-choice-selects, .asi-inline-row");
        const selectScope = localSelectGroup ?? app;
        let nextValues = Array.from(selectScope.querySelectorAll("[data-asi-choice-select]"))
          .filter((selectEl) => {
            const selectSource = String(selectEl.dataset.autoChoiceSource ?? "").trim();
            const selectChoiceId = String(selectEl.dataset.autoChoiceId ?? "").trim();
            return selectSource === sourceKey && selectChoiceId === choiceId;
          })
          .map((selectEl) => String(selectEl.value ?? "").trim())
          .filter(Boolean)
          .slice(0, maxCount);
        if (!allowDuplicates) {
          const seen = new Set();
          nextValues = nextValues.filter((value) => {
            const token = normalizeChoiceToken(value);
            if (!token || seen.has(token)) return false;
            seen.add(token);
            return true;
          });
        }
        sourceSelections[choiceId] = nextValues;
        selections[sourceKey] = sourceSelections;
        nextPlay.autoChoiceSelections = selections;
        updateCharacterWithRequiredSettings(state, { play: nextPlay }, { preserveUserOverrides: true });
      });
    });
    app.querySelectorAll("[data-ability-step]").forEach((button) => {
      button.addEventListener("click", () => {
        const ability = button.dataset.abilityStep;
        if (!ability) return;
        const delta = toNumber(button.dataset.stepDelta, 0);
        if (!delta) return;
        const currentValue = toNumber(state.character.abilities?.[ability], 10);
        const nextValue = Math.max(1, Math.min(30, currentValue + delta));
        store.updateAbility(ability, nextValue);
      });
    });

    app.querySelectorAll("[data-save-prof-btn]").forEach((button) => {
      button.addEventListener("click", () => {
        const ability = button.dataset.saveProfBtn;
        withUpdatedPlay(state, (play) => {
          const current = Boolean(play.saveProficiencies?.[ability]);
          const autoValue = Boolean(play.autoSaveProficiencies?.[ability]);
          if (autoValue && current) return;
          const next = !current;
          const overrides =
            play.saveProficiencyOverrides && typeof play.saveProficiencyOverrides === "object" && !Array.isArray(play.saveProficiencyOverrides)
              ? { ...play.saveProficiencyOverrides }
              : {};
          if (next === autoValue) delete overrides[ability];
          else overrides[ability] = next;
          play.saveProficiencyOverrides = overrides;
          play.saveProficiencies = { ...(play.saveProficiencies ?? {}), [ability]: next };
        });
      });
    });

    app.querySelectorAll("[data-skill-prof-btn]").forEach((button) => {
      button.addEventListener("mousedown", (evt) => {
        evt.preventDefault();
      });
      button.addEventListener("click", () => {
        const key = button.dataset.skillProfBtn;
        withUpdatedPlay(state, (play) => {
          const skillMode = normalizeSkillProficiencyMode(play.skillProficiencyModes?.[key] ?? (play.skillProficiencies?.[key] ? "proficient" : "none"));
          const autoMode = normalizeSkillProficiencyMode(
            play.autoSkillProficiencyModes?.[key] ?? (play.autoSkillProficiencies?.[key] ? "proficient" : "none")
          );
          const cycleModes = getAllowedSkillModesForCharacter(state.character, autoMode);
          if (!cycleModes.length) return;
          const index = cycleModes.indexOf(skillMode);
          const nextMode = cycleModes[(index + 1) % cycleModes.length];
          const next = nextMode === "proficient" || nextMode === "expertise";
          const autoValue = autoMode === "proficient" || autoMode === "expertise";
          const overrides =
            play.skillProficiencyOverrides
            && typeof play.skillProficiencyOverrides === "object"
            && !Array.isArray(play.skillProficiencyOverrides)
              ? { ...play.skillProficiencyOverrides }
              : {};
          const modeOverrides =
            play.skillProficiencyModeOverrides
            && typeof play.skillProficiencyModeOverrides === "object"
            && !Array.isArray(play.skillProficiencyModeOverrides)
              ? { ...play.skillProficiencyModeOverrides }
              : {};
          if (nextMode === autoMode) delete modeOverrides[key];
          else modeOverrides[key] = nextMode;
          if (next === autoValue) delete overrides[key];
          else overrides[key] = next;
          play.skillProficiencyModeOverrides = modeOverrides;
          play.skillProficiencyOverrides = overrides;
          play.skillProficiencyModes = { ...(play.skillProficiencyModes ?? {}), [key]: nextMode };
          play.skillProficiencies = { ...(play.skillProficiencies ?? {}), [key]: next };
        });
      });
    });

    app.querySelectorAll("[data-spell-list-visibility]").forEach((button) => {
      button.addEventListener("click", () => {
        const mode = String(button.dataset.spellListVisibility ?? "").trim().toLowerCase();
        const levelKey = String(button.dataset.spellListLevel ?? "").trim();
        if (!doesClassUsePreparedSpells(state.catalogs, state.character)) return;
        withUpdatedPlay(state, (play) => {
          const nextByLevel =
            play.showAllPreparedCasterSpellsByLevel
            && typeof play.showAllPreparedCasterSpellsByLevel === "object"
            && !Array.isArray(play.showAllPreparedCasterSpellsByLevel)
              ? { ...play.showAllPreparedCasterSpellsByLevel }
              : {};
          if (levelKey) nextByLevel[levelKey] = mode === "all";
          play.showAllPreparedCasterSpellsByLevel = nextByLevel;
          play.showAllPreparedCasterSpells = false;
        });
      });
    });

    app.querySelector("#open-spells")?.addEventListener("click", () => openSpellModal(state));
    app.querySelector("#open-items")?.addEventListener("click", () => openItemModal(state));
    app.querySelectorAll("[data-open-item-details-index]").forEach((button) => {
      button.addEventListener("click", () => {
        openInventoryItemDetails(button.dataset.openItemDetailsIndex);
      });
    });
    app.querySelectorAll("[data-toggle-item-equipped]").forEach((button) => {
      button.addEventListener("click", () => {
        toggleInventoryItemEquipped(button.dataset.toggleItemEquipped);
      });
    });
    app.querySelectorAll("[data-toggle-item-attuned]").forEach((button) => {
      button.addEventListener("click", () => {
        toggleInventoryItemAttuned(button.dataset.toggleItemAttuned, button.dataset.toggleItemAttunedIndex);
      });
    });
    app.querySelectorAll("[data-remove-item-index]").forEach((button) => {
      button.addEventListener("click", () => {
        removeInventoryItemByIndex(button.dataset.removeItemIndex);
      });
    });
    app.querySelectorAll("[data-item-counter-adjust-id]").forEach((button) => {
      button.addEventListener("click", () => {
        adjustInventoryItemCounter(button.dataset.itemCounterAdjustId, button.dataset.itemCounterDelta);
      });
    });
    app.querySelectorAll("[data-open-feat-picker]").forEach((button) => {
      button.addEventListener("click", () => {
        const slotId = button.dataset.openFeatPicker;
        if (!slotId) return;
        openFeatModal(state, slotId);
      });
    });
    app.querySelectorAll("[data-open-optional-feature-picker]").forEach((button) => {
      button.addEventListener("click", () => {
        const slotId = button.dataset.openOptionalFeaturePicker;
        if (!slotId) return;
        openOptionalFeatureModal(state, slotId);
      });
    });
    const setFeatureModeChoice = (modeId, value, maxCountRaw) => {
      const resolvedModeId = String(modeId ?? "").trim();
      const resolvedValue = String(value ?? "").trim();
      if (!resolvedModeId || !resolvedValue) return;
      withUpdatedPlay(state, (play) => {
        const mode = (state.character?.progression?.featureModes ?? []).find((entry) => String(entry?.id ?? "").trim() === resolvedModeId);
        if (!mode) return;
        const options = Array.isArray(mode?.optionValues) ? mode.optionValues : [];
        if (!options.includes(resolvedValue)) return;
        const maxCount = Math.max(1, Math.min(options.length, Math.floor(toNumber(maxCountRaw, toNumber(mode?.count, 1)))));
        const nextModes =
          play.featureModes && typeof play.featureModes === "object" && !Array.isArray(play.featureModes)
            ? { ...play.featureModes }
            : {};
        const existingRaw = nextModes[resolvedModeId];
        const existingValues = Array.isArray(existingRaw)
          ? existingRaw.map((entry) => String(entry ?? "").trim())
          : [String(existingRaw ?? "").trim()];
        let selected = [...new Set(existingValues.filter((entry) => entry && options.includes(entry)))];
        if (maxCount <= 1) {
          selected = [resolvedValue];
        } else if (selected.includes(resolvedValue)) {
          selected = selected.filter((entry) => entry !== resolvedValue);
        } else {
          selected.push(resolvedValue);
          if (selected.length > maxCount) selected = selected.slice(selected.length - maxCount);
        }
        if (!selected.length) selected = [options[0]];
        nextModes[resolvedModeId] = maxCount <= 1 ? selected[0] : selected;
        play.featureModes = nextModes;
      });
    };
    app.querySelectorAll("[data-feature-mode-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const modeId = String(button.dataset.featureModeId ?? "").trim();
        const value = String(button.dataset.featureModeValue ?? "").trim();
        const maxCount = toNumber(button.dataset.featureModeMax, 1);
        setFeatureModeChoice(modeId, value, maxCount);
      });
    });
    app.querySelectorAll("[data-feature-mode-id]").forEach((select) => {
      select.addEventListener("change", () => {
        const modeId = String(select.dataset.featureModeId ?? "").trim();
        const value = String(select.value ?? "").trim();
        if (!modeId || !value) return;
        setFeatureModeChoice(modeId, value, 1);
      });
    });
    app.querySelectorAll("[data-remove-feat-slot]").forEach((button) => {
      button.addEventListener("click", () => {
        const slotId = button.dataset.removeFeatSlot;
        if (!slotId) return;
        const feats = (state.character.feats ?? []).filter((feat) => feat.slotId !== slotId);
        updateCharacterWithRequiredSettings(state, { feats }, { preserveUserOverrides: true });
      });
    });
    app.querySelectorAll("[data-remove-optional-feature-slot]").forEach((button) => {
      button.addEventListener("click", () => {
        const slotId = button.dataset.removeOptionalFeatureSlot;
        if (!slotId) return;
        const optionalFeatures = (state.character.optionalFeatures ?? []).filter((feature) => feature.slotId !== slotId);
        updateCharacterWithRequiredSettings(state, { optionalFeatures }, { preserveUserOverrides: true });
      });
    });
    app.querySelector("#open-multiclass")?.addEventListener("click", () => openMulticlassModal(state));
    app.querySelectorAll("[data-open-levelup]").forEach((button) => {
      button.addEventListener("click", () => openLevelUpModal(state));
    });
    app.querySelectorAll("[data-build-spell-open]").forEach((button) => {
      button.addEventListener("click", () => {
        const spellName = button.dataset.buildSpellOpen;
        if (!spellName) return;
        openSpellDetailsModal(state, spellName);
      });
    });
    const defaultSpellSlots = getCharacterSpellSlotDefaults(state.catalogs, state.character);
    app.querySelectorAll("[data-build-slot-max]").forEach((input) => {
      input.addEventListener("input", () => {
        const level = String(input.dataset.buildSlotMax);
        const nextMax = Math.max(0, toNumber(input.value, 0));
        const defaultMax = Math.max(0, toNumber(defaultSpellSlots[level], 0));
        withUpdatedPlay(state, (play) => {
          const previous = play.spellSlots?.[level] ?? { max: defaultMax, used: 0 };
          const overrides = { ...(play.spellSlotMaxOverrides ?? {}) };
          const userOverrides = { ...(play.spellSlotUserOverrides ?? {}) };
          if (nextMax === defaultMax) delete overrides[level];
          else overrides[level] = nextMax;
          if (nextMax === defaultMax) delete userOverrides[level];
          else userOverrides[level] = true;
          play.spellSlotMaxOverrides = overrides;
          play.spellSlotUserOverrides = userOverrides;
          play.spellSlotAutoDefaults = { ...(play.spellSlotAutoDefaults ?? {}), [level]: defaultMax };
          play.spellSlots = {
            ...(play.spellSlots ?? {}),
            [level]: { ...previous, max: nextMax, used: Math.min(toNumber(previous.used, 0), nextMax) },
          };
        });
      });
    });
    app.querySelectorAll("[data-build-slot-default]").forEach((button) => {
      button.addEventListener("click", () => {
        const level = String(button.dataset.buildSlotDefault);
        const defaultMax = Math.max(0, toNumber(defaultSpellSlots[level], 0));
        withUpdatedPlay(state, (play) => {
          const previous = play.spellSlots?.[level] ?? { max: defaultMax, used: 0 };
          const overrides = { ...(play.spellSlotMaxOverrides ?? {}) };
          const userOverrides = { ...(play.spellSlotUserOverrides ?? {}) };
          delete overrides[level];
          delete userOverrides[level];
          play.spellSlotMaxOverrides = overrides;
          play.spellSlotUserOverrides = userOverrides;
          play.spellSlotAutoDefaults = { ...(play.spellSlotAutoDefaults ?? {}), [level]: defaultMax };
          play.spellSlots = {
            ...(play.spellSlots ?? {}),
            [level]: { ...previous, max: defaultMax, used: Math.min(toNumber(previous.used, 0), defaultMax) },
          };
        });
      });
    });
    app.querySelector("#create-permanent-character")?.addEventListener("click", async () => {
      const button = app.querySelector("#create-permanent-character");
      if (button) button.disabled = true;
      try {
        const id = await createOrSavePermanentCharacter(store.getState());
        alert(`Character saved. Bookmark this URL to reopen: ${window.location.origin}${window.location.pathname}?char=${id}`);
      } catch (error) {
        alert(error instanceof Error ? error.message : "Failed to create permanent character link");
      } finally {
        if (button) button.disabled = false;
      }
    });
    app.querySelector("#copy-character-link")?.addEventListener("click", async () => {
      const id = store.getState().character?.id;
      if (!isUuid(id)) return;
      const link = `${window.location.origin}${window.location.pathname}?char=${id}`;
      try {
        await navigator.clipboard.writeText(link);
        alert("Character URL copied to clipboard.");
      } catch {
        alert(link);
      }
    });
    app.querySelector("#import-character-json")?.addEventListener("click", () => {
      app.querySelector("#import-character-json-file")?.click();
    });
    app.querySelector("#import-character-json-file")?.addEventListener("change", async (evt) => {
      const input = evt.target instanceof HTMLInputElement ? evt.target : null;
      const file = input?.files?.[0] ?? null;
      if (!file) return;
      try {
        await importCharacterFromJsonFile(file, { sourceLabel: "Edit mode import" });
      } catch (error) {
        alert(error instanceof Error ? error.message : "Invalid JSON payload");
      } finally {
        if (input) input.value = "";
      }
    });
    app.querySelector("#export-character-json")?.addEventListener("click", () => {
      try {
        exportCharacterToJsonFile(store.getState().character);
      } catch (error) {
        alert(error instanceof Error ? error.message : "Failed to export JSON");
      }
    });
  }

  function bindPlayEvents(state) {
    bindCoreStatBreakdownButtons();
    clearPlayManualMenuOutsideClickHandler();
    const LONG_PRESS_CHOOSER_DELAY_MS = 500;
    const longPressRollChooser = (() => {
      let overlayEl = null;
      let hintEl = null;
      let advantageButtonEl = null;
      let disadvantageButtonEl = null;
      let critButtonEl = null;
      let hideTimer = null;
      let pendingHandlers = null;

      const positionNearElement = (targetEl) => {
        if (!overlayEl) return;
        const rect = targetEl?.getBoundingClientRect?.();
        if (!rect) {
          overlayEl.style.left = "50%";
          overlayEl.style.top = "auto";
          overlayEl.style.bottom = "1.3rem";
          overlayEl.style.transform = "translate(-50%, 0)";
          return;
        }
        const viewportWidth = Math.max(0, window.innerWidth || document.documentElement.clientWidth || 0);
        const viewportHeight = Math.max(0, window.innerHeight || document.documentElement.clientHeight || 0);
        const margin = 8;
        const overlayWidth = Math.max(220, overlayEl.offsetWidth || 0);
        const overlayHeight = Math.max(54, overlayEl.offsetHeight || 0);
        const preferredLeft = rect.left + rect.width / 2;
        const minCenter = margin + overlayWidth / 2;
        const maxCenter = Math.max(minCenter, viewportWidth - margin - overlayWidth / 2);
        const clampedLeft = Math.min(maxCenter, Math.max(minCenter, preferredLeft));

        const preferredTop = rect.top - 8;
        const canOpenAbove = preferredTop - overlayHeight >= margin;
        const nextTop = canOpenAbove
          ? preferredTop
          : Math.min(viewportHeight - margin, rect.bottom + 8);

        overlayEl.style.left = `${Math.round(clampedLeft)}px`;
        overlayEl.style.top = `${Math.round(nextTop)}px`;
        overlayEl.style.bottom = "auto";
        overlayEl.style.transform = canOpenAbove ? "translate(-50%, -100%)" : "translate(-50%, 0)";
      };

      const hide = (delayMs = 0) => {
        if (!overlayEl) return;
        if (hideTimer != null) {
          window.clearTimeout(hideTimer);
          hideTimer = null;
        }
        const runHide = () => {
          pendingHandlers = null;
          overlayEl?.classList.remove("is-visible", "is-ready");
        };
        if (delayMs > 0) hideTimer = window.setTimeout(runHide, delayMs);
        else runHide();
      };

      const choose = (mode) => {
        const handler = pendingHandlers?.[mode];
        hide();
        if (typeof handler === "function") handler();
      };

      const ensure = () => {
        if (overlayEl) return;
        overlayEl = document.createElement("div");
        overlayEl.className = "long-press-roll-overlay";
        hintEl = document.createElement("div");
        hintEl.className = "long-press-roll-overlay-hint";
        const actionsEl = document.createElement("div");
        actionsEl.className = "long-press-roll-overlay-actions";
        advantageButtonEl = document.createElement("button");
        advantageButtonEl.type = "button";
        advantageButtonEl.className = "long-press-roll-overlay-btn";
        advantageButtonEl.textContent = "Advantage";
        disadvantageButtonEl = document.createElement("button");
        disadvantageButtonEl.type = "button";
        disadvantageButtonEl.className = "long-press-roll-overlay-btn";
        disadvantageButtonEl.textContent = "Disadvantage";
        critButtonEl = document.createElement("button");
        critButtonEl.type = "button";
        critButtonEl.className = "long-press-roll-overlay-btn";
        critButtonEl.textContent = "Crit";
        actionsEl.append(advantageButtonEl, disadvantageButtonEl, critButtonEl);
        overlayEl.append(hintEl, actionsEl);
        advantageButtonEl.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          choose("advantage");
        });
        disadvantageButtonEl.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          choose("disadvantage");
        });
        critButtonEl.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          choose("crit");
        });
        document.addEventListener(
          "pointerdown",
          (event) => {
            if (!overlayEl?.classList.contains("is-visible")) return;
            if (overlayEl.contains(event.target)) return;
            hide();
          },
          true
        );
        document.body.appendChild(overlayEl);
      };

      return {
        showHint(targetEl, message) {
          ensure();
          if (hideTimer != null) {
            window.clearTimeout(hideTimer);
            hideTimer = null;
          }
          pendingHandlers = null;
          if (hintEl) hintEl.textContent = String(message ?? "");
          positionNearElement(targetEl);
          overlayEl?.classList.remove("is-ready");
          overlayEl?.classList.add("is-visible");
        },
        showChooser(targetEl, handlers = {}) {
          ensure();
          if (hideTimer != null) {
            window.clearTimeout(hideTimer);
            hideTimer = null;
          }
          pendingHandlers = {
            advantage: typeof handlers.advantage === "function" ? handlers.advantage : null,
            disadvantage: typeof handlers.disadvantage === "function" ? handlers.disadvantage : null,
            crit: typeof handlers.crit === "function" ? handlers.crit : null,
          };
          if (advantageButtonEl) {
            advantageButtonEl.textContent = String(handlers.advantageLabel ?? "Advantage");
          }
          if (disadvantageButtonEl) {
            disadvantageButtonEl.textContent = String(handlers.disadvantageLabel ?? "Disadvantage");
          }
          if (critButtonEl) {
            critButtonEl.textContent = String(handlers.critLabel ?? "Crit");
          }
          if (advantageButtonEl) advantageButtonEl.hidden = !pendingHandlers.advantage;
          if (disadvantageButtonEl) disadvantageButtonEl.hidden = !pendingHandlers.disadvantage;
          if (critButtonEl) critButtonEl.hidden = !pendingHandlers.crit;
          if (hintEl) hintEl.textContent = String(handlers.hint ?? "Choose roll mode");
          positionNearElement(targetEl);
          overlayEl?.classList.add("is-visible", "is-ready");
        },
        hide,
      };
    })();

    const bindClickAndLongPress = (element, onClick, onLongPress, options = {}) => {
      if (!element || typeof onClick !== "function") return;
      const onCrit = typeof options.onCrit === "function" ? options.onCrit : null;
      const longPressHandlers =
        options.longPressHandlers && typeof options.longPressHandlers === "object" ? options.longPressHandlers : null;
      const advantageLongPressHandler =
        typeof longPressHandlers?.advantage === "function"
          ? longPressHandlers.advantage
          : typeof onLongPress === "function"
            ? () => onLongPress("advantage")
            : null;
      const disadvantageLongPressHandler =
        typeof longPressHandlers?.disadvantage === "function"
          ? longPressHandlers.disadvantage
          : typeof onLongPress === "function"
            ? () => onLongPress("disadvantage")
            : null;
      const chooserHint = typeof options.chooserHint === "string" && options.chooserHint.trim()
        ? options.chooserHint.trim()
        : "Choose roll mode";
      const advantageLabel = typeof options.advantageLabel === "string" && options.advantageLabel.trim()
        ? options.advantageLabel.trim()
        : "Advantage";
      const disadvantageLabel = typeof options.disadvantageLabel === "string" && options.disadvantageLabel.trim()
        ? options.disadvantageLabel.trim()
        : "Disadvantage";
      const critLabel = typeof options.critLabel === "string" && options.critLabel.trim()
        ? options.critLabel.trim()
        : "Crit";
      const hasLongPressOptions = Boolean(advantageLongPressHandler || disadvantageLongPressHandler || onCrit);
      let chooserTimer = null;
      let pressPointerId = null;
      let isPressing = false;
      let longPressTriggered = false;
      let suppressNextClick = false;
      let suppressTimer = null;

      const clearHoldTimers = () => {
        if (chooserTimer != null) {
          window.clearTimeout(chooserTimer);
          chooserTimer = null;
        }
      };

      const cancelPress = () => {
        clearHoldTimers();
        pressPointerId = null;
        isPressing = false;
      };

      const clearSuppress = () => {
        suppressNextClick = false;
        if (suppressTimer != null) {
          window.clearTimeout(suppressTimer);
          suppressTimer = null;
        }
      };

      if (hasLongPressOptions) {
        element.addEventListener("contextmenu", (event) => {
          event.preventDefault();
        });
      }

      element.addEventListener("pointerdown", (event) => {
        if (!hasLongPressOptions) return;
        if (event.button !== 0) return;
        if (event.pointerType && event.pointerType !== "mouse") event.preventDefault();
        isPressing = true;
        longPressTriggered = false;
        pressPointerId = event.pointerId;
        longPressRollChooser.hide();
        clearHoldTimers();
        chooserTimer = window.setTimeout(() => {
          if (!isPressing) return;
          longPressTriggered = true;
          suppressNextClick = true;
          if (suppressTimer != null) window.clearTimeout(suppressTimer);
          suppressTimer = window.setTimeout(() => {
            suppressNextClick = false;
            suppressTimer = null;
          }, 700);
          longPressRollChooser.showChooser(element, {
            advantage: advantageLongPressHandler,
            disadvantage: disadvantageLongPressHandler,
            crit: onCrit ?? null,
            hint: chooserHint,
            advantageLabel,
            disadvantageLabel,
            critLabel,
          });
        }, LONG_PRESS_CHOOSER_DELAY_MS);
      });

      const handlePressEnd = (event) => {
        if (!isPressing) return;
        if (pressPointerId != null && event.pointerId !== pressPointerId) return;
        const consumedByLongPress = longPressTriggered;
        cancelPress();
        if (!consumedByLongPress) longPressRollChooser.hide();
      };

      element.addEventListener("pointerup", handlePressEnd);
      element.addEventListener("pointercancel", () => {
        cancelPress();
        clearSuppress();
        longPressRollChooser.hide();
      });
      element.addEventListener("pointerleave", () => {
        if (!isPressing || longPressTriggered) return;
        cancelPress();
        longPressRollChooser.hide();
      });

      element.addEventListener("click", (event) => {
        if (suppressNextClick || longPressTriggered) {
          event.preventDefault();
          event.stopPropagation();
          longPressTriggered = false;
          clearSuppress();
          return;
        }
        onClick();
      });
    };

    const parseD20ModifierFromNotation = (value) => {
      const notation = extractSimpleNotation(value);
      if (!notation) return null;
      const match = notation.replace(/\s+/g, "").match(/^1d20(?:([+\-]\d+))?$/i);
      if (!match) return null;
      const modifier = toNumber(match[1], 0);
      return Number.isFinite(modifier) ? modifier : null;
    };

    const rollToHitValue = (attackName, value, rollMode = "normal") => {
      if (/[dD]/.test(value)) {
        const notation = extractSimpleNotation(value);
        if (!notation) {
          setDiceResult(`${attackName}: invalid to-hit dice notation.`, true);
          return;
        }
        if (rollMode === "advantage" || rollMode === "disadvantage") {
          const modifier = parseD20ModifierFromNotation(notation);
          if (modifier == null) {
            setDiceResult(`${attackName}: advantage/disadvantage supports to-hit values like 1d20+X.`, true);
            return;
          }
          rollVisualD20(`${attackName} to-hit`, modifier, rollMode);
          return;
        }
        rollVisualNotation(`${attackName} to-hit`, notation);
        return;
      }
      const modifier = toNumber(value, Number.NaN);
      if (!Number.isFinite(modifier)) {
        setDiceResult(`${attackName}: invalid to-hit value.`, true);
        return;
      }
      rollVisualD20(`${attackName} to-hit`, modifier, rollMode);
    };

    const parseDamageNotationTerms = (notation) => {
      const normalized = String(notation ?? "").trim().replace(/\s+/g, "");
      if (!normalized) return null;
      const tokens = normalized.match(/[+\-]?[^+\-]+/g);
      if (!tokens || !tokens.length) return null;
      const diceTerms = [];
      let flatModifier = 0;
      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        const sign = token.startsWith("-") ? -1 : 1;
        const body = token.replace(/^[+\-]/, "");
        if (!body) return null;
        const diceMatch = body.match(/^(\d*)d(\d+)$/i);
        if (diceMatch) {
          const count = toNumber(diceMatch[1] || "1", 0);
          const faces = toNumber(diceMatch[2], 0);
          if (count <= 0 || faces <= 0) return null;
          diceTerms.push({ count, faces, sign });
          continue;
        }
        if (!/^\d+$/.test(body)) return null;
        flatModifier += sign * toNumber(body, 0);
      }
      return { diceTerms, flatModifier };
    };

    const buildNotationFromTerms = (diceTerms, flatModifier) => {
      const parts = [];
      const pushPart = (sign, valueText) => {
        if (!valueText) return;
        if (!parts.length) {
          parts.push(sign < 0 ? `-${valueText}` : valueText);
          return;
        }
        parts.push(`${sign < 0 ? "-" : "+"}${valueText}`);
      };
      (Array.isArray(diceTerms) ? diceTerms : []).forEach((term) => {
        const count = Math.max(1, Math.floor(toNumber(term?.count, 1)));
        const faces = Math.max(1, Math.floor(toNumber(term?.faces, 1)));
        const sign = toNumber(term?.sign, 1) < 0 ? -1 : 1;
        pushPart(sign, `${count}d${faces}`);
      });
      const flat = Math.floor(toNumber(flatModifier, 0));
      if (flat !== 0 || !parts.length) {
        pushPart(flat < 0 ? -1 : 1, String(Math.abs(flat)));
      }
      return parts.join("");
    };

    const getCritNotation = (notation, critStyleRaw) => {
      const parsed = parseDamageNotationTerms(notation);
      if (!parsed) return null;
      const critStyle = String(critStyleRaw ?? "standard").trim() || "standard";
      const baseMaxDice = parsed.diceTerms.reduce(
        (sum, term) => sum + (term.sign > 0 ? term.count * term.faces : 0),
        0
      );
      if (critStyle === "none") return buildNotationFromTerms(parsed.diceTerms, parsed.flatModifier);
      if (critStyle === "doubleTotal" || critStyle === "doubleAll") {
        return buildNotationFromTerms(
          parsed.diceTerms.map((term) => ({ ...term, count: term.count * 2 })),
          parsed.flatModifier * 2
        );
      }
      if (critStyle === "maxPlusRoll") {
        return buildNotationFromTerms(parsed.diceTerms, parsed.flatModifier + baseMaxDice);
      }
      if (critStyle === "maxDamage") {
        return buildNotationFromTerms([], parsed.flatModifier + baseMaxDice * 2);
      }
      return buildNotationFromTerms(
        parsed.diceTerms.map((term) => ({ ...term, count: term.count * 2 })),
        parsed.flatModifier
      );
    };

    const rollDamageValue = (attackName, value, options = {}) => {
      const notation = extractSimpleNotation(value);
      if (!notation) {
        setDiceResult(`${attackName}: invalid damage dice notation.`, true);
        return;
      }
      if (!options.crit) {
        rollVisualNotation(`${attackName} damage`, notation);
        return;
      }
      const latestCharacter = store.getState().character ?? state.character ?? {};
      const critStyle = String(latestCharacter?.critStyle ?? "standard").trim() || "standard";
      const critNotation = getCritNotation(notation, critStyle);
      if (!critNotation) {
        setDiceResult(`${attackName}: unsupported crit notation. Use terms like 2d6+3.`, true);
        return;
      }
      rollVisualNotation(`${attackName} damage (crit)`, critNotation);
    };

    app.querySelectorAll("[data-open-levelup]").forEach((button) => {
      button.addEventListener("click", () => openLevelUpModal(state));
    });
    const diceStyleEl = app.querySelector("#dice-style-select");
    if (diceStyleEl) {
      diceStyleEl.addEventListener("change", () => {
        const nextDiceStyle = diceStyleEl.value in diceStylePresets ? diceStyleEl.value : "arcane";
        uiState.selectedDiceStyle = nextDiceStyle;
        store.updateCharacter({ diceStyle: nextDiceStyle });
        applyDiceStyle();
      });
    }
    app.querySelector("#reroll-last-roll")?.addEventListener("click", () => {
      rerollLastRoll();
    });
    app.querySelector("#open-custom-roll")?.addEventListener("click", () => {
      openCustomRollModal();
    });
    app.querySelectorAll("[data-open-class-info]").forEach((button) => {
      button.addEventListener("click", () => {
        openClassDetailsModal(state);
      });
    });
    app.querySelectorAll("[data-open-subclass-info]").forEach((button) => {
      button.addEventListener("click", () => {
        openSubclassDetailsModal(state);
      });
    });
    const diceResultWrapEl = app.querySelector(".dice-result-wrap");
    const diceHistoryPopoverEl = app.querySelector("#dice-history-popover");
    if (diceResultWrapEl && diceHistoryPopoverEl) {
      const updateDiceHistoryPopoverPosition = () => {
        positionDiceHistoryPopoverWithinViewport(diceResultWrapEl, diceHistoryPopoverEl);
      };
      diceResultWrapEl.addEventListener("mouseenter", updateDiceHistoryPopoverPosition);
      diceResultWrapEl.addEventListener("focusin", updateDiceHistoryPopoverPosition);
      updateDiceHistoryPopoverPosition();
    }
    const manualMenuEl = app.querySelector(".play-manual-menu");
    const characterLogMenuEl = app.querySelector(".play-character-log-menu");
    if (manualMenuEl) {
      playManualMenuOutsideClickHandler = (event) => {
        if (!manualMenuEl.hasAttribute("open")) return;
        const target = event.target;
        if (target instanceof Node && manualMenuEl.contains(target)) return;
        manualMenuEl.removeAttribute("open");
      };
      document.addEventListener("pointerdown", playManualMenuOutsideClickHandler, true);
      manualMenuEl.querySelectorAll(".play-manual-links a").forEach((link) => {
        link.addEventListener("click", () => {
          manualMenuEl.removeAttribute("open");
        });
      });
      manualMenuEl.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        manualMenuEl.removeAttribute("open");
      });
      const manualLinksEl = manualMenuEl.querySelector(".play-manual-links");
      if (manualLinksEl) {
        manualMenuEl.addEventListener("toggle", () => {
          if (!manualMenuEl.hasAttribute("open")) return;
          positionFloatingPanelWithinViewport(manualMenuEl, manualLinksEl);
        });
      }
      if (characterLogMenuEl) {
        manualMenuEl.addEventListener("toggle", () => {
          if (!manualMenuEl.hasAttribute("open")) return;
          characterLogMenuEl.removeAttribute("open");
        });
      }
    }
    if (characterLogMenuEl) {
      playCharacterLogMenuOutsideClickHandler = (event) => {
        if (!characterLogMenuEl.hasAttribute("open")) return;
        const target = event.target;
        if (target instanceof Node && characterLogMenuEl.contains(target)) return;
        characterLogMenuEl.removeAttribute("open");
      };
      document.addEventListener("pointerdown", playCharacterLogMenuOutsideClickHandler, true);
      characterLogMenuEl.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        characterLogMenuEl.removeAttribute("open");
      });
      const characterLogPanelEl = characterLogMenuEl.querySelector(".play-character-log-panel");
      if (characterLogPanelEl) {
        characterLogMenuEl.addEventListener("toggle", () => {
          if (!characterLogMenuEl.hasAttribute("open")) return;
          positionFloatingPanelWithinViewport(characterLogMenuEl, characterLogPanelEl);
        });
      }
      if (manualMenuEl) {
        characterLogMenuEl.addEventListener("toggle", () => {
          if (!characterLogMenuEl.hasAttribute("open")) return;
          manualMenuEl.removeAttribute("open");
        });
      }
    }
    const wireOpenDetailControl = (selector, getId, openHandler) => {
      app.querySelectorAll(selector).forEach((control) => {
        control.addEventListener("click", () => {
          const id = getId(control);
          if (!id) return;
          openHandler(id);
        });
        if (control instanceof HTMLButtonElement) return;
        control.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          const id = getId(control);
          if (!id) return;
          openHandler(id);
        });
      });
    };
    wireOpenDetailControl("[data-open-feature]", (control) => control.dataset.openFeature, (featureId) => {
      openFeatureDetailsModal(state, featureId);
    });
    wireOpenDetailControl("[data-open-feat]", (control) => control.dataset.openFeat, (featId) => {
      openFeatDetailsModal(state, featId);
    });
    wireOpenDetailControl("[data-open-optional-feature]", (control) => control.dataset.openOptionalFeature, (featureId) => {
      openOptionalFeatureDetailsModal(state, featureId);
    });
    wireOpenDetailControl("[data-open-species-trait]", (control) => control.dataset.openSpeciesTrait, (traitName) => {
      openSpeciesTraitDetailsModal(state, traitName);
    });
    const normalizeFeatureLookupToken = (value) =>
      String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^\p{L}\p{N}\s]/gu, "");
    const resolveFeatureFromClassTableEffect = (snapshot, effectId) => {
      const normalizedEffectId = String(effectId ?? "").trim();
      if (!normalizedEffectId) return null;
      const classTableEffects = Array.isArray(snapshot?.character?.progression?.classTableEffects)
        ? snapshot.character.progression.classTableEffects
        : [];
      const effect = classTableEffects.find((entry) => String(entry?.id ?? "").trim() === normalizedEffectId);
      if (!effect) return null;
      const unlockedFeatures = Array.isArray(snapshot?.character?.progression?.unlockedFeatures)
        ? snapshot.character.progression.unlockedFeatures
        : [];
      const effectLabelToken = normalizeFeatureLookupToken(effect?.label);
      const effectClassToken = normalizeFeatureLookupToken(effect?.className);
      if (!effectLabelToken) return null;
      const exactMatch = unlockedFeatures.find((feature) => {
        if (effectClassToken && normalizeFeatureLookupToken(feature?.className) !== effectClassToken) return false;
        return normalizeFeatureLookupToken(feature?.name) === effectLabelToken;
      });
      if (exactMatch) return exactMatch;
      return unlockedFeatures.find((feature) => {
        if (effectClassToken && normalizeFeatureLookupToken(feature?.className) !== effectClassToken) return false;
        const featureNameToken = normalizeFeatureLookupToken(feature?.name);
        if (!featureNameToken) return false;
        return featureNameToken.includes(effectLabelToken) || effectLabelToken.includes(featureNameToken);
      }) ?? null;
    };
    wireOpenDetailControl("[data-open-class-table-effect]", (control) => control.dataset.openClassTableEffect, (effectId) => {
      const latestState = store.getState();
      const matchedFeature = resolveFeatureFromClassTableEffect(latestState, effectId);
      if (matchedFeature?.id) {
        openFeatureDetailsModal(latestState, matchedFeature.id);
        return;
      }
      openClassDetailsModal(latestState);
    });
    const getFeatureUseMetaMap = (playState) =>
      playState.featureUseMeta && typeof playState.featureUseMeta === "object" && !Array.isArray(playState.featureUseMeta)
        ? { ...playState.featureUseMeta }
        : {};
    const getActivatableFeatureById = (snapshot, featureId) => {
      const normalizedId = String(featureId ?? "").trim();
      if (!normalizedId) return null;
      const unlockedFeatures = Array.isArray(snapshot?.character?.progression?.unlockedFeatures)
        ? snapshot.character.progression.unlockedFeatures
        : [];
      const optionalFeatures = Array.isArray(snapshot?.character?.optionalFeatures) ? snapshot.character.optionalFeatures : [];
      const feats = Array.isArray(snapshot?.character?.feats) ? snapshot.character.feats : [];
      return (
        unlockedFeatures.find((entry) => String(entry?.id ?? "").trim() === normalizedId)
        || optionalFeatures.find((entry) => String(entry?.id ?? "").trim() === normalizedId)
        || feats.find((entry) => String(entry?.id ?? "").trim() === normalizedId)
        || null
      );
    };
    const maybeRollFeatureActivation = (featureName, descriptor) => {
      const notation = extractSimpleNotation(descriptor?.rollNotation ?? "");
      if (!notation) return;
      rollVisualNotation(featureName, notation);
    };
    app.querySelectorAll("[data-feature-activate]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const featureId = String(button.dataset.featureActivate ?? "").trim();
        if (!featureId) return;
        const latestState = store.getState();
        const feature = getActivatableFeatureById(latestState, featureId);
        if (!feature) {
          setDiceResult("Could not find the selected feature.", true);
          return;
        }
        const currentFeatureUses =
          latestState?.character?.play?.featureUses
          && typeof latestState.character.play.featureUses === "object"
          && !Array.isArray(latestState.character.play.featureUses)
            ? latestState.character.play.featureUses
            : {};
        const descriptor = getFeatureActivationDescriptor(latestState.catalogs, latestState.character, feature, currentFeatureUses);
        if (!descriptor || !descriptor.trackerKey) {
          setDiceResult(`${feature.name}: no trackable expend cost found.`, true);
          return;
        }
        let spent = false;
        let usedFreeActivation = false;
        let remaining = Math.max(0, toNumber(descriptor.current, 0));
        withUpdatedPlay(latestState, (playState) => {
          const nextFeatureUses =
            playState.featureUses && typeof playState.featureUses === "object" && !Array.isArray(playState.featureUses)
              ? { ...playState.featureUses }
              : {};
          const featureUseMeta = getFeatureUseMetaMap(playState);
          const featureMeta =
            featureUseMeta[featureId] && typeof featureUseMeta[featureId] === "object"
              ? { ...featureUseMeta[featureId] }
              : {};
          const hasUsedSinceLongRest = Boolean(featureMeta.usedSinceLongRest);
          const isFreeUse = Boolean(descriptor.firstUseFreeAfterLongRest) && !hasUsedSinceLongRest;
          const tracker = nextFeatureUses[descriptor.trackerKey];
          if (!tracker || typeof tracker !== "object") return;
          const max = Math.max(0, toNumber(tracker.max, 0));
          const current = Math.max(0, Math.min(max, toNumber(tracker.current, max)));
          const amount = Math.max(1, Math.floor(toNumber(descriptor.amount, 1)));
          if (!isFreeUse) {
            if (current < amount) {
              remaining = current;
              return;
            }
            const nextCurrent = Math.max(0, current - amount);
            remaining = nextCurrent;
            nextFeatureUses[descriptor.trackerKey] = { ...tracker, current: nextCurrent };
          } else {
            usedFreeActivation = true;
            remaining = current;
          }
          featureMeta.usedSinceLongRest = true;
          featureUseMeta[featureId] = featureMeta;
          playState.featureUseMeta = featureUseMeta;
          playState.featureUses = nextFeatureUses;
          spent = true;
        });
        if (!spent) {
          setDiceResult(`${feature.name}: not enough ${descriptor.resourceLabel} (${remaining} left).`, true);
          return;
        }
        if (usedFreeActivation) setDiceResult(`${feature.name}: first use since long rest is free.`);
        else setDiceResult(`${feature.name}: spent ${descriptor.amount} ${descriptor.resourceLabel} (${remaining} left).`);
        maybeRollFeatureActivation(feature.name, descriptor);
      });
    });
    app.querySelectorAll("[data-feature-use-delta]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const raw = String(button.dataset.featureUseDelta ?? "");
        const marker = "|inc:";
        const markerIndex = raw.lastIndexOf(marker);
        if (markerIndex <= 0) return;
        const key = raw.slice(0, markerIndex);
        const deltaRaw = raw.slice(markerIndex + marker.length);
        const delta = toNumber(deltaRaw, 0);
        if (!key || !delta) return;
        const latestState = store.getState();
        const isFeatureUseSpend = delta < 0 && key.startsWith(String(autoResourceIdPrefix ?? "auto:"));
        const featureIdFromKey = isFeatureUseSpend ? key.slice(String(autoResourceIdPrefix ?? "auto:").length) : "";
        const feature = isFeatureUseSpend ? getActivatableFeatureById(latestState, featureIdFromKey) : null;
        let activationDescriptor = null;
        if (feature) {
          const currentFeatureUses =
            latestState?.character?.play?.featureUses
            && typeof latestState.character.play.featureUses === "object"
            && !Array.isArray(latestState.character.play.featureUses)
              ? latestState.character.play.featureUses
              : {};
          activationDescriptor = getFeatureActivationDescriptor(latestState.catalogs, latestState.character, feature, currentFeatureUses);
        }
        let spentFromSharedPool = false;
        let sharedPoolRemaining = 0;
        let blockedForSharedPool = false;
        let usedFreeActivation = false;
        withUpdatedPlay(latestState, (playState) => {
          const nextFeatureUses =
            playState.featureUses && typeof playState.featureUses === "object" && !Array.isArray(playState.featureUses)
              ? { ...playState.featureUses }
              : {};
          const tracker = nextFeatureUses[key];
          if (!tracker || typeof tracker !== "object") return;
          const max = Math.max(0, toNumber(tracker.max, 0));
          const currentValue = Math.max(0, Math.min(max, toNumber(tracker.current, max)));
          const targetValue = Math.max(0, Math.min(max, currentValue + delta));
          if (delta < 0 && targetValue >= currentValue) return;
          if (delta < 0 && activationDescriptor && activationDescriptor.trackerKey && activationDescriptor.trackerKey !== key) {
            const featureUseMeta = getFeatureUseMetaMap(playState);
            const featureMeta =
              featureUseMeta[featureIdFromKey] && typeof featureUseMeta[featureIdFromKey] === "object"
                ? { ...featureUseMeta[featureIdFromKey] }
                : {};
            const hasUsedSinceLongRest = Boolean(featureMeta.usedSinceLongRest);
            const isFreeUse = Boolean(activationDescriptor.firstUseFreeAfterLongRest) && !hasUsedSinceLongRest;
            if (!isFreeUse) {
              const sharedTracker = nextFeatureUses[activationDescriptor.trackerKey];
              if (!sharedTracker || typeof sharedTracker !== "object") {
                blockedForSharedPool = true;
                return;
              }
              const sharedMax = Math.max(0, toNumber(sharedTracker.max, 0));
              const sharedCurrent = Math.max(0, Math.min(sharedMax, toNumber(sharedTracker.current, sharedMax)));
              const spendAmount = Math.max(1, Math.floor(toNumber(activationDescriptor.amount, 1)));
              if (sharedCurrent < spendAmount) {
                blockedForSharedPool = true;
                sharedPoolRemaining = sharedCurrent;
                return;
              }
              const nextSharedCurrent = Math.max(0, sharedCurrent - spendAmount);
              nextFeatureUses[activationDescriptor.trackerKey] = { ...sharedTracker, current: nextSharedCurrent };
              spentFromSharedPool = true;
              sharedPoolRemaining = nextSharedCurrent;
            } else {
              usedFreeActivation = true;
            }
            featureMeta.usedSinceLongRest = true;
            featureUseMeta[featureIdFromKey] = featureMeta;
            playState.featureUseMeta = featureUseMeta;
          }
          nextFeatureUses[key] = { ...tracker, current: targetValue };
          playState.featureUses = nextFeatureUses;
        });
        if (blockedForSharedPool && feature && activationDescriptor) {
          setDiceResult(`${feature.name}: not enough ${activationDescriptor.resourceLabel} (${sharedPoolRemaining} left).`, true);
          return;
        }
        if (delta < 0 && feature && activationDescriptor) {
          if (usedFreeActivation) setDiceResult(`${feature.name}: first use since long rest is free.`);
          else if (spentFromSharedPool) {
            setDiceResult(`${feature.name}: spent ${activationDescriptor.amount} ${activationDescriptor.resourceLabel} (${sharedPoolRemaining} left).`);
          }
          maybeRollFeatureActivation(feature.name, activationDescriptor);
        }
      });
    });
    app.querySelectorAll("[data-class-table-roll]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const notation = extractSimpleNotation(button.dataset.classTableRoll);
        if (!notation) {
          setDiceResult("Class table effect: invalid dice notation.", true);
          return;
        }
        const label = String(button.dataset.classTableRollLabel ?? "Class table effect").trim();
        rollVisualNotation(label, notation);
      });
    });

    const hpCurrentEl = app.querySelector("#play-hp-current");
    const hpTempEl = app.querySelector("#play-hp-temp");
    const dsSuccessEl = app.querySelector("#play-ds-success");
    const dsFailEl = app.querySelector("#play-ds-fail");

    const bindNumberInput = (el, updater) => {
      if (!el) return;
      el.addEventListener("input", () => {
        withUpdatedPlay(state, (play) => updater(play, toNumber(el.value, 0)));
      });
    };

    const clampCurrentHp = (value) => Math.max(0, Math.min(state.derived.hp, value));

    bindNumberInput(hpCurrentEl, (play, value) => {
      play.hpCurrent = clampCurrentHp(value);
    });
    bindNumberInput(hpTempEl, (play, value) => {
      play.hpTemp = Math.max(0, value);
    });
    bindNumberInput(dsSuccessEl, (play, value) => {
      play.deathSavesSuccess = Math.max(0, Math.min(3, value));
    });
    bindNumberInput(dsFailEl, (play, value) => {
      play.deathSavesFail = Math.max(0, Math.min(3, value));
    });

    app.querySelectorAll("[data-hp-delta]").forEach((button) => {
      button.addEventListener("click", () => {
        const delta = toNumber(button.dataset.hpDelta, 0);
        const target = button.dataset.hpDeltaTarget || "current";
        withUpdatedPlay(state, (play) => {
          if (target === "temp") {
            play.hpTemp = Math.max(0, toNumber(play.hpTemp, 0) + delta);
            return;
          }

          const current = play.hpCurrent == null ? state.derived.hp : toNumber(play.hpCurrent, state.derived.hp);
          play.hpCurrent = clampCurrentHp(current + delta);
        });
      });
    });

    app.querySelectorAll("[data-step-target]").forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.dataset.stepTarget;
        const delta = toNumber(button.dataset.stepDelta, 0);
        if (!delta) return;

        withUpdatedPlay(state, (play) => {
          if (target === "hp-current") {
            const current = play.hpCurrent == null ? state.derived.hp : toNumber(play.hpCurrent, state.derived.hp);
            play.hpCurrent = clampCurrentHp(current + delta);
            return;
          }

          if (target === "hp-temp") {
            play.hpTemp = Math.max(0, toNumber(play.hpTemp, 0) + delta);
            return;
          }

          if (target === "ds-success") {
            play.deathSavesSuccess = Math.max(0, Math.min(3, toNumber(play.deathSavesSuccess, 0) + delta));
            return;
          }

          if (target === "ds-fail") {
            play.deathSavesFail = Math.max(0, Math.min(3, toNumber(play.deathSavesFail, 0) + delta));
          }
        });
      });
    });

    app.querySelectorAll("[data-save-roll-btn]").forEach((button) => {
      bindClickAndLongPress(
        button,
        () => {
          const ability = button.dataset.saveRollBtn;
          const mod = toNumber(state.derived.mods?.[ability], 0);
          const isProf = Boolean(state.character.play?.saveProficiencies?.[ability]);
          const itemSaveBonus = toNumber(state.derived?.itemSavingThrowBonus, 0);
          const bonus = mod + (isProf ? state.derived.proficiencyBonus : 0) + itemSaveBonus;
          rollVisualD20(`${ability.toUpperCase()} save`, bonus);
        },
        (rollMode) => {
          const ability = button.dataset.saveRollBtn;
          const mod = toNumber(state.derived.mods?.[ability], 0);
          const isProf = Boolean(state.character.play?.saveProficiencies?.[ability]);
          const itemSaveBonus = toNumber(state.derived?.itemSavingThrowBonus, 0);
          const bonus = mod + (isProf ? state.derived.proficiencyBonus : 0) + itemSaveBonus;
          rollVisualD20(`${ability.toUpperCase()} save`, bonus, rollMode);
        }
      );
    });

    const rollSkillCheck = (key, rollMode = "normal") => {
      const skill = SKILLS.find((entry) => entry.key === key);
      if (!skill) return;
      const mod = toNumber(state.derived.mods?.[skill.ability], 0);
      const skillMode = normalizeSkillProficiencyMode(
        state.character.play?.skillProficiencyModes?.[key] ?? (state.character.play?.skillProficiencies?.[key] ? "proficient" : "none")
      );
      const checkBonus = Math.max(0, toNumber(state.character.play?.autoSkillCheckBonuses?.[key], 0));
      const bonus = mod + getSkillProficiencyBonus(state.derived.proficiencyBonus, skillMode) + checkBonus;
      rollVisualD20(skill.label, bonus, rollMode);
    };

    app.querySelectorAll("[data-skill-roll-btn]").forEach((button) => {
      bindClickAndLongPress(
        button,
        () => {
          const key = button.dataset.skillRollBtn;
          rollSkillCheck(key, "normal");
        },
        (rollMode) => {
          const key = button.dataset.skillRollBtn;
          rollSkillCheck(key, rollMode);
        }
      );
    });
    app.querySelectorAll("[data-skill-roll-row]").forEach((button) => {
      bindClickAndLongPress(
        button,
        () => {
          const key = button.dataset.skillRollRow;
          rollSkillCheck(key, "normal");
        },
        (rollMode) => {
          const key = button.dataset.skillRollRow;
          rollSkillCheck(key, rollMode);
        }
      );
    });

    const handleDeathSaveRoll = async (rollMode = "normal") => {
      const result = await rollVisualD20("Death save", 0, rollMode);
      if (!result || result.dieValue == null) return;

      withUpdatedPlay(state, (play) => {
        let success = Math.max(0, Math.min(3, toNumber(play.deathSavesSuccess, 0)));
        let fail = Math.max(0, Math.min(3, toNumber(play.deathSavesFail, 0)));
        const currentHp = play.hpCurrent == null ? state.derived.hp : toNumber(play.hpCurrent, state.derived.hp);
        const maxHp = Math.max(0, state.derived.hp);

        if (result.dieValue === 20) {
          play.hpCurrent = Math.min(maxHp, Math.max(1, currentHp));
          success = 0;
          fail = 0;
        } else if (result.dieValue === 1) {
          fail = Math.min(3, fail + 2);
        } else if (result.dieValue >= 10) {
          success = Math.min(3, success + 1);
        } else {
          fail = Math.min(3, fail + 1);
        }

        play.deathSavesSuccess = success;
        play.deathSavesFail = fail;
      });
    };

    app.querySelectorAll("[data-ability-roll]").forEach((button) => {
      bindClickAndLongPress(
        button,
        () => {
          const ability = button.dataset.abilityRoll;
          const mod = toNumber(state.derived.mods?.[ability], 0);
          rollVisualD20(`${ability.toUpperCase()} check`, mod);
        },
        (rollMode) => {
          const ability = button.dataset.abilityRoll;
          const mod = toNumber(state.derived.mods?.[ability], 0);
          rollVisualD20(`${ability.toUpperCase()} check`, mod, rollMode);
        }
      );
    });

    const initiativeButton = app.querySelector("[data-roll-initiative]");
    if (initiativeButton) {
      bindClickAndLongPress(
        initiativeButton,
        () => {
          const bonus = toNumber(state.derived?.mods?.dex, 0);
          rollVisualD20("Initiative", bonus);
        },
        (rollMode) => {
          const bonus = toNumber(state.derived?.mods?.dex, 0);
          rollVisualD20("Initiative", bonus, rollMode);
        }
      );
    }

    const proficiencyButton = app.querySelector("[data-roll-proficiency]");
    if (proficiencyButton) {
      bindClickAndLongPress(
        proficiencyButton,
        () => {
          const bonus = toNumber(state.derived?.proficiencyBonus, 0);
          rollVisualD20("Proficiency", bonus);
        },
        (rollMode) => {
          const bonus = toNumber(state.derived?.proficiencyBonus, 0);
          rollVisualD20("Proficiency", bonus, rollMode);
        }
      );
    }

    const deathSaveButton = app.querySelector("[data-roll-death-save]");
    if (deathSaveButton) {
      bindClickAndLongPress(
        deathSaveButton,
        () => {
          handleDeathSaveRoll();
        },
        (rollMode) => {
          handleDeathSaveRoll(rollMode);
        }
      );
    }

    app.querySelector("[data-toggle-inspiration]")?.addEventListener("click", () => {
      withUpdatedPlay(state, (play) => {
        play.inspiration = !Boolean(play.inspiration);
      });
    });

    app.querySelectorAll("[data-spell-list-visibility]").forEach((button) => {
      button.addEventListener("click", () => {
        const mode = String(button.dataset.spellListVisibility ?? "").trim().toLowerCase();
        const levelKey = String(button.dataset.spellListLevel ?? "").trim();
        if (!doesClassUsePreparedSpells(state.catalogs, state.character)) return;
        withUpdatedPlay(state, (play) => {
          const nextByLevel =
            play.showAllPreparedCasterSpellsByLevel
            && typeof play.showAllPreparedCasterSpellsByLevel === "object"
            && !Array.isArray(play.showAllPreparedCasterSpellsByLevel)
              ? { ...play.showAllPreparedCasterSpellsByLevel }
              : {};
          if (levelKey) nextByLevel[levelKey] = mode === "all";
          play.showAllPreparedCasterSpellsByLevel = nextByLevel;
          play.showAllPreparedCasterSpells = false;
        });
      });
    });

    app.querySelectorAll("[data-spell-prepared-btn]").forEach((button) => {
      button.addEventListener("click", () => {
        const spellName = button.dataset.spellPreparedBtn;
        if (!spellName) return;
        withUpdatedPlay(state, (play) => {
          const current = play.preparedSpells?.[spellName];
          const isPrepared = Boolean(current);
          const spell = getSpellByName(state, spellName);
          const isCantrip = toNumber(spell?.level, 0) === 0;
          if (isSpellAlwaysPrepared(state, spellName, play)) return;
          if (isCantrip) {
            play.preparedSpells = { ...(play.preparedSpells ?? {}), [spellName]: true };
            return;
          }
          if (!isPrepared) {
            const preparedCount = countPreparedSpells(state, play);
            const preparedLimit = getPreparedSpellLimit(state);
            if (preparedCount >= preparedLimit) return;
          }
          play.preparedSpells = { ...(play.preparedSpells ?? {}), [spellName]: !isPrepared };
        });
      });
    });

    app.querySelectorAll("[data-spell-open]").forEach((button) => {
      button.addEventListener("click", () => {
        const spellName = button.dataset.spellOpen;
        if (!spellName) return;
        openSpellDetailsModal(state, spellName);
      });
    });

    app.querySelectorAll("[data-spell-attack-roll]").forEach((button) => {
      const getContext = () => {
        const spellName = button.dataset.spellAttackRoll;
        if (!spellName) return null;
        const spell = getSpellByName(state, spellName);
        if (!spell) {
          setDiceResult(`Spell attack unavailable: ${spellName}`, true);
          return null;
        }
        const combat = getSpellCombatContext(state, spell);
        if (!combat.hasSpellAttack || combat.attackBonus == null) {
          setDiceResult(`${spell.name}: no spell attack roll found.`, true);
          return null;
        }
        return { spell, combat };
      };

      bindClickAndLongPress(
        button,
        () => {
          const context = getContext();
          if (!context) return;
          rollVisualD20(`${context.spell.name} to hit`, context.combat.attackBonus);
        },
        (rollMode) => {
          const context = getContext();
          if (!context) return;
          rollVisualD20(`${context.spell.name} to hit`, context.combat.attackBonus, rollMode);
        }
      );
    });

    app.querySelectorAll("[data-spell-damage-roll]").forEach((button) => {
      button.addEventListener("click", async () => {
        const spellName = button.dataset.spellDamageRoll;
        if (!spellName) return;
        const spell = getSpellByName(state, spellName);
        if (!spell) {
          setDiceResult(`Spell damage unavailable: ${spellName}`, true);
          return;
        }
        const notation = getSpellPrimaryDiceNotation(spell);
        const simpleNotation = extractSimpleNotation(notation);
        if (!simpleNotation) {
          setDiceResult(`${spell.name}: no primary damage roll found.`, true);
          return;
        }
        await rollVisualNotation(`${spell.name} damage`, simpleNotation);
      });
    });

    app.querySelectorAll("[data-spell-cast]").forEach((button) => {
      button.addEventListener("click", async () => {
        const spellName = button.dataset.spellCast;
        if (!spellName) return;
        const spell = getSpellByName(state, spellName);
        if (!spell) {
          setDiceResult(`Cast ${spellName}: spell data unavailable.`, true);
          return;
        }

        const spellLevel = Math.max(0, toNumber(spell.level, 0));
        const slotLevel = String(spellLevel);
        let slotSpent = false;
        let slotError = "";
        const usesPreparedSpells = doesClassUsePreparedSpells(state.catalogs, state.character);
        const isPreparedForCast = spellLevel === 0
          || !usesPreparedSpells
          || isSpellAlwaysPrepared(state, spell.name)
          || Boolean(state.character?.play?.preparedSpells?.[spell.name]);

        if (!isPreparedForCast) {
          setSpellCastStatus(`Cast ${spell.name}: spell is not prepared.`, true, { durationMs: 10000 });
          return;
        }

        if (spellLevel > 0) {
          withUpdatedPlay(state, (play) => {
            const values = getSpellSlotValues(play, getCharacterSpellSlotDefaults(state.catalogs, state.character), spellLevel);
            const previous = play.spellSlots?.[slotLevel] ?? { max: values.max, used: values.used };
            if (values.max <= 0) {
              slotError = `Cast ${spell.name}: no level ${spellLevel} slots configured.`;
              return;
            }
            if (values.used >= values.max) {
              slotError = `Cast ${spell.name}: no level ${spellLevel} slots remaining.`;
              return;
            }
            slotSpent = true;
            play.spellSlots = {
              ...(play.spellSlots ?? {}),
              [slotLevel]: { ...previous, used: values.used + 1 },
            };
          });
        }

        if (slotError) {
          setSpellCastStatus(slotError, true, { durationMs: 10000 });
          return;
        }

        setSpellCastStatus("", false);

        const notation = getSpellPrimaryDiceNotation(spell);
        const simpleNotation = extractSimpleNotation(notation);
        const spellCombat = getSpellCombatContext(state, spell);
        if (spellCombat.hasSpellAttack && simpleNotation) {
          setDiceResult(`Cast ${spell.name}: ${slotSpent ? "slot spent." : "cast."} Roll To Hit and Damage separately.`, false);
          return;
        }
        if (simpleNotation) {
          const rollLabel = spellCombat.hasSpellAttack ? `${spell.name} damage` : `Cast ${spell.name}`;
          await rollVisualNotation(rollLabel, simpleNotation);
          return;
        }

        const spentText = slotSpent ? "slot spent." : "cast.";

        if (spellCombat.saveDc != null && spellCombat.saveText) {
          setDiceResult(`Cast ${spell.name}: ${spentText} ${spellCombat.saveText.toUpperCase()} DC ${spellCombat.saveDc}.`, false);
          return;
        }

        if (spellCombat.hasSpellAttack && spellCombat.attackBonus != null) {
          const attackBonusText = spellCombat.attackBonus >= 0 ? `+${spellCombat.attackBonus}` : String(spellCombat.attackBonus);
          setDiceResult(`Cast ${spell.name}: ${spentText} Use To Hit ${attackBonusText} for the spell attack roll.`, false);
          return;
        }

        if (spellLevel === 0) {
          setDiceResult(`Cast ${spell.name}: cast.`, false);
          return;
        }

        setDiceResult(`Cast ${spell.name}: ${spentText}`, false);
      });
    });

    app.querySelectorAll("[data-slot-delta]").forEach((button) => {
      button.addEventListener("click", () => {
        const level = button.dataset.slotDelta;
        const delta = toNumber(button.dataset.delta, 0);
        const defaults = getCharacterSpellSlotDefaults(state.catalogs, state.character);
        withUpdatedPlay(state, (play) => {
          const values = getSpellSlotValues(play, defaults, level);
          const previous = play.spellSlots?.[level] ?? { max: values.max, used: values.used };
          const used = Math.max(0, Math.min(values.max, values.used + delta));
          play.spellSlots = {
            ...(play.spellSlots ?? {}),
            [level]: { ...previous, used },
          };
        });
      });
    });

    app.querySelector("#add-attack")?.addEventListener("click", () => {
      withUpdatedPlay(state, (play) => {
        play.attacks = [...(play.attacks ?? []), { name: "", toHit: "", damage: "" }];
      });
    });

    app.querySelectorAll("[data-attack-field]").forEach((input) => {
      input.addEventListener("input", () => {
        const [idxStr, field] = input.dataset.attackField.split(":");
        const idx = toNumber(idxStr, 0);
        withUpdatedPlay(state, (play) => {
          const next = [...(play.attacks ?? [])];
          next[idx] = { ...(next[idx] ?? {}), [field]: input.value };
          play.attacks = next;
        });
      });
    });

    app.querySelectorAll("[data-attack-mode-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        withUpdatedPlay(state, (play) => {
          const current = play.attackMode === "edit" ? "edit" : "view";
          play.attackMode = current === "edit" ? "view" : "edit";
        });
      });
    });

    app.querySelectorAll("[data-attack-roll]").forEach((button) => {
      const [idxStr, field] = String(button.dataset.attackRoll || "").split(":");
      const idx = toNumber(idxStr, -1);
      const getAttackContext = () => {
        const attack = state.character.play?.attacks?.[idx] ?? null;
        if (!attack) return null;
        const attackName = attack.name?.trim() || `Attack ${idx + 1}`;
        const value = String(attack[field] || "").trim();
        if (!value) {
          setDiceResult(`${attackName}: no roll value entered.`, true);
          return null;
        }
        return { attackName, value };
      };
      if (field === "toHit") {
        bindClickAndLongPress(
          button,
          () => {
            const context = getAttackContext();
            if (!context) return;
            rollToHitValue(context.attackName, context.value);
          },
          (rollMode) => {
            const context = getAttackContext();
            if (!context) return;
            rollToHitValue(context.attackName, context.value, rollMode);
          }
        );
        return;
      }
      bindClickAndLongPress(
        button,
        () => {
          const context = getAttackContext();
          if (!context) return;
          rollDamageValue(context.attackName, context.value);
        },
        null,
        {
          longPressHandlers: {
            advantage: () => {
              const context = getAttackContext();
              if (!context) return;
              rollDamageValue(context.attackName, context.value);
            },
          },
          advantageLabel: "Normal",
          onCrit: () => {
            const context = getAttackContext();
            if (!context) return;
            rollDamageValue(context.attackName, context.value, { crit: true });
          },
          chooserHint: "Choose damage roll",
        }
      );
    });

    app.querySelectorAll("[data-auto-attack-roll]").forEach((button) => {
      const [, field] = String(button.dataset.autoAttackRoll || "").split(":");
      const getAttackContext = () => {
        const attackName = String(button.dataset.autoAttackName || "Equipped Weapon").trim();
        const toHit = String(button.dataset.autoAttackToHit || "").trim();
        const damage = String(button.dataset.autoAttackDamage || "").trim();
        const value = field === "toHit" ? toHit : damage;
        if (!value) {
          setDiceResult(`${attackName}: no roll value entered.`, true);
          return null;
        }
        return { attackName, value };
      };
      if (field === "toHit") {
        bindClickAndLongPress(
          button,
          () => {
            const context = getAttackContext();
            if (!context) return;
            rollToHitValue(context.attackName, context.value);
          },
          (rollMode) => {
            const context = getAttackContext();
            if (!context) return;
            rollToHitValue(context.attackName, context.value, rollMode);
          }
        );
        return;
      }
      bindClickAndLongPress(
        button,
        () => {
          const context = getAttackContext();
          if (!context) return;
          rollDamageValue(context.attackName, context.value);
        },
        null,
        {
          longPressHandlers: {
            advantage: () => {
              const context = getAttackContext();
              if (!context) return;
              rollDamageValue(context.attackName, context.value);
            },
          },
          advantageLabel: "Normal",
          onCrit: () => {
            const context = getAttackContext();
            if (!context) return;
            rollDamageValue(context.attackName, context.value, { crit: true });
          },
          chooserHint: "Choose damage roll",
        }
      );
    });

    app.querySelectorAll("[data-remove-attack]").forEach((button) => {
      button.addEventListener("click", () => {
        const idx = toNumber(button.dataset.removeAttack, -1);
        withUpdatedPlay(state, (play) => {
          const next = [...(play.attacks ?? [])];
          if (idx >= 0) next.splice(idx, 1);
          play.attacks = next;
        });
      });
    });

    app.querySelector("#play-open-items")?.addEventListener("click", () => openItemModal(state));
    app.querySelectorAll("[data-open-item-details-index]").forEach((button) => {
      button.addEventListener("click", () => {
        openInventoryItemDetails(button.dataset.openItemDetailsIndex);
      });
    });
    app.querySelectorAll("[data-toggle-item-equipped]").forEach((button) => {
      button.addEventListener("click", () => {
        toggleInventoryItemEquipped(button.dataset.toggleItemEquipped);
      });
    });
    app.querySelectorAll("[data-toggle-item-attuned]").forEach((button) => {
      button.addEventListener("click", () => {
        toggleInventoryItemAttuned(button.dataset.toggleItemAttuned, button.dataset.toggleItemAttunedIndex);
      });
    });
    app.querySelectorAll("[data-remove-item-index]").forEach((button) => {
      button.addEventListener("click", () => {
        removeInventoryItemByIndex(button.dataset.removeItemIndex);
      });
    });
    app.querySelectorAll("[data-item-counter-adjust-id]").forEach((button) => {
      button.addEventListener("click", () => {
        adjustInventoryItemCounter(button.dataset.itemCounterAdjustId, button.dataset.itemCounterDelta);
      });
    });

    const normalizeConditionName = (value) => String(value ?? "").trim().toLowerCase();
    app.querySelectorAll("[data-toggle-condition-name]").forEach((button) => {
      button.addEventListener("click", () => {
        const conditionName = String(button.dataset.toggleConditionName ?? "").trim();
        if (!conditionName) return;
        withUpdatedPlay(state, (play) => {
          const current = Array.isArray(play.conditions)
            ? play.conditions.map((entry) => String(entry ?? "").trim()).filter(Boolean)
            : [];
          const target = normalizeConditionName(conditionName);
          const hasCondition = current.some((entry) => normalizeConditionName(entry) === target);
          if (hasCondition) {
            play.conditions = current.filter((entry) => normalizeConditionName(entry) !== target);
            return;
          }
          play.conditions = [...current, conditionName];
        });
      });
    });

    app.querySelectorAll("[data-remove-condition-name]").forEach((button) => {
      button.addEventListener("click", () => {
        const conditionName = String(button.dataset.removeConditionName ?? "").trim();
        if (!conditionName) return;
        withUpdatedPlay(state, (play) => {
          const current = Array.isArray(play.conditions)
            ? play.conditions.map((entry) => String(entry ?? "").trim()).filter(Boolean)
            : [];
          const target = normalizeConditionName(conditionName);
          play.conditions = current.filter((entry) => normalizeConditionName(entry) !== target);
        });
      });
    });
    app.querySelector("[data-clear-conditions]")?.addEventListener("click", () => {
      withUpdatedPlay(state, (play) => {
        play.conditions = [];
      });
    });

    app.querySelector("#play-notes")?.addEventListener("input", (evt) => {
      const value = evt.target.value;
      withUpdatedPlay(state, (play) => {
        play.notes = value;
      });
    });
    app.querySelector("#play-character-notes")?.addEventListener("input", (evt) => {
      const value = evt.target.value;
      store.updateCharacter({ notes: value });
    });

    app.querySelector("#short-rest")?.addEventListener("click", () => {
      const currentState = store.getState();
      const pools = getHitDicePools(currentState);
      const spentMap = normalizeHitDiceSpent(currentState.character?.play?.hitDiceSpent);
      const conMod = toNumber(currentState.derived?.mods?.con, 0);
      const conLabel = conMod >= 0 ? `+${conMod}` : `${conMod}`;
      const maxHp = Math.max(1, toNumber(currentState.derived?.hp, 1));
      const currentHp = resolveCurrentHp(currentState.character?.play, maxHp);
      const rowsHtml = pools
        .map((pool) => {
          const spent = Math.max(0, toNumber(spentMap[pool.key], 0));
          const available = Math.max(0, pool.max - spent);
          return `
            <div class="short-rest-hitdie-row">
              <span class="short-rest-hitdie-meta">
                <strong>${esc(pool.className)}</strong>
                <span class="muted">d${esc(pool.faces)} | ${esc(available)}/${esc(pool.max)} available | ${esc(conLabel)} CON per die</span>
              </span>
              <div class="short-rest-hitdie-controls">
                <button type="button" class="btn secondary short-rest-adjust-btn" data-short-rest-adjust="${esc(pool.key)}" data-short-rest-delta="-1" ${available > 0 ? "" : "disabled"}>-</button>
                <input
                  type="number"
                  min="0"
                  max="${esc(available)}"
                  value="0"
                  readonly
                  aria-label="Hit dice to spend for ${esc(pool.className)}"
                  data-short-rest-spend="${esc(pool.key)}"
                  ${available > 0 ? "" : "disabled"}
                >
                <button type="button" class="btn secondary short-rest-adjust-btn" data-short-rest-adjust="${esc(pool.key)}" data-short-rest-delta="1" ${available > 0 ? "" : "disabled"}>+</button>
              </div>
            </div>
          `;
        })
        .join("");
      openModal({
        title: "Short Rest",
        bodyHtml: `
          <div class="short-rest-shell">
            <p class="muted short-rest-copy">Choose how many hit dice to spend, then apply short-rest refreshes.</p>
            <div class="short-rest-stat-row"><span>HP</span><strong>${esc(currentHp)} / ${esc(maxHp)}</strong></div>
            <p class="muted short-rest-help">Use + and - to choose how many hit dice to spend for each class.</p>
            <div class="short-rest-hitdice-list">
              ${rowsHtml || "<p class='muted'>No hit dice available.</p>"}
            </div>
          </div>
        `,
        actions: [
          { label: "Cancel", secondary: true, onClick: (close) => close() },
          {
            label: "Apply Short Rest",
            onClick: async (close) => {
              const modal = document.querySelector(".modal");
              const spends = {};
              let totalSpentDice = 0;
              pools.forEach((pool) => {
                const input = modal?.querySelector(`[data-short-rest-spend="${pool.key}"]`);
                const requested = Math.max(0, Math.floor(toNumber(input?.value, 0)));
                const spent = Math.max(0, toNumber(spentMap[pool.key], 0));
                const available = Math.max(0, pool.max - spent);
                const spendCount = Math.min(available, requested);
                if (spendCount < 1) return;
                spends[pool.key] = spendCount;
                totalSpentDice += spendCount;
              });

              let totalHealing = 0;
              if (totalSpentDice > 0) {
                const notation = buildShortRestHealingNotation(spends, pools, conMod);
                if (notation) {
                  const rollResult = await rollVisualNotation("Short Rest Hit Dice", notation);
                  const rolledTotal = Number(rollResult?.total);
                  if (Number.isFinite(rolledTotal)) totalHealing = Math.max(0, Math.floor(rolledTotal));
                }
              }

              const latestState = store.getState();
              const latestMaxHp = Math.max(1, toNumber(latestState.derived?.hp, 1));
              const latestCurrentHp = resolveCurrentHp(latestState.character?.play, latestMaxHp);
              const healedHp = Math.min(latestMaxHp, latestCurrentHp + totalHealing);
              withUpdatedPlay(latestState, (play) => {
                refreshShortRestResources(play);
                const nextSpentMap = normalizeHitDiceSpent(play.hitDiceSpent);
                Object.entries(spends).forEach(([poolKey, spendCount]) => {
                  const previous = Math.max(0, toNumber(nextSpentMap[poolKey], 0));
                  const total = previous + spendCount;
                  if (total > 0) nextSpentMap[poolKey] = total;
                });
                play.hitDiceSpent = nextSpentMap;
                if (totalHealing > 0) play.hpCurrent = healedHp;
              });
              if (totalSpentDice < 1) {
                setDiceResult("Short Rest applied. No hit dice were spent.");
              }
              close();
            },
          },
        ],
      });
      const modal = document.querySelector(".modal");
      if (modal) modal.classList.add("rest-modal");
      modal?.querySelectorAll("[data-short-rest-adjust]").forEach((button) => {
        button.addEventListener("click", () => {
          const poolKey = String(button.dataset.shortRestAdjust ?? "").trim();
          if (!poolKey) return;
          const delta = Math.floor(toNumber(button.dataset.shortRestDelta, 0));
          if (!delta) return;
          const input = modal.querySelector(`[data-short-rest-spend="${poolKey}"]`);
          if (!(input instanceof HTMLInputElement) || input.disabled) return;
          const min = Math.max(0, Math.floor(toNumber(input.min, 0)));
          const max = Math.max(min, Math.floor(toNumber(input.max, min)));
          const current = Math.floor(toNumber(input.value, 0));
          const next = Math.min(max, Math.max(min, current + delta));
          input.value = String(next);
        });
      });
    });

    app.querySelector("#long-rest")?.addEventListener("click", () => {
      openModal({
        title: "Confirm Long Rest",
        bodyHtml: "<p>Apply a long rest? This restores HP, resets spell slots and features, and recovers spent hit dice.</p>",
        actions: [
          { label: "Cancel", secondary: true, onClick: (close) => close() },
          {
            label: "Apply Long Rest",
            onClick: (close) => {
              const latestState = store.getState();
              const pools = getHitDicePools(latestState);
              withUpdatedPlay(latestState, (play) => {
                play.hpCurrent = latestState.derived.hp;
                play.hpTemp = 0;
                play.deathSavesSuccess = 0;
                play.deathSavesFail = 0;
                play.spellSlots = Object.fromEntries(
                  Object.entries(play.spellSlots ?? {}).map(([level, slot]) => [level, { ...slot, used: 0 }])
                );
                const featureUses =
                  play.featureUses && typeof play.featureUses === "object" && !Array.isArray(play.featureUses)
                    ? { ...play.featureUses }
                    : {};
                Object.entries(featureUses).forEach(([key, tracker]) => {
                  if (!tracker || typeof tracker !== "object") return;
                  const max = Math.max(0, toNumber(tracker.max, 0));
                  featureUses[key] = { ...tracker, current: max };
                });
                play.featureUses = featureUses;
                play.featureUseMeta = {};

                const nextSpentMap = normalizeHitDiceSpent(play.hitDiceSpent);
                const totalHitDice = pools.reduce((sum, pool) => sum + Math.max(0, toNumber(pool.max, 0)), 0);
                let recoverRemaining = Math.max(1, Math.floor(totalHitDice / 2));
                const recoverOrder = pools
                  .map((pool) => ({ key: pool.key, spent: Math.max(0, toNumber(nextSpentMap[pool.key], 0)) }))
                  .sort((a, b) => b.spent - a.spent);
                recoverOrder.forEach((entry) => {
                  if (recoverRemaining < 1) return;
                  if (entry.spent < 1) return;
                  const recovered = Math.min(entry.spent, recoverRemaining);
                  const remaining = entry.spent - recovered;
                  recoverRemaining -= recovered;
                  if (remaining > 0) nextSpentMap[entry.key] = remaining;
                  else delete nextSpentMap[entry.key];
                });
                play.hitDiceSpent = nextSpentMap;
              });
              setDiceResult("Long Rest applied.");
              close();
            },
          },
        ],
      });
      const modal = document.querySelector(".modal");
      if (modal) modal.classList.add("rest-modal");
    });
  }

  return { bindBuildEvents, bindPlayEvents };
}

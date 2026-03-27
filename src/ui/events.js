export function createEvents(deps) {
  const {
    app,
    store,
    toNumber,
    isUuid,
    SKILLS,
    DEFAULT_SOURCE_PRESET,
    getAllowedSources,
    loadCatalogs,
    updateCharacterWithRequiredSettings,
    getClassCatalogEntry,
    normalizeSourceTag,
    withUpdatedPlay,
    openSpellModal,
    openItemModal,
    openFeatModal,
    openMulticlassModal,
    openLevelUpModal,
    openSpellDetailsModal,
    getCharacterSpellSlotDefaults,
    createOrSavePermanentCharacter,
    openClassDetailsModal,
    openFeatureDetailsModal,
    openFeatDetailsModal,
    applyDiceStyle,
    rerollLastRoll,
    openCustomRollModal,
    countPreparedSpells,
    getPreparedSpellLimit,
    getSpellByName,
    setDiceResult,
    setSpellCastStatus,
    getSpellSlotValues,
    rollVisualNotation,
    getSpellPrimaryDiceNotation,
    rollVisualD20,
    extractSimpleNotation,
    uiState,
    diceStylePresets,
  } = deps;

  function normalizeItemTypeCode(value) {
    return String(value ?? "")
      .split("|")[0]
      .trim()
      .toUpperCase();
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
      if (entryId === id) return { ...entry, equipped: shouldEquip };
      if (!shouldEquip) return entry;
      if (isBodyArmorEntry(toggledEntry) && isBodyArmorEntry(entry)) return { ...entry, equipped: false };
      if (isShieldEntry(toggledEntry) && isShieldEntry(entry)) return { ...entry, equipped: false };
      return entry;
    });
    store.updateCharacter({ inventory: nextInventory });
  }

  function removeInventoryItemByIndex(indexRaw) {
    const index = toNumber(indexRaw, -1);
    const currentState = store.getState();
    const currentInventory = Array.isArray(currentState.character?.inventory) ? currentState.character.inventory : [];
    if (index < 0 || index >= currentInventory.length) return;
    const nextInventory = [...currentInventory];
    nextInventory.splice(index, 1);
    store.updateCharacter({ inventory: nextInventory });
  }

  function bindBuildEvents(state) {
    app.querySelectorAll("[data-step]").forEach((btn) => {
      btn.addEventListener("click", () => store.setStep(Number(btn.dataset.step)));
    });
    app.querySelector("#prev-step")?.addEventListener("click", () => store.setStep(state.stepIndex - 1));
    app.querySelector("#next-step")?.addEventListener("click", () => store.setStep(state.stepIndex + 1));

    const sourcePreset = app.querySelector("#source-preset");
    if (sourcePreset) {
      sourcePreset.addEventListener("change", async (evt) => {
        const preset = evt.target.value || DEFAULT_SOURCE_PRESET;
        store.updateCharacter({ sourcePreset: preset });
        const catalogs = await loadCatalogs(getAllowedSources(preset));
        store.setCatalogs(catalogs);
        updateCharacterWithRequiredSettings(store.getState(), {}, { preserveUserOverrides: true });
      });
    }

    [["#name", "name"], ["#notes", "notes"]].forEach(([sel, field]) => {
      const el = app.querySelector(sel);
      if (!el) return;
      const handler = () => store.updateCharacter({ [field]: el.value });
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    });
    [["#race", "race"], ["#background", "background"]].forEach(([sel, field]) => {
      const el = app.querySelector(sel);
      if (!el) return;
      const handler = () => {
        updateCharacterWithRequiredSettings(
          state,
          { [field]: el.value },
          { preserveUserOverrides: true }
        );
      };
      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    });

    const subclassSelectEl = app.querySelector("#subclass-select");
    if (subclassSelectEl) {
      subclassSelectEl.addEventListener("change", () => {
        const [nameRaw = "", sourceRaw = ""] = String(subclassSelectEl.value || "").split("|");
        const classEntry = getClassCatalogEntry(state.catalogs, state.character.class);
        const name = nameRaw.trim();
        const source = normalizeSourceTag(sourceRaw);
        updateCharacterWithRequiredSettings(
          state,
          {
            subclass: name,
            classSelection: {
              subclass: {
                name,
                source,
                className: state.character.class,
                classSource: normalizeSourceTag(classEntry?.source),
              },
            },
          },
          { preserveUserOverrides: true }
        );
      });
    }

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

    const classEl = app.querySelector("#class");
    if (classEl) {
      classEl.addEventListener("change", () => {
        updateCharacterWithRequiredSettings(
          state,
          {
            class: classEl.value || "",
            subclass: "",
            classSelection: {
              subclass: { name: "", source: "", className: "", classSource: "" },
            },
          },
          { preserveUserOverrides: true }
        );
      });
    }

    app.querySelectorAll("[data-ability]").forEach((input) => {
      input.addEventListener("input", () => store.updateAbility(input.dataset.ability, input.value));
    });
    app.querySelectorAll("[data-auto-choice-input]").forEach((input) => {
      input.addEventListener("change", () => {
        const sourceKey = String(input.dataset.autoChoiceSource ?? "").trim();
        const choiceId = String(input.dataset.autoChoiceId ?? "").trim();
        const value = String(input.dataset.autoChoiceValue ?? "").trim().toLowerCase();
        if (!sourceKey || !choiceId || !value) return;
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
          ? sourceSelections[choiceId].map((entry) => String(entry ?? "").trim().toLowerCase()).filter(Boolean)
          : [];
        const uniqueValues = currentValues.filter((entry, index) => currentValues.indexOf(entry) === index);
        const isChecked = input.checked;
        let nextValues = isChecked
          ? [...uniqueValues.filter((entry) => entry !== value), value]
          : uniqueValues.filter((entry) => entry !== value);
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
        const nextValues = Array.from(app.querySelectorAll("[data-asi-choice-select]"))
          .filter((selectEl) => {
            const selectSource = String(selectEl.dataset.autoChoiceSource ?? "").trim();
            const selectChoiceId = String(selectEl.dataset.autoChoiceId ?? "").trim();
            return selectSource === sourceKey && selectChoiceId === choiceId;
          })
          .map((selectEl) => String(selectEl.value ?? "").trim().toLowerCase())
          .filter(Boolean)
          .slice(0, maxCount);
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
          const next = !current;
          const autoValue = Boolean(play.autoSaveProficiencies?.[ability]);
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
          const current = Boolean(play.skillProficiencies?.[key]);
          const next = !current;
          const autoValue = Boolean(play.autoSkillProficiencies?.[key]);
          const overrides =
            play.skillProficiencyOverrides
            && typeof play.skillProficiencyOverrides === "object"
            && !Array.isArray(play.skillProficiencyOverrides)
              ? { ...play.skillProficiencyOverrides }
              : {};
          if (next === autoValue) delete overrides[key];
          else overrides[key] = next;
          play.skillProficiencyOverrides = overrides;
          play.skillProficiencies = { ...(play.skillProficiencies ?? {}), [key]: next };
        });
      });
    });

    app.querySelector("#open-spells")?.addEventListener("click", () => openSpellModal(state));
    app.querySelector("#open-items")?.addEventListener("click", () => openItemModal(state));
    app.querySelectorAll("[data-toggle-item-equipped]").forEach((button) => {
      button.addEventListener("click", () => {
        toggleInventoryItemEquipped(button.dataset.toggleItemEquipped);
      });
    });
    app.querySelectorAll("[data-remove-item-index]").forEach((button) => {
      button.addEventListener("click", () => {
        removeInventoryItemByIndex(button.dataset.removeItemIndex);
      });
    });
    app.querySelectorAll("[data-open-feat-picker]").forEach((button) => {
      button.addEventListener("click", () => {
        const slotId = button.dataset.openFeatPicker;
        if (!slotId) return;
        openFeatModal(state, slotId);
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
    app.querySelector("#import-json")?.addEventListener("click", () => {
      const input = app.querySelector("#export-json");
      try {
        const parsed = JSON.parse(input.value);
        store.hydrate(parsed);
        updateCharacterWithRequiredSettings(store.getState(), {}, { preserveUserOverrides: true });
      } catch {
        alert("Invalid JSON payload");
      }
    });
  }

  function bindPlayEvents(state) {
    const LONG_PRESS_CHOOSER_DELAY_MS = 500;
    const longPressRollChooser = (() => {
      let overlayEl = null;
      let hintEl = null;
      let advantageButtonEl = null;
      let disadvantageButtonEl = null;
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
        const left = rect.left + rect.width / 2;
        const top = Math.max(10, rect.top - 8);
        overlayEl.style.left = `${Math.round(left)}px`;
        overlayEl.style.top = `${Math.round(top)}px`;
        overlayEl.style.bottom = "auto";
        overlayEl.style.transform = "translate(-50%, -100%)";
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
        actionsEl.append(advantageButtonEl, disadvantageButtonEl);
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
          };
          if (hintEl) hintEl.textContent = "Choose roll mode";
          positionNearElement(targetEl);
          overlayEl?.classList.add("is-visible", "is-ready");
        },
        hide,
      };
    })();

    const bindClickAndLongPress = (element, onClick, onLongPress) => {
      if (!element || typeof onClick !== "function") return;
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

      element.addEventListener("pointerdown", (event) => {
        if (typeof onLongPress !== "function") return;
        if (event.button !== 0) return;
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
            advantage: () => onLongPress("advantage"),
            disadvantage: () => onLongPress("disadvantage"),
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

    app.querySelectorAll("[data-open-levelup]").forEach((button) => {
      button.addEventListener("click", () => openLevelUpModal(state));
    });
    const diceStyleEl = app.querySelector("#dice-style-select");
    if (diceStyleEl) {
      diceStyleEl.addEventListener("change", () => {
        uiState.selectedDiceStyle = diceStyleEl.value in diceStylePresets ? diceStyleEl.value : "arcane";
        applyDiceStyle();
      });
    }
    app.querySelector("#reroll-last-roll")?.addEventListener("click", () => {
      rerollLastRoll();
    });
    app.querySelector("#open-custom-roll")?.addEventListener("click", () => {
      openCustomRollModal();
    });
    app.querySelector("[data-open-class-info]")?.addEventListener("click", () => {
      openClassDetailsModal(state);
    });
    app.querySelectorAll("[data-open-feature]").forEach((button) => {
      button.addEventListener("click", () => {
        const featureId = button.dataset.openFeature;
        if (!featureId) return;
        openFeatureDetailsModal(state, featureId);
      });
    });
    app.querySelectorAll("[data-open-feat]").forEach((button) => {
      button.addEventListener("click", () => {
        const featId = button.dataset.openFeat;
        if (!featId) return;
        openFeatDetailsModal(state, featId);
      });
    });
    app.querySelectorAll("[data-feature-use-delta]").forEach((button) => {
      button.addEventListener("click", () => {
        const raw = String(button.dataset.featureUseDelta ?? "");
        const marker = "|inc:";
        const markerIndex = raw.lastIndexOf(marker);
        if (markerIndex <= 0) return;
        const key = raw.slice(0, markerIndex);
        const deltaRaw = raw.slice(markerIndex + marker.length);
        const delta = toNumber(deltaRaw, 0);
        if (!key || !delta) return;
        withUpdatedPlay(state, (playState) => {
          const nextFeatureUses =
            playState.featureUses && typeof playState.featureUses === "object" && !Array.isArray(playState.featureUses)
              ? { ...playState.featureUses }
              : {};
          const tracker = nextFeatureUses[key];
          if (!tracker || typeof tracker !== "object") return;
          const max = Math.max(0, toNumber(tracker.max, 0));
          const current = Math.max(0, Math.min(max, toNumber(tracker.current, max) + delta));
          nextFeatureUses[key] = { ...tracker, current };
          playState.featureUses = nextFeatureUses;
        });
      });
    });

    const hpCurrentEl = app.querySelector("#play-hp-current");
    const hpTempEl = app.querySelector("#play-hp-temp");
    const speedEl = app.querySelector("#play-speed");
    const initiativeEl = app.querySelector("#play-initiative-bonus");
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
    bindNumberInput(speedEl, (play, value) => {
      play.speed = Math.max(0, value);
    });
    bindNumberInput(initiativeEl, (play, value) => {
      play.initiativeBonus = value;
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

          if (target === "speed") {
            play.speed = Math.max(0, toNumber(play.speed, 30) + delta);
            return;
          }

          if (target === "initiative-bonus") {
            play.initiativeBonus = toNumber(play.initiativeBonus, 0) + delta;
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
          const bonus = mod + (isProf ? state.derived.proficiencyBonus : 0);
          rollVisualD20(`${ability.toUpperCase()} save`, bonus);
        },
        (rollMode) => {
          const ability = button.dataset.saveRollBtn;
          const mod = toNumber(state.derived.mods?.[ability], 0);
          const isProf = Boolean(state.character.play?.saveProficiencies?.[ability]);
          const bonus = mod + (isProf ? state.derived.proficiencyBonus : 0);
          rollVisualD20(`${ability.toUpperCase()} save`, bonus, rollMode);
        }
      );
    });

    app.querySelectorAll("[data-skill-roll-btn]").forEach((button) => {
      bindClickAndLongPress(
        button,
        () => {
          const key = button.dataset.skillRollBtn;
          const skill = SKILLS.find((entry) => entry.key === key);
          if (!skill) return;
          const mod = toNumber(state.derived.mods?.[skill.ability], 0);
          const isProf = Boolean(state.character.play?.skillProficiencies?.[key]);
          const bonus = mod + (isProf ? state.derived.proficiencyBonus : 0);
          rollVisualD20(skill.label, bonus);
        },
        (rollMode) => {
          const key = button.dataset.skillRollBtn;
          const skill = SKILLS.find((entry) => entry.key === key);
          if (!skill) return;
          const mod = toNumber(state.derived.mods?.[skill.ability], 0);
          const isProf = Boolean(state.character.play?.skillProficiencies?.[key]);
          const bonus = mod + (isProf ? state.derived.proficiencyBonus : 0);
          rollVisualD20(skill.label, bonus, rollMode);
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
          const bonus = toNumber(state.character.play?.initiativeBonus, 0);
          rollVisualD20("Initiative", bonus);
        },
        (rollMode) => {
          const bonus = toNumber(state.character.play?.initiativeBonus, 0);
          rollVisualD20("Initiative", bonus, rollMode);
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

    app.querySelectorAll("[data-spell-prepared-btn]").forEach((button) => {
      button.addEventListener("click", () => {
        const spellName = button.dataset.spellPreparedBtn;
        if (!spellName) return;
        withUpdatedPlay(state, (play) => {
          const current = play.preparedSpells?.[spellName];
          const isPrepared = Boolean(current);
          const spell = getSpellByName(state, spellName);
          const isCantrip = toNumber(spell?.level, 0) === 0;
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
        if (notation) {
          await rollVisualNotation(`Cast ${spell.name}`, notation);
          return;
        }

        if (spellLevel === 0) {
          setDiceResult(`Cast ${spell.name}: no dice notation found.`, false);
          return;
        }

        const spentText = slotSpent ? "slot spent." : "cast.";
        setDiceResult(`Cast ${spell.name}: ${spentText} No dice notation found.`, false);
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
      button.addEventListener("click", () => {
        const context = getAttackContext();
        if (!context) return;
        const notation = extractSimpleNotation(context.value);
        if (!notation) {
          setDiceResult(`${context.attackName}: invalid damage dice notation.`, true);
          return;
        }
        rollVisualNotation(`${context.attackName} damage`, notation);
      });
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
      button.addEventListener("click", () => {
        const context = getAttackContext();
        if (!context) return;
        const notation = extractSimpleNotation(context.value);
        if (!notation) {
          setDiceResult(`${context.attackName}: invalid damage dice notation.`, true);
          return;
        }
        rollVisualNotation(`${context.attackName} damage`, notation);
      });
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
    app.querySelectorAll("[data-toggle-item-equipped]").forEach((button) => {
      button.addEventListener("click", () => {
        toggleInventoryItemEquipped(button.dataset.toggleItemEquipped);
      });
    });
    app.querySelectorAll("[data-remove-item-index]").forEach((button) => {
      button.addEventListener("click", () => {
        removeInventoryItemByIndex(button.dataset.removeItemIndex);
      });
    });

    app.querySelector("#add-condition")?.addEventListener("click", () => {
      const input = app.querySelector("#play-condition-input");
      const value = input.value.trim();
      if (!value) return;
      withUpdatedPlay(state, (play) => {
        play.conditions = [...(play.conditions ?? []), value];
      });
    });

    app.querySelectorAll("[data-remove-condition]").forEach((button) => {
      button.addEventListener("click", () => {
        const idx = toNumber(button.dataset.removeCondition, -1);
        withUpdatedPlay(state, (play) => {
          const next = [...(play.conditions ?? [])];
          if (idx >= 0) next.splice(idx, 1);
          play.conditions = next;
        });
      });
    });

    app.querySelector("#play-notes")?.addEventListener("input", (evt) => {
      const value = evt.target.value;
      withUpdatedPlay(state, (play) => {
        play.notes = value;
      });
    });

    app.querySelector("#add-resource")?.addEventListener("click", () => {
      withUpdatedPlay(state, (play) => {
        play.resources = [...(play.resources ?? []), { name: "", current: 0, max: 0 }];
      });
    });

    app.querySelectorAll("[data-resource-field]").forEach((input) => {
      input.addEventListener("input", () => {
        const [idxStr, field] = input.dataset.resourceField.split(":");
        const idx = toNumber(idxStr, 0);
        withUpdatedPlay(state, (play) => {
          const next = [...(play.resources ?? [])];
          const prev = next[idx] ?? { name: "", current: 0, max: 0 };
          const value = field === "name" ? input.value : Math.max(0, toNumber(input.value, 0));
          next[idx] = { ...prev, [field]: value };
          play.resources = next;
        });
      });
    });

    app.querySelectorAll("[data-remove-resource]").forEach((button) => {
      button.addEventListener("click", () => {
        const idx = toNumber(button.dataset.removeResource, -1);
        withUpdatedPlay(state, (play) => {
          const next = [...(play.resources ?? [])];
          if (idx >= 0) next.splice(idx, 1);
          play.resources = next;
        });
      });
    });

    app.querySelector("#short-rest")?.addEventListener("click", () => {
      withUpdatedPlay(state, (play) => {
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
      });
    });

    app.querySelector("#long-rest")?.addEventListener("click", () => {
      withUpdatedPlay(state, (play) => {
        play.hpCurrent = state.derived.hp;
        play.hpTemp = 0;
        play.deathSavesSuccess = 0;
        play.deathSavesFail = 0;
        play.spellSlots = Object.fromEntries(
          Object.entries(play.spellSlots ?? {}).map(([level, slot]) => [level, { ...slot, used: 0 }])
        );
        play.resources = (play.resources ?? []).map((resource) => ({
          ...resource,
          current: Math.max(0, toNumber(resource.max, 0)),
        }));
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
      });
    });
  }

  return { bindBuildEvents, bindPlayEvents };
}

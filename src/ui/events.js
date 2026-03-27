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

    [["#name", "name"], ["#notes", "notes"], ["#race", "race"], ["#background", "background"]].forEach(([sel, field]) => {
      const el = app.querySelector(sel);
      if (!el) return;
      const handler = () => store.updateCharacter({ [field]: el.value });
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

    app.querySelectorAll("[data-save-prof-btn]").forEach((button) => {
      button.addEventListener("click", () => {
        const ability = button.dataset.saveProfBtn;
        withUpdatedPlay(state, (play) => {
          const current = Boolean(play.saveProficiencies?.[ability]);
          play.saveProficiencies = { ...(play.saveProficiencies ?? {}), [ability]: !current };
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
          play.skillProficiencies = { ...(play.skillProficiencies ?? {}), [key]: !current };
        });
      });
    });

    app.querySelector("#open-spells")?.addEventListener("click", () => openSpellModal(state));
    app.querySelector("#open-items")?.addEventListener("click", () => openItemModal(state));
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
      button.addEventListener("click", () => {
        const ability = button.dataset.saveRollBtn;
        const mod = toNumber(state.derived.mods?.[ability], 0);
        const isProf = Boolean(state.character.play?.saveProficiencies?.[ability]);
        const bonus = mod + (isProf ? state.derived.proficiencyBonus : 0);
        rollVisualD20(`${ability.toUpperCase()} save`, bonus);
      });
    });

    app.querySelectorAll("[data-skill-roll-btn]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.skillRollBtn;
        const skill = SKILLS.find((entry) => entry.key === key);
        if (!skill) return;
        const mod = toNumber(state.derived.mods?.[skill.ability], 0);
        const isProf = Boolean(state.character.play?.skillProficiencies?.[key]);
        const bonus = mod + (isProf ? state.derived.proficiencyBonus : 0);
        rollVisualD20(skill.label, bonus);
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
          if (!isPrepared) {
            const preparedCount = countPreparedSpells(state, play);
            const preparedLimit = getPreparedSpellLimit(state);
            if (!isCantrip && preparedCount >= preparedLimit) return;
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

    app.querySelectorAll("[data-ability-roll]").forEach((button) => {
      button.addEventListener("click", () => {
        const ability = button.dataset.abilityRoll;
        const mod = toNumber(state.derived.mods?.[ability], 0);
        rollVisualD20(`${ability.toUpperCase()} check`, mod);
      });
    });

    app.querySelector("[data-roll-initiative]")?.addEventListener("click", () => {
      const bonus = toNumber(state.character.play?.initiativeBonus, 0);
      rollVisualD20("Initiative", bonus);
    });

    app.querySelector("[data-roll-death-save]")?.addEventListener("click", async () => {
      const result = await rollVisualD20("Death save", 0);
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
      button.addEventListener("click", () => {
        const [idxStr, field] = String(button.dataset.attackRoll || "").split(":");
        const idx = toNumber(idxStr, -1);
        const attack = state.character.play?.attacks?.[idx] ?? null;
        if (!attack) return;

        const attackName = attack.name?.trim() || `Attack ${idx + 1}`;
        const value = String(attack[field] || "").trim();
        if (!value) {
          setDiceResult(`${attackName}: no roll value entered.`, true);
          return;
        }

        if (field === "toHit") {
          if (/[dD]/.test(value)) {
            const notation = extractSimpleNotation(value);
            if (!notation) {
              setDiceResult(`${attackName}: invalid to-hit dice notation.`, true);
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
          rollVisualD20(`${attackName} to-hit`, modifier);
          return;
        }

        if (field === "damage") {
          const notation = extractSimpleNotation(value);
          if (!notation) {
            setDiceResult(`${attackName}: invalid damage dice notation.`, true);
            return;
          }
          rollVisualNotation(`${attackName} damage`, notation);
        }
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

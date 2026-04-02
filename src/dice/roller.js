const DICE_MODULE_SOURCES = [
  {
    moduleUrl: "/vendor/dice-box/dice-box.es.min.js",
    assetPath: "/vendor/dice-box/assets/",
    assetOrigin: window.location.origin,
  },
  {
    moduleUrl: "/src/vendor/local-dice-box.js",
    assetPath: "assets/",
    assetOrigin: window.location.origin,
  },
];

const CUSTOM_ROLL_DIE_FACES = [4, 6, 8, 10, 12, 20, 100];

function formatNotationWithModifier(baseNotation, modifier) {
  if (modifier === 0) return baseNotation;
  const op = modifier > 0 ? "+" : "-";
  return `${baseNotation} ${op} ${Math.abs(modifier)}`;
}

function formatEvaluatedWithModifier(baseValue, modifier) {
  if (modifier === 0) return String(baseValue);
  const op = modifier > 0 ? "+" : "-";
  return `${baseValue} ${op} ${Math.abs(modifier)}`;
}

function formatEvaluatedNotation(rollValues, total) {
  if (!Array.isArray(rollValues) || !rollValues.length || !Number.isFinite(total)) return null;
  const sum = rollValues.reduce((acc, value) => acc + value, 0);
  const diceExpression = rollValues.length > 1 ? `(${rollValues.join(" + ")})` : `${rollValues[0]}`;
  const delta = total - sum;
  if (delta === 0) return diceExpression;
  const op = delta > 0 ? "+" : "-";
  return `${diceExpression} ${op} ${Math.abs(delta)}`;
}

function parseFlatNotationModifier(notation) {
  const normalized = String(notation || "").replace(/\s+/g, "");
  if (!normalized) return null;
  if (/[^0-9d+\-]/i.test(normalized)) return null;
  const tokens = normalized.match(/[+\-]?[^+\-]+/g);
  if (!tokens?.length) return null;
  let modifierTotal = 0;
  let hasNumericModifierToken = false;
  for (const token of tokens) {
    const isNegative = token.startsWith("-");
    const unsigned = token.replace(/^[+\-]/, "");
    if (!unsigned) return null;
    if (/^\d+d\d+$/i.test(unsigned)) continue;
    if (!/^\d+$/.test(unsigned)) return null;
    hasNumericModifierToken = true;
    const value = Number(unsigned);
    modifierTotal += isNegative ? -value : value;
  }
  return hasNumericModifierToken ? modifierTotal : 0;
}

function parseSimpleNotation(notation) {
  const normalized = String(notation || "").replace(/\s+/g, "");
  if (!normalized) return null;
  if (/[^0-9d+\-]/i.test(normalized)) return null;
  const tokens = normalized.match(/[+\-]?[^+\-]+/g);
  if (!tokens?.length) return null;
  const diceTerms = [];
  let modifierTotal = 0;
  for (const token of tokens) {
    const isNegative = token.startsWith("-");
    const sign = isNegative ? -1 : 1;
    const unsigned = token.replace(/^[+\-]/, "");
    if (!unsigned) return null;
    if (/^\d+d\d+$/i.test(unsigned)) {
      const [countRaw, facesRaw] = unsigned.toLowerCase().split("d");
      const count = Number(countRaw);
      const faces = Number(facesRaw);
      if (!Number.isFinite(count) || !Number.isFinite(faces) || count <= 0 || faces <= 0) return null;
      diceTerms.push({ sign, count, faces });
      continue;
    }
    if (!/^\d+$/.test(unsigned)) return null;
    modifierTotal += sign * Number(unsigned);
  }
  return { normalized, diceTerms, modifierTotal };
}

function extractSimpleNotation(value) {
  const compact = String(value || "").replace(/\s+/g, "");
  if (!compact) return "";
  if (parseSimpleNotation(compact)) return compact;
  const match = compact.match(/[+\-]?\d+d\d+(?:[+\-](?:\d+d\d+|\d+))*/i);
  if (!match?.[0]) return "";
  const candidate = String(match[0]);
  return parseSimpleNotation(candidate) ? candidate : "";
}

function normalizeD20RollMode(value) {
  if (value === "advantage" || value === "disadvantage") return value;
  return "normal";
}

function selectD20ResultFromRolls(rolls, rollMode) {
  const candidates = Array.isArray(rolls) ? rolls.filter((value) => value >= 1 && value <= 20) : [];
  if (!candidates.length) return null;
  if (rollMode === "advantage") return Math.max(...candidates);
  if (rollMode === "disadvantage") return Math.min(...candidates);
  return candidates[0] ?? null;
}

function formatD20ResultMessage(label, modifier, dieValue, total, rollMode = "normal", rollValues = []) {
  const mode = normalizeD20RollMode(rollMode);
  const baseExpression = mode === "advantage" ? "2d20kh1" : mode === "disadvantage" ? "2d20kl1" : "1d20";
  const inputExpression = formatNotationWithModifier(baseExpression, modifier);
  const modeSuffix = mode === "advantage" ? " (advantage)" : mode === "disadvantage" ? " (disadvantage)" : "";
  const rollList = Array.isArray(rollValues) ? rollValues.filter((value) => Number.isFinite(value)) : [];
  if (dieValue != null && total != null) {
    const selected = formatEvaluatedWithModifier(dieValue, modifier);
    if (mode !== "normal" && rollList.length >= 2) {
      return `${label}${modeSuffix}: ${inputExpression} | rolls ${rollList.join(", ")} -> ${selected} = ${total}`;
    }
    return `${label}${modeSuffix}: ${inputExpression} | ${selected} = ${total}`;
  }
  if (total != null) {
    return `${label}${modeSuffix}: ${inputExpression} | total = ${total}`;
  }
  return `${label}${modeSuffix}: ${inputExpression} | roll completed.`;
}

function formatNotationResultMessage(label, notation, total, rollValues) {
  const inputExpression = String(notation || "").trim();
  const evaluated = formatEvaluatedNotation(rollValues, total);
  if (evaluated && total != null) {
    return `${label}: ${inputExpression} | ${evaluated} = ${total}`;
  }
  if (total != null) {
    return `${label}: ${inputExpression} | total = ${total}`;
  }
  return `${label}: ${inputExpression} | roll completed.`;
}

function extractDiceLogLabelAndMode(entry) {
  const summaryParts = Array.isArray(entry?.summaryParts) ? entry.summaryParts : [];
  const highlighted = summaryParts.find((part) => part?.style === "highlight");
  const fallback = summaryParts.map((part) => String(part?.text ?? "")).join("");
  const sourceText = String(highlighted?.text ?? fallback).trim();
  const modeMatch = sourceText.match(/\s+\((advantage|disadvantage)\)\s*$/i);
  const mode = modeMatch?.[1]?.toLowerCase() === "advantage"
    ? "advantage"
    : modeMatch?.[1]?.toLowerCase() === "disadvantage"
      ? "disadvantage"
      : "normal";
  const label = sourceText.replace(/\s+\((advantage|disadvantage)\)\s*$/i, "").trim() || "Roll";
  return { label, mode };
}

function parseDiceLogRollValues(entry, toNumber) {
  const details = Array.isArray(entry?.details) ? entry.details : [];
  const diceRow = details.find((row) => String(row?.label ?? "").trim().toLowerCase() === "dice");
  if (!diceRow) return [];
  return String(diceRow.after ?? "")
    .split(",")
    .map((value) => toNumber(value.trim(), Number.NaN))
    .filter((value) => Number.isFinite(value));
}

function parseDiceLogTotal(entry, toNumber) {
  const details = Array.isArray(entry?.details) ? entry.details : [];
  const rollRow = details.find((row) => String(row?.label ?? "").trim().toLowerCase() === "roll");
  const totalRow = details.find((row) => String(row?.label ?? "").trim().toLowerCase() === "total");
  const candidate = rollRow?.after ?? totalRow?.after;
  const parsed = toNumber(candidate, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDiceLogNotation(entry) {
  const details = Array.isArray(entry?.details) ? entry.details : [];
  const rollRow = details.find((row) => String(row?.label ?? "").trim().toLowerCase() === "roll");
  return String(rollRow?.before ?? "").replace(/\s+/g, "").trim();
}

function parseD20ActionFromLoggedNotation(notation, rollMode, toNumber) {
  const cleaned = String(notation ?? "").replace(/\s+/g, "").trim().toLowerCase();
  if (!cleaned) return null;
  const parseModifier = (token) => {
    if (!token) return 0;
    const parsed = toNumber(token, Number.NaN);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const d20NormalMatch = cleaned.match(/^1d20([+\-]\d+)?$/);
  if (d20NormalMatch) {
    return { type: "d20", modifier: parseModifier(d20NormalMatch[1]), rollMode: "normal" };
  }
  const d20AdvDisMatch = cleaned.match(/^2d20([+\-]\d+)?$/);
  if (d20AdvDisMatch && (rollMode === "advantage" || rollMode === "disadvantage")) {
    return { type: "d20", modifier: parseModifier(d20AdvDisMatch[1]), rollMode };
  }
  const d20KeepHighMatch = cleaned.match(/^2d20kh1([+\-]\d+)?$/);
  if (d20KeepHighMatch) {
    return { type: "d20", modifier: parseModifier(d20KeepHighMatch[1]), rollMode: "advantage" };
  }
  const d20KeepLowMatch = cleaned.match(/^2d20kl1([+\-]\d+)?$/);
  if (d20KeepLowMatch) {
    return { type: "d20", modifier: parseModifier(d20KeepLowMatch[1]), rollMode: "disadvantage" };
  }
  return null;
}

export function createDiceRoller(deps) {
  const {
    uiState,
    store,
    toNumber,
    signed,
    rollDie,
    applyDiceStyle,
    setDiceResult,
    openModal,
    isDiceTrayEnabled,
    appendDiceRollLog,
    defaultDiceResultMessage,
  } = deps;

  let diceBoxPromise = null;
  let lastRollAction = null;

  async function getDiceBox() {
    if (uiState.diceBox) return uiState.diceBox;
    if (diceBoxPromise) return diceBoxPromise;

    diceBoxPromise = (async () => {
      try {
        const tray = document.getElementById("dice-tray");
        if (!tray) return null;
        let lastError = null;
        for (const source of DICE_MODULE_SOURCES) {
          try {
            const module = await import(source.moduleUrl);
            const DiceBox = module?.default;
            if (!DiceBox) continue;

            const box = new DiceBox({
              container: "#dice-tray",
              assetPath: source.assetPath ?? "assets/",
              origin: source.assetOrigin,
              theme: "default",
              scale: 12,
              gravity: 2.35,
              throwForce: 4.8,
              spinForce: 1.55,
              startingHeight: 7,
              linearDamping: 0.82,
              angularDamping: 0.86,
              settleTimeout: 3200,
            });
            await box.init();
            uiState.diceBox = box;
            await applyDiceStyle(box);
            return box;
          } catch (error) {
            lastError = error;
          }
        }
        if (lastError) {
          console.error("Dice modules failed to initialize", lastError);
        }
      } catch (error) {
        console.error("Dice Box failed to initialize", error);
      }
      setDiceResult("Visual dice failed to load.", true);
      return null;
    })();

    return diceBoxPromise;
  }

  async function rollVisualD20(label, modifier = 0, rollMode = "normal") {
    const mode = normalizeD20RollMode(rollMode);
    const notationBase = mode === "advantage" || mode === "disadvantage" ? "2d20" : "1d20";
    const notation = modifier === 0 ? notationBase : `${notationBase}${signed(modifier)}`;
    setDiceResult(`${label}: rolling ${notation}...`, false, { record: false });
    if (!isDiceTrayEnabled(store.getState().character ?? {})) {
      const rollCount = mode === "normal" ? 1 : 2;
      const resolvedRollValues = Array.from({ length: rollCount }, () => rollDie(20));
      const resolvedDieValue = selectD20ResultFromRolls(resolvedRollValues, mode);
      const total = resolvedDieValue != null ? resolvedDieValue + modifier : null;
      setDiceResult(formatD20ResultMessage(label, modifier, resolvedDieValue, total, mode, resolvedRollValues));
      appendDiceRollLog({
        label,
        notation,
        total,
        rollValues: resolvedRollValues,
        rollMode: mode,
      });
      lastRollAction = { type: "d20", label, modifier, rollMode: mode };
      return {
        label,
        notation,
        modifier,
        rollMode: mode,
        rollValues: resolvedRollValues,
        dieValue: resolvedDieValue,
        total,
      };
    }
    const physicalNotation = notationBase;
    const box = await getDiceBox();
    if (!box) return null;
    await applyDiceStyle(box);

    try {
      const rollGroups = await box.roll(physicalNotation);
      const groups = Array.isArray(rollGroups) ? rollGroups : [];
      const rollValues = groups.flatMap((group) =>
        Array.isArray(group?.rolls) ? group.rolls.map((it) => toNumber(it?.value, NaN)).filter((it) => Number.isFinite(it)) : []
      );
      const validRollValues = rollValues.filter((value) => value >= 1 && value <= 20);
      const fallbackRollValues = groups
        .map((group) => Number(group?.value))
        .filter((value) => Number.isFinite(value) && value >= 1 && value <= 20);
      const resolvedRollValues = validRollValues.length ? validRollValues : fallbackRollValues;
      const resolvedDieValue = selectD20ResultFromRolls(resolvedRollValues, mode);
      const total = resolvedDieValue != null ? resolvedDieValue + modifier : null;
      setDiceResult(formatD20ResultMessage(label, modifier, resolvedDieValue, total, mode, resolvedRollValues));
      appendDiceRollLog({
        label,
        notation,
        total,
        rollValues: resolvedRollValues,
        rollMode: mode,
      });
      lastRollAction = { type: "d20", label, modifier, rollMode: mode };
      return {
        label,
        notation,
        modifier,
        rollMode: mode,
        rollValues: resolvedRollValues,
        dieValue: resolvedDieValue,
        total,
      };
    } catch (error) {
      console.error("Dice roll failed", error);
      setDiceResult(`${label}: roll failed.`, true);
      return null;
    }
  }

  async function rollVisualNotation(label, notation) {
    const cleanNotation = String(notation || "").trim();
    if (!cleanNotation) {
      setDiceResult(`${label}: no dice notation.`, true);
      return null;
    }
    const normalizedNotation = cleanNotation.replace(/\s+/g, "");
    const parsedNotation = parseSimpleNotation(normalizedNotation);
    const canComputeDeterministically =
      parsedNotation != null && parsedNotation.diceTerms.length > 0 && parsedNotation.diceTerms.every((term) => term.sign > 0);
    const diceOnlyNotation = canComputeDeterministically
      ? parsedNotation.diceTerms.map((term) => `${term.count}d${term.faces}`).join("+")
      : normalizedNotation;

    setDiceResult(`${label}: rolling ${normalizedNotation}...`, false, { record: false });
    if (!isDiceTrayEnabled(store.getState().character ?? {})) {
      if (!parsedNotation) {
        setDiceResult(`${label}: invalid dice notation.`, true);
        return null;
      }
      const rollValues = [];
      let total = parsedNotation.modifierTotal;
      parsedNotation.diceTerms.forEach((term) => {
        const count = Math.max(0, Math.floor(toNumber(term?.count, 0)));
        const faces = Math.max(1, Math.floor(toNumber(term?.faces, 0)));
        const sign = toNumber(term?.sign, 1) < 0 ? -1 : 1;
        for (let index = 0; index < count; index += 1) {
          const value = rollDie(faces);
          rollValues.push(sign < 0 ? -value : value);
          total += sign * value;
        }
      });
      setDiceResult(formatNotationResultMessage(label, normalizedNotation, total, rollValues));
      appendDiceRollLog({
        label,
        notation: normalizedNotation,
        total,
        rollValues,
        rollMode: "normal",
      });
      lastRollAction = { type: "notation", label, notation: normalizedNotation };
      return {
        notation: normalizedNotation,
        total: Number.isFinite(total) ? total : null,
        rollValues,
      };
    }
    const box = await getDiceBox();
    if (!box) return null;
    await applyDiceStyle(box);

    try {
      const rollGroups = await box.roll(diceOnlyNotation);
      const groups = Array.isArray(rollGroups) ? rollGroups : [];
      const rollValues = groups.flatMap((group) =>
        Array.isArray(group?.rolls) ? group.rolls.map((it) => toNumber(it?.value, NaN)).filter((it) => Number.isFinite(it)) : []
      );
      const groupTotals = groups.map((group) => toNumber(group?.value, NaN)).filter((it) => Number.isFinite(it));
      const summedGroupTotal = groupTotals.length ? groupTotals.reduce((acc, value) => acc + value, 0) : NaN;
      const firstGroupTotal = groups.length ? toNumber(groups[0]?.value, NaN) : NaN;
      const rawTotal = Number.isFinite(summedGroupTotal) ? summedGroupTotal : firstGroupTotal;
      const diceOnlyTotalFromRolls = rollValues.length ? rollValues.reduce((acc, value) => acc + value, 0) : null;
      const diceOnlyTotal =
        diceOnlyTotalFromRolls != null
          ? diceOnlyTotalFromRolls
          : canComputeDeterministically && Number.isFinite(rawTotal)
            ? rawTotal
            : null;
      const parsedModifier = canComputeDeterministically ? parsedNotation.modifierTotal : parseFlatNotationModifier(normalizedNotation);
      const computedTotal =
        Number.isFinite(diceOnlyTotal) && Number.isFinite(parsedModifier) ? diceOnlyTotal + parsedModifier : null;
      const total = computedTotal ?? (Number.isFinite(rawTotal) ? rawTotal : diceOnlyTotal);
      const displayRollValues = rollValues.length
        ? rollValues
        : Number.isFinite(diceOnlyTotal)
          ? [diceOnlyTotal]
          : [];
      setDiceResult(formatNotationResultMessage(label, normalizedNotation, total, displayRollValues));
      appendDiceRollLog({
        label,
        notation: normalizedNotation,
        total,
        rollValues: displayRollValues,
        rollMode: "normal",
      });
      lastRollAction = { type: "notation", label, notation: normalizedNotation };
      return {
        notation: normalizedNotation,
        total: Number.isFinite(total) ? total : null,
        rollValues: displayRollValues,
      };
    } catch (error) {
      console.error("Dice roll failed", error);
      setDiceResult(`${label}: roll failed.`, true);
      return null;
    }
  }

  async function rerollLastRoll() {
    if (!lastRollAction) {
      setDiceResult("There is no previous roll to reroll.", true);
      return;
    }

    if (lastRollAction.type === "d20") {
      await rollVisualD20(
        lastRollAction.label,
        toNumber(lastRollAction.modifier, 0),
        normalizeD20RollMode(lastRollAction.rollMode)
      );
      return;
    }

    if (lastRollAction.type === "notation") {
      await rollVisualNotation(lastRollAction.label, lastRollAction.notation);
    }
  }

  function openCustomRollModal() {
    const diceCounts = CUSTOM_ROLL_DIE_FACES.reduce((acc, face) => {
      acc[face] = 0;
      return acc;
    }, {});
    const close = openModal({
      title: "Custom Dice Roll",
      bodyHtml: `
      <div class="custom-roll-shell">
        <p class="subtitle custom-roll-subtitle">Click dice to add them, then roll.</p>
        <div class="custom-roll-grid">
          ${CUSTOM_ROLL_DIE_FACES.map(
            (face) => `
              <button type="button" class="custom-roll-die-btn" data-custom-roll-add="${face}">
                <span class="custom-roll-die-label">d${face}</span>
                <span class="custom-roll-die-count" data-custom-roll-count="${face}">0</span>
              </button>
            `
          ).join("")}
        </div>
        <div class="custom-roll-selected" id="custom-roll-selected" aria-live="polite"></div>
        <div class="custom-roll-actions">
          <button type="button" class="btn secondary" id="custom-roll-clear">Clear</button>
          <button type="button" class="btn" id="custom-roll-submit" disabled>Roll</button>
        </div>
      </div>
    `,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });
    const selectedEl = document.getElementById("custom-roll-selected");
    const submitEl = document.getElementById("custom-roll-submit");
    const clearEl = document.getElementById("custom-roll-clear");
    const modalEl = selectedEl?.closest(".modal");

    const getNotation = () =>
      CUSTOM_ROLL_DIE_FACES.map((face) => {
        const count = toNumber(diceCounts[face], 0);
        if (count <= 0) return "";
        return `${count}d${face}`;
      })
        .filter(Boolean)
        .join("+");

    const renderSelected = () => {
      if (!selectedEl || !submitEl) return;
      const chips = CUSTOM_ROLL_DIE_FACES.map((face) => {
        const count = toNumber(diceCounts[face], 0);
        if (count <= 0) return "";
        return `
        <button type="button" class="custom-roll-chip" data-custom-roll-remove="${face}" title="Remove one d${face}">
          ${count}d${face}
        </button>
      `;
      })
        .filter(Boolean)
        .join("");
      if (chips) {
        selectedEl.innerHTML = `<span class="muted custom-roll-selected-label">Selected</span>${chips}`;
        selectedEl.classList.add("is-populated");
        submitEl.disabled = false;
        return;
      }
      selectedEl.innerHTML = `<span class="muted">Choose at least one die to roll.</span>`;
      selectedEl.classList.remove("is-populated");
      submitEl.disabled = true;
    };

    modalEl?.querySelectorAll("[data-custom-roll-add]").forEach((button) => {
      button.addEventListener("click", () => {
        const face = toNumber(button.dataset.customRollAdd, 0);
        if (!face || !(face in diceCounts)) return;
        diceCounts[face] = Math.min(20, toNumber(diceCounts[face], 0) + 1);
        const countEl = modalEl.querySelector(`[data-custom-roll-count="${face}"]`);
        if (countEl) countEl.textContent = String(diceCounts[face]);
        renderSelected();
      });
    });

    selectedEl?.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("[data-custom-roll-remove]") : null;
      if (!target) return;
      const face = toNumber(target.dataset.customRollRemove, 0);
      if (!face || !(face in diceCounts)) return;
      diceCounts[face] = Math.max(0, toNumber(diceCounts[face], 0) - 1);
      const countEl = modalEl?.querySelector(`[data-custom-roll-count="${face}"]`);
      if (countEl) countEl.textContent = String(diceCounts[face]);
      renderSelected();
    });

    clearEl?.addEventListener("click", () => {
      CUSTOM_ROLL_DIE_FACES.forEach((face) => {
        diceCounts[face] = 0;
        const countEl = modalEl?.querySelector(`[data-custom-roll-count="${face}"]`);
        if (countEl) countEl.textContent = "0";
      });
      renderSelected();
    });

    submitEl?.addEventListener("click", async () => {
      const notation = getNotation();
      if (!notation) {
        renderSelected();
        return;
      }
      close();
      await rollVisualNotation("Custom Roll", notation);
    });

    renderSelected();
  }

  function restoreDiceStateFromCharacterLog(entries) {
    lastRollAction = null;
    uiState.latestDiceResultMessage = defaultDiceResultMessage;
    uiState.latestDiceResultIsError = false;
    uiState.rollHistory = [];

    const latestDiceEntry = Array.isArray(entries) ? entries.find((entry) => entry?.sectionKey === "dice") : null;
    if (!latestDiceEntry) return;

    const { label, mode } = extractDiceLogLabelAndMode(latestDiceEntry);
    const notation = parseDiceLogNotation(latestDiceEntry);
    const total = parseDiceLogTotal(latestDiceEntry, toNumber);
    const rollValues = parseDiceLogRollValues(latestDiceEntry, toNumber);
    const parsedD20 = parseD20ActionFromLoggedNotation(notation, mode, toNumber);

    let message = "";
    if (parsedD20) {
      const resolvedRollMode = normalizeD20RollMode(parsedD20.rollMode);
      const selectedDieValue = selectD20ResultFromRolls(rollValues, resolvedRollMode);
      message = formatD20ResultMessage(label, parsedD20.modifier, selectedDieValue, total, resolvedRollMode, rollValues);
      lastRollAction = { type: "d20", label, modifier: parsedD20.modifier, rollMode: resolvedRollMode };
    } else if (notation) {
      message = formatNotationResultMessage(label, notation, total, rollValues);
      lastRollAction = { type: "notation", label, notation };
    } else {
      message = `${label}: roll completed.`;
    }

    uiState.latestDiceResultMessage = message;
    uiState.latestDiceResultIsError = false;
    const entryDate = new Date(latestDiceEntry.at);
    const timeLabel = Number.isNaN(entryDate.getTime())
      ? ""
      : entryDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    uiState.rollHistory = [
      {
        message,
        isError: false,
        timeLabel,
      },
    ];
  }

  return {
    extractSimpleNotation,
    rollVisualD20,
    rollVisualNotation,
    rerollLastRoll,
    openCustomRollModal,
    restoreDiceStateFromCharacterLog,
  };
}

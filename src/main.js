import {
  DEFAULT_SOURCE_PRESET,
  SOURCE_PRESETS,
  SOURCE_PRESET_LABELS,
  getAllowedSources,
} from "./config/sources.js";
import { loadCatalogs } from "./data-loader.js";
import { STEPS, createInitialCharacter, createStore } from "./state/character-store.js";
import { loadAppState, saveAppState } from "./state/persistence.js";
import { createCharacter, getCharacter, saveCharacter } from "./character-api.js";
import { createPersistence } from "./app/persistence.js";
import { createDiceUi } from "./dice/index.js";
import { openModal } from "./ui/modals/modal.js";
import { createEvents } from "./ui/events.js";
import { createPickers } from "./ui/pickers.js";
import { createRenderers } from "./ui/renderers.js";
import {
  esc,
  matchesSearchQuery,
  signed,
  toNumber,
} from "./ui/formatters.js";

const app = document.getElementById("app");
const persistedState = loadAppState();
const store = createStore(persistedState?.character ?? createInitialCharacter());
const DICE_MODULE_URL = "https://unpkg.com/@3d-dice/dice-box@1.1.4/dist/dice-box.es.min.js";
const DICE_ASSET_ORIGIN = "https://unpkg.com/@3d-dice/dice-box@1.1.4/dist/";
const DICE_STYLE_PRESETS = {
  ember: { label: "Ember Gold", themeColor: "#f59e0b", lightIntensity: 1.05, shadowTransparency: 0.75 },
  arcane: { label: "Arcane Cyan", themeColor: "#0891b2", lightIntensity: 1.05, shadowTransparency: 0.78 },
  forest: { label: "Forest Jade", themeColor: "#15803d", lightIntensity: 0.9, shadowTransparency: 0.68 },
  ruby: { label: "Ruby Red", themeColor: "#ef4444", lightIntensity: 1.2, shadowTransparency: 0.8 },
};
const DEFAULT_DICE_RESULT_MESSAGE = "Roll a save or skill to throw dice.";
const ROLL_HISTORY_LIMIT = 10;
const LAST_CHARACTER_ID_KEY = "fivee-last-character-id";
const CHARACTER_HISTORY_KEY = "fivee-character-history";
const CHARACTER_HISTORY_LIMIT = 20;
const NEW_CHARACTER_OPTION_VALUE = "__new_character__";
const CHARACTER_SYNC_META_KEY = "__syncMeta";
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let diceBoxPromise = null;
let lastRollAction = null;
let currentUrlCharacterId = null;
let persistenceNoticeMessage = "";
let lastPersistedCharacterFingerprint = "";
const uiState = {
  selectedDiceStyle: "arcane",
  diceBox: null,
  latestDiceResultMessage: DEFAULT_DICE_RESULT_MESSAGE,
  latestDiceResultIsError: false,
  rollHistory: [],
  latestSpellCastStatusMessage: "",
  latestSpellCastStatusIsError: false,
  spellCastStatusTimer: null,
};
const appState = {
  startupErrorMessage: "",
  showOnboardingHome: true,
  isRemoteSaveSuppressed: false,
  remoteSaveTimer: null,
  localCharacterVersion: 0,
  localCharacterUpdatedAt: "",
};

const {
  renderRollHistory,
  syncDiceResultElements,
  syncSpellCastStatusElements,
  setDiceResult,
  setSpellCastStatus,
  applyDiceStyle,
  renderDiceStyleOptions,
} = createDiceUi({
  esc,
  toNumber,
  rollHistoryLimit: ROLL_HISTORY_LIMIT,
  diceStylePresets: DICE_STYLE_PRESETS,
  uiState,
});

appState.localCharacterVersion = getCharacterVersion(persistedState?.character);
lastPersistedCharacterFingerprint = buildCharacterFingerprint(persistedState?.character ?? store.getState().character);
appState.localCharacterUpdatedAt =
  (typeof getSyncMeta(persistedState?.character).updatedAt === "string" && getSyncMeta(persistedState?.character).updatedAt) ||
  new Date().toISOString();

const SKILLS = [
  { key: "acrobatics", label: "Acrobatics", ability: "dex" },
  { key: "animalHandling", label: "Animal Handling", ability: "wis" },
  { key: "arcana", label: "Arcana", ability: "int" },
  { key: "athletics", label: "Athletics", ability: "str" },
  { key: "deception", label: "Deception", ability: "cha" },
  { key: "history", label: "History", ability: "int" },
  { key: "insight", label: "Insight", ability: "wis" },
  { key: "intimidation", label: "Intimidation", ability: "cha" },
  { key: "investigation", label: "Investigation", ability: "int" },
  { key: "medicine", label: "Medicine", ability: "wis" },
  { key: "nature", label: "Nature", ability: "int" },
  { key: "perception", label: "Perception", ability: "wis" },
  { key: "performance", label: "Performance", ability: "cha" },
  { key: "persuasion", label: "Persuasion", ability: "cha" },
  { key: "religion", label: "Religion", ability: "int" },
  { key: "sleightOfHand", label: "Sleight of Hand", ability: "dex" },
  { key: "stealth", label: "Stealth", ability: "dex" },
  { key: "survival", label: "Survival", ability: "wis" },
];

const SAVE_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const ABILITY_LABELS = {
  str: "STR",
  dex: "DEX",
  con: "CON",
  int: "INT",
  wis: "WIS",
  cha: "CHA",
};
const SPELL_SLOT_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const SPELL_SCHOOL_LABELS = {
  A: "Abjuration",
  C: "Conjuration",
  D: "Divination",
  E: "Enchantment",
  V: "Evocation",
  I: "Illusion",
  N: "Necromancy",
  T: "Transmutation",
};
const DICE_NOTATION_REGEX = /\b\d+d\d+(?:\s*[+\-]\s*\d+)?\b/gi;
const CUSTOM_ROLL_DIE_FACES = [4, 6, 8, 10, 12, 20, 100];
const ASI_FEATURE_NAME_REGEX = /ability score improvement/i;
const AUTO_RESOURCE_ID_PREFIX = "auto:";
const NUMBER_WORDS = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function isUuid(value) {
  return UUID_V4_REGEX.test(String(value ?? "").trim());
}

function getCharacterIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("char");
  return isUuid(id) ? id : null;
}

function setCharacterIdInUrl(id, replace = false) {
  if (!isUuid(id)) return;
  const url = new URL(window.location.href);
  url.searchParams.set("char", id);
  if (replace) window.history.replaceState({}, "", url.toString());
  else window.history.pushState({}, "", url.toString());
  currentUrlCharacterId = id;
}

function getLastCharacterId() {
  const id = localStorage.getItem(LAST_CHARACTER_ID_KEY);
  return isUuid(id) ? id : null;
}

function rememberLastCharacterId(id) {
  if (!isUuid(id)) return;
  localStorage.setItem(LAST_CHARACTER_ID_KEY, id);
}

function clearLastCharacterId() {
  localStorage.removeItem(LAST_CHARACTER_ID_KEY);
}

function getCharacterDisplayName(name) {
  const parsed = String(name ?? "").trim();
  return parsed || "Unnamed Hero";
}

function loadCharacterHistory() {
  let parsed = [];
  try {
    const raw = localStorage.getItem(CHARACTER_HISTORY_KEY);
    const json = raw ? JSON.parse(raw) : [];
    if (Array.isArray(json)) parsed = json;
  } catch {
    parsed = [];
  }

  return parsed
    .map((entry) => {
      const id = typeof entry?.id === "string" ? entry.id.trim() : "";
      if (!isUuid(id)) return null;
      const name = getCharacterDisplayName(entry?.name);
      const level = Math.max(1, Math.min(20, toNumber(entry?.level, 1)));
      const className = String(entry?.className ?? "").trim();
      const lastAccessedAt = typeof entry?.lastAccessedAt === "string" ? entry.lastAccessedAt : "";
      return { id, name, level, className, lastAccessedAt };
    })
    .filter(Boolean)
    .slice(0, CHARACTER_HISTORY_LIMIT);
}

function saveCharacterHistory(entries) {
  if (!Array.isArray(entries)) return;
  localStorage.setItem(CHARACTER_HISTORY_KEY, JSON.stringify(entries.slice(0, CHARACTER_HISTORY_LIMIT)));
}

function upsertCharacterHistory(character, options = {}) {
  const id = typeof character?.id === "string" ? character.id.trim() : "";
  if (!isUuid(id)) return;
  const shouldTouchAccess = options.touchAccess !== false;
  const entries = loadCharacterHistory();
  const current = entries.find((entry) => entry.id === id) ?? null;
  const nextName = getCharacterDisplayName(character?.name || current?.name);
  const nextLevel = Math.max(1, Math.min(20, toNumber(character?.level, current?.level ?? 1)));
  const nextClassName = String(character?.class ?? current?.className ?? "").trim();

  if (!current) {
    saveCharacterHistory([
      { id, name: nextName, level: nextLevel, className: nextClassName, lastAccessedAt: new Date().toISOString() },
      ...entries,
    ]);
    return;
  }

  if (!shouldTouchAccess) {
    saveCharacterHistory(
      entries.map((entry) => (entry.id === id ? { ...entry, name: nextName, level: nextLevel, className: nextClassName } : entry))
    );
    return;
  }

  const withoutCurrent = entries.filter((entry) => entry.id !== id);
  saveCharacterHistory([
    { id, name: nextName, level: nextLevel, className: nextClassName, lastAccessedAt: new Date().toISOString() },
    ...withoutCurrent,
  ]);
}

function renderCharacterHistorySelector(selectId, selectedCharacterId = null, options = {}) {
  const className = String(options.className ?? "character-history-control");
  const entries = loadCharacterHistory();

  return `
    <label class="${esc(className)}">
      <select id="${esc(selectId)}" data-character-history-select>
        ${entries
          .map((entry) => {
            const selected = selectedCharacterId === entry.id ? "selected" : "";
            const classLabel = entry.className || "Adventurer";
            const label = `${entry.name} (Lv ${entry.level} ${classLabel})`;
            return `<option value="${esc(entry.id)}" ${selected}>${esc(label)}</option>`;
          })
          .join("")}
        <option value="${NEW_CHARACTER_OPTION_VALUE}">New character</option>
      </select>
    </label>
  `;
}

async function createAndOpenNewCharacter() {
  const character = createInitialCharacter();
  const nextVersion = Math.max(appState.localCharacterVersion, getCharacterVersion(character)) + 1;
  const payload = await createCharacter(withSyncMeta(character, nextVersion));
  const parsed = getCharacterFromApiPayload(payload, null);
  setCharacterIdInUrl(parsed.id, false);
  await applyRemoteCharacterPayload(payload, parsed.id);
}

async function switchCharacterFromHistory(characterId) {
  if (!isUuid(characterId)) return;
  if (!appState.showOnboardingHome && store.getState().character?.id === characterId) return;
  try {
    await loadCharacterById(characterId);
    setCharacterIdInUrl(characterId, false);
    render(store.getState());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load selected character";
    if (appState.showOnboardingHome) appState.startupErrorMessage = message;
    else alert(message);
    render(store.getState());
  }
}

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

function formatD20ResultMessage(label, modifier, dieValue, total) {
  const inputExpression = formatNotationWithModifier("1d20", modifier);
  if (dieValue != null && total != null) {
    const evaluated = formatEvaluatedWithModifier(dieValue, modifier);
    return `${label}: ${inputExpression} | ${evaluated} = ${total}`;
  }
  if (total != null) {
    return `${label}: ${inputExpression} | total = ${total}`;
  }
  return `${label}: ${inputExpression} | roll completed.`;
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

async function getDiceBox() {
  if (uiState.diceBox) return uiState.diceBox;
  if (diceBoxPromise) return diceBoxPromise;

  diceBoxPromise = (async () => {
    try {
      const tray = document.getElementById("dice-tray");
      if (!tray) return null;

      const module = await import(DICE_MODULE_URL);
      const DiceBox = module?.default;
      if (!DiceBox) return null;

      const box = new DiceBox({
        container: "#dice-tray",
        assetPath: "assets/",
        origin: DICE_ASSET_ORIGIN,
        theme: "default",
        scale: 12,
        // Keep rolls readable: less spin/throw, stronger damping, and a longer settle window.
        gravity: 2.1,
        throwForce: 1.3,
        spinForce: 0.85,
        startingHeight: 4,
        linearDamping: 0.9,
        angularDamping: 0.93,
        settleTimeout: 2600,
      });
      await box.init();
      uiState.diceBox = box;
      applyDiceStyle(box);
      return box;
    } catch (error) {
      console.error("Dice Box failed to initialize", error);
      setDiceResult("Visual dice failed to load.", true);
      return null;
    }
  })();

  return diceBoxPromise;
}

async function rollVisualD20(label, modifier = 0) {
  const notation = modifier === 0 ? "1d20" : `1d20${signed(modifier)}`;
  const physicalNotation = "1d20";
  setDiceResult(`${label}: rolling ${notation}...`, false, { record: false });
  const box = await getDiceBox();
  if (!box) return null;

  try {
    const rollGroups = await box.roll(physicalNotation);
    const groups = Array.isArray(rollGroups) ? rollGroups : [];
    const rollValues = groups.flatMap((group) =>
      Array.isArray(group?.rolls) ? group.rolls.map((it) => toNumber(it?.value, NaN)).filter((it) => Number.isFinite(it)) : []
    );
    const dieValue = rollValues.find((value) => value >= 1 && value <= 20) ?? null;
    const fallbackDie = Number(groups[0]?.value);
    const resolvedDieValue =
      dieValue != null ? dieValue : Number.isFinite(fallbackDie) && fallbackDie >= 1 && fallbackDie <= 20 ? fallbackDie : null;
    const total = resolvedDieValue != null ? resolvedDieValue + modifier : null;
    setDiceResult(formatD20ResultMessage(label, modifier, resolvedDieValue, total));
    lastRollAction = { type: "d20", label, modifier };
    return {
      label,
      notation,
      modifier,
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
    return;
  }
  const normalizedNotation = cleanNotation.replace(/\s+/g, "");
  const parsedNotation = parseSimpleNotation(normalizedNotation);
  const canComputeDeterministically =
    parsedNotation != null && parsedNotation.diceTerms.length > 0 && parsedNotation.diceTerms.every((term) => term.sign > 0);
  const diceOnlyNotation = canComputeDeterministically
    ? parsedNotation.diceTerms.map((term) => `${term.count}d${term.faces}`).join("+")
    : normalizedNotation;

  setDiceResult(`${label}: rolling ${normalizedNotation}...`, false, { record: false });
  const box = await getDiceBox();
  if (!box) return;

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
    lastRollAction = { type: "notation", label, notation: normalizedNotation };
  } catch (error) {
    console.error("Dice roll failed", error);
    setDiceResult(`${label}: roll failed.`, true);
  }
}

async function rerollLastRoll() {
  if (!lastRollAction) {
    setDiceResult("No previous roll to reroll.", true);
    return;
  }

  if (lastRollAction.type === "d20") {
    await rollVisualD20(lastRollAction.label, toNumber(lastRollAction.modifier, 0));
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
    selectedEl.innerHTML = `<span class="muted">No dice selected yet.</span>`;
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

function getActiveInputSnapshot() {
  const active = document.activeElement;
  if (!active || !app.contains(active)) return null;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement)) return null;
  if (!active.id) return null;

  return {
    id: active.id,
    selectionStart: typeof active.selectionStart === "number" ? active.selectionStart : null,
    selectionEnd: typeof active.selectionEnd === "number" ? active.selectionEnd : null,
  };
}

function restoreActiveInput(snapshot) {
  if (!snapshot?.id) return;
  const next = app.querySelector(`#${snapshot.id}`);
  if (!next) return;

  next.focus();
  if (
    typeof snapshot.selectionStart === "number" &&
    typeof snapshot.selectionEnd === "number" &&
    typeof next.setSelectionRange === "function"
  ) {
    next.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }
}

function getModeToggle(mode) {
  return `
    <div class="stepper mode-toggle">
      <button data-mode="play" class="${mode === "play" ? "active" : ""}">Play</button>
      <button data-mode="build" class="${mode === "build" ? "active" : ""}">Edit</button>
    </div>
  `;
}

function getCharacterFromApiPayload(payload, fallbackId) {
  const id = payload?.id ?? fallbackId ?? null;
  if (!isUuid(id)) throw new Error("Invalid character id");
  if (!payload || typeof payload.character !== "object" || payload.character == null || Array.isArray(payload.character)) {
    throw new Error("Invalid character payload");
  }
  return {
    id,
    character: { ...payload.character, id },
  };
}

function getSyncMeta(character) {
  if (!character || typeof character !== "object" || Array.isArray(character)) return {};
  const meta = character[CHARACTER_SYNC_META_KEY];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  return meta;
}

function getCharacterVersion(character) {
  const version = Number(getSyncMeta(character).version);
  return Number.isFinite(version) && version > 0 ? Math.floor(version) : 0;
}

function getCharacterUpdatedAtMs(character) {
  const updatedAt = getSyncMeta(character).updatedAt;
  if (typeof updatedAt !== "string" || !updatedAt.trim()) return 0;
  const parsed = Date.parse(updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function withSyncMeta(character, version, updatedAt = null) {
  return {
    ...character,
    [CHARACTER_SYNC_META_KEY]: {
      version: Math.max(1, Math.floor(Number(version) || 1)),
      updatedAt: typeof updatedAt === "string" && updatedAt ? updatedAt : new Date().toISOString(),
    },
  };
}

function stripSyncMeta(character) {
  if (!character || typeof character !== "object" || Array.isArray(character)) return character;
  const next = { ...character };
  delete next[CHARACTER_SYNC_META_KEY];
  return next;
}

function buildCharacterFingerprint(character) {
  try {
    return JSON.stringify(stripSyncMeta(character) ?? {});
  } catch {
    return "";
  }
}

function compareCharacterRecency(a, b) {
  const versionDiff = getCharacterVersion(a) - getCharacterVersion(b);
  if (versionDiff !== 0) return versionDiff;
  return getCharacterUpdatedAtMs(a) - getCharacterUpdatedAtMs(b);
}

function isRemoteSameOrNewer(localCharacter, remoteCharacter) {
  if (!remoteCharacter) return false;
  if (!localCharacter) return true;
  return compareCharacterRecency(remoteCharacter, localCharacter) >= 0;
}

function setPersistenceNotice(message) {
  const nextMessage = String(message ?? "").trim();
  if (persistenceNoticeMessage === nextMessage) return;
  persistenceNoticeMessage = nextMessage;
  if (!appState.showOnboardingHome) render(store.getState());
}

function updatePersistenceStatusFromPayload(payload) {
  const storage = payload?.storage;
  if (!storage || typeof storage !== "object" || Array.isArray(storage)) return;
  if (storage.durable) {
    setPersistenceNotice("");
    return;
  }
  const detail = typeof storage.warning === "string" ? storage.warning.trim() : "";
  setPersistenceNotice(
    detail
      ? `Server persistence is running in temporary non-durable mode (${detail}). Your recent edits are currently only guaranteed in this browser.`
      : "Server persistence is running in temporary non-durable mode. Your recent edits are currently only guaranteed in this browser."
  );
}

function markBrowserOnlyPersistence(error) {
  const detail =
    error instanceof Error && error.message
      ? ` (${error.message})`
      : "";
  setPersistenceNotice(
    `Server sync is currently unavailable${detail}. Your changes are saved in this browser for now, but not confirmed on the server.`
  );
}

function renderPersistenceNotice() {
  if (!persistenceNoticeMessage) return "";
  return `<p class="muted persistence-warning">${esc(persistenceNoticeMessage)}</p>`;
}

function getClassCatalogEntry(catalogs, className) {
  const selectedName = String(className ?? "").trim().toLowerCase();
  if (!selectedName || !Array.isArray(catalogs?.classes)) return null;
  return catalogs.classes.find((entry) => String(entry?.name ?? "").trim().toLowerCase() === selectedName) ?? null;
}

function normalizeSourceTag(value) {
  return String(value ?? "").trim().toUpperCase();
}

function buildEntityId(parts) {
  return parts
    .map((part) =>
      String(part ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
    )
    .filter(Boolean)
    .join("__");
}

function parseClassFeatureToken(rawToken, fallbackSource = "", classNameHint = "") {
  const token = String(rawToken ?? "").trim();
  if (!token) return null;
  const [nameRaw = "", classNameRaw = "", classSourceRaw = "", levelRaw = "", sourceRaw = ""] = token.split("|");
  const level = toNumber(levelRaw, NaN);
  const name = cleanSpellInlineTags(nameRaw);
  if (!name) return null;
  const className = String(classNameRaw || classNameHint || "").trim();
  const source = normalizeSourceTag(sourceRaw || fallbackSource);
  return {
    id: buildEntityId(["class-feature", className, classSourceRaw, levelRaw, name, source]),
    name,
    level: Number.isFinite(level) ? level : null,
    className,
    source,
    type: "class",
  };
}

function parseSubclassFeatureToken(rawToken, fallbackSource = "", fallbackClassName = "", fallbackSubclassName = "") {
  const token = String(rawToken ?? "").trim();
  if (!token) return null;
  const [nameRaw = "", classNameRaw = "", classSourceRaw = "", subclassNameRaw = "", subclassSourceRaw = "", levelRaw = "", sourceRaw = ""] =
    token.split("|");
  const level = toNumber(levelRaw, NaN);
  const name = cleanSpellInlineTags(nameRaw);
  if (!name) return null;
  const className = String(classNameRaw || fallbackClassName || "").trim();
  const subclassName = String(subclassNameRaw || fallbackSubclassName || "").trim();
  const source = normalizeSourceTag(sourceRaw || fallbackSource || subclassSourceRaw);
  return {
    id: buildEntityId(["subclass-feature", className, classSourceRaw, subclassName, subclassSourceRaw, levelRaw, name, source]),
    name,
    level: Number.isFinite(level) ? level : null,
    className,
    subclassName,
    source,
    type: "subclass",
  };
}

function getPrimarySubclassSelection(character) {
  const subclass = character?.classSelection?.subclass;
  if (subclass && typeof subclass === "object" && String(subclass.name ?? "").trim()) {
    return {
      name: String(subclass.name ?? "").trim(),
      source: normalizeSourceTag(subclass.source),
      className: String(subclass.className ?? "").trim(),
      classSource: normalizeSourceTag(subclass.classSource),
    };
  }

  const legacyName = String(character?.subclass ?? "").trim();
  if (!legacyName) return null;
  return {
    name: legacyName,
    source: "",
    className: String(character?.class ?? "").trim(),
    classSource: "",
  };
}

function getSubclassCatalogEntries(catalogs, className, classSource = "") {
  if (!Array.isArray(catalogs?.subclasses)) return [];
  const normalizedClass = String(className ?? "").trim().toLowerCase();
  if (!normalizedClass) return [];
  const normalizedClassSource = normalizeSourceTag(classSource);
  return catalogs.subclasses
    .filter((entry) => String(entry?.className ?? "").trim().toLowerCase() === normalizedClass)
    .filter((entry) => {
      if (!normalizedClassSource) return true;
      const entryClassSource = normalizeSourceTag(entry?.classSource);
      return !entryClassSource || entryClassSource === normalizedClassSource;
    })
    .sort((a, b) => String(a?.name ?? "").localeCompare(String(b?.name ?? "")));
}

function getSelectedSubclassEntry(catalogs, character) {
  const selected = getPrimarySubclassSelection(character);
  if (!selected?.name) return null;
  const classEntry = getClassCatalogEntry(catalogs, character?.class);
  const classSource = normalizeSourceTag(classEntry?.source);
  const candidates = getSubclassCatalogEntries(catalogs, character?.class, classSource);
  const selectedName = selected.name.toLowerCase();
  const selectedSource = normalizeSourceTag(selected.source);
  return (
    candidates.find((entry) => {
      const nameMatch = String(entry?.name ?? "").trim().toLowerCase() === selectedName;
      if (!nameMatch) return false;
      if (!selectedSource) return true;
      return normalizeSourceTag(entry?.source) === selectedSource;
    }) ?? null
  );
}

function getClassLevelTracks(character) {
  const classLevels = getCharacterClassLevels(character);
  const tracks = [];
  const primaryClass = String(character?.class ?? "").trim();
  if (primaryClass) {
    tracks.push({ className: primaryClass, level: classLevels.primaryLevel, isPrimary: true });
  }
  classLevels.multiclass.forEach((entry) => {
    tracks.push({ className: String(entry.class ?? "").trim(), level: entry.level, isPrimary: false });
  });
  return tracks.filter((entry) => entry.className && entry.level > 0);
}

function getUnlockedFeatures(catalogs, character) {
  const unlocked = [];
  const tracks = getClassLevelTracks(character);

  tracks.forEach((track) => {
    const classEntry = getClassCatalogEntry(catalogs, track.className);
    if (!classEntry) return;
    const classSource = normalizeSourceTag(classEntry.source);
    const classFeatures = Array.isArray(classEntry.classFeatures) ? classEntry.classFeatures : [];
    classFeatures.forEach((featureEntry) => {
      const token = typeof featureEntry === "string" ? featureEntry : featureEntry?.classFeature;
      const parsed = parseClassFeatureToken(token, classSource, classEntry.name);
      if (!parsed || parsed.level == null || parsed.level > track.level) return;
      unlocked.push({
        ...parsed,
        className: classEntry.name,
      });
    });

    if (track.isPrimary) {
      const subclassEntry = getSelectedSubclassEntry(catalogs, character);
      if (!subclassEntry) return;
      const subclassFeatures = Array.isArray(subclassEntry.subclassFeatures) ? subclassEntry.subclassFeatures : [];
      subclassFeatures.forEach((token) => {
        const parsed = parseSubclassFeatureToken(token, subclassEntry.source, classEntry.name, subclassEntry.name);
        if (!parsed || parsed.level == null || parsed.level > track.level) return;
        unlocked.push({
          ...parsed,
          className: classEntry.name,
          subclassName: subclassEntry.name,
        });
      });
    }
  });

  const deduped = new Map();
  unlocked.forEach((feature) => {
    deduped.set(feature.id, feature);
  });
  return [...deduped.values()].sort((a, b) => {
    const levelDelta = toNumber(a.level, 0) - toNumber(b.level, 0);
    if (levelDelta !== 0) return levelDelta;
    return String(a.name).localeCompare(String(b.name));
  });
}

function getFeatSlotsForClass(classEntry, classLevel) {
  if (!classEntry || classLevel <= 0) return [];
  const slots = [];

  const featProgression = Array.isArray(classEntry.featProgression) ? classEntry.featProgression : [];
  featProgression.forEach((progressionEntry, progressionIndex) => {
    const progression = progressionEntry?.progression;
    if (!progression || typeof progression !== "object") return;
    const slotType = progressionEntry?.name ? cleanSpellInlineTags(progressionEntry.name) : "Feat";
    Object.entries(progression).forEach(([levelRaw, countRaw]) => {
      const level = toNumber(levelRaw, NaN);
      const count = Math.max(0, toNumber(countRaw, 0));
      if (!Number.isFinite(level) || level > classLevel || count <= 0) return;
      for (let idx = 0; idx < count; idx += 1) {
        const id = buildEntityId(["feat-slot", classEntry.name, classEntry.source, slotType, level, progressionIndex, idx]);
        slots.push({ id, className: classEntry.name, classSource: normalizeSourceTag(classEntry.source), level, count: 1, slotType });
      }
    });
  });

  if (slots.length) return slots;

  const classFeatures = Array.isArray(classEntry.classFeatures) ? classEntry.classFeatures : [];
  classFeatures.forEach((featureEntry, featureIndex) => {
    const token = typeof featureEntry === "string" ? featureEntry : featureEntry?.classFeature;
    const parsed = parseClassFeatureToken(token, classEntry.source, classEntry.name);
    if (!parsed || parsed.level == null || parsed.level > classLevel) return;
    if (!ASI_FEATURE_NAME_REGEX.test(parsed.name)) return;
    const id = buildEntityId(["feat-slot", classEntry.name, classEntry.source, "asi", parsed.level, featureIndex]);
    slots.push({
      id,
      className: classEntry.name,
      classSource: normalizeSourceTag(classEntry.source),
      level: parsed.level,
      count: 1,
      slotType: "Ability Score Improvement",
    });
  });
  return slots;
}

function getFeatSlots(catalogs, character) {
  const tracks = getClassLevelTracks(character);
  const slots = tracks.flatMap((track) => {
    const classEntry = getClassCatalogEntry(catalogs, track.className);
    return getFeatSlotsForClass(classEntry, track.level);
  });
  return slots.sort((a, b) => {
    const levelDelta = a.level - b.level;
    if (levelDelta !== 0) return levelDelta;
    const classDelta = String(a.className).localeCompare(String(b.className));
    if (classDelta !== 0) return classDelta;
    return String(a.slotType).localeCompare(String(b.slotType));
  });
}

function parseCountToken(value, fallback = 0) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (NUMBER_WORDS[normalized] != null) return NUMBER_WORDS[normalized];
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getClassLevelMap(character) {
  const map = new Map();
  getClassLevelTracks(character).forEach((track) => {
    const key = String(track.className ?? "").trim().toLowerCase();
    if (!key) return;
    map.set(key, Math.max(toNumber(map.get(key), 0), toNumber(track.level, 0)));
  });
  return map;
}

function getResourceRechargeHint(lines) {
  const text = lines.join(" ").toLowerCase();
  if (/once per day|once a day/.test(text)) return "day";
  if (/short or long rest/.test(text)) return "shortOrLong";
  if (/long rest/.test(text) && /short rest/.test(text)) return "shortOrLong";
  if (/long rest/.test(text)) return "long";
  if (/short rest/.test(text)) return "short";
  return "";
}

function getAdditionalThresholdsForCombatSuperiority(lines) {
  const thresholds = new Set();
  lines.forEach((line) => {
    if (!/superiority die/i.test(line)) return;
    if (!/(gain|additional|another|one more)/i.test(line)) return;

    const atLevelMatches = [...line.matchAll(/at\s+(\d{1,2})(?:st|nd|rd|th)?\s+level/gi)];
    atLevelMatches.forEach((match) => {
      const level = toNumber(match[1], 0);
      if (level > 0) thresholds.add(level);
    });

    const levelListMatch = line.match(/levels?\s+(\d{1,2})(?:\s*\([^)]+\))?(?:\s+and\s+(\d{1,2}))?/i);
    if (levelListMatch) {
      const first = toNumber(levelListMatch[1], 0);
      const second = toNumber(levelListMatch[2], 0);
      if (first > 0) thresholds.add(first);
      if (second > 0) thresholds.add(second);
    }
  });
  return [...thresholds.values()];
}

function getResourceDescriptorFromEntry(detail, fallbackName, classLevel = 0) {
  const lines = getRuleDescriptionLines(detail);
  const recharge = getResourceRechargeHint(lines);
  let max = 0;
  let resourceName = cleanSpellInlineTags(detail?.consumes?.name ?? "");

  const usesRaw = detail?.uses;
  if (usesRaw != null) {
    if (typeof usesRaw === "number") max = Math.max(0, usesRaw);
    else if (typeof usesRaw === "string") max = Math.max(0, parseCountToken(usesRaw, 0));
  }

  if (max <= 0) {
    for (const line of lines) {
      const generic = line.match(
        /you have\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+([a-z][a-z\s'-]{1,48}?)(?:,|\s+which|\s+that|\.)/i
      );
      if (!generic) continue;
      const noun = String(generic[2] ?? "").toLowerCase();
      if (!/\b(dice?|die|charge|charges|point|points|pool|use|uses|token|tokens)\b/.test(noun)) continue;
      max = parseCountToken(generic[1], 0);
      if (!resourceName) resourceName = toTitleCase(generic[2]);
      break;
    }
  }

  if (max <= 0) {
    const text = lines.join(" ").toLowerCase();
    const hasOnceUsePattern =
      /\bonce per day\b/.test(text)
      || /\bonce a day\b/.test(text)
      || /\byou can use (?:this|it) once\b/.test(text)
      || /\bonce before you finish a (?:short|long) rest\b/.test(text)
      || /\bonce you use this (?:feature|ability)\b/.test(text);
    if (hasOnceUsePattern) max = 1;
  }

  const normalizedName = String(resourceName || fallbackName || "").toLowerCase();
  if (max > 0 && /superiority die|superiority dice/.test(normalizedName)) {
    const thresholds = getAdditionalThresholdsForCombatSuperiority(lines);
    thresholds.forEach((level) => {
      if (classLevel >= level) max += 1;
    });
  }

  if (max <= 0) return null;
  if (/^spellcasting$/i.test(String(fallbackName ?? "").trim())) return null;
  return {
    name: resourceName || cleanSpellInlineTags(fallbackName || "Feature Uses"),
    max,
    recharge,
  };
}

function getAutoResourceMaxFromFeatureName(featureName) {
  const name = String(featureName ?? "").trim();
  if (!name) return 0;
  if (/action surge/i.test(name)) {
    if (/three uses/i.test(name)) return 3;
    if (/two uses/i.test(name)) return 2;
    return 1;
  }
  if (/indomitable/i.test(name)) {
    if (/three uses/i.test(name)) return 3;
    if (/two uses/i.test(name)) return 2;
    return 1;
  }
  if (/second wind/i.test(name)) return 1;
  return 0;
}

function getAutoResourcesFromFeatures(features) {
  return features
    .map((feature) => {
      const max = getAutoResourceMaxFromFeatureName(feature?.name);
      if (max <= 0) return null;
      return {
        autoId: `${AUTO_RESOURCE_ID_PREFIX}${feature.id}`,
        name: cleanSpellInlineTags(feature.name),
        current: max,
        max,
        recharge: "",
      };
    })
    .filter(Boolean);
}

function getAutoResourcesFromRules(catalogs, character, features, feats) {
  const classLevelMap = getClassLevelMap(character);
  const byId = new Map();

  features.forEach((feature) => {
    const detail = resolveFeatureEntryFromCatalogs(catalogs, feature);
    const classLevel = toNumber(classLevelMap.get(String(feature.className ?? "").trim().toLowerCase()), 0);
    const descriptor = getResourceDescriptorFromEntry(detail, feature.name, classLevel);
    if (descriptor) {
      byId.set(`${AUTO_RESOURCE_ID_PREFIX}${feature.id}`, {
        autoId: `${AUTO_RESOURCE_ID_PREFIX}${feature.id}`,
        name: descriptor.name,
        current: descriptor.max,
        max: descriptor.max,
        recharge: descriptor.recharge,
      });
      return;
    }

    const fallbackMax = getAutoResourceMaxFromFeatureName(feature?.name);
    if (fallbackMax <= 0) return;
    byId.set(`${AUTO_RESOURCE_ID_PREFIX}${feature.id}`, {
      autoId: `${AUTO_RESOURCE_ID_PREFIX}${feature.id}`,
      name: cleanSpellInlineTags(feature.name),
      current: fallbackMax,
      max: fallbackMax,
      recharge: "",
    });
  });

  (Array.isArray(feats) ? feats : []).forEach((feat) => {
    const featDetail = (catalogs?.feats ?? []).find((entry) => buildEntityId(["feat", entry?.name, entry?.source]) === feat.id);
    const descriptor = getResourceDescriptorFromEntry(featDetail, feat.name, getCharacterHighestClassLevel(character));
    if (!descriptor) return;
    byId.set(`${AUTO_RESOURCE_ID_PREFIX}${feat.id}`, {
      autoId: `${AUTO_RESOURCE_ID_PREFIX}${feat.id}`,
      name: descriptor.name,
      current: descriptor.max,
      max: descriptor.max,
      recharge: descriptor.recharge,
    });
  });

  return [...byId.values()];
}

function syncAutoFeatureUses(play, trackers) {
  const previous =
    play?.featureUses && typeof play.featureUses === "object" && !Array.isArray(play.featureUses)
      ? play.featureUses
      : {};
  const next = {};
  trackers.forEach((tracker) => {
    const key = String(tracker?.autoId ?? "").trim();
    if (!key) return;
    const prev = previous[key];
    const prevCurrent = prev && typeof prev === "object" ? toNumber(prev.current, tracker.max) : tracker.max;
    const max = Math.max(0, toNumber(tracker.max, 0));
    next[key] = {
      name: String(tracker.name ?? ""),
      max,
      current: Math.max(0, Math.min(max, prevCurrent)),
      recharge: String(tracker.recharge ?? ""),
    };
  });
  return next;
}

function syncAutoResources(play, autoResources) {
  const previousResources = Array.isArray(play?.resources) ? play.resources : [];
  const manualResources = previousResources.filter((resource) => !String(resource?.autoId ?? "").startsWith(AUTO_RESOURCE_ID_PREFIX));
  const previousAutoById = new Map(
    previousResources
      .filter((resource) => String(resource?.autoId ?? "").startsWith(AUTO_RESOURCE_ID_PREFIX))
      .map((resource) => [resource.autoId, resource])
  );
  const mergedAuto = autoResources.map((resource) => {
    const previous = previousAutoById.get(resource.autoId);
    const previousCurrent = previous ? toNumber(previous.current, resource.max) : resource.max;
    return {
      autoId: resource.autoId,
      name: resource.name,
      max: resource.max,
      recharge: resource.recharge || "",
      current: Math.max(0, Math.min(resource.max, previousCurrent)),
    };
  });
  return [...manualResources, ...mergedAuto];
}

function recomputeCharacterProgression(catalogs, character) {
  const unlockedFeatures = getUnlockedFeatures(catalogs, character);
  const featSlots = getFeatSlots(catalogs, character);
  const existingFeats = Array.isArray(character?.feats) ? character.feats : [];
  const slotIds = new Set(featSlots.map((slot) => slot.id));
  const nextFeats = existingFeats.filter((feat) => feat && feat.name && (!feat.slotId || slotIds.has(feat.slotId)));
  const selectedFeatIds = nextFeats.map((feat) => feat.id).filter(Boolean);
  const pendingFeatSlotIds = featSlots.filter((slot) => !nextFeats.some((feat) => feat.slotId === slot.id)).map((slot) => slot.id);
  return {
    unlockedFeatures,
    featSlots,
    pendingFeatSlotIds,
    selectedFeatIds,
  };
}

function resolveFeatureEntryFromCatalogs(catalogs, feature) {
  if (!feature) return null;
  const normalizedName = String(feature.name ?? "").trim().toLowerCase();
  const normalizedClassName = String(feature.className ?? "").trim().toLowerCase();
  const level = toNumber(feature.level, 0);
  const featureSource = normalizeSourceTag(feature.source);

  if (feature.type === "subclass") {
    const normalizedSubclassName = String(feature.subclassName ?? "").trim().toLowerCase();
    const matches = (catalogs?.subclassFeatures ?? []).filter((entry) => {
      const entryName = String(entry?.name ?? "").trim().toLowerCase();
      const entryClassName = String(entry?.className ?? "").trim().toLowerCase();
      const entrySubclassName = String(entry?.subclassShortName ?? "").trim().toLowerCase();
      const entryLevel = toNumber(entry?.level, 0);
      if (entryName !== normalizedName || entryClassName !== normalizedClassName || entryLevel !== level) return false;
      if (normalizedSubclassName && entrySubclassName !== normalizedSubclassName) return false;
      if (!featureSource) return true;
      return normalizeSourceTag(entry?.source) === featureSource;
    });
    return matches[0] ?? null;
  }

  const matches = (catalogs?.classFeatures ?? []).filter((entry) => {
    const entryName = String(entry?.name ?? "").trim().toLowerCase();
    const entryClassName = String(entry?.className ?? "").trim().toLowerCase();
    const entryLevel = toNumber(entry?.level, 0);
    if (entryName !== normalizedName || entryClassName !== normalizedClassName || entryLevel !== level) return false;
    if (!featureSource) return true;
    return normalizeSourceTag(entry?.source) === featureSource;
  });
  return matches[0] ?? null;
}

function getRuleDescriptionLines(entry) {
  return collectSpellEntryLines(entry?.entries ?? []).filter(Boolean);
}

function openFeatureDetailsModal(state, featureId) {
  const feature = (state.character?.progression?.unlockedFeatures ?? []).find((it) => it.id === featureId);
  if (!feature) return;
  const detail = resolveFeatureEntryFromCatalogs(state.catalogs, feature);
  const lines = getRuleDescriptionLines(detail);
  const bodyHtml = lines.length
    ? lines
        .map((line) => {
          const body = renderTextWithInlineDiceButtons(line);
          return `<p>${body}</p>`;
        })
        .join("")
    : "<p class='muted'>No description text available.</p>";
  const metaRows = [
    { label: "Type", value: feature.type === "subclass" ? "Subclass Feature" : "Class Feature" },
    { label: "Class", value: feature.className || "" },
    { label: "Subclass", value: feature.subclassName || "" },
    { label: "Level", value: feature.level ? String(feature.level) : "" },
    { label: "Source", value: detail?.sourceLabel ?? detail?.source ?? feature.source ?? "" },
  ].filter((row) => row.value);
  const close = openModal({
    title: feature.name,
    bodyHtml: `
      <div class="spell-meta-grid">
        ${metaRows.map((row) => `<div><strong>${esc(row.label)}:</strong> ${esc(row.value)}</div>`).join("")}
      </div>
      <div class="spell-description">${bodyHtml}</div>
    `,
    actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
  });
  document.querySelectorAll("[data-spell-roll]").forEach((button) => {
    button.addEventListener("click", () => {
      const notation = button.dataset.spellRoll;
      if (!notation) return;
      close();
      rollVisualNotation(feature.name, notation);
    });
  });
}

function openFeatDetailsModal(state, featId) {
  const feat = (state.character?.feats ?? []).find((it) => it.id === featId);
  if (!feat) return;
  const detail = (state.catalogs?.feats ?? []).find((entry) => buildEntityId(["feat", entry?.name, entry?.source]) === featId) ?? null;
  const lines = getRuleDescriptionLines(detail);
  const bodyHtml = lines.length
    ? lines
        .map((line) => {
          const body = renderTextWithInlineDiceButtons(line);
          return `<p>${body}</p>`;
        })
        .join("")
    : "<p class='muted'>No description text available.</p>";
  const metaRows = [
    { label: "Source", value: detail?.sourceLabel ?? detail?.source ?? feat.source ?? "" },
    { label: "Granted At Level", value: feat.levelGranted ? String(feat.levelGranted) : "" },
    { label: "Via", value: feat.via || "" },
  ].filter((row) => row.value);
  const close = openModal({
    title: feat.name,
    bodyHtml: `
      <div class="spell-meta-grid">
        ${metaRows.map((row) => `<div><strong>${esc(row.label)}:</strong> ${esc(row.value)}</div>`).join("")}
      </div>
      <div class="spell-description">${bodyHtml}</div>
    `,
    actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
  });
  document.querySelectorAll("[data-spell-roll]").forEach((button) => {
    button.addEventListener("click", () => {
      const notation = button.dataset.spellRoll;
      if (!notation) return;
      close();
      rollVisualNotation(feat.name, notation);
    });
  });
}

function getClassSaveProficiencies(catalogs, className) {
  const classEntry = getClassCatalogEntry(catalogs, className);
  const profs = classEntry?.proficiency;
  if (!Array.isArray(profs)) return {};

  return SAVE_ABILITIES.reduce((acc, ability) => {
    acc[ability] = profs.includes(ability);
    return acc;
  }, {});
}

function optionList(options, selected) {
  return options
    .map(
      (opt) =>
        `<option value="${esc(opt.name)}" ${selected === opt.name ? "selected" : ""}>${esc(opt.name)} (${esc(
          opt.sourceLabel ?? opt.source ?? "UNK"
        )})</option>`
    )
    .join("");
}

function getSubclassSelectOptions(state) {
  const classEntry = getClassCatalogEntry(state.catalogs, state.character.class);
  const selected = getPrimarySubclassSelection(state.character);
  const classSource = normalizeSourceTag(classEntry?.source);
  const options = getSubclassCatalogEntries(state.catalogs, state.character.class, classSource);
  return options.map((entry) => {
    const isSelected =
      selected &&
      String(selected.name ?? "").trim().toLowerCase() === String(entry?.name ?? "").trim().toLowerCase() &&
      (!selected.source || normalizeSourceTag(selected.source) === normalizeSourceTag(entry?.source));
    return {
      name: String(entry?.name ?? ""),
      source: String(entry?.source ?? ""),
      sourceLabel: entry?.sourceLabel ?? entry?.source ?? "",
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

function getCharacterHighestClassLevel(character) {
  const tracks = getClassLevelTracks(character);
  return tracks.reduce((highest, track) => Math.max(highest, toNumber(track.level, 0)), 0);
}

function doesCharacterMeetFeatPrerequisites(character, feat) {
  const prerequisites = Array.isArray(feat?.prerequisite) ? feat.prerequisite : [];
  if (!prerequisites.length) return true;
  const highestClassLevel = getCharacterHighestClassLevel(character);

  return prerequisites.some((entry) => {
    if (!entry || typeof entry !== "object") return true;
    const abilityRequirements = Object.entries(entry).filter(([key, value]) => ABILITY_LABELS[key] && Number.isFinite(toNumber(value, NaN)));
    const hasAbilityFailure = abilityRequirements.some(([ability, value]) => toNumber(character?.abilities?.[ability], 0) < toNumber(value, 0));
    if (hasAbilityFailure) return false;
    if (entry.level && typeof entry.level === "object") {
      const minLevel = toNumber(entry.level.level, 0);
      if (minLevel > 0 && highestClassLevel < minLevel) return false;
    }
    return true;
  });
}

function getEmptySpellSlotDefaults() {
  const defaults = Object.fromEntries(SPELL_SLOT_LEVELS.map((level) => [String(level), 0]));
  return defaults;
}

function getClassSpellSlotDefaults(catalogs, className, classLevel) {
  const defaults = getEmptySpellSlotDefaults();
  if (!catalogs || !Array.isArray(catalogs.classes)) return defaults;

  const normalizedClassName = String(className ?? "").trim().toLowerCase();
  if (!normalizedClassName) return defaults;

  const classEntry = catalogs.classes.find((entry) => String(entry?.name ?? "").trim().toLowerCase() === normalizedClassName);
  if (!classEntry || !Array.isArray(classEntry.classTableGroups)) return defaults;

  const levelIndex = Math.max(0, Math.min(19, toNumber(classLevel, 1) - 1));
  const progressionGroup = classEntry.classTableGroups.find((group) => Array.isArray(group?.rowsSpellProgression));
  const progressionRows = progressionGroup?.rowsSpellProgression;
  const row = Array.isArray(progressionRows?.[levelIndex]) ? progressionRows[levelIndex] : null;
  if (!row) return defaults;

  SPELL_SLOT_LEVELS.forEach((slotLevel, idx) => {
    defaults[String(slotLevel)] = Math.max(0, toNumber(row[idx], 0));
  });
  return defaults;
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

function getClassCasterType(catalogs, className) {
  const classKey = getClassKey(className);
  if (classKey === "warlock") return "pact";

  const rows = getSpellProgressionRows(catalogs, className);
  const level20Row = Array.isArray(rows?.[19]) ? rows[19] : null;
  if (!level20Row) return "none";

  const totalSlots = level20Row.reduce((sum, value) => sum + Math.max(0, toNumber(value, 0)), 0);
  const highestSlotLevel = level20Row.reduce((highest, value, idx) => {
    if (toNumber(value, 0) > 0) return Math.max(highest, idx + 1);
    return highest;
  }, 0);

  // Pact magic does not use multiclass spellcasting slot progression.
  if (highestSlotLevel > 0 && totalSlots <= 4) return "pact";
  if (highestSlotLevel >= 9) return "full";
  if (highestSlotLevel >= 5) return "half";
  if (highestSlotLevel >= 4) return "third";
  return "none";
}

function getClassCasterContribution(catalogs, className, classLevel) {
  const casterType = getClassCasterType(catalogs, className);
  const classKey = getClassKey(className);
  const level = Math.max(0, toNumber(classLevel, 0));
  if (casterType === "full") return level;
  if (casterType === "half") {
    if (classKey === "artificer") return Math.ceil(level / 2);
    return Math.floor(level / 2);
  }
  if (casterType === "third") return Math.floor(level / 3);
  return 0;
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
  return { totalLevel, primaryLevel, multiclass: cleanedMulticlass };
}

function getFullCasterSpellSlotsByLevel(catalogs, casterLevel) {
  const defaults = getEmptySpellSlotDefaults();
  const level = Math.max(0, Math.min(20, toNumber(casterLevel, 0)));
  if (level <= 0 || !Array.isArray(catalogs?.classes)) return defaults;

  const fullCaster = catalogs.classes.find((entry) => getClassCasterType(catalogs, entry?.name) === "full");
  const rows = getSpellProgressionRows(catalogs, fullCaster?.name);
  const row = Array.isArray(rows?.[level - 1]) ? rows[level - 1] : null;
  if (!row) return defaults;
  SPELL_SLOT_LEVELS.forEach((slotLevel, idx) => {
    defaults[String(slotLevel)] = Math.max(0, toNumber(row[idx], 0));
  });
  return defaults;
}

function getCharacterSpellSlotDefaults(catalogs, character) {
  const defaults = getEmptySpellSlotDefaults();
  const primaryClassName = String(character?.class ?? "").trim();
  if (!primaryClassName) return defaults;

  const { primaryLevel, multiclass } = getCharacterClassLevels(character);
  if (!multiclass.length) {
    return getClassSpellSlotDefaults(catalogs, primaryClassName, primaryLevel);
  }

  const casterLevel = getClassCasterContribution(catalogs, primaryClassName, primaryLevel)
    + multiclass.reduce((sum, entry) => sum + getClassCasterContribution(catalogs, entry.class, entry.level), 0);
  return getFullCasterSpellSlotsByLevel(catalogs, casterLevel);
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
        <span class="spell-slot-used">Slots <strong>${Math.max(0, max - used)}/${max}</strong></span>
      </div>
      <div class="spell-slot-controls">
        <div class="spell-slot-actions">
          <button type="button" class="spell-slot-btn" data-slot-delta="${level}" data-delta="-1" aria-label="Decrease used slots for level ${level}">-</button>
          <button type="button" class="spell-slot-btn" data-slot-delta="${level}" data-delta="1" aria-label="Increase used slots for level ${level}">+</button>
        </div>
      </div>
    </div>
  `;
}

function getSpellByName(state, spellName) {
  return state.catalogs.spells.find((spell) => spell.name === spellName) ?? null;
}

function getSpellLevelLabel(level) {
  return toNumber(level, 0) === 0 ? "Cantrip" : `Level ${toNumber(level, 0)}`;
}

function cleanSpellInlineTags(value) {
  const text = String(value ?? "");
  return text
    .replace(/\{@([a-zA-Z]+)\s+([^}]+)\}/g, (_, rawTag, rawPayload) => {
      const tag = rawTag.toLowerCase();
      const payload = String(rawPayload ?? "");
      const [primary] = payload.split("|");
      const main = String(primary ?? "").trim();
      if (!main) return "";

      if (tag === "dc") return `DC ${main}`;
      if (tag === "hit") {
        if (main.startsWith("+") || main.startsWith("-")) return `${main} to hit`;
        return `+${main} to hit`;
      }
      if (tag === "dice" || tag === "damage" || tag === "d20" || tag === "scaledice") return main;
      return main;
    })
    .replace(/\{@[a-zA-Z]+\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function collectSpellEntryLines(entry, depth = 0) {
  if (entry == null) return [];
  if (typeof entry === "string") {
    const line = cleanSpellInlineTags(entry);
    return line ? [line] : [];
  }
  if (Array.isArray(entry)) return entry.flatMap((it) => collectSpellEntryLines(it, depth));
  if (typeof entry !== "object") return [];

  const lines = [];
  const name = typeof entry.name === "string" ? cleanSpellInlineTags(entry.name) : "";

  if (Array.isArray(entry.entries)) {
    if (name) lines.push(depth > 0 ? `- ${name}:` : `${name}:`);
    lines.push(...entry.entries.flatMap((it) => collectSpellEntryLines(it, depth + 1)));
    return lines;
  }

  if (Array.isArray(entry.items)) {
    if (name) lines.push(depth > 0 ? `- ${name}:` : `${name}:`);
    entry.items.forEach((item) => {
      const itemLines = collectSpellEntryLines(item, depth + 1);
      if (!itemLines.length) return;
      const [first, ...rest] = itemLines;
      lines.push(`- ${first}`);
      rest.forEach((line) => lines.push(line));
    });
    return lines;
  }

  if (typeof entry.entry === "string") {
    const line = cleanSpellInlineTags(entry.entry);
    if (!line) return lines;
    lines.push(name ? `${name}: ${line}` : line);
    return lines;
  }

  if (typeof entry.optionalfeature === "string") {
    const line = cleanSpellInlineTags(entry.optionalfeature.split("|")[0]);
    if (line) lines.push(name ? `${name}: ${line}` : line);
    return lines;
  }

  if (typeof entry.classFeature === "string") {
    const line = cleanSpellInlineTags(entry.classFeature.split("|")[0]);
    if (line) lines.push(name ? `${name}: ${line}` : line);
    return lines;
  }

  if (typeof entry.subclassFeature === "string") {
    const line = cleanSpellInlineTags(entry.subclassFeature.split("|")[0]);
    if (line) lines.push(name ? `${name}: ${line}` : line);
    return lines;
  }

  if (typeof entry.spell === "string") {
    const line = cleanSpellInlineTags(entry.spell.split("|")[0]);
    if (line) lines.push(name ? `${name}: ${line}` : line);
    return lines;
  }

  if (typeof entry.text === "string") {
    const line = cleanSpellInlineTags(entry.text);
    if (!line) return lines;
    lines.push(name ? `${name}: ${line}` : line);
    return lines;
  }

  return lines;
}

function getSpellDescriptionLines(spell) {
  if (!spell || typeof spell !== "object") return [];
  const lines = collectSpellEntryLines(spell.entries ?? []);
  const higherLevelLines = collectSpellEntryLines(spell.entriesHigherLevel ?? []);
  if (higherLevelLines.length) {
    lines.push("At Higher Levels:");
    lines.push(...higherLevelLines);
  }
  return lines.filter(Boolean);
}

function getSpellPrimaryDiceNotation(spell) {
  const lines = getSpellDescriptionLines(spell);
  for (const line of lines) {
    DICE_NOTATION_REGEX.lastIndex = 0;
    const match = DICE_NOTATION_REGEX.exec(String(line));
    if (match?.[0]) return String(match[0]).replace(/\s+/g, "");
  }
  return "";
}

function renderTextWithInlineDiceButtons(text) {
  const source = String(text ?? "");
  DICE_NOTATION_REGEX.lastIndex = 0;
  const matches = [...source.matchAll(DICE_NOTATION_REGEX)];
  if (!matches.length) return esc(source);

  let html = "";
  let cursor = 0;
  matches.forEach((match) => {
    const notationText = String(match[0] ?? "");
    const notation = notationText.replace(/\s+/g, "");
    const index = toNumber(match.index, cursor);
    html += esc(source.slice(cursor, index));
    html += `<button type="button" class="inline-dice-btn" data-spell-roll="${esc(notation)}" title="Roll ${esc(notation)}">${esc(notationText)}</button>`;
    cursor = index + notationText.length;
  });
  html += esc(source.slice(cursor));
  return html;
}

function formatSpellTime(spell) {
  if (!Array.isArray(spell?.time) || !spell.time.length) return "";
  return spell.time
    .map((entry) => {
      const amount = entry.number == null ? "" : `${entry.number} `;
      const unit = entry.unit ? String(entry.unit) : "";
      const condition = entry.condition ? ` (${cleanSpellInlineTags(entry.condition)})` : "";
      return `${amount}${unit}${condition}`.trim();
    })
    .filter(Boolean)
    .join(", ");
}

function formatSpellRange(spell) {
  const range = spell?.range;
  if (!range || typeof range !== "object") return "";
  if (range.type === "point") {
    const distanceType = range.distance?.type ?? "";
    const distanceAmount = range.distance?.amount;
    if (!distanceType) return "Point";
    if (distanceType === "self" || distanceType === "touch" || distanceType === "sight" || distanceType === "unlimited") {
      return String(distanceType).replace(/^\w/, (char) => char.toUpperCase());
    }
    if (distanceAmount == null) return String(distanceType);
    return `${distanceAmount} ${distanceType}`;
  }
  return String(range.type ?? "");
}

function formatSpellDuration(spell) {
  if (!Array.isArray(spell?.duration) || !spell.duration.length) return "";
  return spell.duration
    .map((entry) => {
      const concentration = entry.concentration ? "Concentration, " : "";
      if (entry.type === "instant") return `${concentration}Instantaneous`;
      if (entry.type === "permanent") return `${concentration}Permanent`;
      if (entry.type === "special") return `${concentration}Special`;
      if (entry.type === "timed") {
        const amount = entry.duration?.amount;
        const unit = entry.duration?.type;
        if (amount != null && unit) return `${concentration}${amount} ${unit}`;
      }
      return concentration.trim();
    })
    .filter(Boolean)
    .join(", ");
}

function formatSpellComponents(spell) {
  const components = spell?.components;
  if (!components || typeof components !== "object") return "";
  const values = [];
  if (components.v) values.push("V");
  if (components.s) values.push("S");
  if (components.m) {
    if (typeof components.m === "string") values.push(`M (${cleanSpellInlineTags(components.m)})`);
    else if (typeof components.m === "object" && typeof components.m.text === "string") {
      values.push(`M (${cleanSpellInlineTags(components.m.text)})`);
    } else {
      values.push("M");
    }
  }
  return values.join(", ");
}

function getClassKey(className) {
  return String(className ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function normalizeAbilityKey(value) {
  const key = String(value ?? "").trim().toLowerCase();
  return ABILITY_LABELS[key] ? key : null;
}

function getClassSpellcastingAbility(catalogs, character) {
  const classEntry = getClassCatalogEntry(catalogs, character?.class);
  if (!classEntry) return null;
  const raw = classEntry.spellcastingAbility;
  if (typeof raw === "string") return normalizeAbilityKey(raw);
  if (Array.isArray(raw)) {
    for (const value of raw) {
      const ability = normalizeAbilityKey(value);
      if (ability) return ability;
    }
    return null;
  }
  return null;
}

function doesClassUsePreparedSpells(catalogs, character) {
  const classEntry = getClassCatalogEntry(catalogs, character?.class);
  return Boolean(classEntry?.preparedSpells);
}

function getPreparedSpellcastingAbility(catalogs, character) {
  if (!doesClassUsePreparedSpells(catalogs, character)) return null;
  return getClassSpellcastingAbility(catalogs, character);
}

function getPreparedSpellLimit(state) {
  if (!doesClassUsePreparedSpells(state?.catalogs, state?.character)) return Infinity;
  const ability = getPreparedSpellcastingAbility(state?.catalogs, state?.character);
  const { primaryLevel } = getCharacterClassLevels(state?.character);
  const abilityMod = ability ? toNumber(state?.derived?.mods?.[ability], 0) : 0;
  return Math.max(1, primaryLevel + abilityMod);
}

function countPreparedSpells(state, playOverride = null) {
  const play = playOverride ?? state?.character?.play ?? {};
  const selectedSpells = Array.isArray(state?.character?.spells) ? state.character.spells : [];
  return selectedSpells.reduce((count, spellName) => {
    const spell = getSpellByName(state, spellName);
    const isCantrip = toNumber(spell?.level, 0) === 0;
    if (!isCantrip && Boolean(play.preparedSpells?.[spellName])) return count + 1;
    return count;
  }, 0);
}

function toTitleCase(value) {
  return String(value ?? "")
    .replace(/[_-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function normalizeAbilityLabel(value) {
  const key = String(value ?? "").trim().toLowerCase();
  if (ABILITY_LABELS[key]) return ABILITY_LABELS[key];
  return toTitleCase(key);
}

function formatClassPrimaryAbility(classEntry) {
  const values = Array.isArray(classEntry?.primaryAbility) ? classEntry.primaryAbility : [];
  if (!values.length) return "";
  const labels = values
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const keys = Object.entries(entry)
        .filter(([, enabled]) => enabled)
        .map(([key]) => normalizeAbilityLabel(key));
      return keys.join(" / ");
    })
    .filter(Boolean);
  return labels.join(" or ");
}

function formatClassStartingSkills(classEntry) {
  const skills = classEntry?.startingProficiencies?.skills;
  if (!Array.isArray(skills) || !skills.length) return "";

  const labels = skills
    .map((entry) => {
      const choose = entry?.choose;
      if (choose && Array.isArray(choose.from)) {
        const count = toNumber(choose.count, 0);
        const fromList = choose.from.map((skill) => toTitleCase(skill)).join(", ");
        return count > 0 ? `Choose ${count}: ${fromList}` : fromList;
      }
      if (typeof entry === "string") return toTitleCase(entry);
      return "";
    })
    .filter(Boolean);

  return labels.join("; ");
}

function formatClassRequirementSet(requirements) {
  if (!requirements || typeof requirements !== "object") return "";
  const pairs = Object.entries(requirements)
    .filter(([, score]) => Number.isFinite(toNumber(score, NaN)))
    .map(([ability, score]) => `${normalizeAbilityLabel(ability)} ${toNumber(score, 0)}`);
  return pairs.join(" and ");
}

function formatClassMulticlassRequirements(classEntry) {
  const requirements = classEntry?.multiclassing?.requirements;
  if (!requirements || typeof requirements !== "object") return "";

  if (Array.isArray(requirements.or) && requirements.or.length) {
    const alternatives = requirements.or.map((set) => formatClassRequirementSet(set)).filter(Boolean);
    if (alternatives.length) return alternatives.join(" or ");
  }

  return formatClassRequirementSet(requirements);
}

function getClassFeatureRows(classEntry) {
  const features = Array.isArray(classEntry?.classFeatures) ? classEntry.classFeatures : [];
  return features
    .map((feature) => {
      const token = typeof feature === "string" ? feature : feature?.classFeature;
      const parsed = parseClassFeatureToken(token, classEntry?.source, classEntry?.name);
      if (!parsed) return null;
      return { name: parsed.name, level: parsed.level };
    })
    .filter(Boolean);
}

function openClassDetailsModal(state) {
  const className = state.character?.class;
  if (!className) {
    setDiceResult("Class details unavailable: no class selected.", true);
    return;
  }

  const classEntry = getClassCatalogEntry(state.catalogs, className);
  if (!classEntry) {
    setDiceResult(`Class details unavailable: ${className}`, true);
    return;
  }

  const currentLevel = Math.max(1, Math.min(20, toNumber(state.character?.level, 1)));
  const hitDie = classEntry?.hd?.faces ? `d${classEntry.hd.faces}` : "";
  const saveProficiencies = Array.isArray(classEntry?.proficiency)
    ? classEntry.proficiency.map((ability) => normalizeAbilityLabel(ability)).join(", ")
    : "";
  const armorProficiencies = Array.isArray(classEntry?.startingProficiencies?.armor)
    ? classEntry.startingProficiencies.armor.map((entry) => toTitleCase(entry)).join(", ")
    : "";
  const weaponProficiencies = Array.isArray(classEntry?.startingProficiencies?.weapons)
    ? classEntry.startingProficiencies.weapons.map((entry) => toTitleCase(entry)).join(", ")
    : "";
  const skillChoices = formatClassStartingSkills(classEntry);
  const primaryAbility = formatClassPrimaryAbility(classEntry);
  const multiclassRequirements = formatClassMulticlassRequirements(classEntry);

  const metaRows = [
    { label: "Source", value: classEntry.sourceLabel ?? classEntry.source ?? "" },
    { label: "Hit Die", value: hitDie },
    { label: "Primary Ability", value: primaryAbility },
    { label: "Saving Throws", value: saveProficiencies },
    { label: "Armor Proficiencies", value: armorProficiencies },
    { label: "Weapon Proficiencies", value: weaponProficiencies },
    { label: "Skill Proficiencies", value: skillChoices },
    { label: "Multiclass Requirement", value: multiclassRequirements },
  ].filter((row) => row.value);

  const progression = recomputeCharacterProgression(state.catalogs, state.character);
  const featureRows = progression.unlockedFeatures
    .filter((row) => row.level == null || row.level <= currentLevel)
    .map((row) => {
      const subtype = row.type === "subclass" ? ` (${row.subclassName || "Subclass"})` : "";
      return `<li><span class="class-feature-level">Lv ${row.level ?? "?"}</span><span>${esc(`${row.name}${subtype}`)}</span></li>`;
    })
    .join("");
  const subclassEntry = getSelectedSubclassEntry(state.catalogs, state.character);

  openModal({
    title: `${classEntry.name} Details`,
    bodyHtml: `
      <div class="spell-meta-grid">
        ${metaRows.map((row) => `<div><strong>${esc(row.label)}:</strong> ${esc(row.value)}</div>`).join("")}
      </div>
      ${
        subclassEntry
          ? `<p class="muted">Subclass: <strong>${esc(subclassEntry.name)}</strong> (${esc(subclassEntry.sourceLabel ?? subclassEntry.source ?? "Unknown source")})</p>`
          : ""
      }
      <h4>Class Features Through Level ${currentLevel}</h4>
      ${
        featureRows
          ? `<ul class="class-feature-list">${featureRows}</ul>`
          : "<p class='muted'>No class feature list available for this entry.</p>"
      }
    `,
    actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
  });
}

async function loadCatalogsForCharacter(character) {
  const sourcePreset = character?.sourcePreset ?? DEFAULT_SOURCE_PRESET;
  const catalogs = await loadCatalogs(getAllowedSources(sourcePreset));
  store.setCatalogs(catalogs);
  const nextState = store.getState();
  updateCharacterWithRequiredSettings(nextState, {}, { preserveUserOverrides: true });
}

async function applyRemoteCharacterPayload(payload, fallbackId = null, defaultMode = "build") {
  const parsed = getCharacterFromApiPayload(payload, fallbackId);
  updatePersistenceStatusFromPayload(payload);
  appState.showOnboardingHome = false;
  appState.startupErrorMessage = "";
  appState.isRemoteSaveSuppressed = true;
  try {
    store.hydrate(parsed.character);
    store.setMode(defaultMode);
    store.setStep(0);
    await loadCatalogsForCharacter(parsed.character);
  } finally {
    appState.isRemoteSaveSuppressed = false;
  }
  appState.localCharacterVersion = Math.max(appState.localCharacterVersion, getCharacterVersion(parsed.character));
  appState.localCharacterUpdatedAt =
    (typeof getSyncMeta(parsed.character).updatedAt === "string" && getSyncMeta(parsed.character).updatedAt) ||
    appState.localCharacterUpdatedAt;
  lastPersistedCharacterFingerprint = buildCharacterFingerprint(parsed.character);
  rememberLastCharacterId(parsed.id);
  upsertCharacterHistory(parsed.character, { touchAccess: true });
  currentUrlCharacterId = parsed.id;
}

function renderOnboardingHome() {
  const lastCharacterId = getLastCharacterId();
  const hasLastCharacter = Boolean(lastCharacterId);
  return `
    <main class="layout layout-onboarding">
      <section class="card">
        <div class="title-with-history">
          <h1 class="title">Character Builder</h1>
          ${renderCharacterHistorySelector("home-character-history-select", null, {
            className: "character-history-control character-history-control-inline",
          })}
        </div>
        <p class="subtitle">
          Permanent characters use UUID links. <strong>Create one, then bookmark that URL in your browser.</strong>
        </p>
        ${
          appState.startupErrorMessage
            ? `<p class="muted onboarding-warning">Could not load requested character. ${esc(appState.startupErrorMessage)}</p>`
            : ""
        }
        ${renderPersistenceNotice()}
        <div class="onboarding-actions">
          <button class="btn" id="home-create-character" type="button">Create New Character</button>
          <button class="btn secondary" id="home-open-last" type="button" ${hasLastCharacter ? "" : "disabled"}>
            Open Last Character
          </button>
          <button class="btn secondary" id="home-import-json" type="button">Import Character JSON</button>
        </div>
        <p class="muted">
          ${
            hasLastCharacter
              ? `Last local character UUID: ${esc(lastCharacterId)}`
              : "No last character found in this browser yet."
          }
        </p>
        <p class="muted">Export JSON is available in the Review step after opening or creating a character.</p>
      </section>
    </main>
  `;
}

function bindOnboardingEvents() {
  app.querySelector("#home-character-history-select")?.addEventListener("change", async (evt) => {
    const selectedId = String(evt.target.value || "").trim();
    if (!selectedId) return;
    evt.target.disabled = true;
    try {
      if (selectedId === NEW_CHARACTER_OPTION_VALUE) {
        await createAndOpenNewCharacter();
        return;
      }
      if (!isUuid(selectedId)) return;
      await switchCharacterFromHistory(selectedId);
    } finally {
      evt.target.disabled = false;
    }
  });

  app.querySelector("#home-create-character")?.addEventListener("click", async () => {
    const button = app.querySelector("#home-create-character");
    if (button) button.disabled = true;
    try {
      await createAndOpenNewCharacter();
    } catch (error) {
      appState.startupErrorMessage = error instanceof Error ? error.message : "Failed to create character";
      render(store.getState());
    } finally {
      if (button) button.disabled = false;
    }
  });

  app.querySelector("#home-open-last")?.addEventListener("click", async () => {
    const id = getLastCharacterId();
    if (!id) return;
    try {
      setCharacterIdInUrl(id, false);
      await loadCharacterById(id);
      render(store.getState());
    } catch (error) {
      appState.startupErrorMessage = error instanceof Error ? error.message : "Failed to load last character";
      clearLastCharacterId();
      appState.showOnboardingHome = true;
      render(store.getState());
    }
  });

  app.querySelector("#home-import-json")?.addEventListener("click", () => {
    openModal({
      title: "Import Character JSON",
      bodyHtml: `
        <p class="subtitle">Paste a JSON export to create a new UUID-backed character.</p>
        <textarea id="home-import-json-input" rows="14" style="width:100%; background:#0b1220; color:#e5e7eb; border:1px solid rgba(255,255,255,0.2); border-radius:10px; padding:0.6rem;"></textarea>
      `,
      actions: [
        {
          label: "Create From JSON",
          onClick: async (done) => {
            const input = document.getElementById("home-import-json-input");
            try {
              const parsed = JSON.parse(input?.value ?? "{}");
              const nextVersion = Math.max(appState.localCharacterVersion, getCharacterVersion(parsed)) + 1;
              const payload = await createCharacter(withSyncMeta(parsed, nextVersion));
              const normalized = getCharacterFromApiPayload(payload, null);
              setCharacterIdInUrl(normalized.id, false);
              await applyRemoteCharacterPayload(payload, normalized.id);
              done();
            } catch (error) {
              alert(error instanceof Error ? error.message : "Invalid JSON payload");
            }
          },
        },
        { label: "Cancel", secondary: true, onClick: (done) => done() },
      ],
    });
  });
}

function bindModeEvents() {
  app.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => store.setMode(button.dataset.mode));
  });
}

function bindCharacterHistoryEvents() {
  app.querySelectorAll("[data-character-history-select]").forEach((select) => {
    if (select.id === "home-character-history-select") return;
    select.addEventListener("change", async () => {
      const selectedId = String(select.value || "").trim();
      if (!selectedId) return;
      select.disabled = true;
      try {
        if (selectedId === NEW_CHARACTER_OPTION_VALUE) {
          await createAndOpenNewCharacter();
          return;
        }
        if (!isUuid(selectedId)) return;
        await switchCharacterFromHistory(selectedId);
      } finally {
        select.disabled = false;
      }
    });
  });
}

function withUpdatedPlay(state, updater) {
  const nextPlay = structuredClone(state.character.play ?? {});
  updater(nextPlay);
  store.updateCharacter({ play: nextPlay });
}

const pickers = createPickers({
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
  spellSchoolLabels: SPELL_SCHOOL_LABELS,
  formatSpellTime,
  formatSpellRange,
  formatSpellDuration,
  formatSpellComponents,
  getSpellDescriptionLines,
  renderTextWithInlineDiceButtons,
  rollVisualNotation,
  setDiceResult,
});

const {
  openSpellDetailsModal,
  openSpellModal,
  openItemModal,
  openFeatModal,
} = pickers;

const persistence = createPersistence({
  store,
  loadAppState,
  getCharacter,
  saveCharacter,
  createCharacter,
  isUuid,
  getCharacterVersion,
  withSyncMeta,
  getCharacterFromApiPayload,
  updatePersistenceStatusFromPayload,
  markBrowserOnlyPersistence,
  applyRemoteCharacterPayload,
  isRemoteSameOrNewer,
  setCharacterIdInUrl,
  getCharacterIdFromUrl,
  loadCatalogsForCharacter,
  render,
  persistedState,
  appState,
  defaultSourcePreset: DEFAULT_SOURCE_PRESET,
});

const { loadCharacterById, createOrSavePermanentCharacter, queueRemoteSave, bootstrap } = persistence;

const events = createEvents({
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
  diceStylePresets: DICE_STYLE_PRESETS,
});

const { bindBuildEvents, bindPlayEvents } = events;

const renderers = createRenderers({
  STEPS,
  esc,
  toNumber,
  signed,
  saveAbilities: SAVE_ABILITIES,
  abilityLabels: ABILITY_LABELS,
  skills: SKILLS,
  spellSlotLevels: SPELL_SLOT_LEVELS,
  sourcePresets: SOURCE_PRESETS,
  sourcePresetLabels: SOURCE_PRESET_LABELS,
  getAllowedSources,
  optionList,
  getSubclassSelectOptions,
  getFeatSlotsWithSelection,
  getCharacterSpellSlotDefaults,
  defaultDiceResultMessage: DEFAULT_DICE_RESULT_MESSAGE,
  renderDiceStyleOptions,
  getSpellSlotRow,
  autoResourceIdPrefix: AUTO_RESOURCE_ID_PREFIX,
  latestSpellCastStatus: () => ({
    message: uiState.latestSpellCastStatusMessage,
    isError: uiState.latestSpellCastStatusIsError,
  }),
  getSpellSlotValues,
  getSpellByName,
  getSpellLevelLabel,
  spellSchoolLabels: SPELL_SCHOOL_LABELS,
  doesClassUsePreparedSpells,
  getPreparedSpellLimit,
  countPreparedSpells,
  getSaveProficiencyLabelMap,
  getLevelUpPreview,
  getClassCasterContribution,
  renderCharacterHistorySelector,
  renderPersistenceNotice,
  getModeToggle,
});

const {
  renderBuildMode,
  renderPlayMode,
  renderSaveRows,
  renderSkillRows,
  renderBuildEditor,
  renderSummary,
  renderBuildSpellSlotRow,
  renderBuildSpellList,
  renderSpellGroupsByLevel,
  renderPlayView,
  renderLevelUpBody,
} = renderers;

function syncSpellSlotsWithDefaults(play, defaults, options = {}) {
  const preserveUserOverrides = options.preserveUserOverrides !== false;
  const nextSlots = { ...(play.spellSlots ?? {}) };
  const nextMaxOverrides = { ...(play.spellSlotMaxOverrides ?? {}) };
  const nextUserOverrides = { ...(play.spellSlotUserOverrides ?? {}) };
  const nextAutoDefaults = { ...(play.spellSlotAutoDefaults ?? {}) };

  SPELL_SLOT_LEVELS.forEach((level) => {
    const key = String(level);
    const defaultMax = Math.max(0, toNumber(defaults?.[key], 0));
    const previousSlot = nextSlots[key] ?? { max: defaultMax, used: 0 };
    const legacyOverride = nextMaxOverrides[key];
    const hasExplicitOverride = Boolean(nextUserOverrides[key]) || (nextUserOverrides[key] == null && legacyOverride != null);
    const shouldUseOverride = preserveUserOverrides && hasExplicitOverride;
    const overrideMax = toNumber(legacyOverride, defaultMax);
    const nextMax = shouldUseOverride ? Math.max(0, overrideMax) : defaultMax;

    if (shouldUseOverride) {
      nextMaxOverrides[key] = nextMax;
      nextUserOverrides[key] = true;
    } else {
      delete nextMaxOverrides[key];
      delete nextUserOverrides[key];
    }

    nextAutoDefaults[key] = defaultMax;
    nextSlots[key] = {
      max: nextMax,
      used: Math.max(0, Math.min(nextMax, toNumber(previousSlot.used, 0))),
    };
  });

  play.spellSlots = nextSlots;
  play.spellSlotMaxOverrides = nextMaxOverrides;
  play.spellSlotUserOverrides = nextUserOverrides;
  play.spellSlotAutoDefaults = nextAutoDefaults;
}

function updateCharacterWithRequiredSettings(state, patch, options = {}) {
  const nextCharacter = { ...state.character, ...patch };
  const nextPlay = structuredClone(state.character.play ?? {});
  nextPlay.saveProficiencies = getClassSaveProficiencies(state.catalogs, nextCharacter.class);
  const defaultSpellSlots = getCharacterSpellSlotDefaults(state.catalogs, nextCharacter);
  syncSpellSlotsWithDefaults(nextPlay, defaultSpellSlots, { preserveUserOverrides: options.preserveUserOverrides !== false });
  const nextProgression = recomputeCharacterProgression(state.catalogs, nextCharacter);
  const autoTrackers = getAutoResourcesFromRules(state.catalogs, nextCharacter, nextProgression.unlockedFeatures, nextCharacter.feats);
  nextPlay.featureUses = syncAutoFeatureUses(nextPlay, autoTrackers);
  nextPlay.resources = (Array.isArray(nextPlay.resources) ? nextPlay.resources : []).filter(
    (resource) => !String(resource?.autoId ?? "").startsWith(AUTO_RESOURCE_ID_PREFIX)
  );
  const selectedSubclass = getSelectedSubclassEntry(state.catalogs, nextCharacter);
  const existingSelection = nextCharacter.classSelection?.subclass ?? {};
  const classSelection = {
    subclass: {
      name: selectedSubclass?.name ?? String(existingSelection.name ?? nextCharacter.subclass ?? "").trim(),
      source: selectedSubclass?.source ?? normalizeSourceTag(existingSelection.source),
      className: selectedSubclass?.className ?? String(existingSelection.className ?? nextCharacter.class ?? "").trim(),
      classSource: selectedSubclass?.classSource ?? normalizeSourceTag(existingSelection.classSource),
    },
  };
  const subclassName = classSelection.subclass.name || "";
  store.updateCharacter({
    ...patch,
    subclass: subclassName,
    classSelection,
    progression: nextProgression,
    feats: nextCharacter.feats,
    play: nextPlay,
  });
}

function createLevelUpDraft(character) {
  const { totalLevel, multiclass } = getCharacterClassLevels(character);
  return {
    totalLevel,
    primaryClass: String(character?.class ?? "").trim(),
    multiclass: multiclass.map((entry) => ({ ...entry })),
  };
}

function sanitizeLevelUpDraft(draft) {
  const totalLevel = Math.max(1, Math.min(20, toNumber(draft?.totalLevel, 1)));
  const primaryClass = String(draft?.primaryClass ?? "").trim();
  const multiclass = (Array.isArray(draft?.multiclass) ? draft.multiclass : [])
    .map((entry) => ({
      class: String(entry?.class ?? "").trim(),
      level: Math.max(1, Math.min(20, toNumber(entry?.level, 1))),
    }))
    .filter((entry) => entry.class);
  return { totalLevel, primaryClass, multiclass };
}

function getSaveProficiencyLabelMap(saveProficiencies) {
  return SAVE_ABILITIES.filter((ability) => Boolean(saveProficiencies?.[ability])).map((ability) => ABILITY_LABELS[ability]);
}

function getLevelUpPreview(state, draft) {
  const currentCharacter = state.character;
  const nextCharacter = {
    ...currentCharacter,
    class: draft.primaryClass,
    level: draft.totalLevel,
    multiclass: draft.multiclass,
  };

  const currentSlots = getCharacterSpellSlotDefaults(state.catalogs, currentCharacter);
  const nextSlots = getCharacterSpellSlotDefaults(state.catalogs, nextCharacter);
  const changedSlotLevels = SPELL_SLOT_LEVELS.filter((level) => toNumber(currentSlots[String(level)], 0) !== toNumber(nextSlots[String(level)], 0));
  const currentSaves = getClassSaveProficiencies(state.catalogs, currentCharacter.class);
  const nextSaves = getClassSaveProficiencies(state.catalogs, nextCharacter.class);
  return {
    currentSlots,
    nextSlots,
    changedSlotLevels,
    currentSaves,
    nextSaves,
    classLevels: getCharacterClassLevels(nextCharacter),
  };
}

function openLevelUpModal(state) {
  const draft = createLevelUpDraft(state.character);
  const close = openModal({
    title: "Level Up",
    bodyHtml: `<div id="levelup-editor"></div>`,
    actions: [
      {
        label: "Apply",
        onClick: (done) => {
          const sanitized = sanitizeLevelUpDraft(draft);
          if (!sanitized.primaryClass) {
            alert("Select a primary class.");
            return;
          }
          const multiclassTotal = sanitized.multiclass.reduce((sum, entry) => sum + entry.level, 0);
          if (multiclassTotal >= sanitized.totalLevel) {
            alert("Secondary class levels must be lower than total level.");
            return;
          }
          updateCharacterWithRequiredSettings(
            state,
            {
              class: sanitized.primaryClass,
              level: sanitized.totalLevel,
              multiclass: sanitized.multiclass,
            },
            { preserveUserOverrides: true }
          );
          done();
        },
      },
      { label: "Cancel", secondary: true, onClick: (done) => done() },
    ],
  });

  const root = document.getElementById("levelup-editor");
  if (!root) return close;

  const renderEditor = () => {
    root.innerHTML = renderLevelUpBody(state, draft);
    const primaryClassEl = document.getElementById("levelup-primary-class");
    if (primaryClassEl) primaryClassEl.value = draft.primaryClass;

    document.getElementById("levelup-total-level")?.addEventListener("input", (evt) => {
      draft.totalLevel = Math.max(1, Math.min(20, toNumber(evt.target.value, 1)));
      renderEditor();
    });
    primaryClassEl?.addEventListener("change", (evt) => {
      draft.primaryClass = evt.target.value;
      renderEditor();
    });
    root.querySelector("[data-levelup-add-mc]")?.addEventListener("click", () => {
      draft.multiclass.push({ class: "", level: 1 });
      renderEditor();
    });
    root.querySelectorAll("[data-levelup-mc-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        const idx = toNumber(button.dataset.levelupMcRemove, -1);
        if (idx < 0) return;
        draft.multiclass.splice(idx, 1);
        renderEditor();
      });
    });
    root.querySelectorAll("[data-levelup-mc-class]").forEach((select) => {
      select.addEventListener("change", () => {
        const idx = toNumber(select.dataset.levelupMcClass, -1);
        if (idx < 0 || !draft.multiclass[idx]) return;
        draft.multiclass[idx].class = select.value;
        renderEditor();
      });
    });
    root.querySelectorAll("[data-levelup-mc-level]").forEach((input) => {
      input.addEventListener("input", () => {
        const idx = toNumber(input.dataset.levelupMcLevel, -1);
        if (idx < 0 || !draft.multiclass[idx]) return;
        draft.multiclass[idx].level = Math.max(1, Math.min(20, toNumber(input.value, 1)));
        renderEditor();
      });
    });
  };

  renderEditor();
  return close;
}

function openMulticlassModal(state) {
  const existing = state.character.multiclass;
  const close = openModal({
    title: "Multiclass Editor",
    bodyHtml: `
      <p class="subtitle">Add one secondary class at a time.</p>
      <div class="row">
        <label>Class
          <select id="mc-class">
            <option value="">Select class</option>
            ${optionList(state.catalogs.classes, "")}
          </select>
        </label>
        <label>Level
          <input id="mc-level" type="number" min="1" max="20" value="1">
        </label>
      </div>
      <h4>Current</h4>
      <div>${existing.length ? existing.map((m) => `<span class="pill">${esc(m.class)} ${esc(m.level)}</span>`).join(" ") : "<span class='muted'>No multiclass entries yet.</span>"}</div>
    `,
    actions: [
      {
        label: "Save",
        onClick: (done) => {
          const classEl = document.getElementById("mc-class");
          const levelEl = document.getElementById("mc-level");
          if (!classEl.value) return;
          const multiclass = [...existing, { class: classEl.value, level: Number(levelEl.value || 1) }];
          updateCharacterWithRequiredSettings(state, { multiclass }, { preserveUserOverrides: true });
          done();
        },
      },
      { label: "Close", secondary: true, onClick: (done) => done() },
    ],
  });
  return close;
}

function dockDiceOverlay(isPlayMode) {
  const overlay = document.getElementById("dice-overlay");
  if (!overlay) return;

  const playSlot = app.querySelector("#play-header-dice-slot");
  if (isPlayMode && playSlot) {
    playSlot.appendChild(overlay);
    overlay.classList.add("in-header");
    return;
  }

  if (overlay.parentElement !== document.body) {
    document.body.appendChild(overlay);
  }
  overlay.classList.remove("in-header");
}

function render(state) {
  if (appState.showOnboardingHome) {
    document.body.classList.remove("play-mode");
    app.innerHTML = renderOnboardingHome();
    bindOnboardingEvents();
    return;
  }

  const previousScrollX = window.scrollX;
  const previousScrollY = window.scrollY;
  const activeInputSnapshot = getActiveInputSnapshot();
  const isPlayMode = state.mode === "play";
  document.body.classList.toggle("play-mode", isPlayMode);

  const overlay = document.getElementById("dice-overlay");
  if (overlay && overlay.parentElement !== document.body) {
    document.body.appendChild(overlay);
  }

  app.innerHTML = state.mode === "play" ? renderPlayMode(state) : renderBuildMode(state);
  dockDiceOverlay(isPlayMode);
  applyDiceStyle();
  syncDiceResultElements();
  syncSpellCastStatusElements();
  renderRollHistory();
  bindCharacterHistoryEvents();
  bindModeEvents();
  if (isPlayMode) bindPlayEvents(state);
  else bindBuildEvents(state);
  restoreActiveInput(activeInputSnapshot);

  // Keep viewport stable across state-driven re-renders.
  const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  window.scrollTo({
    left: previousScrollX,
    top: Math.min(previousScrollY, maxScrollY),
    behavior: "auto",
  });
}

store.subscribe((state) => {
  render(state);
  const nextFingerprint = buildCharacterFingerprint(state.character);
  if (nextFingerprint && nextFingerprint !== lastPersistedCharacterFingerprint) {
    appState.localCharacterVersion += 1;
    lastPersistedCharacterFingerprint = nextFingerprint;
    appState.localCharacterUpdatedAt = new Date().toISOString();
  }
  const persistedCharacter = withSyncMeta(state.character, Math.max(1, appState.localCharacterVersion), appState.localCharacterUpdatedAt);
  saveAppState({ ...state, character: persistedCharacter });
  queueRemoteSave(state);
  if (isUuid(state.character?.id)) {
    rememberLastCharacterId(state.character.id);
    upsertCharacterHistory(state.character, { touchAccess: false });
  }
});

bootstrap().catch((error) => {
  console.error("Bootstrap failed", error);
  appState.startupErrorMessage = "Startup failed. Reload the page to try again.";
  appState.showOnboardingHome = true;
  render(store.getState());
});

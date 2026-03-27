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
import { openModal } from "./ui/modals/modal.js";

const app = document.getElementById("app");
const persistedState = loadAppState();
const store = createStore(persistedState?.character ?? createInitialCharacter());
const DICE_MODULE_URL = "https://unpkg.com/@3d-dice/dice-box@1.1.4/dist/dice-box.es.min.js";
const DICE_ASSET_ORIGIN = "https://unpkg.com/@3d-dice/dice-box@1.1.4/dist/";
const DICE_STYLE_PRESETS = {
  ember: { label: "Ember Gold", themeColor: "#f59e0b", lightIntensity: 1.05, shadowTransparency: 0.75 },
  arcane: { label: "Arcane Cyan", themeColor: "#22d3ee", lightIntensity: 1.15, shadowTransparency: 0.82 },
  forest: { label: "Forest Jade", themeColor: "#34d399", lightIntensity: 0.95, shadowTransparency: 0.72 },
  ruby: { label: "Ruby Red", themeColor: "#ef4444", lightIntensity: 1.2, shadowTransparency: 0.8 },
};
const DEFAULT_DICE_RESULT_MESSAGE = "Roll a save or skill to throw dice.";
const ROLL_HISTORY_LIMIT = 10;
const LAST_CHARACTER_ID_KEY = "fivee-last-character-id";
const CHARACTER_SYNC_META_KEY = "__syncMeta";
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let selectedDiceStyle = "arcane";
let diceBox = null;
let diceBoxPromise = null;
let latestDiceResultMessage = DEFAULT_DICE_RESULT_MESSAGE;
let latestDiceResultIsError = false;
let rollHistory = [];
let lastRollAction = null;
let latestSpellCastStatusMessage = "";
let latestSpellCastStatusIsError = false;
let spellCastStatusTimer = null;
let startupErrorMessage = "";
let showOnboardingHome = true;
let currentUrlCharacterId = null;
let isRemoteSaveSuppressed = false;
let remoteSaveTimer = null;
let persistenceNoticeMessage = "";
let lastPersistedCharacterFingerprint = "";
let localCharacterVersion = 0;
let localCharacterUpdatedAt = "";

localCharacterVersion = getCharacterVersion(persistedState?.character);
lastPersistedCharacterFingerprint = buildCharacterFingerprint(persistedState?.character ?? store.getState().character);
localCharacterUpdatedAt =
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
const PREPARED_SPELL_CLASSES = new Set(["artificer", "cleric", "druid", "paladin", "wizard"]);

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

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

function signed(value) {
  return value >= 0 ? `+${value}` : `${value}`;
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

function renderRollHistory() {
  const listEl = document.getElementById("dice-history-list");
  if (!listEl) return;

  if (!rollHistory.length) {
    listEl.innerHTML = `<div class="dice-history-empty muted">No rolls yet.</div>`;
    return;
  }

  listEl.innerHTML = rollHistory
    .map(
      (entry) => `
        <div class="dice-history-entry ${entry.isError ? "is-error" : ""}">
          <span class="dice-history-time">${esc(entry.timeLabel)}</span>
          <span class="dice-history-message">${esc(entry.message)}</span>
        </div>
      `
    )
    .join("");
}

function syncDiceResultElements() {
  const resultEls = [document.getElementById("dice-result"), document.getElementById("dice-result-inline")].filter(Boolean);
  resultEls.forEach((resultEl) => {
    resultEl.textContent = latestDiceResultMessage;
    resultEl.classList.toggle("is-error", latestDiceResultIsError);
  });
}

function syncSpellCastStatusElements() {
  const statusEl = document.getElementById("spell-cast-status");
  if (!statusEl) return;

  const hasMessage = Boolean(latestSpellCastStatusMessage);
  statusEl.hidden = !hasMessage;
  statusEl.textContent = hasMessage ? latestSpellCastStatusMessage : "";
  statusEl.classList.toggle("is-error", latestSpellCastStatusIsError);
}

function setDiceResult(message, isError = false, options = {}) {
  const shouldRecord = options.record !== false;
  latestDiceResultMessage = String(message ?? "");
  latestDiceResultIsError = Boolean(isError);
  syncDiceResultElements();

  if (!shouldRecord) return;

  rollHistory = [
    {
      message: latestDiceResultMessage,
      isError: latestDiceResultIsError,
      timeLabel: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    },
    ...rollHistory,
  ].slice(0, ROLL_HISTORY_LIMIT);
  renderRollHistory();
}

function setSpellCastStatus(message, isError = false, options = {}) {
  latestSpellCastStatusMessage = String(message ?? "");
  latestSpellCastStatusIsError = Boolean(isError);
  syncSpellCastStatusElements();
  if (spellCastStatusTimer != null) {
    clearTimeout(spellCastStatusTimer);
    spellCastStatusTimer = null;
  }

  const durationMs = toNumber(options.durationMs, 0);
  if (durationMs > 0 && latestSpellCastStatusMessage) {
    spellCastStatusTimer = setTimeout(() => {
      latestSpellCastStatusMessage = "";
      latestSpellCastStatusIsError = false;
      spellCastStatusTimer = null;
      syncSpellCastStatusElements();
    }, durationMs);
  }
}

function scrollDiceTrayIntoView() {
  const tray = document.getElementById("dice-tray");
  if (!tray) return;

  const rect = tray.getBoundingClientRect();
  const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
  if (isVisible) return;

  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const targetY = Math.max(0, window.scrollY + rect.top - 16);
  window.scrollTo({
    top: targetY,
    behavior: prefersReducedMotion ? "auto" : "smooth",
  });
}

function applyDiceStyle(box = diceBox) {
  const overlay = document.getElementById("dice-overlay");
  if (overlay) {
    overlay.dataset.diceStyle = selectedDiceStyle;
  }

  if (!box || typeof box.updateConfig !== "function") return;
  const preset = DICE_STYLE_PRESETS[selectedDiceStyle] ?? DICE_STYLE_PRESETS.ember;
  box.updateConfig({
    theme: "default",
    themeColor: preset.themeColor,
    lightIntensity: preset.lightIntensity,
    shadowTransparency: preset.shadowTransparency,
  });
}

function renderDiceStyleOptions() {
  return Object.entries(DICE_STYLE_PRESETS)
    .map(
      ([key, preset]) => `<option value="${esc(key)}" ${selectedDiceStyle === key ? "selected" : ""}>${esc(preset.label)}</option>`
    )
    .join("");
}

async function getDiceBox() {
  if (diceBox) return diceBox;
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
        gravity: 1.8,
        throwForce: 2.1,
        spinForce: 2.4,
        startingHeight: 5,
        linearDamping: 0.68,
        angularDamping: 0.68,
        settleTimeout: 900,
      });
      await box.init();
      diceBox = box;
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
  scrollDiceTrayIntoView();
  setDiceResult(`${label}: rolling ${notation}...`, false, { record: false });
  const box = await getDiceBox();
  if (!box) return null;

  try {
    const rollGroups = await box.roll(notation);
    const group = rollGroups?.[0] ?? {};
    const rawDieValue = Number(group?.rolls?.[0]?.value);
    const rawTotal = Number(group?.value);
    const hasRawTotal = Number.isFinite(rawTotal);
    const normalizedDieFromResult = Number.isFinite(rawDieValue) && rawDieValue >= 1 && rawDieValue <= 20 ? rawDieValue : null;
    const derivedDieFromTotal = hasRawTotal ? rawTotal - modifier : null;
    const dieValue =
      normalizedDieFromResult ?? (Number.isFinite(derivedDieFromTotal) && derivedDieFromTotal >= 1 && derivedDieFromTotal <= 20 ? derivedDieFromTotal : null);
    const total = hasRawTotal ? rawTotal : dieValue != null ? dieValue + modifier : null;
    setDiceResult(formatD20ResultMessage(label, modifier, dieValue, total));
    lastRollAction = { type: "d20", label, modifier };
    return {
      label,
      notation,
      modifier,
      dieValue,
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

  scrollDiceTrayIntoView();
  setDiceResult(`${label}: rolling ${cleanNotation}...`, false, { record: false });
  const box = await getDiceBox();
  if (!box) return;

  try {
    const rollGroups = await box.roll(cleanNotation);
    const group = rollGroups?.[0] ?? {};
    const rawTotal = Number(group?.value);
    const rollValues = Array.isArray(group?.rolls)
      ? group.rolls.map((it) => toNumber(it?.value, NaN)).filter((it) => Number.isFinite(it))
      : [];
    const inferredTotal = rollValues.length ? rollValues.reduce((acc, value) => acc + value, 0) : null;
    const total = Number.isFinite(rawTotal) ? rawTotal : inferredTotal;
    setDiceResult(formatNotationResultMessage(label, cleanNotation, total, rollValues));
    lastRollAction = { type: "notation", label, notation: cleanNotation };
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
      <button data-mode="play" class="${mode === "play" ? "active" : ""}">Play Mode</button>
      <button data-mode="build" class="${mode === "build" ? "active" : ""}">Edit Mode</button>
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

function choosePreferredCharacterVersion(localCharacter, remoteCharacter) {
  if (!localCharacter) return { character: remoteCharacter, source: "remote" };
  if (!remoteCharacter) return { character: localCharacter, source: "local" };
  if (compareCharacterRecency(localCharacter, remoteCharacter) > 0) {
    return { character: localCharacter, source: "local" };
  }
  return { character: remoteCharacter, source: "remote" };
}

function setPersistenceNotice(message) {
  const nextMessage = String(message ?? "").trim();
  if (persistenceNoticeMessage === nextMessage) return;
  persistenceNoticeMessage = nextMessage;
  if (!showOnboardingHome) render(store.getState());
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
      ? `Server persistence is running in temporary memory mode (${detail}). Your recent edits are currently only guaranteed in this browser.`
      : "Server persistence is running in temporary memory mode. Your recent edits are currently only guaranteed in this browser."
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

function renderSaveRows(state, options = {}) {
  const { character, derived } = state;
  const { canToggle = false, includeRollButtons = false } = options;
  const play = character.play ?? {};

  return SAVE_ABILITIES.map((ability) => {
    const score = toNumber(character.abilities?.[ability], 10);
    const mod = derived.mods[ability];
    const isProf = Boolean(play.saveProficiencies?.[ability]);
    const total = mod + (isProf ? derived.proficiencyBonus : 0);
    const abilityLabel = ABILITY_LABELS[ability] ?? ability.toUpperCase();
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
  }).join("");
}

function renderSkillRows(state, options = {}) {
  const { character, derived } = state;
  const { canToggle = false, includeRollButtons = false } = options;
  const play = character.play ?? {};

  return SKILLS.map((skill) => {
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
  }).join("");
}

function getClassCatalogEntry(catalogs, className) {
  const selectedName = String(className ?? "").trim().toLowerCase();
  if (!selectedName || !Array.isArray(catalogs?.classes)) return null;
  return catalogs.classes.find((entry) => String(entry?.name ?? "").trim().toLowerCase() === selectedName) ?? null;
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

function renderStepper(stepIndex) {
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

function renderBuildEditor(state) {
  const { character, stepIndex, catalogs } = state;
  if (stepIndex === 0) {
    return `
      <h2 class="title">Source Preset</h2>
      <p class="subtitle">Choose what books are legal in this builder run.</p>
      <label>Preset
        <select id="source-preset">
          ${Object.keys(SOURCE_PRESETS)
            .map(
              (key) =>
                `<option value="${key}" ${key === character.sourcePreset ? "selected" : ""}>${esc(
                  SOURCE_PRESET_LABELS[key] ?? key
                )}</option>`
            )
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
    `;
  }
  if (stepIndex === 3) {
    return `
      <h2 class="title">Class & Multiclass</h2>
      <div class="row">
        <label>Class
          <select id="class">
            <option value="">Select class</option>
            ${optionList(catalogs.classes, character.class)}
          </select>
        </label>
        <label>Subclass <input id="subclass" value="${esc(character.subclass)}" placeholder="e.g. Battle Master"></label>
      </div>
      <div class="toolbar">
        <button class="btn secondary" id="open-multiclass">Edit Multiclass</button>
        <button class="btn secondary" type="button" data-open-levelup>Level Up</button>
      </div>
    `;
  }
  if (stepIndex === 4) {
    const saveRows = renderSaveRows(state, { canToggle: true, includeRollButtons: false });
    const skillRows = renderSkillRows(state, { canToggle: true, includeRollButtons: false });
    return `
      <h2 class="title">Abilities</h2>
      <div class="row">
        ${Object.entries(character.abilities)
          .map(
            ([key, val]) => `
          <label>${esc(key.toUpperCase())}
            <input id="ability-${esc(key)}" type="number" min="1" max="30" data-ability="${esc(key)}" value="${esc(val)}">
          </label>
        `
          )
          .join("")}
      </div>
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
      <div>${character.inventory.map((it) => `<span class="pill">${esc(it)}</span>`).join(" ") || "<span class='muted'>No items selected.</span>"}</div>
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
        ${renderBuildSpellList(character, catalogs)}
      </div>
      <h4>Spell Slots (Edit Max)</h4>
      <p class="muted spell-prep-help">Defaults come from 5etools class progression, including multiclass caster-level rules when secondary classes are set. Override only when needed.</p>
      <div class="play-list spell-slot-grid">
        ${SPELL_SLOT_LEVELS.map((level) => renderBuildSpellSlotRow(play, defaultSpellSlots, level)).join("")}
      </div>
    `;
  }
  const permalinkUrl = character.id ? `${window.location.origin}${window.location.pathname}?char=${encodeURIComponent(character.id)}` : "";
  return `
    <h2 class="title">Review & Export</h2>
    <p class="subtitle">Copy JSON to move this sheet between machines. Permanent links use UUID URLs.</p>
    <div class="toolbar">
      <button class="btn" id="create-permanent-character">${
        character.id ? "Save Character Link" : "Create Permanent Character Link"
      }</button>
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

function renderSummary(state) {
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

function renderBuildSpellSlotRow(play, defaults, level) {
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

function getSpellByName(state, spellName) {
  return state.catalogs.spells.find((spell) => spell.name === spellName) ?? null;
}

function getSpellLevelLabel(level) {
  return toNumber(level, 0) === 0 ? "Cantrip" : `Level ${toNumber(level, 0)}`;
}

function renderBuildSpellList(character, catalogs) {
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

function doesClassUsePreparedSpells(character) {
  const classKey = getClassKey(character?.class);
  return PREPARED_SPELL_CLASSES.has(classKey);
}

function renderSpellGroupsByLevel(state) {
  const play = state.character.play ?? {};
  const defaultSpellSlots = getCharacterSpellSlotDefaults(state.catalogs, state.character);
  const usesPreparedSpells = doesClassUsePreparedSpells(state.character);
  const grouped = new Map();

  (state.character.spells ?? []).forEach((name) => {
    const spell = getSpellByName(state, name);
    const level = spell ? toNumber(spell.level, 0) : 99;
    const existing = play.preparedSpells?.[name];
    const isPrepared = usesPreparedSpells ? (existing == null ? true : Boolean(existing)) : true;
    const slotInfo = level > 0 ? getSpellSlotValues(play, defaultSpellSlots, level) : { max: Infinity, used: 0 };
    const hasSlotsAvailable = level === 0 || toNumber(slotInfo.max, 0) - toNumber(slotInfo.used, 0) > 0;
    const stateClass = !isPrepared ? "is-unprepared" : hasSlotsAvailable ? "is-prepared-available" : "is-prepared-unavailable";
    const row = { name, spell, level, isPrepared };
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
        .map(({ name, spell, isPrepared, stateClass, hasSlotsAvailable }) => {
          const school = spell?.school ? SPELL_SCHOOL_LABELS[spell.school] ?? spell.school : "";
          const source = spell?.sourceLabel ?? spell?.source ?? "";
          const meta = [school, source].filter(Boolean).join(" - ");
          const knownTag = usesPreparedSpells ? (isPrepared ? "Prepared" : "Unprepared") : "Known";
          const slotTag = toNumber(spell?.level, 0) > 0 && isPrepared ? (hasSlotsAvailable ? "Slots OK" : "No Slots") : "";
          const knownAndSlotTag = slotTag ? `${knownTag} · ${slotTag}` : knownTag;
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
                  title="Toggle prepared"
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

function renderPlayView(state) {
  const { character, derived } = state;
  const play = character.play ?? {};
  const defaultSpellSlots = getCharacterSpellSlotDefaults(state.catalogs, character);
  const hpTotal = derived.hp;
  const hpCurrent = play.hpCurrent == null ? hpTotal : play.hpCurrent;
  const hpTemp = toNumber(play.hpTemp, 0);
  const speed = toNumber(play.speed, 30);
  const initiativeBonus = toNumber(play.initiativeBonus, 0);
  const conditionText = (play.conditions ?? []).map((c) => `<span class="pill">${esc(c)}</span>`).join(" ");

  const savesHtml = renderSaveRows(state, { canToggle: false, includeRollButtons: true });
  const skillsHtml = renderSkillRows(state, { canToggle: false, includeRollButtons: true });

  const attackMode = play.attackMode === "edit" ? "edit" : "view";
  const attacksHtml = (play.attacks ?? [])
    .map((attack, idx) => {
      const attackName = attack.name?.trim() || `Attack ${idx + 1}`;
      if (attackMode === "edit") {
        return `
          <div class="attack-card">
            <div class="attack-row-top">
              <input
                id="attack-name-${idx}"
                placeholder="Attack name"
                value="${esc(attack.name ?? "")}"
                data-attack-field="${idx}:name"
              >
              <div class="attack-row-actions">
                <button type="button" class="btn secondary" data-remove-attack="${idx}">Remove</button>
              </div>
            </div>
            <div class="attack-row-stats">
              <input
                id="attack-hit-${idx}"
                placeholder="+To hit"
                value="${esc(attack.toHit ?? "")}"
                data-attack-field="${idx}:toHit"
              >
              <input
                id="attack-dmg-${idx}"
                placeholder="Damage"
                value="${esc(attack.damage ?? "")}"
                data-attack-field="${idx}:damage"
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
            <div class="pill attack-pill">To Hit: ${esc(attack.toHit || "n/a")}</div>
            <div class="pill attack-pill">Damage: ${esc(attack.damage || "n/a")}</div>
            <button type="button" class="save-mod-btn attack-roll-btn" data-attack-roll="${idx}:toHit">To Hit</button>
            <button type="button" class="save-mod-btn attack-roll-btn" data-attack-roll="${idx}:damage">Damage</button>
          </div>
        </div>
      `;
    })
    .join("");

  const resourcesHtml = (play.resources ?? []).map((resource, idx) => `
    <div class="play-grid-4">
      <input id="resource-name-${idx}" placeholder="Resource name" value="${esc(resource.name ?? "")}" data-resource-field="${idx}:name">
      <input id="resource-current-${idx}" type="number" min="0" placeholder="Current" value="${esc(resource.current ?? 0)}" data-resource-field="${idx}:current">
      <input id="resource-max-${idx}" type="number" min="0" placeholder="Max" value="${esc(resource.max ?? 0)}" data-resource-field="${idx}:max">
      <button class="btn secondary" data-remove-resource="${idx}">Remove</button>
    </div>
  `).join("");

  return `
    <section class="card">
      <div class="play-sheet-head">
        <h2 class="title">Play Sheet</h2>
        <div class="play-sheet-head-right">
          <div class="dice-result-wrap" tabindex="0" aria-label="Recent roll history">
            <div id="dice-result-inline" class="dice-result muted">${esc(DEFAULT_DICE_RESULT_MESSAGE)}</div>
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
          </div>
        </div>
      </div>
      <p class="subtitle">Live session view with quick trackers.</p>
      <div class="play-grid">
        <article class="card">
          <h3 class="title">Core Stats</h3>
          <div class="summary-grid">
            <div class="pill">HP ${hpCurrent}/${hpTotal}</div>
            <div class="pill">AC ${derived.ac}</div>
            <div class="pill">Prof +${derived.proficiencyBonus}</div>
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
                <button type="button" class="btn secondary hp-quick-btn" data-hp-delta="1" data-hp-delta-target="current">1</button>
                <button type="button" class="btn secondary hp-quick-btn" data-hp-delta="5" data-hp-delta-target="current">5</button>
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
          <h3 class="title">Attacks & Actions</h3>
          <div class="toolbar attack-mode-toolbar">
            <button type="button" class="btn secondary" data-attack-mode-toggle>
              ${attackMode === "edit" ? "Switch to View Mode" : "Switch to Edit Mode"}
            </button>
            ${attackMode === "edit" ? '<button class="btn secondary" id="add-attack">Add Attack</button>' : ""}
          </div>
          <div class="play-list">
            ${attacksHtml || "<p class='muted'>No attack entries yet.</p>"}
          </div>
        </article>

        <article class="card">
          <h3 class="title">Spells & Slots</h3>
          <div class="play-list spell-slot-grid">
            ${SPELL_SLOT_LEVELS.map((level) => getSpellSlotRow(play, defaultSpellSlots, level)).join("")}
          </div>
          <h4>Prepared/Known Spells</h4>
          <p class="muted spell-prep-help">Toggle P to mark prepared. Click a spell name to view details and roll from its description.</p>
          <div id="spell-cast-status" class="spell-cast-status ${latestSpellCastStatusIsError ? "is-error" : ""}" ${latestSpellCastStatusMessage ? "" : "hidden"}>${esc(latestSpellCastStatusMessage)}</div>
          <div class="spell-level-groups">${renderSpellGroupsByLevel(state)}</div>
        </article>

        <article class="card">
          <h3 class="title">Inventory & Conditions</h3>
          <h4>Inventory</h4>
          <div>${character.inventory.map((it) => `<span class="pill">${esc(it)}</span>`).join(" ") || "<span class='muted'>No items selected.</span>"}</div>
          <div class="play-inline-row">
            <input id="play-condition-input" placeholder="Add condition (e.g. Poisoned)">
            <button class="btn secondary" id="add-condition">Add</button>
          </div>
          <div>${conditionText || "<span class='muted'>No conditions tracked.</span>"}</div>
          <div class="play-inline-row">
            ${(play.conditions ?? [])
              .map((condition, idx) => `<button class="btn secondary" data-remove-condition="${idx}">Remove ${esc(condition)}</button>`)
              .join("")}
          </div>
          <label>Combat Notes
            <textarea id="play-notes" rows="4" style="width:100%; background:#0b1220; color:#e5e7eb; border:1px solid rgba(255,255,255,0.2); border-radius:10px; padding:0.6rem;">${esc(play.notes ?? "")}</textarea>
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
      if (!token) return null;
      const [name = "", , , levelRaw = ""] = String(token).split("|");
      const level = toNumber(levelRaw, NaN);
      if (!name.trim()) return null;
      return {
        name: cleanSpellInlineTags(name),
        level: Number.isFinite(level) ? level : null,
      };
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

  const featureRows = getClassFeatureRows(classEntry)
    .filter((row) => row.level == null || row.level <= currentLevel)
    .map((row) => `<li><span class="class-feature-level">Lv ${row.level ?? "?"}</span><span>${esc(row.name)}</span></li>`)
    .join("");

  openModal({
    title: `${classEntry.name} Details`,
    bodyHtml: `
      <div class="spell-meta-grid">
        ${metaRows.map((row) => `<div><strong>${esc(row.label)}:</strong> ${esc(row.value)}</div>`).join("")}
      </div>
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
}

async function applyRemoteCharacterPayload(payload, fallbackId = null, defaultMode = "build") {
  const parsed = getCharacterFromApiPayload(payload, fallbackId);
  updatePersistenceStatusFromPayload(payload);
  showOnboardingHome = false;
  startupErrorMessage = "";
  isRemoteSaveSuppressed = true;
  try {
    store.hydrate(parsed.character);
    store.setMode(defaultMode);
    store.setStep(0);
    await loadCatalogsForCharacter(parsed.character);
  } finally {
    isRemoteSaveSuppressed = false;
  }
  localCharacterVersion = Math.max(localCharacterVersion, getCharacterVersion(parsed.character));
  localCharacterUpdatedAt =
    (typeof getSyncMeta(parsed.character).updatedAt === "string" && getSyncMeta(parsed.character).updatedAt) ||
    localCharacterUpdatedAt;
  lastPersistedCharacterFingerprint = buildCharacterFingerprint(parsed.character);
  rememberLastCharacterId(parsed.id);
  currentUrlCharacterId = parsed.id;
}

async function loadCharacterById(characterId) {
  const payload = await getCharacter(characterId);
  updatePersistenceStatusFromPayload(payload);
  const latestLocalState = loadAppState();
  const localCharacter =
    latestLocalState?.character && latestLocalState.character.id === characterId ? latestLocalState.character : null;
  const remoteCharacter = getCharacterFromApiPayload(payload, characterId).character;
  const selected = choosePreferredCharacterVersion(localCharacter, remoteCharacter);
  const selectedPayload =
    selected.source === "local"
      ? { ...payload, id: characterId, character: localCharacter }
      : payload;
  await applyRemoteCharacterPayload(selectedPayload, characterId, "play");

  if (selected.source === "local" && localCharacter) {
    try {
      const synced = await saveCharacter(characterId, withSyncMeta(localCharacter, getCharacterVersion(localCharacter)));
      updatePersistenceStatusFromPayload(synced);
    } catch (error) {
      markBrowserOnlyPersistence(error);
    }
  }
}

async function createOrSavePermanentCharacter(state) {
  const existingId = isUuid(state.character?.id) ? state.character.id : null;
  const nextVersion = Math.max(localCharacterVersion, getCharacterVersion(state.character)) + 1;
  const versionedCharacter = withSyncMeta(state.character, nextVersion);
  if (existingId) {
    const payload = await saveCharacter(existingId, versionedCharacter);
    await applyRemoteCharacterPayload(payload, existingId);
    setCharacterIdInUrl(existingId, true);
    return existingId;
  }

  const payload = await createCharacter(versionedCharacter);
  const parsed = getCharacterFromApiPayload(payload, null);
  setCharacterIdInUrl(parsed.id, false);
  await applyRemoteCharacterPayload(payload, parsed.id);
  return parsed.id;
}

function queueRemoteSave(state) {
  if (isRemoteSaveSuppressed || showOnboardingHome) return;
  const characterId = state.character?.id;
  if (!isUuid(characterId)) return;
  if (remoteSaveTimer != null) {
    clearTimeout(remoteSaveTimer);
  }
  remoteSaveTimer = setTimeout(async () => {
    remoteSaveTimer = null;
    try {
      const latestState = store.getState();
      const nextVersion = Math.max(localCharacterVersion, getCharacterVersion(latestState.character)) + 1;
      const versionedCharacter = withSyncMeta(latestState.character, nextVersion);
      const payload = await saveCharacter(characterId, versionedCharacter);
      localCharacterVersion = Math.max(localCharacterVersion, nextVersion);
      localCharacterUpdatedAt = getSyncMeta(versionedCharacter).updatedAt ?? localCharacterUpdatedAt;
      updatePersistenceStatusFromPayload(payload);
    } catch (error) {
      console.error("Remote character save failed", error);
      markBrowserOnlyPersistence(error);
    }
  }, 700);
}

function renderOnboardingHome() {
  const lastCharacterId = getLastCharacterId();
  const hasLastCharacter = Boolean(lastCharacterId);
  return `
    <main class="layout layout-onboarding">
      <section class="card">
        <h1 class="title">Character Builder</h1>
        <p class="subtitle">
          Permanent characters use UUID links. <strong>Create one, then bookmark that URL in your browser.</strong>
        </p>
        ${
          startupErrorMessage
            ? `<p class="muted onboarding-warning">Could not load requested character. ${esc(startupErrorMessage)}</p>`
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
  app.querySelector("#home-create-character")?.addEventListener("click", async () => {
    const button = app.querySelector("#home-create-character");
    if (button) button.disabled = true;
    try {
      const character = createInitialCharacter();
      const nextVersion = Math.max(localCharacterVersion, getCharacterVersion(character)) + 1;
      const payload = await createCharacter(withSyncMeta(character, nextVersion));
      const parsed = getCharacterFromApiPayload(payload, null);
      setCharacterIdInUrl(parsed.id, false);
      await applyRemoteCharacterPayload(payload, parsed.id);
    } catch (error) {
      startupErrorMessage = error instanceof Error ? error.message : "Failed to create character";
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
      startupErrorMessage = error instanceof Error ? error.message : "Failed to load last character";
      clearLastCharacterId();
      showOnboardingHome = true;
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
              const nextVersion = Math.max(localCharacterVersion, getCharacterVersion(parsed)) + 1;
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
    });
  }

  [["#name", "name"], ["#notes", "notes"], ["#race", "race"], ["#background", "background"], ["#subclass", "subclass"]].forEach(([sel, field]) => {
    const el = app.querySelector(sel);
    if (!el) return;
    const handler = () => store.updateCharacter({ [field]: el.value });
    el.addEventListener("input", handler);
    el.addEventListener("change", handler);
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

  const classEl = app.querySelector("#class");
  if (classEl) {
    classEl.addEventListener("change", () => {
      updateCharacterWithRequiredSettings(state, { class: classEl.value || "" }, { preserveUserOverrides: true });
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
      // Prevent focus-jump/reflow while preserving click toggle behavior.
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
    } catch {
      alert("Invalid JSON payload");
    }
  });
}

function withUpdatedPlay(state, updater) {
  const nextPlay = structuredClone(state.character.play ?? {});
  updater(nextPlay);
  store.updateCharacter({ play: nextPlay });
}

function bindPlayEvents(state) {
  app.querySelectorAll("[data-open-levelup]").forEach((button) => {
    button.addEventListener("click", () => openLevelUpModal(state));
  });
  const diceStyleEl = app.querySelector("#dice-style-select");
  if (diceStyleEl) {
    diceStyleEl.addEventListener("change", () => {
      selectedDiceStyle = diceStyleEl.value in DICE_STYLE_PRESETS ? diceStyleEl.value : "arcane";
      applyDiceStyle();
    });
  }
  app.querySelector("#reroll-last-roll")?.addEventListener("click", () => {
    rerollLastRoll();
  });
  app.querySelector("[data-open-class-info]")?.addEventListener("click", () => {
    openClassDetailsModal(state);
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
        const isPrepared = current == null ? true : Boolean(current);
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
          const values = getSpellSlotValues(
            play,
            getCharacterSpellSlotDefaults(state.catalogs, state.character),
            spellLevel
          );
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
        scrollDiceTrayIntoView();
        setDiceResult(`Cast ${spell.name}: no dice notation found.`, false);
        return;
      }

      const spentText = slotSpent ? "slot spent." : "cast.";
      scrollDiceTrayIntoView();
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
          rollVisualNotation(`${attackName} to-hit`, value);
          return;
        }
        const modifier = toNumber(value, NaN);
        if (!Number.isFinite(modifier)) {
          setDiceResult(`${attackName}: invalid to-hit value.`, true);
          return;
        }
        rollVisualD20(`${attackName} to-hit`, modifier);
        return;
      }

      if (field === "damage") {
        rollVisualNotation(`${attackName} damage`, value);
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
    });
  });
}

function openSpellDetailsModal(state, spellName) {
  const spell = getSpellByName(state, spellName);
  if (!spell) {
    setDiceResult(`Spell details unavailable: ${spellName}`, true);
    return;
  }

  const metaRows = [
    { label: "Level", value: getSpellLevelLabel(spell.level) },
    { label: "School", value: SPELL_SCHOOL_LABELS[spell.school] ?? spell.school ?? "" },
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

  const close = openModal({
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
  const allSpells = state.catalogs.spells;
  const sourceOptions = [...new Set(allSpells.map((it) => it.source).filter(Boolean))].sort();
  const close = openModal({
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
      <div class="option-list" id="spell-list"></div>
    `,
    actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
  });

  const searchEl = document.getElementById("spell-search");
  const levelEl = document.getElementById("spell-level");
  const sourceEl = document.getElementById("spell-source");
  const listEl = document.getElementById("spell-list");

  function renderSpellRows() {
    const searchValue = searchEl.value.trim().toLowerCase();
    const levelValue = levelEl.value;
    const sourceValue = sourceEl.value;
    const filtered = allSpells
      .filter((spell) => !searchValue || spell.name.toLowerCase().includes(searchValue))
      .filter((spell) => !levelValue || String(spell.level ?? 0) === levelValue)
      .filter((spell) => !sourceValue || spell.source === sourceValue)
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
                <button type="button" class="btn secondary" data-pick="${esc(spell.name)}">${state.character.spells.includes(spell.name) ? "Remove" : "Add"}</button>
              </div>
            </div>
          `
          )
          .join("")
      : "<p class='muted'>No spells match these filters.</p>";

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
        if (state.character.spells.includes(spellName)) store.removeSpell(spellName);
        else store.addSpell(spellName);
        close();
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

  function renderItemRows() {
    const searchValue = searchEl.value.trim().toLowerCase();
    const sourceValue = sourceEl.value;
    const filtered = allItems
      .filter((item) => !searchValue || item.name.toLowerCase().includes(searchValue))
      .filter((item) => !sourceValue || item.source === sourceValue)
      .slice(0, 250);

    listEl.innerHTML = filtered.length
      ? filtered
          .map(
            (item) => `
            <div class="option-row">
              <div>
                <strong>${esc(item.name)}</strong>
                <div class="muted">${esc(item.sourceLabel ?? item.source)}</div>
              </div>
              <button class="btn secondary" data-item-pick="${esc(item.name)}">Add</button>
            </div>
          `
          )
          .join("")
      : "<p class='muted'>No items match these filters.</p>";

    listEl.querySelectorAll("[data-item-pick]").forEach((button) => {
      button.addEventListener("click", () => {
        store.addItem(button.dataset.itemPick);
        close();
      });
    });
  }

  [searchEl, sourceEl].forEach((el) => {
    el.addEventListener("input", renderItemRows);
    el.addEventListener("change", renderItemRows);
  });
  renderItemRows();
}

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
  store.updateCharacter({ ...patch, play: nextPlay });
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

function renderLevelUpContributionRows(catalogs, draft, classLevels) {
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

function renderLevelUpBody(state, draft) {
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
              ${renderLevelUpContributionRows(state.catalogs, draft, preview.classLevels)}
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
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

function renderBuildMode(state) {
  return `
    <main class="layout">
      <section class="card">
        <h1 class="title">Character Builder</h1>
        ${renderPersistenceNotice()}
        ${getModeToggle(state.mode)}
        ${renderStepper(state.stepIndex)}
        <div id="editor">${renderBuildEditor(state)}</div>
        <div class="toolbar">
          <button class="btn secondary" id="prev-step" ${state.stepIndex === 0 ? "disabled" : ""}>Previous</button>
          <button class="btn" id="next-step" ${state.stepIndex === STEPS.length - 1 ? "disabled" : ""}>Next</button>
        </div>
      </section>
      <aside class="card sticky">
        ${renderSummary(state)}
      </aside>
    </main>
  `;
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

function renderPlayMode(state) {
  const className = String(state.character.class ?? "").trim();
  const classHtml = className
    ? `<button type="button" class="class-info-btn" data-open-class-info title="View class details">${esc(className)}</button>`
    : "Adventurer";
  return `
    <main class="layout layout-play">
      <section>
        <div class="card">
          <div class="play-header">
            <div class="play-header-main">
              <h1 class="title">Character Builder</h1>
              ${renderPersistenceNotice()}
              ${getModeToggle(state.mode)}
              <p class="muted">
                ${esc(state.character.name || "Unnamed Hero")} - Level ${esc(state.character.level)}
                ${classHtml}
              </p>
              <div class="toolbar">
                <button class="btn secondary" type="button" data-open-levelup>Level Up</button>
              </div>
            </div>
            <div id="play-header-dice-slot" class="play-header-dice-slot"></div>
          </div>
        </div>
        ${renderPlayView(state)}
      </section>
    </main>
  `;
}

function render(state) {
  if (showOnboardingHome) {
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
    localCharacterVersion += 1;
    lastPersistedCharacterFingerprint = nextFingerprint;
    localCharacterUpdatedAt = new Date().toISOString();
  }
  const persistedCharacter = withSyncMeta(state.character, Math.max(1, localCharacterVersion), localCharacterUpdatedAt);
  saveAppState({ ...state, character: persistedCharacter });
  queueRemoteSave(state);
  if (isUuid(state.character?.id)) rememberLastCharacterId(state.character.id);
});

async function bootstrap() {
  const requestedCharacterId = getCharacterIdFromUrl();
  currentUrlCharacterId = requestedCharacterId;

  if (requestedCharacterId) {
    try {
      await loadCharacterById(requestedCharacterId);
      return;
    } catch (error) {
      startupErrorMessage = error instanceof Error ? error.message : "Failed to load character";
      showOnboardingHome = true;
    }
  } else {
    showOnboardingHome = true;
  }

  if (!showOnboardingHome) {
    if (persistedState?.mode === "play") store.setMode("play");
    if (Number.isFinite(persistedState?.stepIndex)) store.setStep(persistedState.stepIndex);
    const sourcePreset = persistedState?.character?.sourcePreset ?? DEFAULT_SOURCE_PRESET;
    await loadCatalogsForCharacter({ sourcePreset });
    return;
  }

  render(store.getState());
}

bootstrap().catch((error) => {
  console.error("Bootstrap failed", error);
  startupErrorMessage = "Startup failed. Reload the page to try again.";
  showOnboardingHome = true;
  render(store.getState());
});

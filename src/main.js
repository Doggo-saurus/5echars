import {
  DEFAULT_SOURCE_PRESET,
  SOURCE_LABELS,
  SOURCE_PRESETS,
  SOURCE_PRESET_LABELS,
  getAllowedSources,
} from "./config/sources.js";
import { isCatalogDataSrdOnly, loadAvailableSourceEntries, loadAvailableSources, loadCatalogs } from "./data-loader.js";
import { STEPS, createInitialCharacter, createStore } from "./state/character-store.js";
import { loadAppState, saveAppState } from "./state/persistence.js";
import {
  createCharacter,
  flushPendingCharacterSync,
  getCharacter,
  getCharacterEditPassword,
  saveCharacter,
  validateCharacterEditPassword,
} from "./character-api.js";
import { createPersistence } from "./app/persistence.js";
import { createDiceUi } from "./dice/index.js";
import { openModal } from "./ui/modals/modal.js";
import { createEvents } from "./ui/events.js";
import { createPickers } from "./ui/pickers.js";
import { createRenderers } from "./ui/renderers.js";
import { getCharacterFightingStyleSet, getHitPointBreakdown } from "./engine/rules.js";
import {
  esc,
  matchesSearchQuery,
  signed,
  toNumber,
} from "./ui/formatters.js";

const app = document.getElementById("app");
const persistedState = loadAppState();
const store = createStore(persistedState?.character ?? createInitialCharacter());
const DICE_MODULE_SOURCES = [
  {
    moduleUrl: "https://unpkg.com/@3d-dice/dice-box@1.1.4/dist/dice-box.es.min.js",
    assetOrigin: "https://unpkg.com/@3d-dice/dice-box@1.1.4/dist/",
  },
  {
    moduleUrl: "/src/vendor/local-dice-box.js",
    assetOrigin: window.location.origin,
  },
];
const DICE_STYLE_PRESETS = {
  ember: { label: "Ember Gold", themeColor: "#f59e0b", lightIntensity: 1.05, shadowTransparency: 0.75 },
  arcane: { label: "Arcane Cyan", themeColor: "#0891b2", lightIntensity: 1.05, shadowTransparency: 0.78 },
  forest: { label: "Forest Jade", themeColor: "#15803d", lightIntensity: 0.9, shadowTransparency: 0.68 },
  ruby: { label: "Ruby Red", themeColor: "#ef4444", lightIntensity: 1.2, shadowTransparency: 0.8 },
};
const DEFAULT_DICE_RESULT_MESSAGE = "Roll a save or skill to throw dice.";
const ROLL_HISTORY_LIMIT = 10;
const CHARACTER_CHANGE_LOG_LIMIT = 200;
const CHARACTER_CHANGE_LOG_KEY = "characterLog";
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
  characterChangeLog: [],
  lastCharacterSnapshot: null,
  lastCharacterLogFingerprint: "",
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
const { srd: srdPresetSources = [], ...nonSrdSourcePresets } = SOURCE_PRESETS;
const { srd: srdPresetLabel = "SRD", ...nonSrdSourcePresetLabels } = SOURCE_PRESET_LABELS;
let runtimeSourcePresets = { ...nonSrdSourcePresets };
let runtimeSourcePresetLabels = { ...nonSrdSourcePresetLabels };
let sourcePresetRuntimeReady = false;

function getRuntimeDefaultSourcePreset() {
  if (runtimeSourcePresets[DEFAULT_SOURCE_PRESET]) return DEFAULT_SOURCE_PRESET;
  const [firstPreset] = Object.keys(runtimeSourcePresets);
  return firstPreset ?? DEFAULT_SOURCE_PRESET;
}

function resolveRuntimeSourcePreset(presetKey) {
  const normalized = String(presetKey ?? "").trim();
  if (normalized && runtimeSourcePresets[normalized]) return normalized;
  return getRuntimeDefaultSourcePreset();
}

async function ensureRuntimeSourcePresets() {
  if (sourcePresetRuntimeReady) return;
  const srdOnly = await isCatalogDataSrdOnly();
  if (srdOnly) {
    runtimeSourcePresets = { srd: srdPresetSources };
    runtimeSourcePresetLabels = { srd: srdPresetLabel };
  }
  sourcePresetRuntimeReady = true;
}

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
seedCharacterLogState(store.getState().character);
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

const SKILL_KEY_BY_CANONICAL = SKILLS.reduce((acc, skill) => {
  const keyToken = String(skill.key ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  const labelToken = String(skill.label ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (keyToken) acc[keyToken] = skill.key;
  if (labelToken) acc[labelToken] = skill.key;
  return acc;
}, {});

const SKILL_PROFICIENCY_NONE = "none";
const SKILL_PROFICIENCY_HALF = "half";
const SKILL_PROFICIENCY_PROFICIENT = "proficient";
const SKILL_PROFICIENCY_EXPERTISE = "expertise";
const SKILL_PROFICIENCY_MODES = [
  SKILL_PROFICIENCY_NONE,
  SKILL_PROFICIENCY_HALF,
  SKILL_PROFICIENCY_PROFICIENT,
  SKILL_PROFICIENCY_EXPERTISE,
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

function buildClassLevelSummary(character, fallbackClassName = "", fallbackLevel = 1) {
  if (character && typeof character === "object" && !Array.isArray(character)) {
    const primaryClassName = String(character.class ?? "").trim();
    const { primaryLevel, multiclass } = getCharacterClassLevels(character);
    const parts = [];
    if (primaryClassName) parts.push(`Level ${primaryLevel} ${primaryClassName}`);
    multiclass.forEach((entry) => {
      const className = String(entry?.class ?? "").trim();
      if (!className) return;
      const level = Math.max(1, Math.min(20, toNumber(entry?.level, 1)));
      parts.push(`Level ${level} ${className}`);
    });
    if (parts.length) return parts.join(", ");
  }

  const className = String(fallbackClassName ?? "").trim() || "Adventurer";
  const level = Math.max(1, Math.min(20, toNumber(fallbackLevel, 1)));
  return `Level ${level} ${className}`;
}

function formatCharacterHistoryEntrySummary(entry) {
  const name = getCharacterDisplayName(entry?.name);
  const classSummary = String(entry?.classSummary ?? "").trim() || buildClassLevelSummary(null, entry?.className, entry?.level);
  return `${name} (${classSummary})`;
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
      const classSummary = String(entry?.classSummary ?? "").trim();
      const lastAccessedAt = typeof entry?.lastAccessedAt === "string" ? entry.lastAccessedAt : "";
      return { id, name, level, className, classSummary, lastAccessedAt };
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
  const nextClassSummary = buildClassLevelSummary(character, current?.className, current?.level ?? nextLevel);

  if (!current) {
    saveCharacterHistory([
      {
        id,
        name: nextName,
        level: nextLevel,
        className: nextClassName,
        classSummary: nextClassSummary,
        lastAccessedAt: new Date().toISOString(),
      },
      ...entries,
    ]);
    return;
  }

  if (!shouldTouchAccess) {
    saveCharacterHistory(
      entries.map((entry) =>
        entry.id === id
          ? { ...entry, name: nextName, level: nextLevel, className: nextClassName, classSummary: nextClassSummary }
          : entry
      )
    );
    return;
  }

  const withoutCurrent = entries.filter((entry) => entry.id !== id);
  saveCharacterHistory([
    {
      id,
      name: nextName,
      level: nextLevel,
      className: nextClassName,
      classSummary: nextClassSummary,
      lastAccessedAt: new Date().toISOString(),
    },
    ...withoutCurrent,
  ]);
}

function readFileText(file) {
  if (!file || typeof file.text !== "function") throw new Error("Choose a JSON file to import.");
  return file.text();
}

function sanitizeFileNamePart(value) {
  const parsed = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return parsed || "character";
}

function exportCharacterToJsonFile(character) {
  if (!character || typeof character !== "object" || Array.isArray(character)) {
    throw new Error("No character available to export.");
  }
  const fileNameBase = sanitizeFileNamePart(character.name);
  const blob = new Blob([JSON.stringify(character, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileNameBase}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function doesRemoteCharacterExist(id) {
  if (!isUuid(id)) return false;
  try {
    await getCharacter(id);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 404) return false;
    throw error;
  }
}

function buildImportOverwriteMessage(importedId, options = {}) {
  const sourceLabel = String(options.sourceLabel ?? "Import");
  const isCurrentCharacter = Boolean(options.isCurrentCharacter);
  const displayName = String(options.displayName ?? "").trim();
  const targetLabel = isCurrentCharacter
    ? `the currently open character${displayName ? ` (${displayName})` : ""}`
    : `another saved character${displayName ? ` (${displayName})` : ""}`;
  return (
    `${sourceLabel} warning:\n\n` +
    `UUID ${importedId} already exists and importing will overwrite ${targetLabel}.\n\n` +
    "Do you want to continue?"
  );
}

async function importCharacterFromParsedJson(parsed, options = {}) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid JSON payload");
  }

  const sourceLabel = String(options.sourceLabel ?? "Import");
  const importedId = isUuid(parsed.id) ? parsed.id : null;
  const currentId = isUuid(store.getState().character?.id) ? store.getState().character.id : null;
  const nextVersion = Math.max(appState.localCharacterVersion, getCharacterVersion(parsed)) + 1;
  const preparedCharacter = withSyncMeta(withCharacterChangeLog(parsed), nextVersion);

  if (importedId) {
    const isCurrentCharacter = importedId === currentId;
    const existingHistoryEntry = loadCharacterHistory().find((entry) => entry.id === importedId) ?? null;
    const existsRemotely = await doesRemoteCharacterExist(importedId);
    if (isCurrentCharacter || existsRemotely) {
      const displayName = isCurrentCharacter
        ? getCharacterDisplayName(store.getState().character?.name)
        : getCharacterDisplayName(existingHistoryEntry?.name);
      const shouldContinue = window.confirm(
        buildImportOverwriteMessage(importedId, {
          sourceLabel,
          isCurrentCharacter,
          displayName,
        })
      );
      if (!shouldContinue) return { cancelled: true, id: importedId };
    }

    const payload = existsRemotely
      ? await saveCharacter(importedId, { ...preparedCharacter, id: importedId })
      : await createCharacter({ ...preparedCharacter, id: importedId });
    const normalized = getCharacterFromApiPayload(payload, importedId);
    setCharacterIdInUrl(normalized.id, false);
    await applyRemoteCharacterPayload(payload, normalized.id);
    return { cancelled: false, id: normalized.id };
  }

  const payload = await createCharacter(preparedCharacter);
  const normalized = getCharacterFromApiPayload(payload, null);
  setCharacterIdInUrl(normalized.id, false);
  await applyRemoteCharacterPayload(payload, normalized.id);
  return { cancelled: false, id: normalized.id };
}

async function importCharacterFromJsonFile(file, options = {}) {
  const text = await readFileText(file);
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON payload");
  }
  return importCharacterFromParsedJson(parsed, options);
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
            const label = formatCharacterHistoryEntrySummary(entry);
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
  const payload = await createCharacter(withSyncMeta(withCharacterChangeLog(character), nextVersion));
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
            assetPath: "assets/",
            origin: source.assetOrigin,
            theme: "default",
            scale: 12,
            // Punchier throws: stronger launch/spin with lower damping for more bounce.
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
          applyDiceStyle(box);
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
  const physicalNotation = notationBase;
  setDiceResult(`${label}: rolling ${notation}...`, false, { record: false });
  const box = await getDiceBox();
  if (!box) return null;

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
  const box = await getDiceBox();
  if (!box) return null;

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

function sanitizeCharacterLogEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const summaryParts = Array.isArray(entry.summaryParts)
    ? entry.summaryParts
        .map((part) => {
          const text = String(part?.text ?? "");
          if (!text) return null;
          const style = part?.style === "bold" || part?.style === "highlight" ? part.style : "plain";
          return { text, style };
        })
        .filter(Boolean)
    : [];
  const details = Array.isArray(entry.details)
    ? entry.details
        .map((row) => {
          const label = String(row?.label ?? "").trim();
          const before = String(row?.before ?? "").trim();
          const after = String(row?.after ?? "").trim();
          if (!label && !before && !after) return null;
          return { label, before: before || "empty", after: after || "empty" };
        })
        .filter(Boolean)
    : [];
  const at = typeof entry.at === "string" && entry.at ? entry.at : new Date().toISOString();
  const rawSectionLabel = String(entry.sectionLabel ?? "").trim() || "Character";
  const sectionKey = String(entry.sectionKey ?? "").trim() || "character";
  const sectionLabel = sectionKey === "play" && rawSectionLabel.toLowerCase() === "play state"
    ? "Character Sheet"
    : rawSectionLabel;
  return {
    id: String(entry.id ?? "").trim() || createCharacterLogEntryId(),
    at,
    sectionKey,
    sectionLabel,
    summaryParts: summaryParts.length ? summaryParts : [{ text: "Updated character", style: "plain" }],
    details,
  };
}

function loadCharacterChangeLog(character) {
  const raw = character?.play?.[CHARACTER_CHANGE_LOG_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => sanitizeCharacterLogEntry(entry)).filter(Boolean).slice(0, CHARACTER_CHANGE_LOG_LIMIT);
}

function withCharacterChangeLog(character) {
  const nextCharacter = character && typeof character === "object" && !Array.isArray(character) ? { ...character } : {};
  const nextPlay = nextCharacter.play && typeof nextCharacter.play === "object" && !Array.isArray(nextCharacter.play)
    ? { ...nextCharacter.play }
    : {};
  nextPlay[CHARACTER_CHANGE_LOG_KEY] = uiState.characterChangeLog.slice(0, CHARACTER_CHANGE_LOG_LIMIT);
  nextCharacter.play = nextPlay;
  return nextCharacter;
}

function seedCharacterLogState(character) {
  uiState.characterChangeLog = loadCharacterChangeLog(character);
  uiState.lastCharacterSnapshot = stripSyncMeta(character) ?? null;
  uiState.lastCharacterLogFingerprint = buildCharacterFingerprint(character);
}

function createCharacterLogEntryId() {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `clog_${stamp}_${rand}`;
}

function getCharacterLogSectionLabel(sectionKey) {
  const labels = {
    id: "Character ID",
    name: "Name",
    level: "Level",
    sourcePreset: "Source Preset",
    race: "Race",
    background: "Background",
    class: "Class",
    subclass: "Subclass",
    abilities: "Abilities",
    abilityBase: "Base Abilities",
    inventory: "Inventory",
    spells: "Spells",
    feats: "Feats",
    optionalFeatures: "Optional Features",
    notes: "Notes",
    multiclass: "Multiclass",
    classSelection: "Subclass Selection",
    progression: "Progression",
    hitPointRollOverrides: "Hit Point Rolls",
    play: "Character Sheet",
  };
  return labels[sectionKey] ?? toTitleCase(String(sectionKey ?? "Character"));
}

function serializeForDiff(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
}

function truncateLogValue(value, maxLength = 64) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function summarizeLogValue(value) {
  if (value == null) return "empty";
  if (typeof value === "string") {
    const parsed = value.trim();
    return parsed ? truncateLogValue(`"${parsed}"`) : "empty";
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") {
    const size = Object.keys(value).length;
    return `${size} field${size === 1 ? "" : "s"}`;
  }
  return truncateLogValue(String(value));
}

function isPlainLogValue(value) {
  return value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function buildSummaryPartsForSimpleChange(sectionLabel, beforeValue, afterValue) {
  return [
    { text: "Updated ", style: "plain" },
    { text: sectionLabel, style: "highlight" },
    { text: ": ", style: "plain" },
    { text: summarizeLogValue(beforeValue), style: "bold" },
    { text: " -> ", style: "plain" },
    { text: summarizeLogValue(afterValue), style: "bold" },
  ];
}

function normalizeLogRowValue(value) {
  if (value == null) return "empty";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return truncateLogValue(value, 80);
  return summarizeLogValue(value);
}

function buildObjectChangeRows(beforeValue, afterValue, maxRows = 8) {
  const beforeObj = beforeValue && typeof beforeValue === "object" && !Array.isArray(beforeValue) ? beforeValue : {};
  const afterObj = afterValue && typeof afterValue === "object" && !Array.isArray(afterValue) ? afterValue : {};
  const allKeys = [...new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])];
  const changedKeys = allKeys.filter((key) => serializeForDiff(beforeObj[key]) !== serializeForDiff(afterObj[key]));
  const visibleKeys = changedKeys.slice(0, maxRows);
  const rows = visibleKeys.map((key) => ({
    label: key,
    before: normalizeLogRowValue(beforeObj[key]),
    after: normalizeLogRowValue(afterObj[key]),
  }));
  if (changedKeys.length > visibleKeys.length) {
    rows.push({
      label: "more",
      before: `${changedKeys.length - visibleKeys.length} additional changes`,
      after: "…",
    });
  }
  return rows;
}

function buildArrayChangeRows(beforeValue, afterValue) {
  const beforeList = Array.isArray(beforeValue) ? beforeValue : [];
  const afterList = Array.isArray(afterValue) ? afterValue : [];
  const rows = [
    {
      label: "count",
      before: String(beforeList.length),
      after: String(afterList.length),
    },
  ];
  const primitiveToken = (value) =>
    value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
  if (!beforeList.every(primitiveToken) || !afterList.every(primitiveToken)) return rows;
  const beforeSet = new Set(beforeList.map((value) => String(value)));
  const afterSet = new Set(afterList.map((value) => String(value)));
  const added = [...afterSet].filter((value) => !beforeSet.has(value)).slice(0, 3);
  const removed = [...beforeSet].filter((value) => !afterSet.has(value)).slice(0, 3);
  if (added.length) rows.push({ label: "added", before: "-", after: truncateLogValue(added.join(", "), 80) });
  if (removed.length) rows.push({ label: "removed", before: truncateLogValue(removed.join(", "), 80), after: "-" });
  return rows;
}

function getLogEntityName(entry) {
  if (entry == null) return null;
  if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") return String(entry);
  if (typeof entry !== "object" || Array.isArray(entry)) return null;
  const byName = String(entry.name ?? "").trim();
  if (byName) return byName;
  const byClass = String(entry.class ?? "").trim();
  if (byClass) return byClass;
  const byId = String(entry.id ?? "").trim();
  if (byId) return byId;
  return null;
}

function buildNamedArrayRows(beforeValue, afterValue) {
  const beforeList = Array.isArray(beforeValue) ? beforeValue : [];
  const afterList = Array.isArray(afterValue) ? afterValue : [];
  const beforeNames = beforeList.map((entry) => getLogEntityName(entry)).filter(Boolean);
  const afterNames = afterList.map((entry) => getLogEntityName(entry)).filter(Boolean);
  const rows = [{ label: "count", before: String(beforeList.length), after: String(afterList.length) }];
  if (!beforeNames.length && !afterNames.length) return rows;
  const beforeSet = new Set(beforeNames);
  const afterSet = new Set(afterNames);
  const added = [...afterSet].filter((name) => !beforeSet.has(name)).slice(0, 3);
  const removed = [...beforeSet].filter((name) => !afterSet.has(name)).slice(0, 3);
  if (added.length) rows.push({ label: "added", before: "-", after: truncateLogValue(added.join(", "), 80) });
  if (removed.length) rows.push({ label: "removed", before: truncateLogValue(removed.join(", "), 80), after: "-" });
  return rows;
}

function buildStructuredChangeRows(beforeValue, afterValue) {
  if (Array.isArray(beforeValue) || Array.isArray(afterValue)) {
    const namedRows = buildNamedArrayRows(beforeValue, afterValue);
    if (namedRows.length > 1) return namedRows;
    return buildArrayChangeRows(beforeValue, afterValue);
  }
  if (
    (beforeValue && typeof beforeValue === "object" && !Array.isArray(beforeValue))
    || (afterValue && typeof afterValue === "object" && !Array.isArray(afterValue))
  ) {
    return buildObjectChangeRows(beforeValue, afterValue);
  }
  return [];
}

function buildAbilityChangeRows(beforeValue, afterValue) {
  const rows = [];
  const abilityKeys = ["str", "dex", "con", "int", "wis", "cha"];
  abilityKeys.forEach((ability) => {
    const beforeScore = toNumber(beforeValue?.[ability], Number.NaN);
    const afterScore = toNumber(afterValue?.[ability], Number.NaN);
    if (!Number.isFinite(beforeScore) && !Number.isFinite(afterScore)) return;
    if (beforeScore === afterScore) return;
    rows.push({
      label: ABILITY_LABELS[ability] ?? ability.toUpperCase(),
      before: Number.isFinite(beforeScore) ? String(beforeScore) : "empty",
      after: Number.isFinite(afterScore) ? String(afterScore) : "empty",
    });
  });
  return rows;
}

function buildPlayStateRows(beforeValue, afterValue) {
  const beforePlay = beforeValue && typeof beforeValue === "object" && !Array.isArray(beforeValue) ? beforeValue : {};
  const afterPlay = afterValue && typeof afterValue === "object" && !Array.isArray(afterValue) ? afterValue : {};
  const rows = [];
  const fieldMap = [
    { key: "hpCurrent", label: "HP" },
    { key: "hpTemp", label: "Temp HP" },
    { key: "speed", label: "Speed" },
    { key: "initiativeBonus", label: "Initiative" },
    { key: "deathSavesSuccess", label: "Death Saves (Success)" },
    { key: "deathSavesFail", label: "Death Saves (Fail)" },
  ];
  fieldMap.forEach((field) => {
    const beforeField = beforePlay[field.key];
    const afterField = afterPlay[field.key];
    if (serializeForDiff(beforeField) === serializeForDiff(afterField)) return;
    rows.push({
      label: field.label,
      before: summarizeLogValue(beforeField),
      after: summarizeLogValue(afterField),
    });
  });
  const conditionRows = buildNamedArrayRows(beforePlay.conditions, afterPlay.conditions);
  if (conditionRows.length > 1) {
    conditionRows.forEach((row) => rows.push({ ...row, label: row.label === "count" ? "Conditions" : row.label }));
  }
  return rows.slice(0, 8);
}

function buildPlayerFacingChangeEntry(key, beforeValue, afterValue, timestamp) {
  const sectionLabel = getCharacterLogSectionLabel(key);
  if (isPlainLogValue(beforeValue) && isPlainLogValue(afterValue)) {
    return {
      id: createCharacterLogEntryId(),
      at: timestamp,
      sectionKey: key,
      sectionLabel,
      summaryParts: buildSummaryPartsForSimpleChange(sectionLabel, beforeValue, afterValue),
      details: [],
    };
  }
  if (key === "abilities") {
    const abilityRows = buildAbilityChangeRows(beforeValue, afterValue);
    return {
      id: createCharacterLogEntryId(),
      at: timestamp,
      sectionKey: key,
      sectionLabel,
      summaryParts: [
        { text: "Updated ", style: "plain" },
        { text: "ability scores", style: "highlight" },
      ],
      details: abilityRows,
    };
  }
  if (key === "inventory" || key === "spells" || key === "feats" || key === "optionalFeatures" || key === "multiclass") {
    const nounMap = {
      inventory: "inventory",
      spells: "spells",
      feats: "feats",
      optionalFeatures: "optional features",
      multiclass: "class levels",
    };
    return {
      id: createCharacterLogEntryId(),
      at: timestamp,
      sectionKey: key,
      sectionLabel,
      summaryParts: [
        { text: "Updated ", style: "plain" },
        { text: nounMap[key] ?? sectionLabel.toLowerCase(), style: "highlight" },
      ],
      details: buildNamedArrayRows(beforeValue, afterValue),
    };
  }
  if (key === "play") {
    return {
      id: createCharacterLogEntryId(),
      at: timestamp,
      sectionKey: key,
      sectionLabel,
      summaryParts: [
        { text: "Updated ", style: "plain" },
        { text: "character sheet stats", style: "highlight" },
      ],
      details: buildPlayStateRows(beforeValue, afterValue),
    };
  }
  if (key === "progression" || key === "classSelection" || key === "hitPointRollOverrides") {
    return {
      id: createCharacterLogEntryId(),
      at: timestamp,
      sectionKey: key,
      sectionLabel,
      summaryParts: [
        { text: "Updated ", style: "plain" },
        { text: sectionLabel.toLowerCase(), style: "highlight" },
      ],
      details: [],
    };
  }
  const details = buildStructuredChangeRows(beforeValue, afterValue);
  return {
    id: createCharacterLogEntryId(),
    at: timestamp,
    sectionKey: key,
    sectionLabel,
    summaryParts: [
      { text: "Updated ", style: "plain" },
      { text: sectionLabel.toLowerCase(), style: "highlight" },
    ],
    details: details.slice(0, 6),
  };
}

function buildCharacterChangeEntries(previousCharacter, nextCharacter) {
  const previous = previousCharacter && typeof previousCharacter === "object" && !Array.isArray(previousCharacter) ? previousCharacter : {};
  const next = nextCharacter && typeof nextCharacter === "object" && !Array.isArray(nextCharacter) ? nextCharacter : {};
  const ignoredLogKeys = new Set([CHARACTER_SYNC_META_KEY, "editPassword"]);
  const keyOrder = [
    "name",
    "level",
    "race",
    "background",
    "class",
    "subclass",
    "abilities",
    "inventory",
    "spells",
    "feats",
    "optionalFeatures",
    "multiclass",
    "play",
    "notes",
    "progression",
  ];
  const allKeys = [...new Set([...Object.keys(previous), ...Object.keys(next)])]
    .filter((key) => !ignoredLogKeys.has(key))
    .sort((a, b) => {
      const aIndex = keyOrder.indexOf(a);
      const bIndex = keyOrder.indexOf(b);
      if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
      if (aIndex >= 0) return -1;
      if (bIndex >= 0) return 1;
      return a.localeCompare(b);
    });
  const timestamp = new Date().toISOString();
  const entries = [];
  allKeys.forEach((key) => {
    const beforeValue = previous[key];
    const afterValue = next[key];
    if (serializeForDiff(beforeValue) === serializeForDiff(afterValue)) return;
    entries.push(buildPlayerFacingChangeEntry(key, beforeValue, afterValue, timestamp));
  });
  return entries;
}

function captureCharacterLogChanges(character) {
  const nextFingerprint = buildCharacterFingerprint(character);
  if (!nextFingerprint || nextFingerprint === uiState.lastCharacterLogFingerprint) return;
  const nextSnapshot = stripSyncMeta(character) ?? null;
  const previousSnapshot = uiState.lastCharacterSnapshot;
  uiState.lastCharacterSnapshot = nextSnapshot;
  uiState.lastCharacterLogFingerprint = nextFingerprint;
  if (!previousSnapshot || !nextSnapshot) return;
  if (previousSnapshot.id !== nextSnapshot.id) {
    return;
  }
  const nextEntries = buildCharacterChangeEntries(previousSnapshot, nextSnapshot);
  if (!nextEntries.length) return;
  uiState.characterChangeLog = [...nextEntries, ...uiState.characterChangeLog].slice(0, CHARACTER_CHANGE_LOG_LIMIT);
}

function appendCharacterLogEntry(entry, options = {}) {
  const normalized = sanitizeCharacterLogEntry(entry);
  if (!normalized) return;
  uiState.characterChangeLog = [normalized, ...uiState.characterChangeLog].slice(0, CHARACTER_CHANGE_LOG_LIMIT);
  if (options.renderNow !== false && !appState.showOnboardingHome) render(store.getState());
  if (options.syncRemote !== false) {
    const snapshot = store.getState();
    if (isUuid(snapshot.character?.id)) queueRemoteSave(snapshot);
  }
}

function appendDiceRollLog({ label, notation, total, rollValues = [], rollMode = "normal" }) {
  const parsedLabel = String(label ?? "").trim() || "Roll";
  const parsedNotation = String(notation ?? "").trim();
  const parsedTotal = Number.isFinite(total) ? String(total) : "n/a";
  const modeLabel = rollMode === "advantage" ? " (Advantage)" : rollMode === "disadvantage" ? " (Disadvantage)" : "";
  const detailRows = [];
  if (parsedNotation) detailRows.push({ label: "Roll", before: parsedNotation, after: parsedTotal });
  else detailRows.push({ label: "Total", before: "-", after: parsedTotal });
  if (Array.isArray(rollValues) && rollValues.length) {
    detailRows.push({
      label: "Dice",
      before: "-",
      after: truncateLogValue(rollValues.join(", "), 80),
    });
  }
  appendCharacterLogEntry({
    id: createCharacterLogEntryId(),
    at: new Date().toISOString(),
    sectionKey: "dice",
    sectionLabel: "Dice",
    summaryParts: [
      { text: "Rolled ", style: "plain" },
      { text: `${parsedLabel}${modeLabel}`, style: "highlight" },
      { text: " -> ", style: "plain" },
      { text: parsedTotal, style: "bold" },
    ],
    details: detailRows,
  });
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
  const sanitizedMessage =
    error instanceof Error && error.message
      ? error.message
          .replaceAll(/edit password/gi, "password")
          .replaceAll(/invalid password/gi, "Invalid password")
      : "";
  const detail = sanitizedMessage ? ` (${sanitizedMessage})` : "";
  setPersistenceNotice(
    `Server sync is currently unavailable${detail}. Your changes are saved in this browser for now, but not confirmed on the server.`
  );
}

function renderPersistenceNotice() {
  if (!persistenceNoticeMessage) return "";
  return `<p class="muted persistence-warning">${esc(persistenceNoticeMessage)}</p>`;
}

function getClassCatalogEntry(catalogs, className, classSource = "", preferredSources = []) {
  return findCatalogEntryByNameWithSelectedSourcePreference(catalogs?.classes, className, classSource, preferredSources);
}

function getClassHitDieFaces(catalogs, className) {
  const classEntry = getClassCatalogEntry(catalogs, className);
  const faces = Math.max(0, toNumber(classEntry?.hd?.faces, 0));
  return faces > 0 ? faces : 8;
}

function getFixedHitPointGain(faces) {
  return Math.max(1, Math.floor(Math.max(1, faces) / 2) + 1);
}

function sanitizeHitPointRollOverrides(rawOverrides) {
  if (!rawOverrides || typeof rawOverrides !== "object" || Array.isArray(rawOverrides)) return {};
  return Object.fromEntries(
    Object.entries(rawOverrides)
      .map(([key, value]) => [String(key ?? "").trim(), Math.floor(toNumber(value, NaN))])
      .filter(([key, value]) => key && Number.isFinite(value) && value > 0)
  );
}

function rollDie(faces) {
  const max = Math.max(1, Math.floor(toNumber(faces, 0)));
  return 1 + Math.floor(Math.random() * max);
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

function getSubclassCatalogEntries(catalogs, className, classSource = "", preferredSources = []) {
  if (!Array.isArray(catalogs?.subclasses)) return [];
  const normalizedClass = String(className ?? "").trim().toLowerCase();
  if (!normalizedClass) return [];
  const normalizedClassSource = normalizeSourceTag(classSource);
  const sourceOrder = new Map(
    (Array.isArray(preferredSources) ? preferredSources : [])
      .map((source, index) => [normalizeSourceTag(source), index])
      .filter(([source]) => source)
  );
  const unknownSourceOrder = sourceOrder.size + 1000;
  return catalogs.subclasses
    .filter((entry) => String(entry?.className ?? "").trim().toLowerCase() === normalizedClass)
    .filter((entry) => {
      if (!normalizedClassSource) return true;
      const entryClassSource = normalizeSourceTag(entry?.classSource);
      return !entryClassSource || entryClassSource === normalizedClassSource;
    })
    .sort((a, b) => {
      const nameDelta = String(a?.name ?? "").localeCompare(String(b?.name ?? ""));
      if (nameDelta !== 0) return nameDelta;
      const aSource = normalizeSourceTag(a?.source);
      const bSource = normalizeSourceTag(b?.source);
      const aOrder = sourceOrder.get(aSource) ?? unknownSourceOrder;
      const bOrder = sourceOrder.get(bSource) ?? unknownSourceOrder;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return aSource.localeCompare(bSource);
    });
}

function getSelectedSubclassEntry(catalogs, character) {
  const selected = getPrimarySubclassSelection(character);
  if (!selected?.name) return null;
  const classEntry = getClassCatalogEntry(catalogs, character?.class);
  const classSource = normalizeSourceTag(classEntry?.source);
  const sourceOrder = getPreferredSourceOrder(character);
  const candidates = getSubclassCatalogEntries(catalogs, character?.class, classSource, sourceOrder);
  const selectedName = selected.name.toLowerCase();
  const selectedSource = normalizeSourceTag(selected.source);
  const nameMatches = candidates.filter((entry) => String(entry?.name ?? "").trim().toLowerCase() === selectedName);
  if (!nameMatches.length) return null;

  if (selectedSource) {
    const sourceMatch = nameMatches.find((entry) => normalizeSourceTag(entry?.source) === selectedSource);
    if (sourceMatch) return sourceMatch;
  }

  const preferredSource = normalizeSourceTag(selected.classSource || classSource);
  if (preferredSource) {
    const preferredSourceMatch = nameMatches.find((entry) => normalizeSourceTag(entry?.source) === preferredSource);
    if (preferredSourceMatch) return preferredSourceMatch;
  }

  for (const source of sourceOrder) {
    const sourceMatch = nameMatches.find((entry) => normalizeSourceTag(entry?.source) === normalizeSourceTag(source));
    if (sourceMatch) return sourceMatch;
  }

  return nameMatches[0] ?? null;
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
  const seen = new Set();
  const tracks = getClassLevelTracks(character);

  const collectReferencedTokens = (entry, acc = []) => {
    if (entry == null) return acc;
    if (Array.isArray(entry)) {
      entry.forEach((value) => collectReferencedTokens(value, acc));
      return acc;
    }
    if (!isRecordObject(entry)) return acc;
    if (entry.type === "refSubclassFeature" && typeof entry.subclassFeature === "string") {
      acc.push({ type: "subclass", token: entry.subclassFeature });
    }
    if (entry.type === "refClassFeature" && typeof entry.classFeature === "string") {
      acc.push({ type: "class", token: entry.classFeature });
    }
    Object.values(entry).forEach((value) => collectReferencedTokens(value, acc));
    return acc;
  };

  const enqueueFeature = (feature, trackLevel, classNameHint = "", subclassNameHint = "") => {
    if (!feature || feature.level == null || feature.level > trackLevel || !feature.id) return;
    if (seen.has(feature.id)) return;
    seen.add(feature.id);
    unlocked.push(feature);

    const detail = resolveFeatureEntryFromCatalogs(catalogs, feature);
    const refTokens = collectReferencedTokens(detail?.entries ?? []);
    refTokens.forEach((ref) => {
      if (!ref?.token) return;
      if (ref.type === "subclass") {
        const parsed = parseSubclassFeatureToken(
          ref.token,
          feature.source,
          classNameHint || feature.className,
          subclassNameHint || feature.subclassName
        );
        if (!parsed || parsed.level == null || parsed.level > trackLevel) return;
        const nextClassName = parsed.className || classNameHint || feature.className;
        const nextSubclassName = parsed.subclassName || subclassNameHint || feature.subclassName;
        enqueueFeature(
          {
            ...parsed,
            className: nextClassName,
            subclassName: nextSubclassName,
          },
          trackLevel,
          nextClassName,
          nextSubclassName
        );
        return;
      }

      const parsed = parseClassFeatureToken(ref.token, feature.source, classNameHint || feature.className);
      if (!parsed || parsed.level == null || parsed.level > trackLevel) return;
      const nextClassName = parsed.className || classNameHint || feature.className;
      enqueueFeature(
        {
          ...parsed,
          className: nextClassName,
        },
        trackLevel,
        nextClassName,
        subclassNameHint || feature.subclassName
      );
    });
  };

  tracks.forEach((track) => {
    const classEntry = getClassCatalogEntry(catalogs, track.className);
    if (!classEntry) return;
    const classSource = normalizeSourceTag(classEntry.source);
    const classFeatures = Array.isArray(classEntry.classFeatures) ? classEntry.classFeatures : [];
    classFeatures.forEach((featureEntry) => {
      const token = typeof featureEntry === "string" ? featureEntry : featureEntry?.classFeature;
      const parsed = parseClassFeatureToken(token, classSource, classEntry.name);
      if (!parsed || parsed.level == null || parsed.level > track.level) return;
      enqueueFeature(
        {
          ...parsed,
          className: classEntry.name,
        },
        track.level,
        classEntry.name,
        ""
      );
    });

    if (track.isPrimary) {
      const subclassEntry = getSelectedSubclassEntry(catalogs, character);
      if (!subclassEntry) return;
      const subclassFeatures = Array.isArray(subclassEntry.subclassFeatures) ? subclassEntry.subclassFeatures : [];
      subclassFeatures.forEach((token) => {
        const parsed = parseSubclassFeatureToken(token, subclassEntry.source, classEntry.name, subclassEntry.name);
        if (!parsed || parsed.level == null || parsed.level > track.level) return;
        const resolvedSubclassName = parsed.subclassName || subclassEntry.shortName || subclassEntry.name;
        enqueueFeature(
          {
            ...parsed,
            className: classEntry.name,
            subclassName: resolvedSubclassName,
          },
          track.level,
          classEntry.name,
          resolvedSubclassName
        );
      });
    }
  });

  return unlocked.sort((a, b) => {
    const levelDelta = toNumber(a.level, 0) - toNumber(b.level, 0);
    if (levelDelta !== 0) return levelDelta;
    return String(a.name).localeCompare(String(b.name));
  });
}

function getFeatSlotsForClass(classEntry, classLevel) {
  if (!classEntry || classLevel <= 0) return [];
  const slots = [];

  const normalizeFeatCategoryList = (value) => {
    if (Array.isArray(value)) return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
    const single = String(value ?? "").trim();
    return single ? [single] : [];
  };

  const featProgression = Array.isArray(classEntry.featProgression) ? classEntry.featProgression : [];
  featProgression.forEach((progressionEntry, progressionIndex) => {
    const progression = progressionEntry?.progression;
    if (!progression || typeof progression !== "object") return;
    const slotType = progressionEntry?.name ? cleanSpellInlineTags(progressionEntry.name) : "Feat";
    const featCategories = normalizeFeatCategoryList(progressionEntry?.category);
    Object.entries(progression).forEach(([levelRaw, countRaw]) => {
      const level = toNumber(levelRaw, NaN);
      const count = Math.max(0, toNumber(countRaw, 0));
      if (!Number.isFinite(level) || level > classLevel || count <= 0) return;
      for (let idx = 0; idx < count; idx += 1) {
        const id = buildEntityId(["feat-slot", classEntry.name, classEntry.source, slotType, level, progressionIndex, idx]);
        slots.push({
          id,
          className: classEntry.name,
          classSource: normalizeSourceTag(classEntry.source),
          level,
          count: 1,
          slotType,
          featCategories,
        });
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
      featCategories: [],
    });
  });
  return slots;
}

function getFeatSlotsForSubclass(subclassEntry, classLevel) {
  if (!subclassEntry || classLevel <= 0) return [];
  const normalizeFeatCategoryList = (value) => {
    if (Array.isArray(value)) return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
    const single = String(value ?? "").trim();
    return single ? [single] : [];
  };
  const slots = [];
  const featProgression = Array.isArray(subclassEntry?.featProgression) ? subclassEntry.featProgression : [];
  featProgression.forEach((progressionEntry, progressionIndex) => {
    const progression = progressionEntry?.progression;
    if (!progression || typeof progression !== "object") return;
    const slotType = progressionEntry?.name ? cleanSpellInlineTags(progressionEntry.name) : "Feat";
    const featCategories = normalizeFeatCategoryList(progressionEntry?.category);
    Object.entries(progression).forEach(([levelRaw, countRaw]) => {
      const level = toNumber(levelRaw, NaN);
      const count = Math.max(0, toNumber(countRaw, 0));
      if (!Number.isFinite(level) || level > classLevel || count <= 0) return;
      for (let idx = 0; idx < count; idx += 1) {
        const id = buildEntityId([
          "feat-slot",
          "subclass",
          subclassEntry.className,
          subclassEntry.classSource,
          subclassEntry.name,
          subclassEntry.source,
          slotType,
          level,
          progressionIndex,
          idx,
        ]);
        slots.push({
          id,
          className: String(subclassEntry?.className ?? "").trim(),
          classSource: normalizeSourceTag(subclassEntry?.classSource),
          subclassName: String(subclassEntry?.name ?? "").trim(),
          level,
          count: 1,
          slotType,
          featCategories,
        });
      }
    });
  });
  return slots;
}

function getFeatSlots(catalogs, character) {
  const tracks = getClassLevelTracks(character);
  const selectedPrimarySubclass = getSelectedSubclassEntry(catalogs, character);
  const slots = tracks.flatMap((track) => {
    const classEntry = getClassCatalogEntry(catalogs, track.className);
    const classSlots = getFeatSlotsForClass(classEntry, track.level);
    if (!track.isPrimary || !selectedPrimarySubclass) return classSlots;
    const subclassClassName = String(selectedPrimarySubclass?.className ?? "").trim().toLowerCase();
    const trackClassName = String(track?.className ?? "").trim().toLowerCase();
    if (!subclassClassName || subclassClassName !== trackClassName) return classSlots;
    return [...classSlots, ...getFeatSlotsForSubclass(selectedPrimarySubclass, track.level)];
  });
  return slots.sort((a, b) => {
    const levelDelta = a.level - b.level;
    if (levelDelta !== 0) return levelDelta;
    const classDelta = String(a.className).localeCompare(String(b.className));
    if (classDelta !== 0) return classDelta;
    return String(a.slotType).localeCompare(String(b.slotType));
  });
}

function normalizeOptionalFeatureTypeList(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
  const single = String(value ?? "").trim();
  return single ? [single] : [];
}

function getProgressionCountAtLevel(progression, classLevel) {
  if (Array.isArray(progression)) {
    const idx = Math.max(0, Math.min(progression.length - 1, classLevel - 1));
    return Math.max(0, toNumber(progression[idx], 0));
  }
  if (isRecordObject(progression)) {
    let count = 0;
    Object.entries(progression).forEach(([levelRaw, countRaw]) => {
      const level = toNumber(levelRaw, NaN);
      if (!Number.isFinite(level) || level > classLevel) return;
      count = Math.max(count, Math.max(0, toNumber(countRaw, 0)));
    });
    return count;
  }
  return 0;
}

function getOptionalFeatureSlotsForClass(classEntry, classLevel) {
  if (!classEntry || classLevel <= 0) return [];
  const slots = [];
  const groups = Array.isArray(classEntry?.optionalfeatureProgression) ? classEntry.optionalfeatureProgression : [];
  groups.forEach((group, groupIndex) => {
    const count = getProgressionCountAtLevel(group?.progression, classLevel);
    if (count <= 0) return;
    const featureTypes = normalizeOptionalFeatureTypeList(group?.featureType);
    const featureType = featureTypes[0] || "";
    const slotType = cleanSpellInlineTags(group?.name || "Optional Feature");
    for (let idx = 0; idx < count; idx += 1) {
      const id = buildEntityId(["optional-slot", classEntry.name, classEntry.source, slotType, featureType, classLevel, groupIndex, idx]);
      slots.push({
        id,
        className: classEntry.name,
        classSource: normalizeSourceTag(classEntry.source),
        level: classLevel,
        count: 1,
        slotType,
        featureType,
      });
    }
  });
  return slots;
}

function getOptionalFeatureSlotsForSubclass(subclassEntry, classLevel) {
  if (!subclassEntry || classLevel <= 0) return [];
  const slots = [];
  const groups = Array.isArray(subclassEntry?.optionalfeatureProgression) ? subclassEntry.optionalfeatureProgression : [];
  groups.forEach((group, groupIndex) => {
    const count = getProgressionCountAtLevel(group?.progression, classLevel);
    if (count <= 0) return;
    const featureTypes = normalizeOptionalFeatureTypeList(group?.featureType);
    const featureType = featureTypes[0] || "";
    const slotType = cleanSpellInlineTags(group?.name || "Optional Feature");
    for (let idx = 0; idx < count; idx += 1) {
      const id = buildEntityId([
        "optional-slot",
        "subclass",
        subclassEntry.className,
        subclassEntry.classSource,
        subclassEntry.name,
        subclassEntry.source,
        slotType,
        featureType,
        classLevel,
        groupIndex,
        idx,
      ]);
      slots.push({
        id,
        className: String(subclassEntry?.className ?? "").trim(),
        classSource: normalizeSourceTag(subclassEntry?.classSource),
        subclassName: String(subclassEntry?.name ?? "").trim(),
        level: classLevel,
        count: 1,
        slotType,
        featureType,
      });
    }
  });
  return slots;
}

function getOptionalFeatureSlots(catalogs, character) {
  const tracks = getClassLevelTracks(character);
  const selectedPrimarySubclass = getSelectedSubclassEntry(catalogs, character);
  return tracks
    .flatMap((track) => {
      const classEntry = getClassCatalogEntry(catalogs, track.className);
      const classSlots = getOptionalFeatureSlotsForClass(classEntry, track.level);
      if (!track.isPrimary || !selectedPrimarySubclass) return classSlots;
      const subclassClassName = String(selectedPrimarySubclass?.className ?? "").trim().toLowerCase();
      const trackClassName = String(track?.className ?? "").trim().toLowerCase();
      if (!subclassClassName || subclassClassName !== trackClassName) return classSlots;
      return [...classSlots, ...getOptionalFeatureSlotsForSubclass(selectedPrimarySubclass, track.level)];
    })
    .sort((a, b) => {
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
      || /\bonce you use this (?:feature|ability|benefit)\b/.test(text)
      || /\byou can't (?:do so|use (?:this|it)) again until you finish a (?:short|long) rest\b/.test(text)
      || /\byou can(?:not|'t) (?:do so|use (?:this|it)) again until you finish a (?:short|long) rest\b/.test(text);
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

function getAutoResourcesFromRules(catalogs, character, features, feats, optionalFeatures) {
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

  (Array.isArray(optionalFeatures) ? optionalFeatures : []).forEach((feature) => {
    const optionalFeatureDetail = (catalogs?.optionalFeatures ?? []).find(
      (entry) => buildEntityId(["optionalfeature", entry?.name, entry?.source]) === feature.id
    );
    const descriptor = getResourceDescriptorFromEntry(optionalFeatureDetail, feature.name, getCharacterHighestClassLevel(character));
    if (!descriptor) return;
    byId.set(`${AUTO_RESOURCE_ID_PREFIX}${feature.id}`, {
      autoId: `${AUTO_RESOURCE_ID_PREFIX}${feature.id}`,
      name: descriptor.name,
      current: descriptor.max,
      max: descriptor.max,
      recharge: descriptor.recharge,
    });
  });

  return [...byId.values()];
}

function getAutoResourcesFromClassTableEffects(catalogs, character, unlockedFeatures, classTableEffects) {
  const normalizeResourceLabel = (value) =>
    cleanSpellInlineTags(String(value ?? ""))
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\bpoints\b/g, "point")
      .replace(/\bdice\b/g, "die")
      .replace(/\brages\b/g, "rage")
      .trim();

  const getLabelTokenSet = (value) =>
    new Set(
      normalizeResourceLabel(value)
        .split(" ")
        .map((token) => token.trim())
        .filter(Boolean)
    );

  const scoreResourceLabelMatch = (left, right) => {
    const normalizedLeft = normalizeResourceLabel(left);
    const normalizedRight = normalizeResourceLabel(right);
    if (!normalizedLeft || !normalizedRight) return 0;
    if (normalizedLeft === normalizedRight) return 100;
    if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return 60;
    const leftTokens = getLabelTokenSet(normalizedLeft);
    const rightTokens = getLabelTokenSet(normalizedRight);
    if (!leftTokens.size || !rightTokens.size) return 0;
    let overlap = 0;
    leftTokens.forEach((token) => {
      if (rightTokens.has(token)) overlap += 1;
    });
    return overlap;
  };

  const classLevelMap = getClassLevelMap(character);
  const candidatesByClass = new Map();
  (Array.isArray(unlockedFeatures) ? unlockedFeatures : []).forEach((feature) => {
    const className = String(feature?.className ?? "").trim();
    if (!className) return;
    const classKey = className.toLowerCase();
    const detail = resolveFeatureEntryFromCatalogs(catalogs, feature);
    const classLevel = toNumber(classLevelMap.get(classKey), 0);
    const descriptor = getResourceDescriptorFromEntry(detail, feature?.name, classLevel);
    const rechargeHint = getResourceRechargeHint(getRuleDescriptionLines(detail));
    const list = candidatesByClass.get(classKey) ?? [];
    if (descriptor) {
      list.push({
        label: String(descriptor?.name ?? "").trim(),
        recharge: String(descriptor?.recharge ?? ""),
        source: "descriptor",
      });
    }
    if (rechargeHint) {
      list.push({
        label: String(feature?.name ?? "").trim(),
        recharge: rechargeHint,
        source: "feature",
      });
    }
    if (list.length) candidatesByClass.set(classKey, list);
  });

  return (Array.isArray(classTableEffects) ? classTableEffects : [])
    .map((effect) => {
      const id = String(effect?.id ?? "").trim();
      const label = String(effect?.label ?? "").trim();
      const classKey = String(effect?.className ?? "").trim().toLowerCase();
      const valueText = String(effect?.value ?? "").trim();
      if (!id || !label || !classKey || !valueText) return null;
      const max = toNumber(valueText.match(/[+\-]?\d+/)?.[0], Number.NaN);
      if (!Number.isFinite(max) || max <= 0) return null;
      const candidates = candidatesByClass.get(classKey) ?? [];
      let best = null;
      let bestScore = 0;
      candidates.forEach((candidate) => {
        const score = scoreResourceLabelMatch(label, candidate?.label);
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      });
      if (!best || bestScore < 1) return null;
      if (best.source !== "descriptor" && !String(best?.recharge ?? "").trim()) return null;
      return {
        autoId: `${AUTO_RESOURCE_ID_PREFIX}${id}`,
        name: label,
        current: max,
        max,
        recharge: String(best?.recharge ?? ""),
      };
    })
    .filter(Boolean);
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

function extractSpellNameFromGrant(value) {
  if (typeof value === "string") return cleanSpellInlineTags(value.split("|")[0].replace(/#c$/i, "").trim());
  if (isRecordObject(value) && typeof value.spell === "string") {
    return cleanSpellInlineTags(value.spell.split("|")[0].replace(/#c$/i, "").trim());
  }
  return "";
}

const AUTO_SPELL_GRANT_PRIORITY = {
  expanded: 1,
  innate: 2,
  known: 3,
  prepared: 4,
};

function collectAdditionalSpellGrantsFromEntries(entries, classLevel) {
  const grants = new Map();
  const addFromSpellList = (list, grantType) => {
    (Array.isArray(list) ? list : []).forEach((entry) => {
      const name = extractSpellNameFromGrant(entry);
      if (!name) return;
      const key = name.toLowerCase();
      const current = grants.get(key);
      const currentPriority = AUTO_SPELL_GRANT_PRIORITY[current?.grantType] ?? 0;
      const nextPriority = AUTO_SPELL_GRANT_PRIORITY[grantType] ?? 0;
      if (!current || nextPriority >= currentPriority) grants.set(key, { name, grantType });
    });
  };
  (Array.isArray(entries) ? entries : []).forEach((block) => {
    if (!isRecordObject(block)) return;
    ["prepared", "known", "innate", "expanded"].forEach((key) => {
      const bucket = block[key];
      if (!isRecordObject(bucket)) return;
      Object.entries(bucket).forEach(([levelRaw, list]) => {
        const unlockLevel = toNumber(levelRaw, NaN);
        if (!Number.isFinite(unlockLevel) || unlockLevel > classLevel) return;
        addFromSpellList(list, key);
      });
    });
  });
  return [...grants.values()];
}

function getAutoGrantedSpellData(catalogs, character) {
  const catalogNameByLower = new Map(
    (Array.isArray(catalogs?.spells) ? catalogs.spells : [])
      .map((spell) => String(spell?.name ?? "").trim())
      .filter(Boolean)
      .map((name) => [name.toLowerCase(), name])
  );
  const grants = new Map();
  const addGrant = (rawName, grantType) => {
    const cleaned = cleanSpellInlineTags(rawName);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    const canonical = catalogNameByLower.get(key) ?? cleaned;
    const current = grants.get(key);
    const currentPriority = AUTO_SPELL_GRANT_PRIORITY[current?.grantType] ?? 0;
    const nextPriority = AUTO_SPELL_GRANT_PRIORITY[grantType] ?? 0;
    if (!current || nextPriority >= currentPriority) grants.set(key, { name: canonical, grantType });
  };
  const tracks = getClassLevelTracks(character);
  tracks.forEach((track) => {
    const classEntry = getClassCatalogEntry(catalogs, track.className);
    if (!classEntry) return;
    collectAdditionalSpellGrantsFromEntries(classEntry.additionalSpells, track.level).forEach((grant) =>
      addGrant(grant.name, grant.grantType)
    );
    if (!track.isPrimary) return;
    const subclassEntry = getSelectedSubclassEntry(catalogs, character);
    if (!subclassEntry) return;
    collectAdditionalSpellGrantsFromEntries(subclassEntry.additionalSpells, track.level).forEach((grant) =>
      addGrant(grant.name, grant.grantType)
    );
  });
  const autoPreparedSpells = {};
  const autoSpellGrantTypes = {};
  [...grants.entries()].forEach(([key, grant]) => {
    autoPreparedSpells[key] = true;
    autoSpellGrantTypes[key] = grant.grantType;
  });
  return {
    names: [...grants.values()].map((grant) => grant.name),
    autoPreparedSpells,
    autoSpellGrantTypes,
  };
}

const FULL_LIST_PREPARED_CASTER_KEYS = new Set(["cleric", "druid", "paladin", "artificer"]);

function classUsesFullPreparedSpellList(classEntry) {
  if (!isRecordObject(classEntry) || !classEntry.preparedSpells) return false;
  const classKey = getClassKey(classEntry.name);
  if (!FULL_LIST_PREPARED_CASTER_KEYS.has(classKey)) return false;
  if (Array.isArray(classEntry.spellsKnownProgression) && classEntry.spellsKnownProgression.length) return false;
  if (Array.isArray(classEntry.spellsKnownProgressionFixed) && classEntry.spellsKnownProgressionFixed.length) return false;
  if (isRecordObject(classEntry.spellsKnownProgressionFixedByLevel)
    && Object.keys(classEntry.spellsKnownProgressionFixedByLevel).length) return false;
  return true;
}

function getClassMaxPreparedSpellLevel(catalogs, className, classLevel) {
  const defaults = getClassSpellSlotDefaults(catalogs, className, classLevel);
  return SPELL_SLOT_LEVELS.reduce((highest, slotLevel) => {
    if (toNumber(defaults?.[String(slotLevel)], 0) > 0) return slotLevel;
    return highest;
  }, 0);
}

function doesSpellListClass(spell, classKey) {
  if (!spell || !classKey) return false;
  const classLookup = spell?.spellSourceEntry?.class;
  if (!isRecordObject(classLookup)) return false;
  return Object.values(classLookup).some((sourceMap) =>
    Object.keys(sourceMap ?? {}).some((className) => getClassKey(className) === classKey)
  );
}

function getAutoClassListSpellNames(catalogs, character) {
  const classMaxLevelByKey = new Map();
  getClassLevelTracks(character).forEach((track) => {
    const classEntry = getClassCatalogEntry(catalogs, track.className);
    if (!classUsesFullPreparedSpellList(classEntry)) return;
    const classKey = getClassKey(classEntry.name);
    if (!classKey) return;
    const maxSpellLevel = getClassMaxPreparedSpellLevel(catalogs, classEntry.name, track.level);
    const previousMax = classMaxLevelByKey.get(classKey) ?? 0;
    if (maxSpellLevel > previousMax) classMaxLevelByKey.set(classKey, maxSpellLevel);
  });
  if (!classMaxLevelByKey.size) return [];

  const spells = Array.isArray(catalogs?.spells) ? catalogs.spells : [];
  const names = new Map();
  spells.forEach((spell) => {
    const spellLevel = Math.max(0, toNumber(spell?.level, 0));
    const isAvailable = [...classMaxLevelByKey.entries()].some(([classKey, maxSpellLevel]) => {
      if (!doesSpellListClass(spell, classKey)) return false;
      if (spellLevel === 0) return true;
      return spellLevel <= maxSpellLevel;
    });
    if (!isAvailable) return;
    const name = String(spell?.name ?? "").trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (!names.has(key)) names.set(key, name);
  });
  return [...names.values()];
}

function getClassTableEffects(catalogs, character) {
  const formatClassTableRollNotation = (toRoll) => {
    if (typeof toRoll === "string") {
      const notation = extractSimpleNotation(toRoll);
      return notation || String(toRoll).replace(/\s+/g, "");
    }
    const terms = Array.isArray(toRoll) ? toRoll : isRecordObject(toRoll) ? [toRoll] : [];
    const notation = terms
      .map((term) => {
        if (typeof term === "string") return extractSimpleNotation(term);
        if (!isRecordObject(term)) return "";
        const count = Math.max(1, toNumber(term.number, 1));
        const faces = Math.max(0, toNumber(term.faces, 0));
        if (!faces) return "";
        return `${count}d${faces}`;
      })
      .filter(Boolean)
      .join("+");
    return extractSimpleNotation(notation);
  };

  const effects = [];
  const tracks = getClassLevelTracks(character);
  tracks.forEach((track) => {
    const classEntry = getClassCatalogEntry(catalogs, track.className);
    if (!classEntry) return;
    const groups = Array.isArray(classEntry.classTableGroups) ? classEntry.classTableGroups : [];
    const levelIndex = Math.max(0, Math.min(19, toNumber(track.level, 1) - 1));
    groups.forEach((group, groupIndex) => {
      const labels = Array.isArray(group?.colLabels) ? group.colLabels : [];
      const rows = Array.isArray(group?.rows) ? group.rows : [];
      const row = Array.isArray(rows[levelIndex]) ? rows[levelIndex] : null;
      if (!row) return;
      labels.forEach((labelRaw, idx) => {
        const label = cleanSpellInlineTags(labelRaw);
        const key = label.toLowerCase();
        if (!label) return;
        if (!/(point|die|dice|movement|speed|rage|inspiration|mastery|indomitable|channel divinity|sneak attack|martial arts|wild shape|sorcery|ki)/i.test(key)) {
          return;
        }
        const value = row[idx];
        let effectValue = "";
        let kind = "text";
        if (isRecordObject(value) && value.toRoll != null) {
          effectValue = formatClassTableRollNotation(value.toRoll);
          kind = "dice";
        } else if (isRecordObject(value) && value.type === "bonus") {
          effectValue = signed(toNumber(value.value, 0));
          kind = "number";
        } else if (isRecordObject(value) && value.type === "bonusSpeed") {
          effectValue = `+${Math.max(0, toNumber(value.value, 0))} ft`;
          kind = "number";
        } else if (typeof value === "number" || Number.isFinite(toNumber(value, NaN))) {
          effectValue = String(Math.max(0, toNumber(value, 0)));
          kind = "number";
        } else {
          effectValue = String(value ?? "").trim();
        }
        if (!effectValue) return;
        effects.push({
          id: buildEntityId(["table-effect", classEntry.name, groupIndex, idx, label]),
          className: classEntry.name,
          label,
          kind,
          value: effectValue,
          rollNotation: kind === "dice" ? extractSimpleNotation(effectValue) : "",
        });
      });
    });
  });
  return effects;
}

function extractFeatureModeDescriptors(catalogs, features) {
  const getOptionLabel = (option) => {
    if (!option) return "";
    if (typeof option === "string") return cleanSpellInlineTags(option.split("|")[0]);
    if (!isRecordObject(option)) return "";
    if (typeof option.name === "string" && option.name.trim()) return cleanSpellInlineTags(option.name);
    if (typeof option.optionalfeature === "string") return cleanSpellInlineTags(option.optionalfeature.split("|")[0]);
    if (typeof option.subclassFeature === "string") return cleanSpellInlineTags(option.subclassFeature.split("|")[0]);
    if (typeof option.classFeature === "string") return cleanSpellInlineTags(option.classFeature.split("|")[0]);
    if (typeof option.feature === "string") return cleanSpellInlineTags(option.feature.split("|")[0]);
    if (typeof option.entry === "string") return cleanSpellInlineTags(option.entry);
    return "";
  };

  const normalizeModeCount = (raw) => {
    const parsed = Math.max(1, Math.floor(toNumber(raw, 1)));
    return Number.isFinite(parsed) ? parsed : 1;
  };

  const modes = [];
  (Array.isArray(features) ? features : []).forEach((feature) => {
    const detail = resolveFeatureEntryFromCatalogs(catalogs, feature);
    const entries = Array.isArray(detail?.entries) ? detail.entries : [];
    entries.forEach((entry, entryIndex) => {
      if (!isRecordObject(entry) || entry.type !== "options" || !Array.isArray(entry.entries)) return;
      const optionValues = [...new Set(entry.entries.map((option) => getOptionLabel(option)).filter(Boolean))];
      const count = Math.min(optionValues.length, normalizeModeCount(entry.count));
      if (optionValues.length < 2 || count < 1) return;
      modes.push({
        id: buildEntityId(["feature-mode", feature.id, entryIndex]),
        featureId: feature.id,
        featureName: feature.name,
        className: feature.className,
        optionValues,
        count,
      });
    });
  });
  return modes;
}

function recomputeCharacterProgression(catalogs, character) {
  const unlockedFeatures = getUnlockedFeatures(catalogs, character);
  const featSlots = getFeatSlots(catalogs, character);
  const optionalFeatureSlots = getOptionalFeatureSlots(catalogs, character);
  const classTableEffects = getClassTableEffects(catalogs, character);
  const featureModes = extractFeatureModeDescriptors(catalogs, unlockedFeatures);
  const existingFeats = Array.isArray(character?.feats) ? character.feats : [];
  const existingOptionalFeatures = Array.isArray(character?.optionalFeatures) ? character.optionalFeatures : [];
  const slotIds = new Set(featSlots.map((slot) => slot.id));
  const optionalSlotIds = new Set(optionalFeatureSlots.map((slot) => slot.id));
  const nextFeats = existingFeats.filter((feat) => feat && feat.name && (!feat.slotId || slotIds.has(feat.slotId)));
  const nextOptionalFeatures = existingOptionalFeatures.filter(
    (feature) => feature && feature.name && (!feature.slotId || optionalSlotIds.has(feature.slotId))
  );
  const selectedFeatIds = nextFeats.map((feat) => feat.id).filter(Boolean);
  const selectedOptionalFeatureIds = nextOptionalFeatures.map((feature) => feature.id).filter(Boolean);
  const pendingFeatSlotIds = featSlots.filter((slot) => !nextFeats.some((feat) => feat.slotId === slot.id)).map((slot) => slot.id);
  const pendingOptionalFeatureSlotIds = optionalFeatureSlots
    .filter((slot) => !nextOptionalFeatures.some((feature) => feature.slotId === slot.id))
    .map((slot) => slot.id);
  return {
    unlockedFeatures,
    featSlots,
    pendingFeatSlotIds,
    selectedFeatIds,
    optionalFeatureSlots,
    pendingOptionalFeatureSlotIds,
    selectedOptionalFeatureIds,
    classTableEffects,
    featureModes,
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
    const match = matches[0] ?? null;
    if (!match) return null;
    if (Array.isArray(match?.entries) && match.entries.length) return match;
    const copy = isRecordObject(match?._copy) ? match._copy : null;
    if (!copy) return match;
    const copiedName = String(copy?.name ?? "").trim().toLowerCase();
    const copiedClassName = String(copy?.className ?? "").trim().toLowerCase();
    const copiedSubclassName = String(copy?.subclassShortName ?? "").trim().toLowerCase();
    const copiedLevel = toNumber(copy?.level, NaN);
    const copiedSource = normalizeSourceTag(copy?.source);
    const copiedEntry = (catalogs?.subclassFeatures ?? []).find((entry) => {
      if (String(entry?.name ?? "").trim().toLowerCase() !== copiedName) return false;
      if (String(entry?.className ?? "").trim().toLowerCase() !== copiedClassName) return false;
      if (String(entry?.subclassShortName ?? "").trim().toLowerCase() !== copiedSubclassName) return false;
      if (Number.isFinite(copiedLevel) && toNumber(entry?.level, NaN) !== copiedLevel) return false;
      if (copiedSource && normalizeSourceTag(entry?.source) !== copiedSource) return false;
      return true;
    });
    return copiedEntry ?? match;
  }

  const matches = (catalogs?.classFeatures ?? []).filter((entry) => {
    const entryName = String(entry?.name ?? "").trim().toLowerCase();
    const entryClassName = String(entry?.className ?? "").trim().toLowerCase();
    const entryLevel = toNumber(entry?.level, 0);
    if (entryName !== normalizedName || entryClassName !== normalizedClassName || entryLevel !== level) return false;
    if (!featureSource) return true;
    return normalizeSourceTag(entry?.source) === featureSource;
  });
  const match = matches[0] ?? null;
  if (!match) return null;
  if (Array.isArray(match?.entries) && match.entries.length) return match;
  const copy = isRecordObject(match?._copy) ? match._copy : null;
  if (!copy) return match;
  const copiedName = String(copy?.name ?? "").trim().toLowerCase();
  const copiedClassName = String(copy?.className ?? "").trim().toLowerCase();
  const copiedLevel = toNumber(copy?.level, NaN);
  const copiedSource = normalizeSourceTag(copy?.source);
  const copiedEntry = (catalogs?.classFeatures ?? []).find((entry) => {
    if (String(entry?.name ?? "").trim().toLowerCase() !== copiedName) return false;
    if (String(entry?.className ?? "").trim().toLowerCase() !== copiedClassName) return false;
    if (Number.isFinite(copiedLevel) && toNumber(entry?.level, NaN) !== copiedLevel) return false;
    if (copiedSource && normalizeSourceTag(entry?.source) !== copiedSource) return false;
    return true;
  });
  return copiedEntry ?? match;
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
    : "<p class='muted'>No description is available for this feature.</p>";
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
    : "<p class='muted'>No description is available for this feat.</p>";
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

function openOptionalFeatureDetailsModal(state, featureId) {
  const selectedFeature = (state.character?.optionalFeatures ?? []).find((it) => it.id === featureId);
  if (!selectedFeature) return;
  const detail =
    (state.catalogs?.optionalFeatures ?? []).find((entry) => buildEntityId(["optionalfeature", entry?.name, entry?.source]) === featureId)
    ?? null;
  const lines = getRuleDescriptionLines(detail);
  const bodyHtml = lines.length
    ? lines
        .map((line) => {
          const body = renderTextWithInlineDiceButtons(line);
          return `<p>${body}</p>`;
        })
        .join("")
    : "<p class='muted'>No description is available for this optional feature.</p>";
  const featureTypes = Array.isArray(detail?.featureType)
    ? detail.featureType.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : [String(detail?.featureType ?? selectedFeature?.featureType ?? "").trim()].filter(Boolean);
  const metaRows = [
    { label: "Source", value: detail?.sourceLabel ?? detail?.source ?? selectedFeature?.source ?? "" },
    { label: "Granted At Level", value: selectedFeature.levelGranted ? String(selectedFeature.levelGranted) : "" },
    { label: "Class", value: selectedFeature.className || "" },
    { label: "Type", value: selectedFeature.slotType || "" },
    { label: "Feature Type", value: featureTypes.join(", ") },
  ].filter((row) => row.value);
  const close = openModal({
    title: selectedFeature.name,
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
      rollVisualNotation(selectedFeature.name, notation);
    });
  });
}

function openSpeciesTraitDetailsModal(state, traitName) {
  const selectedTraitName = String(traitName ?? "").trim();
  if (!selectedTraitName) return;
  const sourceOrder = getPreferredSourceOrder(state.character);
  const raceEntry = findCatalogEntryByNameWithSelectedSourcePreference(
    state.catalogs?.races,
    state.character?.race,
    state.character?.raceSource,
    sourceOrder
  );
  if (!raceEntry) return;
  const ignoredTraitNames = new Set(["age", "alignment", "size", "language", "languages", "creature type"]);
  const traitEntry = (Array.isArray(raceEntry?.entries) ? raceEntry.entries : []).find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const name = String(entry?.name ?? "").trim();
    if (!name) return false;
    if (ignoredTraitNames.has(name.toLowerCase())) return false;
    return name.toLowerCase() === selectedTraitName.toLowerCase();
  });
  const lines = getRuleDescriptionLines(traitEntry);
  const bodyHtml = lines.length
    ? lines
        .map((line) => {
          const body = renderTextWithInlineDiceButtons(line);
          return `<p>${body}</p>`;
        })
        .join("")
    : "<p class='muted'>No description is available for this trait.</p>";
  const raceName = String(raceEntry?.name ?? state.character?.race ?? "").trim();
  const close = openModal({
    title: selectedTraitName,
    bodyHtml: `
      <div class="spell-meta-grid">
        <div><strong>Type:</strong> Species Trait</div>
        ${raceName ? `<div><strong>Species:</strong> ${esc(raceName)}</div>` : ""}
        <div><strong>Source:</strong> ${esc(raceEntry?.sourceLabel ?? raceEntry?.source ?? "")}</div>
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
      rollVisualNotation(selectedTraitName, notation);
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

function isRecordObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findCatalogEntryByName(entries, selectedName) {
  if (!Array.isArray(entries)) return null;
  const normalized = String(selectedName ?? "").trim().toLowerCase();
  if (!normalized) return null;
  return entries.find((entry) => String(entry?.name ?? "").trim().toLowerCase() === normalized) ?? null;
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
  const matches = findCatalogEntriesByName(entries, selectedName);
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];
  const sourceOrder = (Array.isArray(preferredSources) ? preferredSources : [])
    .map((entry) => normalizeSourceTag(entry))
    .filter(Boolean);
  for (const source of sourceOrder) {
    const match = matches.find((entry) => normalizeSourceTag(entry?.source) === source);
    if (match) return match;
  }
  return matches[0];
}

function findCatalogEntryByNameWithSelectedSourcePreference(entries, selectedName, selectedSource = "", preferredSources = []) {
  const matches = findCatalogEntriesByName(entries, selectedName);
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];
  const normalizedSource = normalizeSourceTag(selectedSource);
  if (normalizedSource) {
    const selectedMatch = matches.find((entry) => normalizeSourceTag(entry?.source) === normalizedSource);
    if (selectedMatch) return selectedMatch;
  }
  return findCatalogEntryByNameWithSourcePreference(matches, selectedName, preferredSources);
}

function findCatalogEntriesByName(entries, selectedName) {
  if (!Array.isArray(entries)) return [];
  const normalized = String(selectedName ?? "").trim().toLowerCase();
  if (!normalized) return [];
  return entries.filter((entry) => String(entry?.name ?? "").trim().toLowerCase() === normalized);
}

function findCatalogEntryByNameAndSource(entries, selectedName, selectedSource = "") {
  const byName = findCatalogEntriesByName(entries, selectedName);
  if (!byName.length) return null;
  const source = normalizeSourceTag(selectedSource);
  if (!source) return byName.length === 1 ? byName[0] : null;
  return byName.find((entry) => normalizeSourceTag(entry?.source) === source) ?? null;
}

function resolveImportedFeats(catalogs, feats) {
  if (!Array.isArray(feats)) return [];
  const entries = Array.isArray(catalogs?.feats) ? catalogs.feats : [];
  return feats
    .map((feat) => {
      const name = String(feat?.name ?? "").trim();
      if (!name) return null;
      const source = String(feat?.source ?? "").trim();
      const matched = findCatalogEntryByNameAndSource(entries, name, source);
      const canonical = matched
        ? {
            name: String(matched.name ?? "").trim(),
            source: normalizeSourceTag(matched.source),
            id: buildEntityId(["feat", matched.name, matched.source]),
          }
        : {
            name,
            source,
            id: String(feat?.id ?? "").trim() || buildEntityId(["feat", name, source || "unknown"]),
          };
      return {
        ...feat,
        ...canonical,
      };
    })
    .filter((feat) => feat && feat.name);
}

function resolveImportedOptionalFeatures(catalogs, optionalFeatures) {
  if (!Array.isArray(optionalFeatures)) return [];
  const entries = Array.isArray(catalogs?.optionalFeatures) ? catalogs.optionalFeatures : [];
  return optionalFeatures
    .map((feature) => {
      const name = String(feature?.name ?? "").trim();
      if (!name) return null;
      const source = String(feature?.source ?? "").trim();
      const matched = findCatalogEntryByNameAndSource(entries, name, source);
      const canonical = matched
        ? {
            name: String(matched.name ?? "").trim(),
            source: normalizeSourceTag(matched.source),
            id: buildEntityId(["optionalfeature", matched.name, matched.source]),
          }
        : {
            name,
            source,
            id: String(feature?.id ?? "").trim() || buildEntityId(["optionalfeature", name, source || "unknown"]),
          };
      return {
        ...feature,
        ...canonical,
      };
    })
    .filter((feature) => feature && feature.name);
}

function resolveImportedCharacterSelections(catalogs, character) {
  return {
    feats: resolveImportedFeats(catalogs, character?.feats),
    optionalFeatures: resolveImportedOptionalFeatures(catalogs, character?.optionalFeatures),
  };
}

function normalizeAbilityKey(value) {
  const key = String(value ?? "").trim().toLowerCase();
  return SAVE_ABILITIES.includes(key) ? key : "";
}

function normalizeSkillKey(value) {
  const token = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return SKILL_KEY_BY_CANONICAL[token] ?? "";
}

function getEmptyAbilityMap() {
  return SAVE_ABILITIES.reduce((acc, ability) => {
    acc[ability] = 0;
    return acc;
  }, {});
}

function getAutoChoiceSelectionMap(play, sourceKey) {
  if (!isRecordObject(play?.autoChoiceSelections)) return {};
  const selected = play.autoChoiceSelections[sourceKey];
  return isRecordObject(selected) ? selected : {};
}

function normalizeChoiceToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getAutoChoiceSelectedValues(play, sourceKey, choiceId, from, count) {
  const selectionMap = getAutoChoiceSelectionMap(play, sourceKey);
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
  if (!uniqueStored.length) return from.slice(0, Math.max(0, Math.min(from.length, count)));
  const normalizedByOrder = from.filter((entry) => uniqueStored.includes(normalizeChoiceToken(entry)));
  return normalizedByOrder.slice(0, Math.max(0, Math.min(from.length, count)));
}

function getStoredAutoChoiceSelectedValues(play, sourceKey, choiceId, from, count, options = {}) {
  const shouldAllowDuplicates =
    options?.allowDuplicates === true
    || (options?.allowDuplicates == null && String(sourceKey ?? "").startsWith("asi:"));
  const preserveStoredOrder = Boolean(options?.preserveStoredOrder) || shouldAllowDuplicates;
  const selectionMap = getAutoChoiceSelectionMap(play, sourceKey);
  const storedRaw = selectionMap[choiceId];
  const fromByToken = new Map(
    from
      .map((entry) => [normalizeChoiceToken(entry), entry])
      .filter(([token, entry]) => token && entry)
  );
  const stored = (Array.isArray(storedRaw) ? storedRaw : [])
    .map((entry) => normalizeChoiceToken(entry))
    .filter((token) => fromByToken.has(token));
  if (preserveStoredOrder) {
    if (!stored.length) return from.slice(0, Math.max(0, Math.min(from.length, count)));
    const ordered = stored
      .map((token) => fromByToken.get(token))
      .filter(Boolean);
    if (shouldAllowDuplicates) {
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
  return normalizedByOrder.slice(0, Math.max(0, Math.min(from.length, count)));
}

function applyAbilityChoiceBonuses(choice, bonuses, context) {
  if (!choice) return;
  const weighted = isRecordObject(choice.weighted) ? choice.weighted : null;
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
  const countFromWeights = weightValues.length;
  const countFromChoice = Math.max(0, toNumber(choice.count ?? weighted?.count, 0));
  const count = Math.max(1, Math.min(from.length, countFromChoice || countFromWeights || 1));
  const choiceId = `a:${context.optionIndex}:choose:${context.choiceIndex}`;
  const selected = getStoredAutoChoiceSelectedValues(context.play, context.sourceKey, choiceId, from, count, {
    allowDuplicates: false,
    preserveStoredOrder: weightValues.length > 1,
  });
  selected.forEach((ability, index) => {
    const amount = Math.max(1, toNumber(weightValues[index], fallbackAmount));
    bonuses[ability] = Math.max(0, toNumber(bonuses[ability], 0) + amount);
  });
}

function getAbilityBonusesFromEntity(entry, sourceKey, play) {
  const bonuses = getEmptyAbilityMap();
  const options = Array.isArray(entry?.ability) ? entry.ability : [];
  const optionIndex = options.findIndex((option) => isRecordObject(option));
  const selected = optionIndex >= 0 ? options[optionIndex] : null;
  if (!selected) return bonuses;
  let abilityChoiceIndex = 0;
  Object.entries(selected).forEach(([key, value]) => {
    const ability = normalizeAbilityKey(key);
    if (ability) {
      const amount = Math.max(0, toNumber(value, 0));
      bonuses[ability] = Math.max(0, toNumber(bonuses[ability], 0) + amount);
      return;
    }
    if (key === "choose") {
      if (Array.isArray(value)) {
        value.forEach((choice) => {
          applyAbilityChoiceBonuses(choice, bonuses, { play, sourceKey, optionIndex, choiceIndex: abilityChoiceIndex });
          abilityChoiceIndex += 1;
        });
      } else if (isRecordObject(value)) {
        applyAbilityChoiceBonuses(value, bonuses, { play, sourceKey, optionIndex, choiceIndex: abilityChoiceIndex });
        abilityChoiceIndex += 1;
      }
    }
  });
  return bonuses;
}

function getSelectedFeatAndOptionalFeatureEntries(catalogs, character, sourceOrder) {
  const selectedFeats = Array.isArray(character?.feats) ? character.feats : [];
  const featEntries = selectedFeats
    .map((feat) => {
      const entry = findCatalogEntryByNameWithSelectedSourcePreference(catalogs?.feats, feat?.name, feat?.source, sourceOrder);
      if (!entry) return null;
      const sourceKey = `feat:${String(feat?.id ?? "").trim() || buildEntityId(["feat", feat?.name, feat?.source])}`;
      return { entry, sourceKey };
    })
    .filter(Boolean);
  const selectedOptionalFeatures = Array.isArray(character?.optionalFeatures) ? character.optionalFeatures : [];
  const optionalFeatureEntries = selectedOptionalFeatures
    .map((feature) => {
      const entry = findCatalogEntryByNameWithSelectedSourcePreference(catalogs?.optionalFeatures, feature?.name, feature?.source, sourceOrder);
      if (!entry) return null;
      const sourceKey = `optional-feature:${
        String(feature?.id ?? "").trim() || buildEntityId(["optionalfeature", feature?.name, feature?.source])
      }`;
      return { entry, sourceKey };
    })
    .filter(Boolean);
  return { featEntries, optionalFeatureEntries };
}

function getAutomaticAbilityBonuses(catalogs, character, play) {
  const sourceOrder = getPreferredSourceOrder(character);
  const raceEntry = findCatalogEntryByNameWithSelectedSourcePreference(
    catalogs?.races,
    character?.race,
    character?.raceSource,
    sourceOrder
  );
  const backgroundEntry = findCatalogEntryByNameWithSelectedSourcePreference(
    catalogs?.backgrounds,
    character?.background,
    character?.backgroundSource,
    sourceOrder
  );
  const raceBonuses = getAbilityBonusesFromEntity(raceEntry, "race", play);
  const backgroundBonuses = getAbilityBonusesFromEntity(backgroundEntry, "background", play);
  const { featEntries, optionalFeatureEntries } = getSelectedFeatAndOptionalFeatureEntries(catalogs, character, sourceOrder);
  const featBonuses = getEmptyAbilityMap();
  featEntries.forEach(({ entry, sourceKey }) => {
    const bonuses = getAbilityBonusesFromEntity(entry, sourceKey, play);
    SAVE_ABILITIES.forEach((ability) => {
      featBonuses[ability] = Math.max(0, toNumber(featBonuses?.[ability], 0) + toNumber(bonuses?.[ability], 0));
    });
  });
  const optionalFeatureBonuses = getEmptyAbilityMap();
  optionalFeatureEntries.forEach(({ entry, sourceKey }) => {
    const bonuses = getAbilityBonusesFromEntity(entry, sourceKey, play);
    SAVE_ABILITIES.forEach((ability) => {
      optionalFeatureBonuses[ability] = Math.max(
        0,
        toNumber(optionalFeatureBonuses?.[ability], 0) + toNumber(bonuses?.[ability], 0)
      );
    });
  });
  const featSlots = Array.isArray(character?.progression?.featSlots) ? character.progression.featSlots : [];
  const selectedFeatSlotIds = new Set(
    (Array.isArray(character?.feats) ? character.feats : [])
      .map((feat) => String(feat?.slotId ?? "").trim())
      .filter(Boolean)
  );
  const asiBonuses = getEmptyAbilityMap();
  featSlots
    .filter((slot) => ASI_FEATURE_NAME_REGEX.test(String(slot?.slotType ?? "")))
    .filter((slot) => !selectedFeatSlotIds.has(String(slot?.id ?? "").trim()))
    .forEach((slot) => {
      const sourceKey = `asi:${String(slot?.id ?? "").trim()}`;
      if (!sourceKey) return;
      const selectedAbilities = getStoredAutoChoiceSelectedValues(play, sourceKey, "a:0:choose:0", SAVE_ABILITIES, 2);
      selectedAbilities.forEach((ability) => {
        asiBonuses[ability] = Math.max(0, toNumber(asiBonuses[ability], 0) + 1);
      });
    });
  return SAVE_ABILITIES.reduce((acc, ability) => {
    acc[ability] = Math.max(
      0,
      toNumber(raceBonuses[ability], 0)
        + toNumber(backgroundBonuses[ability], 0)
        + toNumber(asiBonuses[ability], 0)
        + toNumber(featBonuses[ability], 0)
        + toNumber(optionalFeatureBonuses[ability], 0)
    );
    return acc;
  }, {});
}

function mergeProficienciesWithOverrides(auto, overrides, keys) {
  return keys.reduce((acc, key) => {
    const overrideValue = overrides?.[key];
    if (typeof overrideValue === "boolean") {
      acc[key] = overrideValue;
      return acc;
    }
    acc[key] = Boolean(auto?.[key]);
    return acc;
  }, {});
}

function deriveLegacyProficiencyOverrides(current, auto, keys) {
  const overrides = {};
  keys.forEach((key) => {
    const currentValue = Boolean(current?.[key]);
    const autoValue = Boolean(auto?.[key]);
    if (currentValue !== autoValue) overrides[key] = currentValue;
  });
  return overrides;
}

function hasStoredProficiencyState(stateMap, keys) {
  return keys.some((key) => typeof stateMap?.[key] === "boolean");
}

function normalizeSkillProficiencyMode(value, fallback = SKILL_PROFICIENCY_NONE) {
  const mode = String(value ?? "").trim().toLowerCase();
  return SKILL_PROFICIENCY_MODES.includes(mode) ? mode : fallback;
}

function isSkillModeProficient(mode) {
  return mode === SKILL_PROFICIENCY_PROFICIENT || mode === SKILL_PROFICIENCY_EXPERTISE;
}

function hasStoredSkillModeState(stateMap, keys) {
  return keys.some((key) => SKILL_PROFICIENCY_MODES.includes(String(stateMap?.[key] ?? "").trim().toLowerCase()));
}

function mapSkillModesToProficiencyMap(modeMap, keys) {
  return keys.reduce((acc, key) => {
    acc[key] = isSkillModeProficient(normalizeSkillProficiencyMode(modeMap?.[key], SKILL_PROFICIENCY_NONE));
    return acc;
  }, {});
}

function mergeSkillModesWithOverrides(autoModes, overrides, keys) {
  return keys.reduce((acc, key) => {
    const overrideMode = normalizeSkillProficiencyMode(overrides?.[key], "");
    if (overrideMode) {
      acc[key] = overrideMode;
      return acc;
    }
    acc[key] = normalizeSkillProficiencyMode(autoModes?.[key], SKILL_PROFICIENCY_NONE);
    return acc;
  }, {});
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

function applySkillProficiencyOption(activeSkills, option, context) {
  if (!isRecordObject(option)) return;
  const fixedSkillKeys = Object.entries(option)
    .filter(([key, value]) => key !== "choose" && key !== "any" && value === true)
    .map(([key]) => normalizeSkillKey(key))
    .filter(Boolean);
  fixedSkillKeys.forEach((skillKey) => activeSkills.add(skillKey));

  const anyCount = Math.max(0, toNumber(option.any, 0));
  if (anyCount > 0) {
    const pool = SKILLS.map((skill) => skill.key).filter((skillKey) => !activeSkills.has(skillKey));
    const anyChoiceId = `s:${context.optionIndex}:any`;
    const selected = getAutoChoiceSelectedValues(context.play, context.sourceKey, anyChoiceId, pool, anyCount);
    selected.forEach((skillKey) => activeSkills.add(skillKey));
  }

  const choose = isRecordObject(option.choose) ? option.choose : null;
  if (!choose) return;
  const from = (Array.isArray(choose.from) ? choose.from : [])
    .map((entry) => normalizeSkillKey(entry))
    .filter(Boolean)
    .filter((skillKey, index, list) => list.indexOf(skillKey) === index);
  if (!from.length) return;
  const count = Math.max(1, toNumber(choose.count, 1));
  const pool = from.filter((skillKey) => !activeSkills.has(skillKey));
  const chooseChoiceId = `s:${context.optionIndex}:choose`;
  const selected = getAutoChoiceSelectedValues(context.play, context.sourceKey, chooseChoiceId, pool, count);
  selected.forEach((skillKey) => activeSkills.add(skillKey));
}

function collectSkillProficienciesFromEntity(entry, sourceKey, play) {
  const activeSkills = new Set();
  const options = Array.isArray(entry?.skillProficiencies) ? entry.skillProficiencies : [];
  const optionIndex = options.findIndex((option) => isRecordObject(option));
  const firstOption = optionIndex >= 0 ? options[optionIndex] : null;
  if (firstOption) applySkillProficiencyOption(activeSkills, firstOption, { play, sourceKey, optionIndex });
  return activeSkills;
}

function collectSkillProficienciesFromClassEntry(classEntry, play, sourceKey = "class") {
  const activeSkills = new Set();
  const skills = Array.isArray(classEntry?.startingProficiencies?.skills) ? classEntry.startingProficiencies.skills : [];
  skills.forEach((entry, optionIndex) => {
    if (typeof entry === "string") {
      const skillKey = normalizeSkillKey(entry);
      if (skillKey) activeSkills.add(skillKey);
      return;
    }
    const choose = isRecordObject(entry?.choose) ? entry.choose : null;
    if (!choose) return;
    const from = (Array.isArray(choose.from) ? choose.from : [])
      .map((value) => normalizeSkillKey(value))
      .filter(Boolean)
      .filter((skillKey, index, list) => list.indexOf(skillKey) === index);
    if (!from.length) return;
    const count = Math.max(1, Math.min(from.length, toNumber(choose.count, 1)));
    const choiceId = `cs:${optionIndex}:choose`;
    const selected = getAutoChoiceSelectedValues(play, sourceKey, choiceId, from, count);
    selected.forEach((skillKey) => activeSkills.add(skillKey));
  });
  return activeSkills;
}

function getAutomaticSaveProficiencies(catalogs, character) {
  const auto = { ...getClassSaveProficiencies(catalogs, character?.class) };
  const sourceOrder = getPreferredSourceOrder(character);
  const raceEntry = findCatalogEntryByNameWithSelectedSourcePreference(
    catalogs?.races,
    character?.race,
    character?.raceSource,
    sourceOrder
  );
  const backgroundEntry = findCatalogEntryByNameWithSelectedSourcePreference(
    catalogs?.backgrounds,
    character?.background,
    character?.backgroundSource,
    sourceOrder
  );
  const { featEntries, optionalFeatureEntries } = getSelectedFeatAndOptionalFeatureEntries(catalogs, character, sourceOrder);
  [raceEntry, backgroundEntry, ...featEntries.map((item) => item.entry), ...optionalFeatureEntries.map((item) => item.entry)].forEach((entry) => {
    const saveOptions = Array.isArray(entry?.saveProficiencies) ? entry.saveProficiencies : [];
    const selected = saveOptions.find((option) => isRecordObject(option)) ?? null;
    if (!selected) return;
    Object.entries(selected).forEach(([key, value]) => {
      const ability = normalizeAbilityKey(key);
      if (!ability || value !== true) return;
      auto[ability] = true;
    });
  });
  return SAVE_ABILITIES.reduce((acc, ability) => {
    acc[ability] = Boolean(auto?.[ability]);
    return acc;
  }, {});
}

function getAutomaticSkillProficiencies(catalogs, character, play) {
  const sourceOrder = getPreferredSourceOrder(character);
  const classEntry = getClassCatalogEntry(catalogs, character?.class, character?.classSource, sourceOrder);
  const raceEntry = findCatalogEntryByNameWithSelectedSourcePreference(
    catalogs?.races,
    character?.race,
    character?.raceSource,
    sourceOrder
  );
  const backgroundEntry = findCatalogEntryByNameWithSelectedSourcePreference(
    catalogs?.backgrounds,
    character?.background,
    character?.backgroundSource,
    sourceOrder
  );
  const { featEntries, optionalFeatureEntries } = getSelectedFeatAndOptionalFeatureEntries(catalogs, character, sourceOrder);
  const activeSkills = new Set();
  if (classEntry) {
    const className = String(classEntry?.name ?? character?.class ?? "").trim().toLowerCase();
    collectSkillProficienciesFromClassEntry(classEntry, play, `class:${className || "primary"}`).forEach((skillKey) =>
      activeSkills.add(skillKey)
    );
  }
  [raceEntry, backgroundEntry].forEach((entry) => {
    const sourceKey = entry === raceEntry ? "race" : "background";
    collectSkillProficienciesFromEntity(entry, sourceKey, play).forEach((skillKey) => activeSkills.add(skillKey));
  });
  featEntries.forEach(({ entry, sourceKey }) => {
    collectSkillProficienciesFromEntity(entry, sourceKey, play).forEach((skillKey) => activeSkills.add(skillKey));
  });
  optionalFeatureEntries.forEach(({ entry, sourceKey }) => {
    collectSkillProficienciesFromEntity(entry, sourceKey, play).forEach((skillKey) => activeSkills.add(skillKey));
  });
  return SKILLS.reduce((acc, skill) => {
    acc[skill.key] = activeSkills.has(skill.key);
    return acc;
  }, {});
}

function getAutomaticSkillProficiencyModes(catalogs, character, play) {
  const baseProficiencies = getAutomaticSkillProficiencies(catalogs, character, play);
  const modes = SKILLS.reduce((acc, skill) => {
    acc[skill.key] = baseProficiencies?.[skill.key] ? SKILL_PROFICIENCY_PROFICIENT : SKILL_PROFICIENCY_NONE;
    return acc;
  }, {});
  const bardLevel = getClassLevelByName(character, "bard");
  if (bardLevel >= 2) {
    SKILLS.forEach((skill) => {
      if (modes[skill.key] === SKILL_PROFICIENCY_NONE) modes[skill.key] = SKILL_PROFICIENCY_HALF;
    });
  }
  return modes;
}

function formatSourceSummaryLabel(value) {
  const token = String(value ?? "").trim();
  if (!token) return "";
  return cleanSpellInlineTags(token)
    .toLowerCase()
    .replace(/(^|[\s(/-])([a-z])/g, (match, prefix, letter) => `${prefix}${letter.toUpperCase()}`)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSummaryLabel(value) {
  return formatSourceSummaryLabel(value).toLowerCase();
}

function createSummaryCollector() {
  const byLabel = new Map();
  const add = (label, source = "") => {
    const normalized = normalizeSummaryLabel(label);
    if (!normalized) return;
    if (!byLabel.has(normalized)) byLabel.set(normalized, { label: formatSourceSummaryLabel(label), sourceSet: new Set() });
    if (source) byLabel.get(normalized).sourceSet.add(formatSourceSummaryLabel(source));
  };
  const list = () =>
    [...byLabel.values()]
      .map((entry) => ({
        label: entry.label,
        sources: [...entry.sourceSet].filter(Boolean).sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  return { add, list };
}

function formatToolCategoryLabel(key, count = 1) {
  const normalized = normalizeToolCategoryKey(key);
  const total = Math.max(1, toNumber(count, 1));
  if (normalized === "any") return total > 1 ? `Any tools (${total})` : "Any tool";
  if (normalized === "anytool") return total > 1 ? `Any tools (${total})` : "Any tool";
  if (normalized === "anyartisantool") return total > 1 ? `Any artisan's tools (${total})` : "Any artisan's tool";
  if (normalized === "anymusicalinstrument") return total > 1 ? `Any musical instruments (${total})` : "Any musical instrument";
  if (normalized === "anygamingset") return total > 1 ? `Any gaming sets (${total})` : "Any gaming set";
  const cleaned = formatSourceSummaryLabel(key);
  if (!cleaned) return "";
  return total > 1 ? `${cleaned} (${total})` : cleaned;
}

function normalizeToolTypeCode(value) {
  return String(value ?? "")
    .split("|")[0]
    .trim()
    .toUpperCase();
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

function isMundaneToolCatalogItem(entry) {
  if (!isRecordObject(entry)) return false;
  const rarity = String(entry?.rarity ?? "").trim().toLowerCase();
  const hasAttunement = String(entry?.reqAttune ?? "").trim().length > 0;
  const isMundaneRarity = !rarity || rarity === "none" || rarity === "unknown";
  return isMundaneRarity && !hasAttunement;
}

function getToolPoolsFromCatalogs(catalogs) {
  const items = Array.isArray(catalogs?.items) ? catalogs.items : [];
  const normalizeToolName = (value) => formatSourceSummaryLabel(value).toLowerCase();
  const dedupeByName = (list) =>
    list.filter((entry, index, arr) => arr.findIndex((other) => normalizeToolName(other) === normalizeToolName(entry)) === index);
  const allTools = dedupeByName(
    items
      .filter((entry) => ["AT", "INS", "GS", "T"].includes(normalizeToolTypeCode(entry?.type ?? entry?.itemType)))
      .filter((entry) => isMundaneToolCatalogItem(entry))
      .map((entry) => formatSourceSummaryLabel(entry?.name))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  );
  const artisansTools = dedupeByName(
    items
      .filter((entry) => normalizeToolTypeCode(entry?.type ?? entry?.itemType) === "AT")
      .filter((entry) => isMundaneToolCatalogItem(entry))
      .map((entry) => formatSourceSummaryLabel(entry?.name))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  );
  const musicalInstruments = dedupeByName(
    items
      .filter((entry) => normalizeToolTypeCode(entry?.type ?? entry?.itemType) === "INS")
      .filter((entry) => isMundaneToolCatalogItem(entry))
      .map((entry) => formatSourceSummaryLabel(entry?.name))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  );
  const gamingSets = dedupeByName(
    items
      .filter((entry) => normalizeToolTypeCode(entry?.type ?? entry?.itemType) === "GS")
      .filter((entry) => isMundaneToolCatalogItem(entry))
      .map((entry) => formatSourceSummaryLabel(entry?.name))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  );
  return { allTools, artisansTools, musicalInstruments, gamingSets };
}

function getToolPoolForCategory(categoryKey, pools) {
  const normalized = normalizeToolCategoryKey(categoryKey);
  if (normalized === "any" || normalized === "anytool") return pools.allTools;
  if (normalized === "anyartisantool") return pools.artisansTools;
  if (normalized === "anymusicalinstrument") return pools.musicalInstruments;
  if (normalized === "anygamingset") return pools.gamingSets;
  return [];
}

function addToolProficienciesFromStructuredSpec(collector, spec, sourceLabel = "", options = {}) {
  if (!Array.isArray(spec)) return;
  const sourceKey = String(options?.sourceKey ?? "").trim();
  const play = options?.play;
  const pools = options?.pools ?? getToolPoolsFromCatalogs(options?.catalogs);
  spec.forEach((entry, optionIndex) => {
    if (typeof entry === "string") {
      const label = formatSourceSummaryLabel(entry);
      if (label) collector.add(label, sourceLabel);
      return;
    }
    if (!isRecordObject(entry)) return;
    Object.entries(entry).forEach(([key, value]) => {
      if (key === "choose" && isRecordObject(value)) {
        const from = (Array.isArray(value.from) ? value.from : [])
          .map((item) => formatSourceSummaryLabel(item))
          .filter(Boolean);
        const count = Math.max(1, toNumber(value.count, 1));
        if (sourceKey && from.length) {
          const choiceId = `t:${optionIndex}:choose`;
          const selected = getStoredAutoChoiceSelectedValues(play, sourceKey, choiceId, from, count, {
            allowDuplicates: false,
            preserveStoredOrder: false,
          });
          if (selected.length) {
            selected.forEach((selectedTool) => collector.add(selectedTool, sourceLabel));
            return;
          }
        }
        if (from.length) {
          collector.add(`Choose ${count} tool${count > 1 ? "s" : ""}`, sourceLabel);
        }
        return;
      }
      if (value === true) {
        collector.add(formatToolCategoryLabel(key, 1), sourceLabel);
        return;
      }
      if (Number.isFinite(toNumber(value, NaN)) && toNumber(value, 0) > 0) {
        const count = Math.max(1, toNumber(value, 1));
        const pool = getToolPoolForCategory(key, pools);
        if (sourceKey && pool.length) {
          const choiceId = `t:${optionIndex}:${String(key ?? "").trim().toLowerCase()}`;
          const selected = getStoredAutoChoiceSelectedValues(play, sourceKey, choiceId, pool, count, {
            allowDuplicates: false,
            preserveStoredOrder: false,
          });
          if (selected.length) {
            selected.forEach((selectedTool) => collector.add(selectedTool, sourceLabel));
            return;
          }
        }
        collector.add(formatToolCategoryLabel(key, count), sourceLabel);
      }
    });
  });
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

function addDefenseEntries(collector, entries, sourceLabel = "", options = {}) {
  const singular = String(options?.singular ?? "type").trim();
  const sourceKey = String(options?.sourceKey ?? "").trim();
  const play = isRecordObject(options?.play) ? options.play : null;
  const entryKey = String(options?.entryKey ?? "").trim();
  if (!Array.isArray(entries)) return;
  entries.forEach((entry, optionIndex) => {
    if (typeof entry === "string") {
      const label = formatDefenseTypeLabel(entry);
      if (label) collector.add(label, sourceLabel);
      return;
    }
    if (!isRecordObject(entry)) return;
    const choose = isRecordObject(entry.choose) ? entry.choose : null;
    if (!choose) return;
    const from = (Array.isArray(choose.from) ? choose.from : [])
      .map((item) => formatDefenseTypeLabel(item))
      .filter(Boolean);
    const count = Math.max(1, toNumber(choose.count, 1));
    if (!from.length) return;
    if (sourceKey && play && entryKey) {
      const choiceId = `d:${entryKey}:${optionIndex}:choose`;
      const selected = getStoredAutoChoiceSelectedValues(play, sourceKey, choiceId, from, count, {
        allowDuplicates: false,
        preserveStoredOrder: false,
      });
      if (selected.length) {
        selected.forEach((selectedType) => collector.add(selectedType, sourceLabel));
        return;
      }
    }
    collector.add(`Choose ${count} ${singular}${count > 1 ? "s" : ""}: ${from.join(", ")}`, sourceLabel);
  });
}

function getCharacterToolAndDefenseSummary(catalogs, character) {
  const sourceOrder = getPreferredSourceOrder(character);
  const raceEntry = findCatalogEntryByNameWithSelectedSourcePreference(
    catalogs?.races,
    character?.race,
    character?.raceSource,
    sourceOrder
  );
  const backgroundEntry = findCatalogEntryByNameWithSelectedSourcePreference(
    catalogs?.backgrounds,
    character?.background,
    character?.backgroundSource,
    sourceOrder
  );
  const classEntry = getClassCatalogEntry(catalogs, character?.class, character?.classSource, sourceOrder);
  const toolCollector = createSummaryCollector();
  const resistanceCollector = createSummaryCollector();
  const immunityCollector = createSummaryCollector();
  const conditionImmunityCollector = createSummaryCollector();
  const vulnerabilityCollector = createSummaryCollector();
  const toolPools = getToolPoolsFromCatalogs(catalogs);

  addToolProficienciesFromStructuredSpec(toolCollector, raceEntry?.toolProficiencies, "Race", {
    sourceKey: "race",
    play: character?.play,
    pools: toolPools,
  });
  addToolProficienciesFromStructuredSpec(toolCollector, backgroundEntry?.toolProficiencies, "Background", {
    sourceKey: "background",
    play: character?.play,
    pools: toolPools,
  });
  const classSourceKey = `class:${String(classEntry?.name ?? character?.class ?? "").trim().toLowerCase() || "primary"}`;
  addToolProficienciesFromStructuredSpec(toolCollector, classEntry?.startingProficiencies?.toolProficiencies, "Class", {
    sourceKey: classSourceKey,
    play: character?.play,
    pools: toolPools,
  });
  const classHasStructuredTools = Array.isArray(classEntry?.startingProficiencies?.toolProficiencies)
    && classEntry.startingProficiencies.toolProficiencies.length > 0;
  if (!classHasStructuredTools && Array.isArray(classEntry?.startingProficiencies?.tools)) {
    classEntry.startingProficiencies.tools.forEach((tool) => toolCollector.add(tool, "Class"));
  }

  const multiclassEntries = Array.isArray(character?.multiclass) ? character.multiclass : [];
  multiclassEntries.forEach((entry) => {
    const className = String(entry?.class ?? "").trim();
    if (!className) return;
    const classCatalogEntry = getClassCatalogEntry(catalogs, className, "", sourceOrder);
    const tools = classCatalogEntry?.multiclassing?.proficienciesGained?.tools;
    const multiclassHasStructuredTools = Array.isArray(classCatalogEntry?.multiclassing?.proficienciesGained?.toolProficiencies)
      && classCatalogEntry.multiclassing.proficienciesGained.toolProficiencies.length > 0;
    if (!multiclassHasStructuredTools && Array.isArray(tools)) {
      tools.forEach((tool) => toolCollector.add(tool, "Multiclass"));
    }
    const multiclassSourceKey = `multiclass:${className.toLowerCase() || "class"}`;
    addToolProficienciesFromStructuredSpec(
      toolCollector,
      classCatalogEntry?.multiclassing?.proficienciesGained?.toolProficiencies,
      "Multiclass",
      {
        sourceKey: multiclassSourceKey,
        play: character?.play,
        pools: toolPools,
      }
    );
  });

  const feats = Array.isArray(character?.feats) ? character.feats : [];
  feats.forEach((feat) => {
    const featEntry = findCatalogEntryByNameWithSelectedSourcePreference(catalogs?.feats, feat?.name, feat?.source, sourceOrder);
    if (!featEntry) return;
    addToolProficienciesFromStructuredSpec(toolCollector, featEntry?.toolProficiencies, "Feat", { pools: toolPools });
    addDefenseEntries(resistanceCollector, featEntry?.resist, "Feat", { singular: "resistance" });
    addDefenseEntries(immunityCollector, featEntry?.immune, "Feat", { singular: "immunity" });
    addDefenseEntries(conditionImmunityCollector, featEntry?.conditionImmune, "Feat", { singular: "condition immunity" });
    addDefenseEntries(vulnerabilityCollector, featEntry?.vulnerable, "Feat", { singular: "vulnerability" });
  });

  const optionalFeatures = Array.isArray(character?.optionalFeatures) ? character.optionalFeatures : [];
  optionalFeatures.forEach((feature) => {
    const entry = findCatalogEntryByNameWithSelectedSourcePreference(
      catalogs?.optionalFeatures,
      feature?.name,
      feature?.source,
      sourceOrder
    );
    if (!entry) return;
    addToolProficienciesFromStructuredSpec(toolCollector, entry?.toolProficiencies, "Optional Feature", { pools: toolPools });
    addDefenseEntries(resistanceCollector, entry?.resist, "Optional Feature", { singular: "resistance" });
    addDefenseEntries(immunityCollector, entry?.immune, "Optional Feature", { singular: "immunity" });
    addDefenseEntries(conditionImmunityCollector, entry?.conditionImmune, "Optional Feature", { singular: "condition immunity" });
    addDefenseEntries(vulnerabilityCollector, entry?.vulnerable, "Optional Feature", { singular: "vulnerability" });
  });

  addDefenseEntries(resistanceCollector, raceEntry?.resist, "Race", {
    singular: "resistance",
    sourceKey: "race",
    play: character?.play,
    entryKey: "resist",
  });
  addDefenseEntries(immunityCollector, raceEntry?.immune, "Race", {
    singular: "immunity",
    sourceKey: "race",
    play: character?.play,
    entryKey: "immune",
  });
  addDefenseEntries(conditionImmunityCollector, raceEntry?.conditionImmune, "Race", {
    singular: "condition immunity",
    sourceKey: "race",
    play: character?.play,
    entryKey: "conditionImmune",
  });
  addDefenseEntries(vulnerabilityCollector, raceEntry?.vulnerable, "Race", {
    singular: "vulnerability",
    sourceKey: "race",
    play: character?.play,
    entryKey: "vulnerable",
  });

  return {
    tools: toolCollector.list(),
    resistances: resistanceCollector.list(),
    immunities: immunityCollector.list(),
    conditionImmunities: conditionImmunityCollector.list(),
    vulnerabilities: vulnerabilityCollector.list(),
  };
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
  const sourceOrder = getPreferredSourceOrder(state.character);
  const classEntry = getClassCatalogEntry(state.catalogs, state.character.class, state.character?.classSource, sourceOrder);
  const selected = getPrimarySubclassSelection(state.character);
  const classSource = normalizeSourceTag(classEntry?.source);
  const options = getSubclassCatalogEntries(state.catalogs, state.character.class, classSource, sourceOrder);
  return options.map((entry) => {
    const isSelected =
      selected &&
      String(selected.name ?? "").trim().toLowerCase() === String(entry?.name ?? "").trim().toLowerCase() &&
      (!selected.source || normalizeSourceTag(selected.source) === normalizeSourceTag(entry?.source));
    const subclassSource = normalizeSourceTag(entry?.source);
    const subclassSourceLabel = entry?.sourceLabel ?? SOURCE_LABELS[subclassSource] ?? entry?.source ?? "";
    const subclassClassSource = normalizeSourceTag(entry?.classSource);
    const subclassClassSourceLabel = SOURCE_LABELS[subclassClassSource] ?? entry?.classSource ?? "";
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

function doesCharacterMeetOptionalFeaturePrerequisites(character, optionalFeature) {
  const prerequisites = Array.isArray(optionalFeature?.prerequisite) ? optionalFeature.prerequisite : [];
  if (!prerequisites.length) return true;
  const highestClassLevel = getCharacterHighestClassLevel(character);
  return prerequisites.some((entry) => {
    if (!isRecordObject(entry)) return true;
    const levelRequirement = toNumber(entry.level, NaN);
    if (Number.isFinite(levelRequirement) && highestClassLevel < levelRequirement) return false;
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

function getAdditionalHitPointEntries(catalogs, character) {
  const { primaryLevel, multiclass } = getCharacterClassLevels(character);
  const primaryClassName = String(character?.class ?? "").trim();
  const entries = [];
  const primaryFaces = getClassHitDieFaces(catalogs, primaryClassName);
  const primaryKey = getClassKey(primaryClassName) || "primary";

  for (let level = 2; level <= primaryLevel; level += 1) {
    entries.push({
      key: `${primaryKey}:${level}`,
      className: primaryClassName || "Primary class",
      classLevel: level,
      faces: primaryFaces,
    });
  }

  multiclass.forEach((entry) => {
    const className = String(entry.class ?? "").trim();
    const faces = getClassHitDieFaces(catalogs, className);
    const classKey = getClassKey(className) || "multiclass";
    for (let level = 1; level <= entry.level; level += 1) {
      entries.push({
        key: `${classKey}:${level}`,
        className,
        classLevel: level,
        faces,
      });
    }
  });
  return entries;
}

function getCharacterMaxHp(catalogs, character, options = {}) {
  return getHitPointBreakdown(catalogs, character, options).total;
}

function buildLevelUpHitPointPlan(catalogs, currentCharacter, draft) {
  const currentCharacterDraft = {
    ...currentCharacter,
    class: draft.primaryClass,
    level: draft.totalLevel,
    multiclass: draft.multiclass,
  };
  const currentOverrides = sanitizeHitPointRollOverrides(currentCharacter?.hitPointRollOverrides);
  const currentEntries = getAdditionalHitPointEntries(catalogs, currentCharacter);
  const nextEntries = getAdditionalHitPointEntries(catalogs, currentCharacterDraft);
  const currentEntryKeys = new Set(currentEntries.map((entry) => entry.key));
  const nextEntryKeys = new Set(nextEntries.map((entry) => entry.key));
  const gainedEntries = nextEntries.filter((entry) => !currentEntryKeys.has(entry.key));
  const lostEntries = currentEntries.filter((entry) => !nextEntryKeys.has(entry.key));
  const choicesRaw = draft?.hitPointChoices;
  const draftChoices = choicesRaw && typeof choicesRaw === "object" && !Array.isArray(choicesRaw) ? choicesRaw : {};
  const nextRollOverrides = Object.fromEntries(Object.entries(currentOverrides).filter(([key]) => nextEntryKeys.has(key)));
  const resolvedGainedEntries = gainedEntries.map((entry) => {
    const draftChoice = draftChoices?.[entry.key];
    const method = draftChoice?.method === "roll" ? "roll" : "fixed";
    let rollValue = Math.floor(toNumber(draftChoice?.rollValue, NaN));
    if (!(Number.isFinite(rollValue) && rollValue >= 1 && rollValue <= entry.faces)) {
      rollValue = method === "roll" ? rollDie(entry.faces) : null;
    }
    const fixedValue = getFixedHitPointGain(entry.faces);
    const baseGain = method === "roll" ? rollValue : fixedValue;
    if (method === "roll" && Number.isFinite(rollValue)) nextRollOverrides[entry.key] = rollValue;
    else delete nextRollOverrides[entry.key];
    return {
      ...entry,
      method,
      rollValue,
      fixedValue,
      baseGain,
    };
  });
  const { totalLevel: currentTotalLevel } = getCharacterClassLevels(currentCharacter);
  const { totalLevel: nextTotalLevel } = getCharacterClassLevels(currentCharacterDraft);
  const levelDelta = nextTotalLevel - currentTotalLevel;
  const conMod = Math.floor((toNumber(currentCharacter?.abilities?.con, 10) - 10) / 2);
  const baseDelta = resolvedGainedEntries.reduce((sum, entry) => sum + Math.max(1, toNumber(entry.baseGain, 0)), 0)
    - lostEntries.reduce((sum, entry) => {
      const rolled = Math.floor(toNumber(currentOverrides[entry.key], NaN));
      if (Number.isFinite(rolled) && rolled >= 1 && rolled <= entry.faces) return sum + rolled;
      return sum + getFixedHitPointGain(entry.faces);
    }, 0);
  const conDelta = conMod * levelDelta;
  const currentHpBreakdown = getHitPointBreakdown(catalogs, currentCharacter, { rollOverrides: currentOverrides });
  const nextHpBreakdown = getHitPointBreakdown(catalogs, currentCharacterDraft, { rollOverrides: nextRollOverrides });
  const currentMaxHp = currentHpBreakdown.total;
  const nextMaxHp = nextHpBreakdown.total;
  const featDelta = nextHpBreakdown.featBonusHp - currentHpBreakdown.featBonusHp;
  return {
    levelDelta,
    conMod,
    currentMaxHp,
    nextMaxHp,
    totalDelta: nextMaxHp - currentMaxHp,
    baseDelta,
    conDelta,
    featDelta,
    gainedEntries: resolvedGainedEntries,
    nextRollOverrides,
  };
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
  const sourceOrder = getPreferredSourceOrder(character);
  const primaryClassEntry = getClassCatalogEntry(catalogs, primaryClassName, character?.classSource, sourceOrder);
  const resolvedPrimaryClassName = String(primaryClassEntry?.name ?? primaryClassName).trim();

  const { primaryLevel, multiclass } = getCharacterClassLevels(character);
  if (!multiclass.length) {
    return getClassSpellSlotDefaults(catalogs, resolvedPrimaryClassName, primaryLevel);
  }

  const casterLevel = getClassCasterContribution(catalogs, resolvedPrimaryClassName, primaryLevel)
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

function getSpellByName(state, spellName) {
  const normalized = cleanSpellInlineTags(String(spellName ?? "").trim());
  if (!normalized) return null;
  const exact = state.catalogs.spells.find((spell) => spell.name === normalized);
  if (exact) return exact;
  const lowered = normalized.toLowerCase();
  return state.catalogs.spells.find((spell) => String(spell?.name ?? "").trim().toLowerCase() === lowered) ?? null;
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

function getCharacterAllowedSources(character) {
  const sourcePreset = resolveRuntimeSourcePreset(character?.sourcePreset ?? DEFAULT_SOURCE_PRESET);
  const presetSources = runtimeSourcePresets[sourcePreset] ?? getAllowedSources(sourcePreset);
  const customSources = Array.isArray(character?.customSources)
    ? character.customSources.map((entry) => String(entry ?? "").trim()).filter(Boolean)
    : [];
  return [...new Set([...presetSources, ...customSources])];
}

function getSpellSaveAbilityKeys(spell, descriptionText = "") {
  const keys = [];
  const addKey = (value) => {
    const key = normalizeAbilityKey(value);
    if (!key || keys.includes(key)) return;
    keys.push(key);
  };

  const savingThrowList = Array.isArray(spell?.savingThrow) ? spell.savingThrow : [];
  savingThrowList.forEach((entry) => addKey(entry));

  if (!keys.length && spell?.save && typeof spell.save === "object") {
    Object.keys(spell.save).forEach((entry) => addKey(entry));
  }

  if (!keys.length && descriptionText) {
    const matches = [...descriptionText.matchAll(/\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving\s+throw\b/gi)];
    matches.forEach((match) => addKey(match[1]));
  }

  return keys;
}

function getSpellCombatContext(state, spell) {
  if (!spell || typeof spell !== "object") {
    return {
      hasSpellAttack: false,
      attackLabel: "Spell Attack",
      attackBonus: null,
      hasSave: false,
      saveDc: null,
      saveText: "",
    };
  }

  const lines = getSpellDescriptionLines(spell);
  const descriptionText = lines.join(" ").toLowerCase();
  const hasMeleeSpellAttack = /melee spell attack/.test(descriptionText);
  const hasRangedSpellAttack = /ranged spell attack/.test(descriptionText);
  const hasGenericSpellAttack = /spell attack/.test(descriptionText);
  const hasSpellAttack = hasMeleeSpellAttack || hasRangedSpellAttack || hasGenericSpellAttack;
  const attackLabel = hasMeleeSpellAttack ? "Melee Spell Attack" : hasRangedSpellAttack ? "Ranged Spell Attack" : "Spell Attack";

  const saveAbilityKeys = getSpellSaveAbilityKeys(spell, descriptionText);
  const hasSave = saveAbilityKeys.length > 0 || /\bsaving throw\b/.test(descriptionText);

  const spellcastingAbility = getClassSpellcastingAbility(state?.catalogs, state?.character);
  const spellcastingMod = spellcastingAbility ? toNumber(state?.derived?.mods?.[spellcastingAbility], 0) : 0;
  const proficiencyBonus = toNumber(state?.derived?.proficiencyBonus, 0);
  const hasSpellcastingAbility = Boolean(spellcastingAbility);
  const attackBonus = hasSpellAttack && hasSpellcastingAbility ? spellcastingMod + proficiencyBonus : null;
  const saveDc = hasSave && hasSpellcastingAbility ? 8 + proficiencyBonus + spellcastingMod : null;
  const saveText = saveAbilityKeys.length
    ? `${saveAbilityKeys.map((key) => ABILITY_LABELS[key] ?? key.toUpperCase()).join("/")} save`
    : hasSave
      ? "save"
      : "";

  return {
    hasSpellAttack,
    attackLabel,
    attackBonus,
    hasSave,
    saveDc,
    saveText,
  };
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
    if (!isCantrip && !isSpellAlwaysPrepared(state, spellName, play) && Boolean(play.preparedSpells?.[spellName])) return count + 1;
    return count;
  }, 0);
}

function isSpellAlwaysPrepared(state, spellName, playOverride = null) {
  const play = playOverride ?? state?.character?.play ?? {};
  const key = String(spellName ?? "").trim().toLowerCase();
  if (!key || !isRecordObject(play?.autoPreparedSpells)) return false;
  return Boolean(play.autoPreparedSpells[key]);
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

function getInventoryObjectEntries(character) {
  const inventory = Array.isArray(character?.inventory) ? character.inventory : [];
  return inventory.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
}

function normalizeItemTypeCode(value) {
  return String(value ?? "")
    .split("|")[0]
    .trim()
    .toUpperCase();
}

function normalizeWeaponProficiencyToken(value) {
  const cleanedValue = cleanSpellInlineTags(String(value ?? ""));
  return cleanedValue
    .trim()
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\s+/g, " ");
}

function collectWeaponProficiencyStrings(value, out = []) {
  if (typeof value === "string") {
    const token = normalizeWeaponProficiencyToken(value);
    if (token) out.push(token);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectWeaponProficiencyStrings(entry, out));
    return out;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => collectWeaponProficiencyStrings(entry, out));
  }
  return out;
}

function getCharacterWeaponProficiencyTokens(catalogs, character) {
  const tracks = getClassLevelTracks(character);
  const tokens = new Set();
  tracks.forEach((track) => {
    const classEntry = getClassCatalogEntry(catalogs, track.className);
    if (!classEntry) return;
    const primaryWeapons = Array.isArray(classEntry?.startingProficiencies?.weapons) ? classEntry.startingProficiencies.weapons : [];
    const multiclassWeapons = Array.isArray(classEntry?.multiclassing?.proficienciesGained?.weapons)
      ? classEntry.multiclassing.proficienciesGained.weapons
      : [];
    const sourceEntries = track.isPrimary ? primaryWeapons : multiclassWeapons;
    collectWeaponProficiencyStrings(sourceEntries).forEach((token) => tokens.add(token));
  });
  return tokens;
}

function getInventoryItemName(entry) {
  return String(entry?.name ?? "").trim();
}

function isInventoryWeapon(entry) {
  return Boolean(entry?.weapon) || Boolean(entry?.damageDice) || Boolean(entry?.dmg1) || Boolean(entry?.weaponCategory);
}

function getInventoryWeaponCategory(entry) {
  return String(entry?.weaponCategory ?? "").trim().toLowerCase();
}

function getInventoryWeaponProperties(entry) {
  const props = Array.isArray(entry?.properties) ? entry.properties : Array.isArray(entry?.property) ? entry.property : [];
  return props.map((prop) => String(prop ?? "").trim().toUpperCase()).filter(Boolean);
}

function getInventoryWeaponFamily(entry) {
  const category = getInventoryWeaponCategory(entry);
  if (category.includes("simple")) return "simple";
  if (category.includes("martial")) return "martial";
  return "";
}

function isRangedWeaponEntry(entry) {
  const category = getInventoryWeaponCategory(entry);
  const typeCode = normalizeItemTypeCode(entry?.itemType ?? entry?.type);
  const properties = getInventoryWeaponProperties(entry);
  return category.includes("ranged") || properties.includes("R") || typeCode === "R";
}

function normalizeItemNameForProficiency(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\+\d+/g, "")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isWeaponProficient(entry, proficiencyTokens) {
  if (!(proficiencyTokens instanceof Set) || !proficiencyTokens.size) return false;
  if (proficiencyTokens.has("all") || proficiencyTokens.has("all weapons")) return true;

  const tokenList = [...proficiencyTokens];
  const family = getInventoryWeaponFamily(entry);
  const isRanged = isRangedWeaponEntry(entry);
  const isMelee = !isRanged;

  const hasSimpleWeaponProficiency = tokenList.some(
    (token) => token === "simple" || token === "simple weapon" || token === "simple weapons"
  );
  const hasMartialWeaponProficiency = tokenList.some(
    (token) => token === "martial" || token === "martial weapon" || token === "martial weapons"
  );
  const hasRangedWeaponProficiency = tokenList.some((token) => token === "ranged weapon" || token === "ranged weapons");
  const hasMeleeWeaponProficiency = tokenList.some((token) => token === "melee weapon" || token === "melee weapons");

  if (family === "simple" && hasSimpleWeaponProficiency) return true;
  if (family === "martial" && hasMartialWeaponProficiency) return true;
  if (isRanged && hasRangedWeaponProficiency) return true;
  if (isMelee && hasMeleeWeaponProficiency) return true;

  const itemName = normalizeItemNameForProficiency(getInventoryItemName(entry));
  if (itemName && tokenList.some((token) => normalizeItemNameForProficiency(token) === itemName)) return true;

  return false;
}

function getWeaponAttackAbility(entry, derived) {
  const mods = derived?.mods ?? {};
  const strMod = toNumber(mods.str, 0);
  const dexMod = toNumber(mods.dex, 0);
  const category = getInventoryWeaponCategory(entry);
  const properties = getInventoryWeaponProperties(entry);
  const isRanged = category.includes("ranged") || properties.includes("R");
  const hasFinesse = properties.includes("F");

  if (isRanged) return { key: "dex", mod: dexMod };
  if (hasFinesse) return dexMod > strMod ? { key: "dex", mod: dexMod } : { key: "str", mod: strMod };
  return { key: "str", mod: strMod };
}

function formatDamageNotation(diceNotation, modifier) {
  const notation = String(diceNotation ?? "").trim();
  if (!notation) return "";
  const mod = toNumber(modifier, 0);
  if (!mod) return notation;
  return `${notation} ${mod > 0 ? "+" : "-"} ${Math.abs(mod)}`;
}

function parseItemWeaponBonus(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  const direct = Number(text);
  if (Number.isFinite(direct)) return direct;
  const match = text.match(/[+\-]?\d+/);
  if (!match) return fallback;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDamageTypeLabel(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const code = raw.toUpperCase();
  const DAMAGE_TYPE_BY_CODE = {
    A: "acid",
    B: "bludgeoning",
    C: "cold",
    F: "fire",
    I: "poison",
    L: "lightning",
    N: "necrotic",
    O: "force",
    P: "piercing",
    R: "radiant",
    S: "slashing",
    T: "thunder",
    Y: "psychic",
  };
  if (DAMAGE_TYPE_BY_CODE[code]) return DAMAGE_TYPE_BY_CODE[code];
  return raw.toLowerCase();
}

function getWeaponNameBonus(entry) {
  const match = getInventoryItemName(entry).match(/(?:^|\s)\+(\d+)(?:\s|$|\))/i);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeFeatureAttackToken(value) {
  return cleanSpellInlineTags(String(value ?? ""))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreFeatureAttackNameOverlap(left, right) {
  const a = normalizeFeatureAttackToken(left);
  const b = normalizeFeatureAttackToken(right);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 60;
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  let overlap = 0;
  aTokens.forEach((token) => {
    if (bTokens.has(token)) overlap += 1;
  });
  return overlap;
}

function getClassFeatureAttackBuilders() {
  const buildUnarmedStrikeAttack = (context) => {
    const rollNotation = extractSimpleNotation(context?.effect?.rollNotation ?? context?.effect?.value ?? "");
    if (!rollNotation) return null;
    const featureText = String(context?.featureText ?? "").toLowerCase();
    const effectLabel = String(context?.effect?.label ?? "");
    const hintsUnarmed = /unarmed strike|unarmed attacks?|unarmed/.test(featureText);
    const hintsAttack = /\battack\b/.test(featureText);
    const labelHints = /martial arts/i.test(effectLabel);
    if (!(labelHints || (hintsUnarmed && hintsAttack))) return null;

    const strMod = toNumber(context?.derived?.mods?.str, 0);
    const dexMod = toNumber(context?.derived?.mods?.dex, 0);
    const allowsDex = /dexterity (?:modifier )?instead of strength/.test(featureText) || /martial arts/i.test(effectLabel);
    const ability = allowsDex && dexMod >= strMod ? { key: "dex", mod: dexMod } : { key: "str", mod: strMod };
    const proficiencyBonus = toNumber(context?.derived?.proficiencyBonus, 0);
    const damageNotation = formatDamageNotation(rollNotation, ability.mod);
    if (!damageNotation) return null;
    return {
      source: "auto-feature",
      autoSourceLabel: cleanSpellInlineTags(context?.effect?.label || context?.feature?.name || "Class Feature"),
      name: "Unarmed Strike",
      toHit: signed(ability.mod + proficiencyBonus),
      damage: `${damageNotation} bludgeoning`,
      proficient: true,
      ability: ability.key,
    };
  };

  return [buildUnarmedStrikeAttack];
}

function getClassFeatureAutoAttacks(state) {
  const character = state?.character ?? {};
  const progression = character?.progression ?? {};
  const effects = Array.isArray(progression?.classTableEffects) ? progression.classTableEffects : [];
  const unlocked = Array.isArray(progression?.unlockedFeatures) ? progression.unlockedFeatures : [];
  if (!effects.length || !unlocked.length) return [];

  const effectCandidates = effects.filter((effect) => extractSimpleNotation(effect?.rollNotation ?? effect?.value ?? ""));
  if (!effectCandidates.length) return [];

  const builders = getClassFeatureAttackBuilders();
  const attacks = [];
  const seen = new Set();

  effectCandidates.forEach((effect) => {
    const className = String(effect?.className ?? "").trim().toLowerCase();
    if (!className) return;
    let bestFeature = null;
    let bestScore = 0;
    unlocked.forEach((feature) => {
      if (String(feature?.className ?? "").trim().toLowerCase() !== className) return;
      const score = scoreFeatureAttackNameOverlap(effect?.label, feature?.name);
      if (score > bestScore) {
        bestScore = score;
        bestFeature = feature;
      }
    });
    if (!bestFeature) return;
    const detail = resolveFeatureEntryFromCatalogs(state?.catalogs, bestFeature);
    const featureText = getRuleDescriptionLines(detail).join(" ");
    const context = {
      state,
      derived: state?.derived ?? {},
      effect,
      feature: bestFeature,
      featureText,
    };
    builders.forEach((builder) => {
      const attack = builder(context);
      if (!attack) return;
      const key = `${String(attack?.name ?? "").trim().toLowerCase()}|${String(attack?.autoSourceLabel ?? "").trim().toLowerCase()}`;
      if (!key || seen.has(key)) return;
      seen.add(key);
      attacks.push(attack);
    });
  });

  return attacks;
}

function getAutoAttacks(state) {
  const character = state?.character ?? {};
  const equippedWeapons = getInventoryObjectEntries(character).filter((entry) => Boolean(entry?.equipped) && isInventoryWeapon(entry));
  const featureAttacks = getClassFeatureAutoAttacks(state);
  if (!equippedWeapons.length) return featureAttacks;
  const fightingStyles = getCharacterFightingStyleSet(character, state?.catalogs);
  const hasArcheryStyle = fightingStyles.has("archery");
  const hasDuelingStyle = fightingStyles.has("dueling");
  const equippedWeaponCount = equippedWeapons.length;

  const profTokens = getCharacterWeaponProficiencyTokens(state?.catalogs, character);
  const weaponAttacks = equippedWeapons
    .map((entry) => {
      const name = getInventoryItemName(entry);
      if (!name) return null;
      const ability = getWeaponAttackAbility(entry, state?.derived);
      const properties = getInventoryWeaponProperties(entry);
      const isRanged = isRangedWeaponEntry(entry);
      const isMelee = !isRanged;
      const isTwoHanded = properties.includes("2H");
      const proficient = isWeaponProficient(entry, profTokens);
      const proficiencyBonus = proficient ? toNumber(state?.derived?.proficiencyBonus, 0) : 0;
      const nameBonus = getWeaponNameBonus(entry);
      const attackBonus = parseItemWeaponBonus(entry?.weaponAttackBonus, nameBonus);
      const damageBonus = parseItemWeaponBonus(entry?.weaponDamageBonus, nameBonus);
      const styleAttackBonus = hasArcheryStyle && isRanged ? 2 : 0;
      const styleDamageBonus = hasDuelingStyle && isMelee && !isTwoHanded && equippedWeaponCount === 1 ? 2 : 0;
      const toHit = signed(ability.mod + proficiencyBonus + attackBonus + styleAttackBonus);
      const rawDamageDice = String(entry?.damageDice ?? entry?.dmg1 ?? "").trim();
      const baseDamage = rawDamageDice ? formatDamageNotation(rawDamageDice, ability.mod + damageBonus + styleDamageBonus) : "";
      const damageType = normalizeDamageTypeLabel(entry?.damageType ?? entry?.dmgType);
      const damage = baseDamage && damageType ? `${baseDamage} ${damageType}` : baseDamage;
      return {
        source: "auto",
        name,
        toHit,
        damage,
        proficient,
        ability: ability.key,
      };
    })
    .filter(Boolean);
  return [...featureAttacks, ...weaponAttacks];
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
  await ensureRuntimeSourcePresets();
  const resolvedPreset = resolveRuntimeSourcePreset(character?.sourcePreset ?? DEFAULT_SOURCE_PRESET);
  const nextCharacter = character && character.sourcePreset !== resolvedPreset
    ? { ...character, sourcePreset: resolvedPreset }
    : character;
  if (nextCharacter && nextCharacter !== character) {
    const currentSourcePreset = String(store.getState().character?.sourcePreset ?? "").trim();
    if (currentSourcePreset !== resolvedPreset) {
      store.updateCharacter({ sourcePreset: resolvedPreset });
    }
  }
  const catalogs = await loadCatalogs(getCharacterAllowedSources(nextCharacter));
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
    seedCharacterLogState(parsed.character);
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
  const lastCharacterSummary = hasLastCharacter
    ? formatCharacterHistoryEntrySummary(loadCharacterHistory().find((entry) => entry.id === lastCharacterId))
    : "";
  return `
    <main class="layout layout-onboarding">
      <section class="card">
        <div class="title-with-history">
          <a class="app-brand-link" href="/" aria-label="Go to home">
            <img class="app-brand-logo" src="/icons/icon.svg" alt="Action Surge logo" />
          </a>
          <h1 class="title">Action Surge</h1>
          ${renderCharacterHistorySelector("home-character-history-select", null, {
            className: "character-history-control character-history-control-inline",
          })}
        </div>
        <p class="subtitle">
          Saved characters use shareable links. <strong>Create one, then bookmark it in your browser.</strong>
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
              ? `Last character: ${esc(lastCharacterSummary)}`
              : "No recent character found in this browser."
          }
        </p>
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
        <p class="subtitle">Choose a JSON backup file to import.</p>
        <input id="home-import-json-file" type="file" accept=".json,application/json" />
      `,
      actions: [
        {
          label: "Import",
          onClick: async (done) => {
            const input = document.getElementById("home-import-json-file");
            const file = input?.files?.[0] ?? null;
            if (!file) {
              alert("Choose a JSON file to import.");
              return;
            }
            try {
              const result = await importCharacterFromJsonFile(file, { sourceLabel: "Homepage import" });
              if (result?.cancelled) return;
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

const EDIT_PASSWORD_PROMPT_INPUT_ID = "build-mode-edit-password-input";
const EDIT_PASSWORD_PROMPT_STATUS_ID = "build-mode-edit-password-status";

function isInvalidEditPasswordError(error) {
  return Number(error?.status) === 403 && String(error?.payload?.code ?? "") === "INVALID_EDIT_PASSWORD";
}

function getEditPasswordValidationErrorMessage(error) {
  if (isInvalidEditPasswordError(error)) return "Invalid password.";
  const status = Number(error?.status);
  if (!Number.isFinite(status) || status <= 0) {
    return "Could not reach the server to validate the password. Check your connection and try again.";
  }
  if (status >= 500) {
    return "The server could not validate the password right now. Try again in a moment.";
  }
  return error instanceof Error ? error.message : "Could not validate password.";
}

function openInfoModal(title, message) {
  openModal({
    title,
    bodyHtml: `<p class="subtitle">${esc(message)}</p>`,
    actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
  });
}

function openEditPasswordPromptModal(characterId) {
  if (document.getElementById(EDIT_PASSWORD_PROMPT_INPUT_ID)) return;
  let isSubmitting = false;
  let closeModal = () => {};

  const setStatusMessage = (message) => {
    const statusEl = document.getElementById(EDIT_PASSWORD_PROMPT_STATUS_ID);
    if (!statusEl) return;
    statusEl.textContent = String(message ?? "");
  };

  const submitPassword = async () => {
    if (isSubmitting) return;
    const inputEl = document.getElementById(EDIT_PASSWORD_PROMPT_INPUT_ID);
    if (!inputEl) return;
    const enteredPassword = String(inputEl.value ?? "");
    isSubmitting = true;
    inputEl.disabled = true;
    setStatusMessage("");
    try {
      await validateCharacterEditPassword(characterId, enteredPassword);
      store.updateCharacter({ editPassword: enteredPassword });
      closeModal();
      store.setMode("build");
    } catch (error) {
      setStatusMessage(getEditPasswordValidationErrorMessage(error));
    } finally {
      isSubmitting = false;
      inputEl.disabled = false;
      inputEl.focus();
      inputEl.select();
    }
  };

  closeModal = openModal({
    title: "Enter Password",
    bodyHtml: `
      <p class="subtitle">This character is protected. Enter the password to continue.</p>
      <label>Password
        <input id="${EDIT_PASSWORD_PROMPT_INPUT_ID}" type="password" autocomplete="current-password">
      </label>
      <p id="${EDIT_PASSWORD_PROMPT_STATUS_ID}" class="muted" aria-live="polite"></p>
    `,
    actions: [
      { label: "Unlock", onClick: () => void submitPassword() },
      { label: "Cancel", secondary: true, onClick: (done) => done() },
    ],
  });

  const inputEl = document.getElementById(EDIT_PASSWORD_PROMPT_INPUT_ID);
  inputEl?.focus();
  inputEl?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void submitPassword();
  });
}

function bindModeEvents() {

  app.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", async () => {
      const targetMode = button.dataset.mode === "play" ? "play" : "build";
      if (targetMode !== "build") {
        store.setMode(targetMode);
        return;
      }

      const currentState = store.getState();
      const characterId = String(currentState.character?.id ?? "").trim();
      const localEditPassword = getCharacterEditPassword(currentState.character);
      if (localEditPassword) {
        store.setMode("build");
        return;
      }
      if (!isUuid(characterId)) {
        store.setMode("build");
        return;
      }

      try {
        await validateCharacterEditPassword(characterId, "");
        store.updateCharacter({ editPassword: "" });
        store.setMode("build");
      } catch (error) {
        if (isInvalidEditPasswordError(error)) {
          openEditPasswordPromptModal(characterId);
          return;
        }
        openInfoModal("Password Check Failed", getEditPasswordValidationErrorMessage(error));
      }
    });
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
  const currentState = store.getState();
  const nextPlay = structuredClone(currentState.character.play ?? {});
  updater(nextPlay);
  updateCharacterWithRequiredSettings(currentState, { play: nextPlay }, { preserveUserOverrides: true });
}

const pickers = createPickers({
  openModal,
  store,
  esc,
  toNumber,
  matchesSearchQuery,
  buildEntityId,
  doesCharacterMeetFeatPrerequisites,
  doesCharacterMeetOptionalFeaturePrerequisites,
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
  openOptionalFeatureModal,
} = pickers;

const persistence = createPersistence({
  store,
  loadAppState,
  getCharacter,
  saveCharacter,
  createCharacter,
  flushPendingCharacterSync,
  isUuid,
  getCharacterVersion,
  withSyncMeta,
  getCharacterFromApiPayload,
  updatePersistenceStatusFromPayload,
  onEditPasswordRequired: (characterId) => {
    if (store.getState().mode !== "build") return false;
    openEditPasswordPromptModal(characterId);
    return true;
  },
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
  withCharacterChangeLog,
});

const { loadCharacterById, createOrSavePermanentCharacter, queueRemoteSave, bootstrap, flushPendingSaves } = persistence;

const events = createEvents({
  app,
  store,
  toNumber,
  isUuid,
  SKILLS,
  DEFAULT_SOURCE_PRESET: getRuntimeDefaultSourcePreset(),
  getAllowedSources,
  getCharacterAllowedSources,
  sourceLabels: SOURCE_LABELS,
  loadAvailableSourceEntries,
  loadAvailableSources,
  loadCatalogs,
  updateCharacterWithRequiredSettings,
  getClassCatalogEntry,
  normalizeSourceTag,
  withUpdatedPlay,
  openModal,
  openSpellModal,
  openItemModal,
  openFeatModal,
  openOptionalFeatureModal,
  openMulticlassModal,
  openLevelUpModal,
  openSpellDetailsModal,
  getCharacterSpellSlotDefaults,
  createOrSavePermanentCharacter,
  importCharacterFromJsonFile,
  exportCharacterToJsonFile,
  openClassDetailsModal,
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
  sourcePresets: () => runtimeSourcePresets,
  sourcePresetLabels: () => runtimeSourcePresetLabels,
  getCharacterAllowedSources,
  sourceLabels: SOURCE_LABELS,
  optionList,
  getSubclassSelectOptions,
  getFeatSlotsWithSelection,
  getOptionalFeatureSlotsWithSelection,
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
  getSpellCombatContext,
  getSpellLevelLabel,
  spellSchoolLabels: SPELL_SCHOOL_LABELS,
  getRuleDescriptionLines,
  doesClassUsePreparedSpells,
  getPreparedSpellLimit,
  countPreparedSpells,
  isSpellAlwaysPrepared,
  getSaveProficiencyLabelMap,
  getCharacterToolAndDefenseSummary,
  getLevelUpPreview,
  getClassCasterContribution,
  renderCharacterHistorySelector,
  renderPersistenceNotice,
  getModeToggle,
  getAutoAttacks,
  getCharacterChangeLog: () => uiState.characterChangeLog,
  extractSimpleNotation,
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
  let nextCharacter = { ...state.character, ...patch };
  const sourceOrder = getPreferredSourceOrder(nextCharacter);
  const resolvedRace = findCatalogEntryByNameWithSelectedSourcePreference(
    state.catalogs?.races,
    nextCharacter?.race,
    nextCharacter?.raceSource,
    sourceOrder
  );
  const resolvedBackground = findCatalogEntryByNameWithSelectedSourcePreference(
    state.catalogs?.backgrounds,
    nextCharacter?.background,
    nextCharacter?.backgroundSource,
    sourceOrder
  );
  const resolvedClass = findCatalogEntryByNameWithSelectedSourcePreference(
    state.catalogs?.classes,
    nextCharacter?.class,
    nextCharacter?.classSource,
    sourceOrder
  );
  nextCharacter.raceSource = resolvedRace ? normalizeSourceTag(resolvedRace?.source) : "";
  nextCharacter.backgroundSource = resolvedBackground ? normalizeSourceTag(resolvedBackground?.source) : "";
  nextCharacter.classSource = resolvedClass ? normalizeSourceTag(resolvedClass?.source) : "";
  nextCharacter = {
    ...nextCharacter,
    ...resolveImportedCharacterSelections(state.catalogs, nextCharacter),
  };
  const nextPlaySeed = isRecordObject(patch.play) ? patch.play : state.character.play;
  const nextPlay = structuredClone(nextPlaySeed ?? {});
  const autoAbilityBonuses = getAutomaticAbilityBonuses(state.catalogs, nextCharacter, nextPlay);
  const previousAutoBonuses = isRecordObject(state.character?.play?.autoAbilityBonuses) ? state.character.play.autoAbilityBonuses : {};
  const baseAbilities = SAVE_ABILITIES.reduce((acc, ability) => {
    const explicitBase = nextCharacter?.abilityBase?.[ability];
    if (Number.isFinite(toNumber(explicitBase, NaN))) {
      acc[ability] = Math.max(1, Math.min(30, toNumber(explicitBase, 10)));
      return acc;
    }
    const currentFinal = toNumber(nextCharacter?.abilities?.[ability], 10);
    const previousAuto = toNumber(previousAutoBonuses?.[ability], 0);
    acc[ability] = Math.max(1, Math.min(30, currentFinal - previousAuto));
    return acc;
  }, {});
  const nextAbilities = SAVE_ABILITIES.reduce((acc, ability) => {
    acc[ability] = Math.max(1, Math.min(30, toNumber(baseAbilities?.[ability], 10) + toNumber(autoAbilityBonuses?.[ability], 0)));
    return acc;
  }, {});

  const autoSaveProficiencies = getAutomaticSaveProficiencies(state.catalogs, nextCharacter);
  const autoSkillProficiencyModes = getAutomaticSkillProficiencyModes(state.catalogs, nextCharacter, nextPlay);
  const autoSkillProficiencies = mapSkillModesToProficiencyMap(autoSkillProficiencyModes, SKILLS.map((skill) => skill.key));
  let saveOverrides = isRecordObject(nextPlay.saveProficiencyOverrides) ? { ...nextPlay.saveProficiencyOverrides } : {};
  let skillOverrides = isRecordObject(nextPlay.skillProficiencyOverrides) ? { ...nextPlay.skillProficiencyOverrides } : {};
  let skillModeOverrides = isRecordObject(nextPlay.skillProficiencyModeOverrides) ? { ...nextPlay.skillProficiencyModeOverrides } : {};
  const hasLegacySaveSnapshot = hasStoredProficiencyState(nextPlay.saveProficiencies, SAVE_ABILITIES);
  const hasSavedAutoSaveState = hasStoredProficiencyState(nextPlay.autoSaveProficiencies, SAVE_ABILITIES);
  if (!Object.keys(saveOverrides).length && hasLegacySaveSnapshot && !hasSavedAutoSaveState) {
    saveOverrides = deriveLegacyProficiencyOverrides(nextPlay.saveProficiencies, autoSaveProficiencies, SAVE_ABILITIES);
  }
  const skillKeys = SKILLS.map((skill) => skill.key);
  const hasLegacySkillSnapshot = hasStoredProficiencyState(nextPlay.skillProficiencies, skillKeys);
  const hasSavedAutoSkillState = hasStoredProficiencyState(nextPlay.autoSkillProficiencies, skillKeys);
  const hasSavedSkillModeOverrides = hasStoredSkillModeState(nextPlay.skillProficiencyModeOverrides, skillKeys);
  if (!hasSavedSkillModeOverrides && Object.keys(skillOverrides).length) {
    const migrated = {};
    Object.entries(skillOverrides).forEach(([key, value]) => {
      if (!skillKeys.includes(key) || typeof value !== "boolean") return;
      migrated[key] = value ? SKILL_PROFICIENCY_PROFICIENT : SKILL_PROFICIENCY_NONE;
    });
    skillModeOverrides = migrated;
  }
  if (!Object.keys(skillModeOverrides).length && hasLegacySkillSnapshot && !hasSavedAutoSkillState) {
    const legacySkillOverrides = deriveLegacyProficiencyOverrides(nextPlay.skillProficiencies, autoSkillProficiencies, skillKeys);
    skillModeOverrides = Object.fromEntries(
      Object.entries(legacySkillOverrides).map(([key, value]) => [
        key,
        value ? SKILL_PROFICIENCY_PROFICIENT : SKILL_PROFICIENCY_NONE,
      ])
    );
  }
  const nextSkillModes = mergeSkillModesWithOverrides(autoSkillProficiencyModes, skillModeOverrides, skillKeys);
  skillOverrides = Object.fromEntries(
    skillKeys
      .map((key) => {
        const currentIsProf = isSkillModeProficient(nextSkillModes[key]);
        const autoIsProf = isSkillModeProficient(autoSkillProficiencyModes[key]);
        if (currentIsProf === autoIsProf) return null;
        return [key, currentIsProf];
      })
      .filter(Boolean)
  );
  nextPlay.autoAbilityBonuses = autoAbilityBonuses;
  nextPlay.autoSaveProficiencies = autoSaveProficiencies;
  nextPlay.autoSkillProficiencyModes = autoSkillProficiencyModes;
  nextPlay.autoSkillProficiencies = autoSkillProficiencies;
  nextPlay.saveProficiencyOverrides = saveOverrides;
  nextPlay.skillProficiencyModeOverrides = skillModeOverrides;
  nextPlay.skillProficiencyOverrides = skillOverrides;
  nextPlay.saveProficiencies = mergeProficienciesWithOverrides(autoSaveProficiencies, saveOverrides, SAVE_ABILITIES);
  nextPlay.skillProficiencyModes = nextSkillModes;
  nextPlay.skillProficiencies = mapSkillModesToProficiencyMap(nextSkillModes, skillKeys);
  const defaultSpellSlots = getCharacterSpellSlotDefaults(state.catalogs, nextCharacter);
  syncSpellSlotsWithDefaults(nextPlay, defaultSpellSlots, { preserveUserOverrides: options.preserveUserOverrides !== false });
  const nextProgression = recomputeCharacterProgression(state.catalogs, nextCharacter);
  const autoGrantedSpellData = getAutoGrantedSpellData(state.catalogs, nextCharacter);
  const autoGrantedSpells = autoGrantedSpellData.names;
  const autoClassListSpells = getAutoClassListSpellNames(state.catalogs, nextCharacter);
  const previousAutoSpells = Array.isArray(nextPlay.autoGrantedSpells) ? nextPlay.autoGrantedSpells : [];
  const previousClassListSpells = Array.isArray(nextPlay.autoClassListSpells) ? nextPlay.autoClassListSpells : [];
  const previousAutoSet = new Set(previousAutoSpells.map((name) => String(name ?? "").trim().toLowerCase()).filter(Boolean));
  const previousClassListSet = new Set(previousClassListSpells.map((name) => String(name ?? "").trim().toLowerCase()).filter(Boolean));
  const manualSpells = (Array.isArray(nextCharacter.spells) ? nextCharacter.spells : []).filter(
    (name) =>
      !previousAutoSet.has(String(name ?? "").trim().toLowerCase())
      && !previousClassListSet.has(String(name ?? "").trim().toLowerCase())
  );
  const mergedSpellMap = new Map();
  [...manualSpells, ...autoGrantedSpells, ...autoClassListSpells].forEach((name) => {
    const normalized = String(name ?? "").trim();
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (!mergedSpellMap.has(key)) mergedSpellMap.set(key, normalized);
  });
  const nextSpells = [...mergedSpellMap.values()];
  nextPlay.autoGrantedSpells = autoGrantedSpells;
  nextPlay.autoClassListSpells = autoClassListSpells;
  nextPlay.autoPreparedSpells = autoGrantedSpellData.autoPreparedSpells;
  nextPlay.autoSpellGrantTypes = autoGrantedSpellData.autoSpellGrantTypes;
  nextPlay.preparedSpells = Object.fromEntries(
    Object.entries(nextPlay.preparedSpells ?? {}).filter(([name]) =>
      mergedSpellMap.has(String(name ?? "").trim().toLowerCase())
    )
  );
  const autoTrackers = [
    ...getAutoResourcesFromRules(
      state.catalogs,
      nextCharacter,
      nextProgression.unlockedFeatures,
      nextCharacter.feats,
      nextCharacter.optionalFeatures
    ),
    ...getAutoResourcesFromClassTableEffects(
      state.catalogs,
      nextCharacter,
      nextProgression.unlockedFeatures,
      nextProgression.classTableEffects
    ),
  ];
  nextPlay.featureUses = syncAutoFeatureUses(nextPlay, autoTrackers);
  const allowedFeatureModeIds = new Set((nextProgression.featureModes ?? []).map((mode) => mode.id));
  const nextFeatureModes = isRecordObject(nextPlay.featureModes) ? { ...nextPlay.featureModes } : {};
  Object.keys(nextFeatureModes).forEach((modeId) => {
    if (!allowedFeatureModeIds.has(modeId)) delete nextFeatureModes[modeId];
  });
  (nextProgression.featureModes ?? []).forEach((mode) => {
    const options = Array.isArray(mode?.optionValues) ? mode.optionValues : [];
    if (!options.length) return;
    const maxCount = Math.max(1, Math.min(options.length, Math.floor(toNumber(mode?.count, 1))));
    const raw = nextFeatureModes[mode.id];
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
    nextFeatureModes[mode.id] = maxCount <= 1 ? selected[0] : selected.slice(0, maxCount);
  });
  nextPlay.featureModes = nextFeatureModes;
  const selectedSubclass = getSelectedSubclassEntry(state.catalogs, nextCharacter);
  const classEntry = getClassCatalogEntry(state.catalogs, nextCharacter.class, nextCharacter?.classSource, sourceOrder);
  const classSource = normalizeSourceTag(classEntry?.source);
  const classSelection = {
    subclass: {
      name: selectedSubclass?.name ?? "",
      source: selectedSubclass?.source ?? "",
      className: selectedSubclass?.className ?? String(nextCharacter.class ?? "").trim(),
      classSource: selectedSubclass?.classSource ?? classSource,
    },
  };
  const subclassName = classSelection.subclass.name || "";
  store.updateCharacter({
    ...patch,
    raceSource: nextCharacter.raceSource,
    backgroundSource: nextCharacter.backgroundSource,
    classSource: nextCharacter.classSource,
    abilities: nextAbilities,
    abilityBase: baseAbilities,
    subclass: subclassName,
    classSelection,
    progression: nextProgression,
    feats: nextCharacter.feats,
    optionalFeatures: nextCharacter.optionalFeatures,
    spells: nextSpells,
    play: nextPlay,
  });
}

function createLevelUpDraft(character) {
  const { totalLevel, multiclass } = getCharacterClassLevels(character);
  return {
    totalLevel,
    primaryClass: String(character?.class ?? "").trim(),
    multiclass: multiclass.map((entry) => ({ ...entry })),
    hitPointChoices: {},
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
  const hitPointChoicesRaw = draft?.hitPointChoices;
  const hitPointChoices =
    hitPointChoicesRaw && typeof hitPointChoicesRaw === "object" && !Array.isArray(hitPointChoicesRaw)
      ? Object.fromEntries(
          Object.entries(hitPointChoicesRaw).map(([key, choice]) => {
            const normalizedKey = String(key ?? "").trim();
            const method = choice?.method === "roll" ? "roll" : "fixed";
            const rollValue = Math.floor(toNumber(choice?.rollValue, NaN));
            return [
              normalizedKey,
              {
                method,
                rollValue: Number.isFinite(rollValue) && rollValue > 0 ? rollValue : null,
              },
            ];
          })
        )
      : {};
  return { totalLevel, primaryClass, multiclass, hitPointChoices };
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
  const currentSaves = getAutomaticSaveProficiencies(state.catalogs, currentCharacter);
  const nextSaves = getAutomaticSaveProficiencies(state.catalogs, nextCharacter);
  const currentProgression = recomputeCharacterProgression(state.catalogs, currentCharacter);
  const nextProgression = recomputeCharacterProgression(state.catalogs, nextCharacter);
  const currentAutoSpells = getAutoGrantedSpellData(state.catalogs, currentCharacter).names;
  const nextAutoSpells = getAutoGrantedSpellData(state.catalogs, nextCharacter).names;
  const currentSpellSet = new Set(currentAutoSpells.map((name) => name.toLowerCase()));
  const nextSpellSet = new Set(nextAutoSpells.map((name) => name.toLowerCase()));
  const addedAutoSpells = nextAutoSpells.filter((name) => !currentSpellSet.has(name.toLowerCase()));
  const removedAutoSpells = currentAutoSpells.filter((name) => !nextSpellSet.has(name.toLowerCase()));
  const currentFeatureIds = new Set((currentProgression.unlockedFeatures ?? []).map((feature) => feature.id));
  const nextFeatureIds = new Set((nextProgression.unlockedFeatures ?? []).map((feature) => feature.id));
  const addedFeatures = (nextProgression.unlockedFeatures ?? []).filter((feature) => !currentFeatureIds.has(feature.id));
  const removedFeatures = (currentProgression.unlockedFeatures ?? []).filter((feature) => !nextFeatureIds.has(feature.id));
  const currentEffects = new Map((currentProgression.classTableEffects ?? []).map((effect) => [effect.id, effect]));
  const nextEffects = new Map((nextProgression.classTableEffects ?? []).map((effect) => [effect.id, effect]));
  const changedClassTableEffects = [...nextEffects.values()].filter((effect) => {
    const previous = currentEffects.get(effect.id);
    if (!previous) return true;
    return String(previous.value) !== String(effect.value);
  });
  const hitPointPlan = buildLevelUpHitPointPlan(state.catalogs, currentCharacter, draft);
  return {
    currentSlots,
    nextSlots,
    changedSlotLevels,
    currentSaves,
    nextSaves,
    currentProgression,
    nextProgression,
    addedFeatures,
    removedFeatures,
    addedAutoSpells,
    removedAutoSpells,
    changedClassTableEffects,
    classLevels: getCharacterClassLevels(nextCharacter),
    hitPointPlan,
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
            alert("Choose a primary class.");
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
              hitPointRollOverrides: getLevelUpPreview(state, sanitized).hitPointPlan.nextRollOverrides,
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
  let levelInputRenderTimer = null;
  const clampLevelValue = (value) => Math.max(1, Math.min(20, toNumber(value, 1)));
  const renderEditorSoon = () => {
    if (levelInputRenderTimer != null) clearTimeout(levelInputRenderTimer);
    levelInputRenderTimer = window.setTimeout(() => {
      levelInputRenderTimer = null;
      renderEditor();
    }, 250);
  };
  const renderEditorNow = () => {
    if (levelInputRenderTimer != null) {
      clearTimeout(levelInputRenderTimer);
      levelInputRenderTimer = null;
    }
    renderEditor();
  };

  const renderEditor = () => {
    root.innerHTML = renderLevelUpBody(state, draft);
    const primaryClassEl = document.getElementById("levelup-primary-class");
    if (primaryClassEl) primaryClassEl.value = draft.primaryClass;

    document.getElementById("levelup-total-level")?.addEventListener("input", (evt) => {
      draft.totalLevel = clampLevelValue(evt.target.value);
      renderEditorSoon();
    });
    document.getElementById("levelup-total-level")?.addEventListener("change", (evt) => {
      draft.totalLevel = clampLevelValue(evt.target.value);
      renderEditorNow();
    });
    primaryClassEl?.addEventListener("change", (evt) => {
      draft.primaryClass = evt.target.value;
      renderEditorNow();
    });
    root.querySelector("[data-levelup-add-mc]")?.addEventListener("click", () => {
      draft.multiclass.push({ class: "", level: 1 });
      renderEditorNow();
    });
    root.querySelectorAll("[data-levelup-mc-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        const idx = toNumber(button.dataset.levelupMcRemove, -1);
        if (idx < 0) return;
        draft.multiclass.splice(idx, 1);
        renderEditorNow();
      });
    });
    root.querySelectorAll("[data-levelup-mc-class]").forEach((select) => {
      select.addEventListener("change", () => {
        const idx = toNumber(select.dataset.levelupMcClass, -1);
        if (idx < 0 || !draft.multiclass[idx]) return;
        draft.multiclass[idx].class = select.value;
        renderEditorNow();
      });
    });
    root.querySelectorAll("[data-levelup-mc-level]").forEach((input) => {
      input.addEventListener("input", () => {
        const idx = toNumber(input.dataset.levelupMcLevel, -1);
        if (idx < 0 || !draft.multiclass[idx]) return;
        draft.multiclass[idx].level = clampLevelValue(input.value);
        renderEditorSoon();
      });
      input.addEventListener("change", () => {
        const idx = toNumber(input.dataset.levelupMcLevel, -1);
        if (idx < 0 || !draft.multiclass[idx]) return;
        draft.multiclass[idx].level = clampLevelValue(input.value);
        renderEditorNow();
      });
    });
    root.querySelectorAll("[data-levelup-step-target]").forEach((button) => {
      button.addEventListener("click", () => {
        const target = String(button.dataset.levelupStepTarget ?? "");
        const delta = toNumber(button.dataset.stepDelta, 0);
        if (!delta) return;
        if (target === "total-level") {
          draft.totalLevel = clampLevelValue(toNumber(draft.totalLevel, 1) + delta);
          renderEditorNow();
          return;
        }
        if (target === "mc-level") {
          const idx = toNumber(button.dataset.levelupStepIndex, -1);
          if (idx < 0 || !draft.multiclass[idx]) return;
          draft.multiclass[idx].level = clampLevelValue(toNumber(draft.multiclass[idx].level, 1) + delta);
          renderEditorNow();
        }
      });
    });
    root.querySelectorAll("[data-levelup-hp-method]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = String(input.dataset.levelupHpKey ?? "").trim();
        if (!key) return;
        const method = input.value === "roll" ? "roll" : "fixed";
        const faces = Math.max(1, toNumber(input.dataset.levelupHpFaces, 8));
        const existing = draft.hitPointChoices[key] ?? { method: "fixed", rollValue: null };
        draft.hitPointChoices[key] = {
          ...existing,
          method,
          rollValue: method === "roll" ? existing.rollValue ?? rollDie(faces) : null,
        };
        renderEditorNow();
      });
    });
    root.querySelectorAll("[data-levelup-hp-reroll]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = String(button.dataset.levelupHpReroll ?? "").trim();
        if (!key) return;
        const faces = Math.max(1, toNumber(button.dataset.levelupHpFaces, 8));
        draft.hitPointChoices[key] = {
          method: "roll",
          rollValue: rollDie(faces),
        };
        renderEditorNow();
      });
    });
  };

  renderEditor();
  return () => {
    if (levelInputRenderTimer != null) {
      clearTimeout(levelInputRenderTimer);
      levelInputRenderTimer = null;
    }
    close();
  };
}

function openMulticlassModal(state) {
  const existing = state.character.multiclass;
  const close = openModal({
    title: "Multiclass Editor",
    bodyHtml: `
      <p class="subtitle">Add one secondary class at a time to build your multiclass.</p>
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
      <div>${existing.length ? existing.map((m) => `<span class="pill">${esc(m.class)} ${esc(m.level)}</span>`).join(" ") : "<span class='muted'>No secondary classes added yet.</span>"}</div>
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

let persistentBrandLogoLink = null;

function ensurePersistentBrandLogoLink() {
  if (persistentBrandLogoLink) return persistentBrandLogoLink;
  const link = document.createElement("a");
  link.className = "app-brand-link";
  link.href = "/";
  link.setAttribute("aria-label", "Go to home");

  const image = document.createElement("img");
  image.className = "app-brand-logo";
  image.src = "/icons/icon.svg";
  image.alt = "Action Surge logo";

  link.appendChild(image);
  persistentBrandLogoLink = link;
  return persistentBrandLogoLink;
}

function hydratePersistentBrandLogo() {
  const slot = app.querySelector("[data-brand-logo-slot]");
  if (!slot) return;
  slot.replaceWith(ensurePersistentBrandLogoLink());
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
  hydratePersistentBrandLogo();
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

let serviceWorkerRefreshPending = false;
let serviceWorkerUpdateTimer = null;

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    registration.update().catch(() => {});
    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          installing.postMessage({ type: "SKIP_WAITING" });
        }
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (serviceWorkerRefreshPending) return;
      serviceWorkerRefreshPending = true;
      window.location.reload();
    });
    if (serviceWorkerUpdateTimer != null) {
      clearInterval(serviceWorkerUpdateTimer);
    }
    // Poll for updates during active play sessions so refresh picks new deploys quickly.
    serviceWorkerUpdateTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        registration.update().catch(() => {});
      }
    }, 60_000);
  } catch (error) {
    console.error("Service worker registration failed", error);
  }
}

store.subscribe((state) => {
  captureCharacterLogChanges(state.character);
  render(state);
  const nextFingerprint = buildCharacterFingerprint(state.character);
  if (nextFingerprint && nextFingerprint !== lastPersistedCharacterFingerprint) {
    appState.localCharacterVersion += 1;
    lastPersistedCharacterFingerprint = nextFingerprint;
    appState.localCharacterUpdatedAt = new Date().toISOString();
  }
  const persistedCharacter = withSyncMeta(
    withCharacterChangeLog(state.character),
    Math.max(1, appState.localCharacterVersion),
    appState.localCharacterUpdatedAt
  );
  saveAppState({ ...state, character: persistedCharacter });
  queueRemoteSave(state);
  if (isUuid(state.character?.id)) {
    rememberLastCharacterId(state.character.id);
    upsertCharacterHistory(state.character, { touchAccess: false });
  }
});

registerServiceWorker();
window.addEventListener("online", () => {
  flushPendingSaves().catch((error) => {
    console.error("Pending sync flush failed", error);
  });
});

bootstrap().catch((error) => {
  console.error("Bootstrap failed", error);
  appState.startupErrorMessage = "Startup failed. Reload the page to try again.";
  appState.showOnboardingHome = true;
  render(store.getState());
});

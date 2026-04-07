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
  patchCharacter,
  saveCharacter,
  validateCharacterEditPassword,
} from "./character-api.js";
import { createPersistence } from "./app/persistence.js";
import { createPartyFeature } from "./app/party-feature.js";
import {
  CHARACTER_CHANGE_LOG_KEY,
  CHARACTER_CHANGE_LOG_LIMIT,
  CHARACTER_HISTORY_KEY,
  CHARACTER_HISTORY_LIMIT,
  CHARACTER_SYNC_META_KEY,
  DEFAULT_DICE_RESULT_MESSAGE,
  LAST_CHARACTER_ID_KEY,
  NEW_CHARACTER_OPTION_VALUE,
  ROLL_HISTORY_LIMIT,
  UUID_V4_REGEX,
  createAppState,
  createUiState,
} from "./app/runtime/state.js";
import { createRuntimeSourcePresets } from "./app/runtime/source-presets.js";
import { createCharacterHistory } from "./app/character/history.js";
import { createCharacterImportExport } from "./app/character/import-export.js";
import { getCharacterFromApiPayload as parseCharacterApiPayload } from "./app/character/api-payload.js";
import { createCharacterChangeLogDomain } from "./app/character/change-log.js";
import { createCharacterUpdater } from "./app/character/update.js";
import { createCharacterViewHelpers } from "./app/character/view-helpers.js";
import { createCatalogLookupDomain } from "./app/catalog/lookup.js";
import { createBootstrap } from "./app/bootstrap.js";
import { createCharacterDetailsModals } from "./app/modals/character-details.js";
import { createEditPasswordController } from "./app/modals/edit-password.js";
import { createLevelUpModal } from "./app/modals/level-up.js";
import { createMulticlassModal } from "./app/modals/multiclass.js";
import { createPartyModalCatalogCache } from "./app/modals/party-catalog-cache.js";
import { createPartyCharacterDetailsModals } from "./app/modals/party-character-details.js";
import { createOnboardingView } from "./app/render/onboarding.js";
import { createPersistentBrandLogo } from "./app/render/brand-logo.js";
import { createFeatureResourceRules } from "./app/rules/feature-resources.js";
import { createHitPointRules } from "./app/rules/hit-points.js";
import { createProficiencySummaryRules } from "./app/rules/proficiency-summary.js";
import { createProgressionRules } from "./app/rules/progression.js";
import { createProgressionCore } from "./app/rules/progression-core.js";
import { createCharacterProgressionDomain } from "./app/rules/character-progression.js";
import { createProficiencyRules } from "./app/rules/proficiencies.js";
import { createSpellcastingRules } from "./app/rules/spellcasting.js";
import { createAutoGrantedSpellRules, getClassKey as getSpellClassKey } from "./app/spells/auto-grants.js";
import { createPreparedSpellRules } from "./app/spells/prepared.js";
import { createSpellTextAndContext } from "./app/spells/text-and-context.js";
import { createAutoAttackRules } from "./app/inventory/auto-attacks.js";
import { createInventoryWeapons } from "./app/inventory/weapons.js";
import {
  buildEntityId,
  normalizeSourceTag,
  parseClassFeatureToken,
  parseSubclassFeatureToken,
} from "./app/dataset/feature-token-parsers.js";
import {
  flattenTableCellToText,
  getAdditionalThresholdsForCombatSuperiority,
  getResourceRechargeHint,
  hasFirstUseFreeAfterLongRestRule,
  inferResourceLabelFromLines,
  normalizeResourceLabel,
  parseDieFacesByClassLevel,
  parseExplicitResourceCostFromLines,
  parseResourceCountFromProficiencyBonus,
  parseResourceCountFromTable,
  scoreResourceLabelMatch,
} from "./app/dataset/resource-string-parsers.js";
import { cleanSpellInlineTags, parseCountToken, toTitleCase } from "./app/dataset/text-utils.js";
import { createDiceUi } from "./dice/index.js";
import { dockDiceOverlay, isDiceTrayEnabled, syncDiceOverlayVisibility } from "./dice/overlay.js";
import { createDiceRoller } from "./dice/roller.js";
import { DEFAULT_DICE_STYLE, DICE_STYLE_PRESETS } from "./theme/dice-theme.js";
import { openModal } from "./ui/modals/modal.js";
import { createEvents } from "./ui/events.js";
import { createPickers } from "./ui/pickers.js";
import { createRenderers } from "./ui/renderers.js";
import { getArmorClassBreakdown, getCharacterFightingStyleSet, getHitPointBreakdown } from "./engine/rules.js";
import {
  esc,
  matchesSearchQuery,
  signed,
  toNumber,
} from "./ui/formatters.js";

const app = document.getElementById("app");
const persistentBrandLogo = createPersistentBrandLogo({ app });
const MANUAL_BASE_URL = String(window.__MANUAL_BASE_URL__ ?? "").trim().replace(/\/+$/g, "");
const persistedState = loadAppState();
const store = createStore(persistedState?.character ?? createInitialCharacter());
let currentUrlCharacterId = null;
let lastPersistedCharacterFingerprint = "";
const uiState = createUiState(DEFAULT_DICE_STYLE);
const appState = createAppState();
const changeLogDomain = createCharacterChangeLogDomain({
  toNumber,
  toTitleCase,
  esc,
  characterSyncMetaKey: CHARACTER_SYNC_META_KEY,
  characterChangeLogKey: CHARACTER_CHANGE_LOG_KEY,
  characterChangeLogLimit: CHARACTER_CHANGE_LOG_LIMIT,
  uiState,
  getState: () => store.getState(),
  isUuid,
  isOnboardingHome: () => appState.showOnboardingHome,
});
const runtimeSourcePresetsState = createRuntimeSourcePresets({
  defaultSourcePreset: DEFAULT_SOURCE_PRESET,
  sourcePresets: SOURCE_PRESETS,
  sourcePresetLabels: SOURCE_PRESET_LABELS,
  isCatalogDataSrdOnly,
});

const diceUi = createDiceUi({
  esc,
  toNumber,
  rollHistoryLimit: ROLL_HISTORY_LIMIT,
  diceStylePresets: DICE_STYLE_PRESETS,
  uiState,
});

const diceRoller = createDiceRoller({
  uiState,
  store,
  toNumber,
  signed,
  rollDie,
  applyDiceStyle: diceUi.applyDiceStyle,
  setDiceResult: diceUi.setDiceResult,
  openModal,
  isDiceTrayEnabled,
  appendDiceRollLog: changeLogDomain.appendDiceRollLog,
  defaultDiceResultMessage: DEFAULT_DICE_RESULT_MESSAGE,
});


changeLogDomain.setRestoreDiceStateFromCharacterLog(diceRoller.restoreDiceStateFromCharacterLog);

appState.localCharacterVersion = changeLogDomain.getCharacterVersion(persistedState?.character);
lastPersistedCharacterFingerprint = changeLogDomain.buildCharacterFingerprint(persistedState?.character ?? store.getState().character);
changeLogDomain.seedCharacterLogState(store.getState().character);
appState.localCharacterUpdatedAt =
  (typeof changeLogDomain.getSyncMeta(persistedState?.character).updatedAt === "string" && changeLogDomain.getSyncMeta(persistedState?.character).updatedAt) ||
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
const ASI_FEATURE_NAME_REGEX = /ability score improvement/i;
const AUTO_RESOURCE_ID_PREFIX = "auto:";
const catalogLookupDomain = createCatalogLookupDomain({
  toNumber,
  normalizeSourceTag,
  sourceLabels: SOURCE_LABELS,
  saveAbilities: SAVE_ABILITIES,
  getCharacterAllowedSources,
  buildEntityId,
});
const spellcastingRules = createSpellcastingRules({
  toNumber,
  spellSlotLevels: SPELL_SLOT_LEVELS,
  getPreferredSourceOrder: catalogLookupDomain.getPreferredSourceOrder,
  getClassCatalogEntry: catalogLookupDomain.getClassCatalogEntry,
});
const progressionCore = createProgressionCore({
  toNumber,
  abilityLabels: ABILITY_LABELS,
  isRecordObject: catalogLookupDomain.isRecordObject,
  getCharacterClassLevels: spellcastingRules.getCharacterClassLevels,
});
const proficiencyRules = createProficiencyRules({
  toNumber,
  saveAbilities: SAVE_ABILITIES,
  skills: SKILLS,
  skillKeyByCanonical: SKILL_KEY_BY_CANONICAL,
  skillProficiencyNone: SKILL_PROFICIENCY_NONE,
  skillProficiencyHalf: SKILL_PROFICIENCY_HALF,
  skillProficiencyProficient: SKILL_PROFICIENCY_PROFICIENT,
  skillProficiencyExpertise: SKILL_PROFICIENCY_EXPERTISE,
  skillProficiencyModes: SKILL_PROFICIENCY_MODES,
  asiFeatureNameRegex: ASI_FEATURE_NAME_REGEX,
  isRecordObject: catalogLookupDomain.isRecordObject,
  getCharacterClassLevels: spellcastingRules.getCharacterClassLevels,
  getPreferredSourceOrder: catalogLookupDomain.getPreferredSourceOrder,
  getClassCatalogEntry: catalogLookupDomain.getClassCatalogEntry,
  getEffectiveRaceEntry: catalogLookupDomain.getEffectiveRaceEntry,
  findCatalogEntryByNameWithSelectedSourcePreference: catalogLookupDomain.findCatalogEntryByNameWithSelectedSourcePreference,
  getClassSaveProficiencies: catalogLookupDomain.getClassSaveProficiencies,
});
const characterViewHelpers = createCharacterViewHelpers({
  esc,
  toNumber,
  normalizeSourceTag,
  sourceLabels: SOURCE_LABELS,
  defaultSourcePreset: DEFAULT_SOURCE_PRESET,
  getAllowedSources,
  runtimeSourcePresetsState,
  catalogLookupDomain,
  spellcastingRules,
  saveAbilities: SAVE_ABILITIES,
  abilityLabels: ABILITY_LABELS,
});
const spellTextAndContext = createSpellTextAndContext({
  cleanSpellInlineTags,
  flattenTableCellToText,
  toNumber,
  esc,
  diceNotationRegex: DICE_NOTATION_REGEX,
  abilityLabels: ABILITY_LABELS,
  getClassSpellcastingAbility,
});
const characterProgressionDomain = createCharacterProgressionDomain({
  toNumber,
  signed,
  isRecordObject: catalogLookupDomain.isRecordObject,
  normalizeSourceTag,
  buildEntityId,
  cleanSpellInlineTags,
  parseClassFeatureToken,
  parseSubclassFeatureToken,
  getClassLevelTracks: progressionCore.getClassLevelTracks,
  getPreferredSourceOrder: catalogLookupDomain.getPreferredSourceOrder,
  getClassCatalogEntry: catalogLookupDomain.getClassCatalogEntry,
  getSelectedSubclassEntry: catalogLookupDomain.getSelectedSubclassEntry,
  getEffectiveRaceEntry: catalogLookupDomain.getEffectiveRaceEntry,
  findCatalogEntryByNameWithSelectedSourcePreference: catalogLookupDomain.findCatalogEntryByNameWithSelectedSourcePreference,
  asiFeatureNameRegex: ASI_FEATURE_NAME_REGEX,
  extractSimpleNotation: diceRoller.extractSimpleNotation,
  collectSpellEntryLines: spellTextAndContext.collectSpellEntryLines,
});
const inventoryWeapons = createInventoryWeapons({
  cleanSpellInlineTags,
  extractSimpleNotation: diceRoller.extractSimpleNotation,
  toNumber,
  signed,
  getRuleDescriptionLines: characterProgressionDomain.getRuleDescriptionLines,
  getClassLevelTracks: progressionCore.getClassLevelTracks,
  getClassCatalogEntry: catalogLookupDomain.getClassCatalogEntry,
  getUnlockedFeatures: characterProgressionDomain.getUnlockedFeatures,
  resolveFeatureEntryFromCatalogs: characterProgressionDomain.resolveFeatureEntryFromCatalogs,
});
const autoGrantedSpellRules = createAutoGrantedSpellRules({
  toNumber,
  cleanSpellInlineTags,
  catalogLookupDomain,
  progressionCore,
  characterProgressionDomain,
  spellcastingRules,
  spellSlotLevels: SPELL_SLOT_LEVELS,
});
const featureResourceRules = createFeatureResourceRules({
  toNumber,
  toTitleCase,
  normalizeSourceTag,
  buildEntityId,
  cleanSpellInlineTags,
  parseCountToken,
  progressionCore,
  characterProgressionDomain,
  catalogLookupDomain,
  parseDieFacesByClassLevel,
  getAdditionalThresholdsForCombatSuperiority,
  getResourceRechargeHint,
  hasFirstUseFreeAfterLongRestRule,
  inferResourceLabelFromLines,
  parseExplicitResourceCostFromLines,
  parseResourceCountFromProficiencyBonus,
  parseResourceCountFromTable,
  scoreResourceLabelMatch,
  autoResourceIdPrefix: AUTO_RESOURCE_ID_PREFIX,
});
const preparedSpellRules = createPreparedSpellRules({
  toNumber,
  catalogLookupDomain,
  spellcastingRules,
  normalizeAbilityKey: proficiencyRules.normalizeAbilityKey,
  getSpellByName: spellTextAndContext.getSpellByName,
});
const proficiencySummaryRules = createProficiencySummaryRules({
  toNumber,
  cleanSpellInlineTags,
  normalizeSourceTag,
  buildEntityId,
  catalogLookupDomain,
  proficiencyRules,
});
const autoAttackRules = createAutoAttackRules({
  toNumber,
  signed,
  getCharacterFightingStyleSet,
  inventoryWeapons,
});
const characterDetailsModals = createCharacterDetailsModals({
  openModal,
  esc,
  toNumber,
  toTitleCase,
  buildEntityId,
  sourceLabels: SOURCE_LABELS,
  normalizeSourceTag,
  parseClassFeatureToken,
  parseSubclassFeatureToken,
  getRuleDescriptionLines: characterProgressionDomain.getRuleDescriptionLines,
  renderTextWithInlineDiceButtons: spellTextAndContext.renderTextWithInlineDiceButtons,
  rollVisualNotation: diceRoller.rollVisualNotation,
  setDiceResult: diceUi.setDiceResult,
  recomputeCharacterProgression: characterProgressionDomain.recomputeCharacterProgression,
  getClassCatalogEntry: catalogLookupDomain.getClassCatalogEntry,
  getSelectedSubclassEntry: catalogLookupDomain.getSelectedSubclassEntry,
  resolveFeatureEntryFromCatalogs: characterProgressionDomain.resolveFeatureEntryFromCatalogs,
  getPreferredSourceOrder: catalogLookupDomain.getPreferredSourceOrder,
  getEffectiveRaceEntry: catalogLookupDomain.getEffectiveRaceEntry,
});
function isUuid(value) {
  return UUID_V4_REGEX.test(String(value ?? "").trim());
}

const historyApi = createCharacterHistory({
  toNumber,
  esc,
  isUuid,
  lastCharacterIdKey: LAST_CHARACTER_ID_KEY,
  characterHistoryKey: CHARACTER_HISTORY_KEY,
  characterHistoryLimit: CHARACTER_HISTORY_LIMIT,
  newCharacterOptionValue: NEW_CHARACTER_OPTION_VALUE,
});

function setCharacterIdInUrl(id, replace = false) {
  historyApi.setCharacterIdInUrl(id, replace);
  currentUrlCharacterId = isUuid(id) ? String(id).trim().toLowerCase() : null;
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

const characterIo = createCharacterImportExport({
  isUuid,
  getCharacter,
  saveCharacter,
  createCharacter,
  getCharacterVersion: changeLogDomain.getCharacterVersion,
  getCharacterFromApiPayload,
  withSyncMeta: changeLogDomain.withSyncMeta,
  withCharacterChangeLog: changeLogDomain.withCharacterChangeLog,
  applyRemoteCharacterPayload,
  setCharacterIdInUrl,
  getCharacterDisplayName: historyApi.getCharacterDisplayName,
  loadCharacterHistory: historyApi.loadCharacterHistory,
  buildImportOverwriteMessage,
  getCurrentCharacterId: () => (isUuid(store.getState().character?.id) ? store.getState().character.id : null),
  getCurrentCharacterName: () => store.getState().character?.name,
  getLocalCharacterVersion: () => appState.localCharacterVersion,
});

async function createAndOpenNewCharacter() {
  partyFeature.clearActiveParty();
  const character = createInitialCharacter();
  const nextVersion = Math.max(appState.localCharacterVersion, changeLogDomain.getCharacterVersion(character)) + 1;
  const payload = await createCharacter(changeLogDomain.withSyncMeta(changeLogDomain.withCharacterChangeLog(character), nextVersion));
  const parsed = getCharacterFromApiPayload(payload, null);
  setCharacterIdInUrl(parsed.id, false);
  await applyRemoteCharacterPayload(payload, parsed.id);
}

function forgetActiveCharacterAndRedirectHome() {
  const characterId = String(store.getState().character?.id ?? "").trim();
  if (!isUuid(characterId)) return;
  historyApi.removeCharacterFromHistory(characterId);
  // Reset the in-memory/persisted character so startup subscription does not re-add it to history.
  store.hydrate(createInitialCharacter());
  appState.showOnboardingHome = true;
  currentUrlCharacterId = null;
  window.location.replace("/");
}

async function switchCharacterFromHistory(characterId) {
  if (!isUuid(characterId)) return;
  if (!appState.showOnboardingHome && store.getState().character?.id === characterId) return;
  try {
    const isCharacterInActiveParty = partyFeature.isCharacterInActiveParty(characterId);
    if (!isCharacterInActiveParty) {
      partyFeature.clearActiveParty();
    }
    await persistence.loadCharacterById(characterId);
    setCharacterIdInUrl(characterId, false);
    render(store.getState());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load selected character";
    if (appState.showOnboardingHome) appState.startupErrorMessage = message;
    else alert(message);
    render(store.getState());
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

function getCharacterFromApiPayload(payload, fallbackId) {
  return parseCharacterApiPayload(payload, fallbackId, { isUuid });
}


function rollDie(faces) {
  const max = Math.max(1, Math.floor(toNumber(faces, 0)));
  return 1 + Math.floor(Math.random() * max);
}

const hitPointRules = createHitPointRules({
  toNumber,
  getHitPointBreakdown,
  getCharacterClassLevels: spellcastingRules.getCharacterClassLevels,
  getClassHitDieFaces: catalogLookupDomain.getClassHitDieFaces,
  getClassKey: getSpellClassKey,
  rollDie,
});


function getCharacterAllowedSources(character) {
  return characterViewHelpers.getCharacterAllowedSources(character);
}

const partyModalCatalogCacheApi = createPartyModalCatalogCache({
  normalizeSourceTag,
  getCharacterAllowedSources,
  loadCatalogs,
});

function getClassSpellcastingAbility(catalogs, character) {
  return preparedSpellRules.getClassSpellcastingAbility(catalogs, character);
}

async function loadCatalogsForCharacter(character) {
  await runtimeSourcePresetsState.ensureRuntimeSourcePresets();
  const resolvedPreset = runtimeSourcePresetsState.resolveRuntimeSourcePreset(character?.sourcePreset ?? DEFAULT_SOURCE_PRESET);
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
  characterUpdater.updateCharacterWithRequiredSettings(nextState, {}, { preserveUserOverrides: true });
}

async function applyRemoteCharacterPayload(payload, fallbackId = null, defaultMode = "build") {
  const parsed = getCharacterFromApiPayload(payload, fallbackId);
  changeLogDomain.updatePersistenceStatusFromPayload(payload);
  appState.showOnboardingHome = false;
  appState.startupErrorMessage = "";
  appState.isRemoteSaveSuppressed = true;
  try {
    await runtimeSourcePresetsState.ensureRuntimeSourcePresets();
    const resolvedPreset = runtimeSourcePresetsState.resolveRuntimeSourcePreset(parsed.character?.sourcePreset ?? DEFAULT_SOURCE_PRESET);
    const nextCharacter = parsed.character?.sourcePreset === resolvedPreset
      ? parsed.character
      : { ...parsed.character, sourcePreset: resolvedPreset };
    const catalogs = await loadCatalogs(getCharacterAllowedSources(nextCharacter));
    // Apply catalogs before hydration so derived HP uses the correct source data
    // on the first render of the loaded character.
    store.setCatalogs(catalogs);
    changeLogDomain.seedCharacterLogState(nextCharacter);
    store.hydrate(nextCharacter);
    store.setMode(defaultMode);
    store.setStep(0);
    characterUpdater.updateCharacterWithRequiredSettings(store.getState(), {}, { preserveUserOverrides: true });
  } finally {
    appState.isRemoteSaveSuppressed = false;
  }
  appState.localCharacterVersion = Math.max(appState.localCharacterVersion, changeLogDomain.getCharacterVersion(parsed.character));
  appState.localCharacterUpdatedAt =
    (typeof changeLogDomain.getSyncMeta(parsed.character).updatedAt === "string" && changeLogDomain.getSyncMeta(parsed.character).updatedAt) ||
    appState.localCharacterUpdatedAt;
  lastPersistedCharacterFingerprint = changeLogDomain.buildCharacterFingerprint(parsed.character);
  historyApi.rememberLastCharacterId(parsed.id);
  historyApi.upsertCharacterHistory(parsed.character, { touchAccess: true });
  currentUrlCharacterId = parsed.id;
}

const editPasswordController = createEditPasswordController({
  openModal,
  esc,
  store,
  validateCharacterEditPassword,
  getCharacterEditPassword,
  isUuid,
});
const partyCharacterDetailsModals = createPartyCharacterDetailsModals({
  store,
  setDiceResult: diceUi.setDiceResult,
  getCachedPartyModalCatalogs: partyModalCatalogCacheApi.getCachedPartyModalCatalogs,
  characterDetailsModals,
});

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

function updateCharacterWithRequiredSettings(state, updates, options = {}) {
  return characterUpdater.updateCharacterWithRequiredSettings(state, updates, options);
}

const pickers = createPickers({
  openModal,
  store,
  esc,
  toNumber,
  matchesSearchQuery,
  buildEntityId,
  doesCharacterMeetFeatPrerequisites: progressionCore.doesCharacterMeetFeatPrerequisites,
  doesCharacterMeetOptionalFeaturePrerequisites: progressionCore.doesCharacterMeetOptionalFeaturePrerequisites,
  updateCharacterWithRequiredSettings,
  getSpellByName: spellTextAndContext.getSpellByName,
  getSpellLevelLabel: spellTextAndContext.getSpellLevelLabel,
  spellSchoolLabels: SPELL_SCHOOL_LABELS,
  formatSpellTime: spellTextAndContext.formatSpellTime,
  formatSpellRange: spellTextAndContext.formatSpellRange,
  formatSpellDuration: spellTextAndContext.formatSpellDuration,
  formatSpellComponents: spellTextAndContext.formatSpellComponents,
  getSpellDescriptionLines: spellTextAndContext.getSpellDescriptionLines,
  getRuleDescriptionLines: characterProgressionDomain.getRuleDescriptionLines,
  renderTextWithInlineDiceButtons: spellTextAndContext.renderTextWithInlineDiceButtons,
  rollVisualNotation: diceRoller.rollVisualNotation,
  setDiceResult: diceUi.setDiceResult,
});


const persistence = createPersistence({
  store,
  loadAppState,
  getCharacter,
  saveCharacter,
  patchCharacter,
  createCharacter,
  flushPendingCharacterSync,
  isUuid,
  getCharacterVersion: changeLogDomain.getCharacterVersion,
  withSyncMeta: changeLogDomain.withSyncMeta,
  getCharacterFromApiPayload,
  updatePersistenceStatusFromPayload: changeLogDomain.updatePersistenceStatusFromPayload,
  onEditPasswordRequired: (characterId) => {
    if (store.getState().mode !== "build") return false;
    editPasswordController.openEditPasswordPromptModal(characterId);
    return true;
  },
  markBrowserOnlyPersistence: changeLogDomain.markBrowserOnlyPersistence,
  applyRemoteCharacterPayload,
  isRemoteSameOrNewer: changeLogDomain.isRemoteSameOrNewer,
  setCharacterIdInUrl,
  getCharacterIdFromUrl: historyApi.getCharacterIdFromUrl,
  loadCatalogsForCharacter,
  render,
  persistedState,
  appState,
  defaultSourcePreset: DEFAULT_SOURCE_PRESET,
  withCharacterChangeLog: changeLogDomain.withCharacterChangeLog,
});

changeLogDomain.setRender(render);
changeLogDomain.setQueueRemoteSave(persistence.queueRemoteSave);
const partyFeature = createPartyFeature({
  app,
  appState,
  store,
  isUuid,
  esc,
  toNumber,
  openModal,
  loadCharacterHistory: historyApi.loadCharacterHistory,
  loadCharacterById: persistence.loadCharacterById,
  getCatalogsForCharacter: partyModalCatalogCacheApi.getCachedPartyModalCatalogs,
  openClassDetailsModalForCharacter: partyCharacterDetailsModals.openClassDetailsModalForCharacter,
  openSubclassDetailsModalForCharacter: partyCharacterDetailsModals.openSubclassDetailsModalForCharacter,
  render,
});
const onboardingView = createOnboardingView({
  app,
  esc,
  isUuid,
  newCharacterOptionValue: NEW_CHARACTER_OPTION_VALUE,
  historyApi,
  partyFeature,
  appState,
  renderPersistenceNotice: changeLogDomain.renderPersistenceNotice,
  createAndOpenNewCharacter,
  switchCharacterFromHistory,
  setCharacterIdInUrl,
  loadCharacterById: persistence.loadCharacterById,
  renderState: render,
  store,
});
const characterUpdater = createCharacterUpdater({
  toNumber,
  isRecordObject: catalogLookupDomain.isRecordObject,
  normalizeSourceTag,
  saveAbilities: SAVE_ABILITIES,
  skills: SKILLS,
  skillProficiencyNone: SKILL_PROFICIENCY_NONE,
  skillProficiencyProficient: SKILL_PROFICIENCY_PROFICIENT,
  spellSlotLevels: SPELL_SLOT_LEVELS,
  getPreferredSourceOrder: catalogLookupDomain.getPreferredSourceOrder,
  findCatalogEntryByNameWithSelectedSourcePreference: catalogLookupDomain.findCatalogEntryByNameWithSelectedSourcePreference,
  getSubraceCatalogEntries: catalogLookupDomain.getSubraceCatalogEntries,
  resolveImportedCharacterSelections: catalogLookupDomain.resolveImportedCharacterSelections,
  getAutomaticAbilityBonuses: proficiencyRules.getAutomaticAbilityBonuses,
  getAutomaticSaveProficiencies: proficiencyRules.getAutomaticSaveProficiencies,
  getAutomaticSkillProficiencyModes: proficiencyRules.getAutomaticSkillProficiencyModes,
  getAutomaticFeatureModeBonuses: proficiencyRules.getAutomaticFeatureModeBonuses,
  mapSkillModesToProficiencyMap: proficiencyRules.mapSkillModesToProficiencyMap,
  hasStoredProficiencyState: proficiencyRules.hasStoredProficiencyState,
  deriveLegacyProficiencyOverrides: proficiencyRules.deriveLegacyProficiencyOverrides,
  hasStoredSkillModeState: proficiencyRules.hasStoredSkillModeState,
  isSkillModeProficient: proficiencyRules.isSkillModeProficient,
  mergeSkillModesWithOverrides: proficiencyRules.mergeSkillModesWithOverrides,
  mergeProficienciesWithOverrides: proficiencyRules.mergeProficienciesWithOverrides,
  getCharacterSpellSlotDefaults: spellcastingRules.getCharacterSpellSlotDefaults,
  recomputeCharacterProgression: characterProgressionDomain.recomputeCharacterProgression,
  getAutoGrantedSpellData: autoGrantedSpellRules.getAutoGrantedSpellData,
  getAutoClassListSpellNames: autoGrantedSpellRules.getAutoClassListSpellNames,
  getAutoResourcesFromRules: featureResourceRules.getAutoResourcesFromRules,
  getAutoResourcesFromClassTableEffects: featureResourceRules.getAutoResourcesFromClassTableEffects,
  syncAutoFeatureUses: featureResourceRules.syncAutoFeatureUses,
  getSelectedSubclassEntry: catalogLookupDomain.getSelectedSubclassEntry,
  getClassCatalogEntry: catalogLookupDomain.getClassCatalogEntry,
  store,
});
const progressionRules = createProgressionRules({
  toNumber,
  spellSlotLevels: SPELL_SLOT_LEVELS,
  getCharacterClassLevels: spellcastingRules.getCharacterClassLevels,
  getCharacterSpellSlotDefaults: spellcastingRules.getCharacterSpellSlotDefaults,
  getAutomaticSaveProficiencies: proficiencyRules.getAutomaticSaveProficiencies,
  recomputeCharacterProgression: characterProgressionDomain.recomputeCharacterProgression,
  getAutoGrantedSpellData: autoGrantedSpellRules.getAutoGrantedSpellData,
  buildLevelUpHitPointPlan: hitPointRules.buildLevelUpHitPointPlan,
});

const events = createEvents({
  app,
  store,
  toNumber,
  isUuid,
  SKILLS,
  DEFAULT_SOURCE_PRESET: runtimeSourcePresetsState.getRuntimeDefaultSourcePreset(),
  getAllowedSources,
  getCharacterAllowedSources,
  sourceLabels: SOURCE_LABELS,
  loadAvailableSourceEntries,
  loadAvailableSources,
  loadCatalogs,
  updateCharacterWithRequiredSettings,
  getClassCatalogEntry: catalogLookupDomain.getClassCatalogEntry,
  getCharacterFightingStyleSet,
  normalizeSourceTag,
  withUpdatedPlay,
  openModal,
  openSpellModal: pickers.openSpellModal,
  openItemModal: pickers.openItemModal,
  openFeatModal: pickers.openFeatModal,
  openOptionalFeatureModal: pickers.openOptionalFeatureModal,
  openMulticlassModal,
  openLevelUpModal,
  openSpellDetailsModal: pickers.openSpellDetailsModal,
  getCharacterSpellSlotDefaults: spellcastingRules.getCharacterSpellSlotDefaults,
  createOrSavePermanentCharacter: persistence.createOrSavePermanentCharacter,
  importCharacterFromJsonFile: characterIo.importCharacterFromJsonFile,
  exportCharacterToJsonFile: characterIo.exportCharacterToJsonFile,
  openClassDetailsModal: characterDetailsModals.openClassDetailsModal,
  openSubclassDetailsModal: characterDetailsModals.openSubclassDetailsModal,
  openFeatureDetailsModal: characterDetailsModals.openFeatureDetailsModal,
  openFeatDetailsModal: characterDetailsModals.openFeatDetailsModal,
  openOptionalFeatureDetailsModal: characterDetailsModals.openOptionalFeatureDetailsModal,
  openSpeciesTraitDetailsModal: characterDetailsModals.openSpeciesTraitDetailsModal,
  applyDiceStyle: diceUi.applyDiceStyle,
  rerollLastRoll: diceRoller.rerollLastRoll,
  openCustomRollModal: diceRoller.openCustomRollModal,
  countPreparedSpells: preparedSpellRules.countPreparedSpells,
  getPreparedSpellLimit: preparedSpellRules.getPreparedSpellLimit,
  doesClassUsePreparedSpells: preparedSpellRules.doesClassUsePreparedSpells,
  isSpellAlwaysPrepared: preparedSpellRules.isSpellAlwaysPrepared,
  getSpellByName: spellTextAndContext.getSpellByName,
  getSpellCombatContext: spellTextAndContext.getSpellCombatContext,
  getFeatureActivationDescriptor: featureResourceRules.getFeatureActivationDescriptor,
  setDiceResult: diceUi.setDiceResult,
  setSpellCastStatus: diceUi.setSpellCastStatus,
  getSpellSlotValues: characterViewHelpers.getSpellSlotValues,
  rollVisualNotation: diceRoller.rollVisualNotation,
  getSpellPrimaryDiceNotation: spellTextAndContext.getSpellPrimaryDiceNotation,
  rollVisualD20: diceRoller.rollVisualD20,
  extractSimpleNotation: diceRoller.extractSimpleNotation,
  getArmorClassBreakdown,
  getHitPointBreakdown,
  autoResourceIdPrefix: AUTO_RESOURCE_ID_PREFIX,
  uiState,
  diceStylePresets: DICE_STYLE_PRESETS,
  forgetActiveCharacterAndRedirectHome,
});


const renderers = createRenderers({
  STEPS,
  esc,
  toNumber,
  signed,
  saveAbilities: SAVE_ABILITIES,
  abilityLabels: ABILITY_LABELS,
  skills: SKILLS,
  spellSlotLevels: SPELL_SLOT_LEVELS,
  sourcePresets: () => runtimeSourcePresetsState.getRuntimeSourcePresets(),
  sourcePresetLabels: () => runtimeSourcePresetsState.getRuntimeSourcePresetLabels(),
  getCharacterAllowedSources,
  sourceLabels: SOURCE_LABELS,
  optionList: characterViewHelpers.optionList,
  getSubraceCatalogEntries: catalogLookupDomain.getSubraceCatalogEntries,
  getEffectiveRaceEntry: catalogLookupDomain.getEffectiveRaceEntry,
  getSubclassSelectOptions: characterViewHelpers.getSubclassSelectOptions,
  getFeatSlotsWithSelection: characterViewHelpers.getFeatSlotsWithSelection,
  getOptionalFeatureSlotsWithSelection: characterViewHelpers.getOptionalFeatureSlotsWithSelection,
  getCharacterSpellSlotDefaults: spellcastingRules.getCharacterSpellSlotDefaults,
  defaultDiceResultMessage: DEFAULT_DICE_RESULT_MESSAGE,
  renderDiceStyleOptions: diceUi.renderDiceStyleOptions,
  getSpellSlotRow: characterViewHelpers.getSpellSlotRow,
  autoResourceIdPrefix: AUTO_RESOURCE_ID_PREFIX,
  latestSpellCastStatus: () => ({
    message: uiState.latestSpellCastStatusMessage,
    isError: uiState.latestSpellCastStatusIsError,
  }),
  getSpellSlotValues: characterViewHelpers.getSpellSlotValues,
  getSpellByName: spellTextAndContext.getSpellByName,
  getSpellCombatContext: spellTextAndContext.getSpellCombatContext,
  getSpellPrimaryDiceNotation: spellTextAndContext.getSpellPrimaryDiceNotation,
  getSpellLevelLabel: spellTextAndContext.getSpellLevelLabel,
  spellSchoolLabels: SPELL_SCHOOL_LABELS,
  getRuleDescriptionLines: characterProgressionDomain.getRuleDescriptionLines,
  getReferencedUnlockedFeatureIds: featureResourceRules.getReferencedUnlockedFeatureIds,
  getFeatureActivationDescriptor: featureResourceRules.getFeatureActivationDescriptor,
  doesClassUsePreparedSpells: preparedSpellRules.doesClassUsePreparedSpells,
  getPreparedSpellLimit: preparedSpellRules.getPreparedSpellLimit,
  countPreparedSpells: preparedSpellRules.countPreparedSpells,
  isSpellAlwaysPrepared: preparedSpellRules.isSpellAlwaysPrepared,
  getSaveProficiencyLabelMap: characterViewHelpers.getSaveProficiencyLabelMap,
  getCharacterToolAndDefenseSummary: proficiencySummaryRules.getCharacterToolAndDefenseSummary,
  getLevelUpPreview: progressionRules.getLevelUpPreview,
  getClassCasterContribution: spellcastingRules.getClassCasterContribution,
  renderCharacterHistorySelector: historyApi.renderCharacterHistorySelector,
  renderPersistenceNotice: changeLogDomain.renderPersistenceNotice,
  getModeToggle: characterViewHelpers.getModeToggle,
  getAutoAttacks: autoAttackRules.getAutoAttacks,
  getCharacterChangeLog: () => uiState.characterChangeLog,
  extractSimpleNotation: diceRoller.extractSimpleNotation,
  manualBaseUrl: MANUAL_BASE_URL,
  isUuid,
});


const levelUpModalController = createLevelUpModal({
  openModal,
  toNumber,
  rollDie,
  progressionRules,
  renderLevelUpBody: renderers.renderLevelUpBody,
  updateCharacterWithRequiredSettings,
});
const multiclassModalController = createMulticlassModal({
  openModal,
  esc,
  optionList: characterViewHelpers.optionList,
  updateCharacterWithRequiredSettings,
});

function openLevelUpModal(state) {
  return levelUpModalController.openLevelUpModal(state);
}

function openMulticlassModal(state) {
  return multiclassModalController.openMulticlassModal(state);
}

function render(state) {
  if (!appState.showOnboardingHome && partyFeature.getPartyIdFromUrl()) {
    uiState.selectedDiceStyle = DEFAULT_DICE_STYLE;
    document.body.classList.remove("play-mode");
    diceUi.applyDiceStyle();
    syncDiceOverlayVisibility({ ...state, mode: "build" });
    app.innerHTML = partyFeature.renderPartyPage();
    partyFeature.bindPartyEvents();
    return;
  }

  if (appState.showOnboardingHome) {
    uiState.selectedDiceStyle = DEFAULT_DICE_STYLE;
    document.body.classList.remove("play-mode");
    diceUi.applyDiceStyle();
    syncDiceOverlayVisibility(state);
    app.innerHTML = onboardingView.renderOnboardingHome();
    onboardingView.bindOnboardingEvents();
    return;
  }

  const selectedDiceStyle = state.character?.diceStyle;
  uiState.selectedDiceStyle = selectedDiceStyle in DICE_STYLE_PRESETS ? selectedDiceStyle : DEFAULT_DICE_STYLE;

  const previousScrollX = window.scrollX;
  const previousScrollY = window.scrollY;
  const activeInputSnapshot = getActiveInputSnapshot();
  const isPlayMode = state.mode === "play";
  document.body.classList.toggle("play-mode", isPlayMode);

  const overlay = document.getElementById("dice-overlay");
  if (overlay && overlay.parentElement !== document.body) {
    document.body.appendChild(overlay);
  }

  app.innerHTML = state.mode === "play" ? renderers.renderPlayMode(state) : renderers.renderBuildMode(state);
  persistentBrandLogo.hydratePersistentBrandLogo();
  dockDiceOverlay({ app, isPlayMode });
  syncDiceOverlayVisibility(state);
  diceUi.applyDiceStyle();
  diceUi.syncDiceResultElements();
  diceUi.syncSpellCastStatusElements();
  diceUi.renderRollHistory();
  bindCharacterHistoryEvents();
  editPasswordController.bindModeEvents(app);
  if (isPlayMode) events.bindPlayEvents(state);
  else events.bindBuildEvents(state);
  restoreActiveInput(activeInputSnapshot);

  // Keep viewport stable across state-driven re-renders.
  const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  window.scrollTo({
    left: previousScrollX,
    top: Math.min(previousScrollY, maxScrollY),
    behavior: "auto",
  });
}

const bootstrapApi = createBootstrap({
  isUuid,
  appState,
  render: () => render(store.getState()),
  loadCharacterById: persistence.loadCharacterById,
  bootstrap: persistence.bootstrap,
  flushPendingSaves: persistence.flushPendingSaves,
  partyFeature,
  getCharacterIdFromUrl: historyApi.getCharacterIdFromUrl,
});

store.subscribe((state) => {
  changeLogDomain.captureCharacterLogChanges(state.character);
  render(state);
  const nextFingerprint = changeLogDomain.buildCharacterFingerprint(state.character);
  if (nextFingerprint && nextFingerprint !== lastPersistedCharacterFingerprint) {
    appState.localCharacterVersion += 1;
    lastPersistedCharacterFingerprint = nextFingerprint;
    appState.localCharacterUpdatedAt = new Date().toISOString();
  }
  const persistedCharacter = changeLogDomain.withSyncMeta(
    changeLogDomain.withCharacterChangeLog(state.character),
    Math.max(1, appState.localCharacterVersion),
    appState.localCharacterUpdatedAt
  );
  saveAppState({ ...state, character: persistedCharacter });
  persistence.queueRemoteSave(state);
  if (isUuid(state.character?.id)) {
    historyApi.rememberLastCharacterId(state.character.id);
    historyApi.upsertCharacterHistory(state.character, { touchAccess: false });
  }
});

bootstrapApi.registerServiceWorker();
bootstrapApi.bindGlobalEvents();

bootstrapApi.bootstrap().catch((error) => {
  console.error("Bootstrap failed", error);
  appState.startupErrorMessage = "Startup failed. Reload the page to try again.";
  appState.showOnboardingHome = true;
  render(store.getState());
});

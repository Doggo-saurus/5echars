export const DEFAULT_DICE_RESULT_MESSAGE = "Roll a save or skill to throw dice.";
export const ROLL_HISTORY_LIMIT = 10;
export const CHARACTER_CHANGE_LOG_LIMIT = 200;
export const CHARACTER_CHANGE_LOG_KEY = "characterLog";
export const LAST_CHARACTER_ID_KEY = "fivee-last-character-id";
export const CHARACTER_HISTORY_KEY = "fivee-character-history";
export const CHARACTER_HISTORY_LIMIT = 20;
export const NEW_CHARACTER_OPTION_VALUE = "__new_character__";
export const CHARACTER_SYNC_META_KEY = "__syncMeta";
export const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createUiState(defaultDiceStyle) {
  return {
    selectedDiceStyle: defaultDiceStyle,
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
}

export function createAppState() {
  return {
    startupErrorMessage: "",
    showOnboardingHome: true,
    isRemoteSaveSuppressed: false,
    remoteSaveTimer: null,
    localCharacterVersion: 0,
    localCharacterUpdatedAt: "",
    activePartyId: null,
    activeParty: null,
  };
}

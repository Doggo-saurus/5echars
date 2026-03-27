import { computeDerivedStats } from "../engine/rules.js";

export const STEPS = [
  "Sources",
  "Basics",
  "Ancestry",
  "Class",
  "Abilities",
  "Equipment",
  "Spells",
  "Review",
];

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const SPELL_SLOT_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function getDefaultSpellSlots() {
  return SPELL_SLOT_LEVELS.reduce((acc, lvl) => {
    acc[String(lvl)] = { max: 0, used: 0 };
    return acc;
  }, {});
}

function getDefaultPlayState() {
  return {
    hpCurrent: null,
    hpTemp: 0,
    speed: 30,
    initiativeBonus: 0,
    saveProficiencies: {},
    skillProficiencies: {},
    preparedSpells: {},
    spellSlots: getDefaultSpellSlots(),
    attacks: [],
    resources: [],
    conditions: [],
    notes: "",
    deathSavesSuccess: 0,
    deathSavesFail: 0,
  };
}

function normalizeCharacter(character) {
  const base = createInitialCharacter();
  const play = {
    ...getDefaultPlayState(),
    ...(character.play ?? {}),
    preparedSpells:
      character.play?.preparedSpells && typeof character.play.preparedSpells === "object"
        ? { ...character.play.preparedSpells }
        : {},
    spellSlots: {
      ...getDefaultSpellSlots(),
      ...(character.play?.spellSlots ?? {}),
    },
  };

  return {
    ...base,
    ...character,
    abilities: { ...base.abilities, ...(character.abilities ?? {}) },
    inventory: Array.isArray(character.inventory) ? character.inventory : [],
    spells: Array.isArray(character.spells) ? character.spells : [],
    multiclass: Array.isArray(character.multiclass) ? character.multiclass : [],
    play,
  };
}

export function createInitialCharacter() {
  return {
    name: "",
    level: 1,
    sourcePreset: "expanded",
    race: "",
    background: "",
    class: "",
    subclass: "",
    abilities: {
      str: 10,
      dex: 10,
      con: 10,
      int: 10,
      wis: 10,
      cha: 10,
    },
    inventory: [],
    spells: [],
    notes: "",
    multiclass: [],
    play: getDefaultPlayState(),
  };
}

export function createStore(initialState) {
  const state = {
    character: normalizeCharacter(initialState ?? createInitialCharacter()),
    catalogs: { classes: [], races: [], backgrounds: [], spells: [], items: [] },
    stepIndex: 0,
    mode: "build",
  };
  const listeners = new Set();

  const notify = () => {
    listeners.forEach((fn) => fn(getState()));
  };

  const getState = () => ({
    ...state,
    derived: computeDerivedStats(state.character),
  });

  return {
    subscribe(fn) {
      listeners.add(fn);
      fn(getState());
      return () => listeners.delete(fn);
    },
    setCatalogs(catalogs) {
      state.catalogs = catalogs;
      notify();
    },
    setStep(index) {
      state.stepIndex = Math.max(0, Math.min(STEPS.length - 1, index));
      notify();
    },
    setMode(mode) {
      state.mode = mode === "play" ? "play" : "build";
      notify();
    },
    updateCharacter(patch) {
      state.character = normalizeCharacter({ ...state.character, ...patch });
      notify();
    },
    updateAbility(key, value) {
      if (!ABILITIES.includes(key)) return;
      state.character = {
        ...state.character,
        abilities: { ...state.character.abilities, [key]: Number(value) || 0 },
      };
      notify();
    },
    addSpell(spellName) {
      if (!spellName || state.character.spells.includes(spellName)) return;
      state.character = {
        ...state.character,
        spells: [...state.character.spells, spellName],
      };
      notify();
    },
    removeSpell(spellName) {
      state.character = {
        ...state.character,
        spells: state.character.spells.filter((it) => it !== spellName),
        play: {
          ...state.character.play,
          preparedSpells: Object.fromEntries(
            Object.entries(state.character.play?.preparedSpells ?? {}).filter(([name]) => name !== spellName)
          ),
        },
      };
      notify();
    },
    setSpellPrepared(spellName, prepared) {
      if (!spellName) return;
      state.character = {
        ...state.character,
        play: {
          ...state.character.play,
          preparedSpells: {
            ...(state.character.play?.preparedSpells ?? {}),
            [spellName]: Boolean(prepared),
          },
        },
      };
      notify();
    },
    addItem(itemName) {
      if (!itemName) return;
      state.character = {
        ...state.character,
        inventory: [...state.character.inventory, itemName],
      };
      notify();
    },
    removeItem(itemName) {
      const idx = state.character.inventory.indexOf(itemName);
      if (idx < 0) return;
      const next = [...state.character.inventory];
      next.splice(idx, 1);
      state.character = { ...state.character, inventory: next };
      notify();
    },
    hydrate(character) {
      state.character = normalizeCharacter(character);
      notify();
    },
    getState,
  };
}

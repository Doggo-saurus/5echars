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
  };
}

export function createStore(initialState) {
  const state = {
    character: initialState ?? createInitialCharacter(),
    catalogs: { classes: [], races: [], backgrounds: [], spells: [], items: [] },
    stepIndex: 0,
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
    updateCharacter(patch) {
      state.character = { ...state.character, ...patch };
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
      state.character = character;
      notify();
    },
    getState,
  };
}

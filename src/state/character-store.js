import { DEFAULT_SOURCE_PRESET } from "../config/sources.js";
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

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

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
    spellSlotMaxOverrides: {},
    spellSlotUserOverrides: {},
    spellSlotAutoDefaults: {},
    attacks: [],
    resources: [],
    featureUses: {},
    conditions: [],
    notes: "",
    deathSavesSuccess: 0,
    deathSavesFail: 0,
  };
}

function normalizeCharacter(character) {
  const incomingClassSelection =
    character.classSelection && typeof character.classSelection === "object" ? character.classSelection : {};
  const incomingSubclass =
    incomingClassSelection.subclass && typeof incomingClassSelection.subclass === "object"
      ? incomingClassSelection.subclass
      : {};
  const subclassName =
    typeof incomingSubclass.name === "string" && incomingSubclass.name.trim()
      ? incomingSubclass.name.trim()
      : typeof character.subclass === "string"
        ? character.subclass.trim()
        : "";

  const legacySlotOverrides = Object.fromEntries(
    Object.entries(character.play?.spellSlots ?? {})
      .filter(([, slot]) => toNumber(slot?.max, 0) > 0)
      .map(([level, slot]) => [level, Math.max(0, toNumber(slot?.max, 0))])
  );
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
    spellSlotMaxOverrides:
      character.play?.spellSlotMaxOverrides && typeof character.play.spellSlotMaxOverrides === "object"
        ? { ...character.play.spellSlotMaxOverrides }
        : legacySlotOverrides,
    spellSlotUserOverrides:
      character.play?.spellSlotUserOverrides && typeof character.play.spellSlotUserOverrides === "object"
        ? { ...character.play.spellSlotUserOverrides }
        : { ...legacySlotOverrides },
    spellSlotAutoDefaults:
      character.play?.spellSlotAutoDefaults && typeof character.play.spellSlotAutoDefaults === "object"
        ? { ...character.play.spellSlotAutoDefaults }
        : {},
    featureUses:
      character.play?.featureUses && typeof character.play.featureUses === "object"
        ? { ...character.play.featureUses }
        : {},
  };

  return {
    ...base,
    ...character,
    id: typeof character.id === "string" && character.id.trim() ? character.id.trim() : null,
    abilities: { ...base.abilities, ...(character.abilities ?? {}) },
    inventory: Array.isArray(character.inventory) ? character.inventory : [],
    spells: Array.isArray(character.spells) ? character.spells : [],
    multiclass: Array.isArray(character.multiclass) ? character.multiclass : [],
    feats: Array.isArray(character.feats)
      ? character.feats
          .map((feat) => ({
            id: typeof feat?.id === "string" ? feat.id : "",
            name: typeof feat?.name === "string" ? feat.name : "",
            source: typeof feat?.source === "string" ? feat.source : "",
            via: typeof feat?.via === "string" ? feat.via : "manual",
            levelGranted: toNumber(feat?.levelGranted, 0),
            slotId: typeof feat?.slotId === "string" ? feat.slotId : "",
          }))
          .filter((feat) => feat.id && feat.name)
      : [],
    subclass: subclassName,
    classSelection: {
      subclass: {
        name: subclassName,
        source: typeof incomingSubclass.source === "string" ? incomingSubclass.source : "",
        className: typeof incomingSubclass.className === "string" ? incomingSubclass.className : "",
        classSource: typeof incomingSubclass.classSource === "string" ? incomingSubclass.classSource : "",
      },
    },
    progression:
      character.progression && typeof character.progression === "object"
        ? {
            unlockedFeatures: Array.isArray(character.progression.unlockedFeatures)
              ? character.progression.unlockedFeatures
                  .map((feature) => ({
                    id: typeof feature?.id === "string" ? feature.id : "",
                    name: typeof feature?.name === "string" ? feature.name : "",
                    source: typeof feature?.source === "string" ? feature.source : "",
                    type: feature?.type === "subclass" ? "subclass" : "class",
                    className: typeof feature?.className === "string" ? feature.className : "",
                    subclassName: typeof feature?.subclassName === "string" ? feature.subclassName : "",
                    level: toNumber(feature?.level, 0),
                  }))
                  .filter((feature) => feature.id && feature.name)
              : [],
            featSlots: Array.isArray(character.progression.featSlots)
              ? character.progression.featSlots
                  .map((slot) => ({
                    id: typeof slot?.id === "string" ? slot.id : "",
                    className: typeof slot?.className === "string" ? slot.className : "",
                    level: toNumber(slot?.level, 0),
                    count: Math.max(1, toNumber(slot?.count, 1)),
                    slotType: typeof slot?.slotType === "string" && slot.slotType ? slot.slotType : "feat",
                  }))
                  .filter((slot) => slot.id && slot.className && slot.level > 0)
              : [],
            pendingFeatSlotIds: Array.isArray(character.progression.pendingFeatSlotIds)
              ? character.progression.pendingFeatSlotIds.filter((id) => typeof id === "string" && id)
              : [],
            selectedFeatIds: Array.isArray(character.progression.selectedFeatIds)
              ? character.progression.selectedFeatIds.filter((id) => typeof id === "string" && id)
              : [],
          }
        : { ...base.progression },
    play,
  };
}

export function createInitialCharacter() {
  return {
    id: null,
    name: "",
    level: 1,
    sourcePreset: DEFAULT_SOURCE_PRESET,
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
    feats: [],
    notes: "",
    multiclass: [],
    classSelection: {
      subclass: {
        name: "",
        source: "",
        className: "",
        classSource: "",
      },
    },
    progression: {
      unlockedFeatures: [],
      featSlots: [],
      pendingFeatSlotIds: [],
      selectedFeatIds: [],
    },
    play: getDefaultPlayState(),
  };
}

export function createStore(initialState) {
  const state = {
    character: normalizeCharacter(initialState ?? createInitialCharacter()),
    catalogs: {
      classes: [],
      subclasses: [],
      classFeatures: [],
      subclassFeatures: [],
      races: [],
      backgrounds: [],
      feats: [],
      optionalFeatures: [],
      spells: [],
      items: [],
    },
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

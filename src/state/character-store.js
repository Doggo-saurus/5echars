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
const CRIT_STYLE_KEYS = new Set(["none", "standard", "doubleTotal", "maxPlusRoll", "maxDamage", "doubleAll"]);

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function getCatalogSpell(state, spellName) {
  const target = String(spellName ?? "").trim().toLowerCase();
  if (!target) return null;
  const spells = Array.isArray(state?.catalogs?.spells) ? state.catalogs.spells : [];
  return spells.find((spell) => String(spell?.name ?? "").trim().toLowerCase() === target) ?? null;
}

function isCantripSpell(state, spellName) {
  const spell = getCatalogSpell(state, spellName);
  return toNumber(spell?.level, 0) === 0;
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
    autoSaveProficiencies: {},
    autoSkillProficiencies: {},
    saveProficiencyOverrides: {},
    skillProficiencyOverrides: {},
    skillProficiencyModes: {},
    autoSkillProficiencyModes: {},
    skillProficiencyModeOverrides: {},
    autoAbilityBonuses: {},
    autoChoiceSelections: {},
    featureModes: {},
    autoGrantedSpells: [],
    autoClassListSpells: [],
    autoPreparedSpells: {},
    autoSpellGrantTypes: {},
    showAllPreparedCasterSpells: false,
    showAllPreparedCasterSpellsByLevel: {},
    preparedSpells: {},
    spellSlots: getDefaultSpellSlots(),
    spellSlotMaxOverrides: {},
    spellSlotUserOverrides: {},
    spellSlotAutoDefaults: {},
    attacks: [],
    featureUses: {},
    hitDiceSpent: {},
    inspiration: false,
    conditions: [],
    notes: "",
    deathSavesSuccess: 0,
    deathSavesFail: 0,
  };
}

function normalizeHitPointRollOverrides(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .map(([key, value]) => [String(key ?? "").trim(), Math.floor(toNumber(value, NaN))])
      .filter(([key, value]) => key && Number.isFinite(value) && value > 0)
  );
}

function createInventoryEntryId() {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `inv_${stamp}_${rand}`;
}

function normalizeInventoryEntry(entry) {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const name = String(entry.name ?? "").trim();
  if (!name) return null;
  return {
    ...entry,
    id: String(entry.id ?? "").trim() || createInventoryEntryId(),
    name,
    equipped: Boolean(entry.equipped),
  };
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

function normalizeFeatEntry(entry) {
  const isObject = entry && typeof entry === "object" && !Array.isArray(entry);
  const name = isObject ? String(entry.name ?? "").trim() : String(entry ?? "").trim();
  if (!name) return null;
  const source = isObject ? String(entry.source ?? "").trim() : "";
  const idRaw = isObject ? String(entry.id ?? "").trim() : "";
  const id = idRaw || buildEntityId(["feat", name, source || "unknown"]);
  return {
    id,
    name,
    source,
    via: isObject && typeof entry.via === "string" ? entry.via : "manual",
    levelGranted: toNumber(isObject ? entry.levelGranted : undefined, 0),
    slotId: isObject && typeof entry.slotId === "string" ? entry.slotId : "",
  };
}

function normalizeOptionalFeatureEntry(entry) {
  const isObject = entry && typeof entry === "object" && !Array.isArray(entry);
  const name = isObject ? String(entry.name ?? "").trim() : String(entry ?? "").trim();
  if (!name) return null;
  const source = isObject ? String(entry.source ?? "").trim() : "";
  const idRaw = isObject ? String(entry.id ?? "").trim() : "";
  const id = idRaw || buildEntityId(["optionalfeature", name, source || "unknown"]);
  return {
    id,
    name,
    source,
    levelGranted: toNumber(isObject ? entry.levelGranted : undefined, 0),
    slotId: isObject && typeof entry.slotId === "string" ? entry.slotId : "",
    className: isObject && typeof entry.className === "string" ? entry.className : "",
    slotType: isObject && typeof entry.slotType === "string" ? entry.slotType : "",
    featureType: isObject && typeof entry.featureType === "string" ? entry.featureType : "",
  };
}

function normalizeCharacter(character) {
  const incomingAutoChoiceSelections =
    character.play?.autoChoiceSelections && typeof character.play.autoChoiceSelections === "object" && !Array.isArray(character.play.autoChoiceSelections)
      ? character.play.autoChoiceSelections
      : {};
  const normalizedAutoChoiceSelections = Object.fromEntries(
    Object.entries(incomingAutoChoiceSelections).map(([sourceKey, choiceMap]) => [
      sourceKey,
      choiceMap && typeof choiceMap === "object" && !Array.isArray(choiceMap) ? { ...choiceMap } : {},
    ])
  );

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
    resources: [],
    featureUses:
      character.play?.featureUses && typeof character.play.featureUses === "object"
        ? { ...character.play.featureUses }
        : {},
    hitDiceSpent:
      character.play?.hitDiceSpent && typeof character.play.hitDiceSpent === "object" && !Array.isArray(character.play.hitDiceSpent)
        ? Object.fromEntries(
            Object.entries(character.play.hitDiceSpent)
              .map(([key, value]) => [String(key ?? "").trim(), Math.max(0, Math.floor(toNumber(value, 0)))])
              .filter(([key, value]) => key && value > 0)
          )
        : {},
    featureModes:
      character.play?.featureModes && typeof character.play.featureModes === "object" && !Array.isArray(character.play.featureModes)
        ? { ...character.play.featureModes }
        : {},
    autoGrantedSpells:
      Array.isArray(character.play?.autoGrantedSpells)
        ? character.play.autoGrantedSpells.map((name) => String(name ?? "").trim()).filter(Boolean)
        : [],
    autoClassListSpells:
      Array.isArray(character.play?.autoClassListSpells)
        ? character.play.autoClassListSpells.map((name) => String(name ?? "").trim()).filter(Boolean)
        : [],
    autoPreparedSpells:
      character.play?.autoPreparedSpells && typeof character.play.autoPreparedSpells === "object"
        ? { ...character.play.autoPreparedSpells }
        : {},
    autoSpellGrantTypes:
      character.play?.autoSpellGrantTypes && typeof character.play.autoSpellGrantTypes === "object"
        ? { ...character.play.autoSpellGrantTypes }
        : {},
    showAllPreparedCasterSpells: Boolean(character.play?.showAllPreparedCasterSpells),
    showAllPreparedCasterSpellsByLevel:
      character.play?.showAllPreparedCasterSpellsByLevel && typeof character.play.showAllPreparedCasterSpellsByLevel === "object"
      && !Array.isArray(character.play.showAllPreparedCasterSpellsByLevel)
        ? { ...character.play.showAllPreparedCasterSpellsByLevel }
        : {},
    autoSaveProficiencies:
      character.play?.autoSaveProficiencies && typeof character.play.autoSaveProficiencies === "object"
        ? { ...character.play.autoSaveProficiencies }
        : {},
    autoSkillProficiencies:
      character.play?.autoSkillProficiencies && typeof character.play.autoSkillProficiencies === "object"
        ? { ...character.play.autoSkillProficiencies }
        : {},
    skillProficiencyModes:
      character.play?.skillProficiencyModes && typeof character.play.skillProficiencyModes === "object"
        ? { ...character.play.skillProficiencyModes }
        : {},
    autoSkillProficiencyModes:
      character.play?.autoSkillProficiencyModes && typeof character.play.autoSkillProficiencyModes === "object"
        ? { ...character.play.autoSkillProficiencyModes }
        : {},
    saveProficiencyOverrides:
      character.play?.saveProficiencyOverrides && typeof character.play.saveProficiencyOverrides === "object"
        ? { ...character.play.saveProficiencyOverrides }
        : {},
    skillProficiencyOverrides:
      character.play?.skillProficiencyOverrides && typeof character.play.skillProficiencyOverrides === "object"
        ? { ...character.play.skillProficiencyOverrides }
        : {},
    skillProficiencyModeOverrides:
      character.play?.skillProficiencyModeOverrides && typeof character.play.skillProficiencyModeOverrides === "object"
        ? { ...character.play.skillProficiencyModeOverrides }
        : {},
    autoAbilityBonuses:
      character.play?.autoAbilityBonuses && typeof character.play.autoAbilityBonuses === "object"
        ? { ...character.play.autoAbilityBonuses }
        : {},
    inspiration: Boolean(character.play?.inspiration),
    autoChoiceSelections:
      normalizedAutoChoiceSelections,
  };

  return {
    ...base,
    ...character,
    id: typeof character.id === "string" && character.id.trim() ? character.id.trim() : null,
    diceStyle: typeof character.diceStyle === "string" && character.diceStyle.trim() ? character.diceStyle.trim() : base.diceStyle,
    critStyle:
      typeof character.critStyle === "string" && CRIT_STYLE_KEYS.has(character.critStyle.trim())
        ? character.critStyle.trim()
        : base.critStyle,
    showDiceTray:
      typeof character.showDiceTray === "boolean"
        ? character.showDiceTray
        : base.showDiceTray,
    abilities: { ...base.abilities, ...(character.abilities ?? {}) },
    abilityBase:
      character.abilityBase && typeof character.abilityBase === "object"
        ? { ...base.abilities, ...character.abilityBase }
        : { ...base.abilities, ...(character.abilities ?? {}) },
    inventory: Array.isArray(character.inventory) ? character.inventory.map((entry) => normalizeInventoryEntry(entry)).filter(Boolean) : [],
    customSources: Array.isArray(character.customSources)
      ? [...new Set(character.customSources.map((entry) => String(entry ?? "").trim()).filter(Boolean))]
      : [],
    race: typeof character.race === "string" ? character.race : "",
    raceSource: typeof character.raceSource === "string" ? character.raceSource : "",
    subrace: typeof character.subrace === "string" ? character.subrace : "",
    subraceSource: typeof character.subraceSource === "string" ? character.subraceSource : "",
    background: typeof character.background === "string" ? character.background : "",
    backgroundSource: typeof character.backgroundSource === "string" ? character.backgroundSource : "",
    class: typeof character.class === "string" ? character.class : "",
    classSource: typeof character.classSource === "string" ? character.classSource : "",
    spells: Array.isArray(character.spells) ? character.spells : [],
    multiclass: Array.isArray(character.multiclass) ? character.multiclass : [],
    feats: Array.isArray(character.feats) ? character.feats.map((feat) => normalizeFeatEntry(feat)).filter(Boolean) : [],
    optionalFeatures: Array.isArray(character.optionalFeatures)
      ? character.optionalFeatures.map((feature) => normalizeOptionalFeatureEntry(feature)).filter(Boolean)
      : [],
    editPassword: typeof character.editPassword === "string" ? character.editPassword : "",
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
                    classSource: typeof slot?.classSource === "string" ? slot.classSource : "",
                    subclassName: typeof slot?.subclassName === "string" ? slot.subclassName : "",
                    level: toNumber(slot?.level, 0),
                    count: Math.max(1, toNumber(slot?.count, 1)),
                    slotType: typeof slot?.slotType === "string" && slot.slotType ? slot.slotType : "feat",
                    featCategories: Array.isArray(slot?.featCategories)
                      ? slot.featCategories.map((entry) => String(entry ?? "").trim()).filter(Boolean)
                      : [],
                  }))
                  .filter((slot) => slot.id && slot.className && slot.level > 0)
              : [],
            pendingFeatSlotIds: Array.isArray(character.progression.pendingFeatSlotIds)
              ? character.progression.pendingFeatSlotIds.filter((id) => typeof id === "string" && id)
              : [],
            selectedFeatIds: Array.isArray(character.progression.selectedFeatIds)
              ? character.progression.selectedFeatIds.filter((id) => typeof id === "string" && id)
              : [],
            optionalFeatureSlots: Array.isArray(character.progression.optionalFeatureSlots)
              ? character.progression.optionalFeatureSlots
                  .map((slot) => ({
                    id: typeof slot?.id === "string" ? slot.id : "",
                    className: typeof slot?.className === "string" ? slot.className : "",
                    classSource: typeof slot?.classSource === "string" ? slot.classSource : "",
                    subclassName: typeof slot?.subclassName === "string" ? slot.subclassName : "",
                    level: toNumber(slot?.level, 0),
                    count: Math.max(1, toNumber(slot?.count, 1)),
                    slotType: typeof slot?.slotType === "string" ? slot.slotType : "Optional Feature",
                    featureType: typeof slot?.featureType === "string" ? slot.featureType : "",
                  }))
                  .filter((slot) => slot.id && slot.className && slot.level > 0)
              : [],
            pendingOptionalFeatureSlotIds: Array.isArray(character.progression.pendingOptionalFeatureSlotIds)
              ? character.progression.pendingOptionalFeatureSlotIds.filter((id) => typeof id === "string" && id)
              : [],
            selectedOptionalFeatureIds: Array.isArray(character.progression.selectedOptionalFeatureIds)
              ? character.progression.selectedOptionalFeatureIds.filter((id) => typeof id === "string" && id)
              : [],
            classTableEffects: Array.isArray(character.progression.classTableEffects)
              ? character.progression.classTableEffects
                  .map((effect) => ({
                    id: typeof effect?.id === "string" ? effect.id : "",
                    className: typeof effect?.className === "string" ? effect.className : "",
                    label: typeof effect?.label === "string" ? effect.label : "",
                    kind: typeof effect?.kind === "string" ? effect.kind : "text",
                    value: effect?.value ?? "",
                  }))
                  .filter((effect) => effect.id && effect.className && effect.label)
              : [],
            featureModes: Array.isArray(character.progression.featureModes)
              ? character.progression.featureModes
                  .map((mode) => ({
                    id: typeof mode?.id === "string" ? mode.id : "",
                    featureId: typeof mode?.featureId === "string" ? mode.featureId : "",
                    featureName: typeof mode?.featureName === "string" ? mode.featureName : "",
                    className: typeof mode?.className === "string" ? mode.className : "",
                    optionValues: Array.isArray(mode?.optionValues)
                      ? mode.optionValues.map((value) => String(value ?? "").trim()).filter(Boolean)
                      : [],
                  }))
                  .filter((mode) => mode.id && mode.featureId && mode.optionValues.length > 0)
              : [],
          }
        : { ...base.progression },
    hitPointRollOverrides: normalizeHitPointRollOverrides(character.hitPointRollOverrides),
    play,
  };
}

export function createInitialCharacter() {
  return {
    id: null,
    name: "",
    diceStyle: "arcane",
    critStyle: "standard",
    showDiceTray: true,
    level: 1,
    sourcePreset: DEFAULT_SOURCE_PRESET,
    customSources: [],
    race: "",
    raceSource: "",
    subrace: "",
    subraceSource: "",
    background: "",
    backgroundSource: "",
    class: "",
    classSource: "",
    subclass: "",
    abilities: {
      str: 10,
      dex: 10,
      con: 10,
      int: 10,
      wis: 10,
      cha: 10,
    },
    abilityBase: {
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
    optionalFeatures: [],
    notes: "",
    editPassword: "",
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
      optionalFeatureSlots: [],
      pendingOptionalFeatureSlotIds: [],
      selectedOptionalFeatureIds: [],
      classTableEffects: [],
      featureModes: [],
    },
    hitPointRollOverrides: {},
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
      subraces: [],
      backgrounds: [],
      feats: [],
      optionalFeatures: [],
      spells: [],
      items: [],
      conditions: [],
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
    derived: computeDerivedStats(state.character, state.catalogs),
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
      const nextScore = Math.max(1, Math.min(30, Number(value) || 0));
      const autoBonus = toNumber(state.character.play?.autoAbilityBonuses?.[key], 0);
      const nextBase = Math.max(1, Math.min(30, nextScore - autoBonus));
      state.character = {
        ...state.character,
        abilityBase: { ...(state.character.abilityBase ?? {}), [key]: nextBase },
        abilities: { ...state.character.abilities, [key]: nextScore },
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
      const nextPrepared = isCantripSpell(state, spellName) ? true : Boolean(prepared);
      state.character = {
        ...state.character,
        play: {
          ...state.character.play,
          preparedSpells: {
            ...(state.character.play?.preparedSpells ?? {}),
            [spellName]: nextPrepared,
          },
        },
      };
      notify();
    },
    addItem(itemEntry) {
      if (!itemEntry) return;
      const normalized = normalizeInventoryEntry(itemEntry);
      if (normalized == null && typeof itemEntry !== "string") return;
      state.character = {
        ...state.character,
        inventory: [...state.character.inventory, normalized ?? String(itemEntry)],
      };
      notify();
    },
    removeItem(itemSelector) {
      const current = Array.isArray(state.character.inventory) ? state.character.inventory : [];
      let idx = -1;
      if (typeof itemSelector === "number") idx = itemSelector;
      else if (typeof itemSelector === "string") {
        idx = current.findIndex((entry) => {
          if (typeof entry === "string") return entry === itemSelector;
          return String(entry?.id ?? "").trim() === itemSelector || String(entry?.name ?? "").trim() === itemSelector;
        });
      }
      if (idx < 0 || idx >= current.length) return;
      const next = [...state.character.inventory];
      next.splice(idx, 1);
      state.character = { ...state.character, inventory: next };
      notify();
    },
    toggleItemEquipped(itemId) {
      const id = String(itemId ?? "").trim();
      if (!id) return;
      const next = (state.character.inventory ?? []).map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
        if (String(entry.id ?? "").trim() !== id) return entry;
        return { ...entry, equipped: !Boolean(entry.equipped) };
      });
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

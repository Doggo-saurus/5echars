# JSON Format Reference

This document describes the JSON structures the app depends on and what parts of the app are affected when those structures change.

It covers:

- External catalog JSON loaded from `data/5etools-src/data/...`
- Character JSON exported/imported in the builder UI and persisted to `localStorage`

---

## 1) External Catalog JSON (5etools data)

Loader entrypoint: `src/data-loader.js`

### 1.1 File-level contract

The app expects these files/keys:

- `data/5etools-src/data/class/index.json`
  - Treated as a filename map via `Object.values(index)`
  - Every referenced chunk file must contain a `class` array
- `data/5etools-src/data/races.json`
  - Must contain a `race` array
- `data/5etools-src/data/backgrounds.json`
  - Must contain a `background` array
- `data/5etools-src/data/feats.json`
  - Must contain a `feat` array
- `data/5etools-src/data/optionalfeatures.json`
  - Must contain an `optionalfeature` array
- `data/5etools-src/data/spells/index.json`
  - Treated as a filename map via `Object.values(index)`
  - Every referenced chunk file must contain a `spell` array
- `data/5etools-src/data/items.json`
  - Must contain an `item` array
- `data/5etools-src/data/items-base.json`
  - Must contain a `baseitem` array

If these files cannot be loaded, the app falls back to a minimal in-memory catalog from `getFallbackCatalogs()` in `src/data-loader.js`.

For class chunks loaded from `data/5etools-src/data/class/index.json`, the app reads both:

- `class` arrays (class catalogs)
- `subclass` arrays (subclass catalogs used by subclass selector + feature progression)

### 1.2 Shared entity requirements

All loaded entities are filtered and displayed with:

- `name` (required for inclusion)
- `source` (required to pass source preset filtering)

`sourceLabel` is computed at load time and is not expected in source JSON.

If `name` is missing, entries are removed by `mapNamed()` in `src/data-loader.js`.

If `source` is missing or not in the selected preset, entries are removed by `filterBySources()` in `src/data-loader.js`.

### 1.3 Class object contract and impact

Minimal class shape used by the UI logic:

```json
{
  "name": "Wizard",
  "source": "PHB",
  "proficiency": ["int", "wis"],
  "hd": { "faces": 6 },
  "classTableGroups": [
    {
      "rowsSpellProgression": [
        [2, 0, 0, 0, 0, 0, 0, 0, 0]
      ]
    }
  ],
  "primaryAbility": [{ "int": true }],
  "startingProficiencies": {
    "armor": ["none"],
    "weapons": ["dagger"],
    "skills": [{ "choose": { "count": 2, "from": ["arcana", "history"] } }]
  },
  "multiclassing": {
    "requirements": { "int": 13 }
  },
  "classFeatures": [
    "Spellcasting|Wizard||1"
  ]
}
```

Field impact map:

- `name`, `source`
  - Affects class dropdowns, class matching, multiclass UI, source filters
  - Used in `src/data-loader.js`, `optionList()` in `src/main.js`, and class lookup helpers
- `proficiency`
  - Drives auto-save proficiencies
  - Used by `getClassSaveProficiencies()` and class details modal in `src/main.js`
- `classTableGroups[].rowsSpellProgression`
  - Drives spell slot defaults, caster type detection, multiclass caster math, level-up preview
  - Used by `getClassSpellSlotDefaults()`, `getSpellProgressionRows()`, `getClassCasterType()`, `getClassCasterContribution()` in `src/main.js`
- `hd.faces`
  - Used in class details modal display
- `primaryAbility`
  - Used in class details modal (`formatClassPrimaryAbility()`)
- `startingProficiencies.skills|armor|weapons`
  - Used in class details modal (`formatClassStartingSkills()` and proficiency rows)
- `multiclassing.requirements`
  - Used in class details modal (`formatClassMulticlassRequirements()`)
- `classFeatures`
  - Parsed for class feature list in class details modal (`getClassFeatureRows()`)
- `featProgression`
  - Drives automatic feat slot generation for feat picker UI
- subclass catalogs (`subclass` objects in class chunk files)
  - Drive subclass selector and unlocked subclass feature progression (`subclassFeatures`)

### 1.4 Race / Background / Item object contract and impact

The app currently uses only:

- `name`
- `source`

Impact:

- Race + background: ancestry step selectors (`renderBuildEditor()` in `src/main.js`)
- Items: inventory picker search/filter/list (`openItemModal()` in `src/main.js`)

Changing additional fields on these entities currently has no UI impact.

### 1.5 Spell object contract and impact

Minimal spell shape used by the UI logic:

```json
{
  "name": "Magic Missile",
  "source": "PHB",
  "level": 1,
  "school": "E",
  "time": [{ "number": 1, "unit": "action" }],
  "range": { "type": "point", "distance": { "type": "feet", "amount": 120 } },
  "duration": [{ "type": "instant" }],
  "components": { "v": true, "s": true, "m": "a bit of phosphorus" },
  "entries": [
    "You create three glowing darts..."
  ],
  "entriesHigherLevel": [
    { "name": "At Higher Levels", "entries": ["One more dart..."] }
  ]
}
```

Field impact map:

- `name`
  - Primary ID for selection and lookup
  - Used in spell picker, selected-spell storage, details modal, cast actions
- `source`
  - Source filter and metadata labels in spell lists/modals
- `level`
  - Grouping, filtering, slot-usage logic, and labels (Cantrip vs Level N)
- `school`
  - School label in play/build spell UI and details modal
- `time`, `range`, `duration`, `components`
  - Rendered metadata in spell details modal
  - Formatting functions in `src/main.js`: `formatSpellTime()`, `formatSpellRange()`, `formatSpellDuration()`, `formatSpellComponents()`
- `entries`, `entriesHigherLevel`
  - Description rendering and automatic dice-notation extraction for cast/roll actions
  - Used by `getSpellDescriptionLines()`, `getSpellPrimaryDiceNotation()`, and spell details modal rendering

Accepted nested entry patterns in descriptions:

- String entries
- Arrays of entries
- Objects with `entries`
- Objects with `items`
- Objects with `entry`
- Objects with `text`

Inline tags such as `{@dice ...}`, `{@damage ...}`, `{@dc ...}`, `{@hit ...}` are stripped/normalized by `cleanSpellInlineTags()`.

---

## 2) Character JSON (Export / Import / Persistence)

Character state source of truth:

- Initial/default shape: `createInitialCharacter()` in `src/state/character-store.js`
- Normalization on load/import: `normalizeCharacter()` in `src/state/character-store.js`

### 2.1 Character root shape

```json
{
  "name": "",
  "level": 1,
  "sourcePreset": "expanded",
  "race": "",
  "background": "",
  "class": "",
  "subclass": "",
  "abilities": {
    "str": 10,
    "dex": 10,
    "con": 10,
    "int": 10,
    "wis": 10,
    "cha": 10
  },
  "inventory": [],
  "spells": [],
  "feats": [],
  "notes": "",
  "multiclass": [],
  "classSelection": {},
  "progression": {},
  "play": {}
}
```

New root fields:

- `feats`: selected feats, typically assigned to generated feat slots
- `classSelection.subclass`: structured subclass selection (`name`, `source`, `className`, `classSource`)
- `progression`: auto-generated progression state (`unlockedFeatures`, `featSlots`, `pendingFeatSlotIds`, `selectedFeatIds`)

### 2.2 `play` object shape

```json
{
  "hpCurrent": null,
  "hpTemp": 0,
  "speed": 30,
  "initiativeBonus": 0,
  "saveProficiencies": {},
  "skillProficiencies": {},
  "preparedSpells": {},
  "spellSlots": {
    "1": { "max": 0, "used": 0 },
    "2": { "max": 0, "used": 0 },
    "3": { "max": 0, "used": 0 },
    "4": { "max": 0, "used": 0 },
    "5": { "max": 0, "used": 0 },
    "6": { "max": 0, "used": 0 },
    "7": { "max": 0, "used": 0 },
    "8": { "max": 0, "used": 0 },
    "9": { "max": 0, "used": 0 }
  },
  "spellSlotMaxOverrides": {},
  "spellSlotUserOverrides": {},
  "spellSlotAutoDefaults": {},
  "attacks": [],
  "resources": [],
  "conditions": [],
  "notes": "",
  "deathSavesSuccess": 0,
  "deathSavesFail": 0
}
```

`resources` may include auto-generated entries keyed with `autoId` (e.g. `auto:...`) for deterministic class feature trackers.

### 2.3 Character field impact map

- `level`, `abilities`
  - Affect all derived stats (`src/engine/rules.js`) and many play/build displays
- `class`, `multiclass`
  - Affect save proficiencies and spell slot defaults via `updateCharacterWithRequiredSettings()` in `src/main.js`
- `sourcePreset`
  - Triggers catalog reload and therefore changes all available race/class/background/spell/item options
- `spells` (array of spell names)
  - Drives spell group rendering, prepared toggles, slot spending, cast actions
  - Name must match a spell `name` in loaded catalogs
- `inventory` (array of item names)
  - Drives equipment pills/list
- `play.saveProficiencies`, `play.skillProficiencies`
  - Toggle state for manual proficiency controls in play/build views
- `play.preparedSpells`
  - Prepared state keyed by spell name; used for prepared casters only
- `play.spellSlots`, `play.spellSlotMaxOverrides`, `play.spellSlotUserOverrides`, `play.spellSlotAutoDefaults`
  - Core spell-slot state and override system used in build + play flows
- `play.hpCurrent`, `play.hpTemp`, `play.speed`, `play.initiativeBonus`, `play.conditions`, `play.notes`
  - Play sheet-only runtime fields
- `play.attacks`, `play.resources`
  - Dynamic play sheet collections
- `play.deathSavesSuccess`, `play.deathSavesFail`
  - Death save tracker and roller logic

### 2.4 Persistence wrapper format

`localStorage` v2 wrapper (see `src/state/persistence.js`):

```json
{
  "character": { "...": "character object above" },
  "mode": "build",
  "stepIndex": 0
}
```

Legacy compatibility:

- If v2 is missing, the app attempts to read legacy v1 and treats it as direct character JSON.

---

## 3) Change-Safety Checklist

When changing JSON shape, verify these in order:

1. **Loader paths/keys** still match in `src/data-loader.js`
2. **Required identity fields** still exist (`name`, `source`) for catalog entities
3. **Class spell progression shape** still maps to `rowsSpellProgression[levelIndex][slotIndex]`
4. **Spell description structure** is still parseable by `collectSpellEntryLines()`
5. **Character import/export** still round-trips through `normalizeCharacter()` without losing data
6. **Play mode interactions** still work after long rest, spell cast, add/remove spell/item, and class changes

If any JSON format changes are planned, update this file first and treat it as the impact checklist for QA.

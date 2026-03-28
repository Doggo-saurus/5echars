# JSON Format Reference (LLM Ingest)

This document is the ingest contract for LLMs that extract character data from exported PDFs and return JSON for dataset prefill.

Public endpoints:

- `GET /JSON_FORMAT_REFERENCE`
- `GET /JSON_FORMAT_REFERENCE.md`

---

## 1) Output Rules

- Return valid JSON only.
- Use exactly the keys defined in this document.
- Keep key names case-sensitive.
- Use numbers for numeric fields (not numeric strings).
- Use `null` only where explicitly allowed.
- If a value is unknown, use the documented default.
- Do not invent fields.
- Internal IDs are optional for LLM output; the app resolves IDs from names when possible.

---

## 2) Canonical Payload

Provide one JSON object in this shape:

```json
{
  "id": null,
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
  "abilityBase": {
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
  "optionalFeatures": [],
  "notes": "",
  "multiclass": [],
  "classSelection": {
    "subclass": {
      "name": "",
      "source": "",
      "className": "",
      "classSource": ""
    }
  },
  "progression": {
    "unlockedFeatures": [],
    "featSlots": [],
    "pendingFeatSlotIds": [],
    "selectedFeatIds": [],
    "optionalFeatureSlots": [],
    "pendingOptionalFeatureSlotIds": [],
    "selectedOptionalFeatureIds": [],
    "classTableEffects": [],
    "featureModes": []
  },
  "hitPointRollOverrides": {},
  "play": {
    "hpCurrent": null,
    "hpTemp": 0,
    "speed": 30,
    "initiativeBonus": 0,
    "saveProficiencies": {},
    "skillProficiencies": {},
    "autoSaveProficiencies": {},
    "autoSkillProficiencies": {},
    "saveProficiencyOverrides": {},
    "skillProficiencyOverrides": {},
    "skillProficiencyModes": {},
    "autoSkillProficiencyModes": {},
    "skillProficiencyModeOverrides": {},
    "autoAbilityBonuses": {},
    "autoChoiceSelections": {},
    "featureModes": {},
    "autoGrantedSpells": [],
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
    "featureUses": {},
    "hitDiceSpent": {},
    "conditions": [],
    "notes": "",
    "deathSavesSuccess": 0,
    "deathSavesFail": 0
  }
}
```

---

## 3) Field Constraints

Top-level constraints:

- `id`: `null` or UUID string. If unknown, use `null`.
- `name`: string.
- `level`: integer `1..20`.
- `sourcePreset`: `"core"` or `"expanded"`. Default `"expanded"`.
- `race`, `background`, `class`, `subclass`, `notes`: strings.

Ability constraints:

- `abilities` and `abilityBase` must include exactly: `str`, `dex`, `con`, `int`, `wis`, `cha`.
- Each ability score is an integer `1..30`.

Collection constraints:

- `inventory`: array of either item-name strings or objects with at least:
  - `name` (string, required if object form is used)
  - optional `id` (string)
  - optional `equipped` (boolean)
- `spells`: array of spell-name strings.
- `multiclass`: array.
- `feats`: array of objects with:
  - optional `id` (string)
  - `name` (string, required if entry exists)
  - optional `source` (string)
  - optional `via` (string)
  - optional `levelGranted` (number)
  - optional `slotId` (string)
- `optionalFeatures`: array of objects with:
  - optional `id` (string)
  - `name` (string, required if entry exists)
  - optional `source` (string)
  - optional `levelGranted` (number)
  - optional `slotId` (string)
  - optional `className` (string)
  - optional `slotType` (string)
  - optional `featureType` (string)

`play` constraints:

- `hpCurrent`: number or `null`.
- `hpTemp`, `speed`, `initiativeBonus`, `deathSavesSuccess`, `deathSavesFail`: numbers.
- `preparedSpells`: object keyed by spell name with boolean values.
- `spellSlots`: object with string keys `"1"` to `"9"`, each value:
  - `max`: number `>= 0`
  - `used`: number `>= 0`
- `conditions`: array of strings.
- `notes`: string.
- Other `play` object fields listed in section 2 should be objects or arrays as shown by defaults.

---

## 4) Name Resolution Policy

- For catalog-backed names (race, class, subclass, spells, feats, optional features), use canonical names when confident.
- If extraction is ambiguous:
  - leave the field empty (or omit the uncertain array entry),
  - add the raw uncertain text to `notes` for review.
- Do not hallucinate catalog names.

---

## 5) Minimal Safe Prefill

When confidence is limited, this compact payload is acceptable:

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
  "optionalFeatures": [],
  "notes": "",
  "multiclass": [],
  "play": {
    "hpCurrent": null,
    "hpTemp": 0,
    "deathSavesSuccess": 0,
    "deathSavesFail": 0
  }
}
```

---

## 6) PDF Extraction Mapping Guide

Use these rules when the only input is a character-sheet PDF.

### 6.1 Section detection order

Read and map in this order:

1. Identity block (`name`, class/level line, race, background)
2. Ability block (`STR DEX CON INT WIS CHA`)
3. Combat block (`HP`, initiative, speed, conditions, death saves)
4. Spellcasting block (known/prepared spells and slots)
5. Inventory/equipment block
6. Notes/free-text block

If the same field appears in multiple places, keep the most explicit value and record conflicts in `notes`.

### 6.2 Label aliases -> target keys

Map common labels and variants as follows:

- `character name`, `name` -> `name`
- `level`, `lvl`, `lv` -> `level`
- `class`, `classes` -> `class` (primary class)
- `subclass`, `archetype`, `domain`, `school`, `oath`, `patron`, `circle`, `college` -> `subclass`
- `race`, `species`, `ancestry`, `lineage` -> `race`
- `background` -> `background`

Ability labels:

- `str`, `strength` -> `abilities.str`
- `dex`, `dexterity` -> `abilities.dex`
- `con`, `constitution` -> `abilities.con`
- `int`, `intelligence` -> `abilities.int`
- `wis`, `wisdom` -> `abilities.wis`
- `cha`, `charisma` -> `abilities.cha`

Play labels:

- `hp`, `hit points current`, `current hp` -> `play.hpCurrent`
- `temp hp`, `temporary hit points` -> `play.hpTemp`
- `initiative`, `initiative bonus` -> `play.initiativeBonus`
- `speed`, `walk speed`, `movement` -> `play.speed`
- `conditions`, `condition` -> `play.conditions[]`
- `death saves success`, `death save successes` -> `play.deathSavesSuccess`
- `death saves fail`, `death save failures` -> `play.deathSavesFail`

Spells/inventory:

- `spells known`, `known spells` -> `spells[]`
- `prepared spells` -> `play.preparedSpells`
- `equipment`, `inventory`, `gear` -> `inventory[]`

### 6.3 Class and level parsing

Class/level often appears as one string, for example:

- `Wizard 5`
- `Fighter (Battle Master) 7`
- `Rogue 3 / Fighter 2`

Rules:

- Extract the highest-confidence class name into `class`.
- Extract subclass text into `subclass` when explicitly present.
- Extract total character level into `level`.
- For multiclass notation (`A x / B y`):
  - set `class` to the class with the highest level (tie: first listed),
  - set `multiclass` to an array of class entries parsed from the line.

### 6.4 Numeric parsing rules

- Strip symbols like `+`, `%`, and commas before parsing numbers.
- Accept signed initiative values (e.g. `+3`, `-1`) into `play.initiativeBonus`.
- Clamp:
  - `level` to `1..20`
  - ability scores to `1..30`
  - death saves to `0..3`
  - spell slot `max` and `used` to `>= 0`
- If parsing fails, keep default.

### 6.5 Spell extraction rules

- Split spell lists on commas, semicolons, bullets, or line breaks.
- Remove slot annotations from names (for example `Shield (1st)` -> `Shield`).
- Keep distinct names only (case-insensitive dedupe).
- Preserve original casing from the PDF where possible.
- If prepared markers are present (`*`, checkbox, `prepared`), set:
  - `play.preparedSpells["Spell Name"] = true`
- If no prepared indicators exist, leave `play.preparedSpells` empty.

Spell slots:

- Parse slot tables like `1st 4/2` into:
  - `play.spellSlots["1"] = { "max": 4, "used": 2 }`
- If only total/max is present, set `used` to `0`.

### 6.6 Inventory extraction rules

- If only item names are available, use string entries in `inventory`.
- If an equipped marker exists (`equipped`, `worn`, checkbox), use object form:
  - `{ "name": "Longsword", "equipped": true }`
- Quantity may be folded into the name when no dedicated quantity field exists:
  - `Torch x5` as a single item-name string.

### 6.7 Ambiguity and conflict handling

- Never guess a value that is not supported by nearby PDF text.
- If two candidate values conflict:
  - choose the value closest to a clear field label,
  - append a short conflict note to `notes`.
- If a field is unreadable or absent, use the default from section 2.

### 6.8 One-pass output procedure

1. Initialize the section 5 minimal payload.
2. Fill identity and abilities.
3. Fill combat/play numeric fields.
4. Fill spells, prepared state, and spell slots.
5. Fill inventory.
6. Populate `subclass`, `multiclass`, `notes`.
7. Ensure final output still matches section 2 key names and section 3 constraints.

---

## 7) Identifier Policy (LLM-Safe)

The LLM does not need internal identifiers.

Rules:

- For `feats[]` and `optionalFeatures[]`, always provide `name`.
- Provide `source` when it is explicitly visible in the PDF.
- `id` may be omitted.
- Never fabricate IDs.

App behavior:

- During import, the app attempts to match `name` + optional `source` to catalog entries.
- If matched, canonical `name`, `source`, and internal `id` are assigned automatically.
- If not matched, the entry is kept with a fallback ID and can be corrected by the user in the picker UI.

Preferred source codes when present in PDF:

- `PHB`
- `XPHB`
- `DMG`
- `XDMG`
- `XGE`
- `TCE`
- `SCAG`
- `MPMM`


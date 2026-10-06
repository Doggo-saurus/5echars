import test from "node:test";
import assert from "node:assert/strict";

import { createInventoryWeapons } from "../../src/app/inventory/weapons.js";
import { createAutoAttackRules } from "../../src/app/inventory/auto-attacks.js";

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function signed(value) {
  const number = toNumber(value, 0);
  return `${number >= 0 ? "+" : "-"}${Math.abs(number)}`;
}

function getClassLevelTracks(character) {
  const primaryClass = String(character?.class ?? "").trim();
  const tracks = primaryClass ? [{ className: primaryClass, isPrimary: true }] : [];
  const multiclass = Array.isArray(character?.multiclass) ? character.multiclass : [];
  multiclass.forEach((entry) => {
    const className = String(entry?.class ?? "").trim();
    if (className) tracks.push({ className, isPrimary: false });
  });
  return tracks;
}

function getClassCatalogEntry(catalogs, className) {
  const classes = Array.isArray(catalogs?.classes) ? catalogs.classes : [];
  const wanted = String(className ?? "").trim().toLowerCase();
  return classes.find((entry) => String(entry?.name ?? "").trim().toLowerCase() === wanted) ?? null;
}

function collectRuleDescriptionLines(entry, out = []) {
  if (entry == null) return out;
  if (typeof entry === "string") {
    const line = String(entry).trim();
    if (line) out.push(line);
    return out;
  }
  if (Array.isArray(entry)) {
    entry.forEach((value) => collectRuleDescriptionLines(value, out));
    return out;
  }
  if (typeof entry !== "object") return out;
  collectRuleDescriptionLines(entry.entry, out);
  collectRuleDescriptionLines(entry.text, out);
  collectRuleDescriptionLines(entry.entries, out);
  collectRuleDescriptionLines(entry.items, out);
  return out;
}

function getRuleDescriptionLines(entry) {
  return collectRuleDescriptionLines(entry?.entries ?? entry, []);
}

function createWeaponsForFeatures(features, resolveDetail) {
  return createInventoryWeapons({
    cleanSpellInlineTags: (value) => String(value ?? "").replace(/\{@[a-z]+ ([^}|]+)(?:\|[^}]+)?\}/gi, "$1"),
    extractSimpleNotation: (value) => String(value ?? "").trim(),
    toNumber,
    signed,
    getRuleDescriptionLines,
    getClassLevelTracks,
    getClassCatalogEntry,
    getUnlockedFeatures: () => features,
    resolveFeatureEntryFromCatalogs: resolveDetail,
  });
}

const inventoryWeapons = createInventoryWeapons({
  cleanSpellInlineTags: (value) => String(value ?? ""),
  extractSimpleNotation: (value) => String(value ?? "").trim(),
  toNumber,
  signed,
  getRuleDescriptionLines: () => [],
  getClassLevelTracks,
  getClassCatalogEntry,
  getUnlockedFeatures: () => [],
  resolveFeatureEntryFromCatalogs: () => null,
});

const autoAttackRules = createAutoAttackRules({
  toNumber,
  signed,
  getCharacterFightingStyleSet: () => new Set(),
  inventoryWeapons,
});

test("finesse typos still allow STR/DEX selection", () => {
  const ability = inventoryWeapons.getWeaponAttackAbility(
    {
      name: "Rapier",
      weaponCategory: "martial melee weapon",
      properties: ["finese"],
    },
    { mods: { str: 1, dex: 4 } }
  );

  assert.equal(ability.key, "dex");
  assert.equal(ability.mod, 4);
});

test("ranged weapons always use DEX in auto attack ability selection", () => {
  const ability = inventoryWeapons.getWeaponAttackAbility(
    {
      name: "Shortbow",
      weaponCategory: "simple ranged weapon",
      properties: ["F"],
    },
    { mods: { str: 5, dex: 2 } }
  );

  assert.equal(ability.key, "dex");
  assert.equal(ability.mod, 2);
});

test("firearms and improvised proficiency tokens are recognized", () => {
  const profTokens = new Set(["firearms", "improvised"]);
  const firearmEntry = {
    name: "Pistol",
    weaponCategory: "martial ranged firearm",
    equipped: true,
  };
  const improvisedEntry = {
    name: "Improvised Club",
    weaponCategory: "improvised weapon",
    equipped: true,
  };

  assert.equal(inventoryWeapons.isWeaponProficient(firearmEntry, profTokens), true);
  assert.equal(inventoryWeapons.isWeaponProficient(improvisedEntry, profTokens), true);
});

test("weapon proficiency categories normalize to canonical labels", () => {
  assert.deepEqual(inventoryWeapons.collectWeaponProficiencyStrings(["simple", "martial", "martial weapon"]), [
    "simple weapons",
    "martial weapons",
    "martial weapons",
  ]);
});

function getClericCatalog() {
  return {
    classes: [
      {
        name: "Cleric",
        startingProficiencies: {
          weapons: ["simple"],
        },
      },
    ],
  };
}

test("cleric protector adds one martial weapons proficiency token", () => {
  const clericWeapons = createWeaponsForFeatures([{ className: "Cleric", name: "Protector" }], () => null);

  const tokens = clericWeapons.getCharacterWeaponProficiencyTokens(getClericCatalog(), { class: "Cleric" });

  assert.deepEqual([...tokens].sort(), ["martial weapons", "simple weapons"]);
});

test("subclass bonus proficiency text grants martial weapons", () => {
  const cases = [
    {
      name: "Tempest Domain",
      className: "Cleric",
      text: "At 1st level, you gain proficiency with martial weapons and heavy armor.",
    },
    {
      name: "War Domain",
      className: "Cleric",
      text: "You gain proficiency with martial weapons and heavy armor.",
    },
    {
      name: "Death Domain",
      className: "Cleric",
      text: "You gain proficiency with martial weapons.",
    },
    {
      name: "Twilight Domain",
      className: "Cleric",
      text: "You gain proficiency with martial weapons and heavy armor.",
    },
    {
      name: "College of Valor",
      className: "Bard",
      text: "You gain proficiency with medium armor, shields, and martial weapons.",
    },
    {
      name: "The Hexblade",
      className: "Warlock",
      text: "You gain proficiency with medium armor, shields, and martial weapons.",
    },
    {
      name: "Battle Smith",
      className: "Artificer",
      text: "When you adopt this specialization at 3rd level, you gain proficiency with martial weapons.",
    },
    {
      name: "Protector",
      className: "Cleric",
      text: "You gain proficiency with Martial weapons and training with Heavy armor.",
    },
  ];

  cases.forEach((entry) => {
    const weapons = createWeaponsForFeatures(
      [{ className: entry.className, name: "Bonus Proficiency", type: "subclass", subclassName: entry.name }],
      () => ({
        name: "Bonus Proficiency",
        entries: [entry.text],
      })
    );
    const classCatalog = {
      classes: [
        {
          name: entry.className,
          startingProficiencies: {
            weapons: ["simple"],
          },
        },
      ],
    };
    const tokens = weapons.getCharacterWeaponProficiencyTokens(classCatalog, { class: entry.className });
    assert.equal(tokens.has("martial weapons"), true, `${entry.name} should grant martial weapons`);
  });
});

test("life domain bonus proficiency does not grant martial weapons", () => {
  const weapons = createWeaponsForFeatures(
    [{ className: "Cleric", name: "Bonus Proficiency", type: "subclass", subclassName: "Life Domain" }],
    () => ({
      name: "Bonus Proficiency",
      entries: ["When you choose this domain at 1st level, you gain proficiency with heavy armor."],
    })
  );
  const tokens = weapons.getCharacterWeaponProficiencyTokens(getClericCatalog(), { class: "Cleric" });
  assert.deepEqual([...tokens].sort(), ["simple weapons"]);
});

test("hitting with a martial weapon does not grant martial weapon proficiency", () => {
  const weapons = createWeaponsForFeatures(
    [{ className: "Cleric", name: "Divine Strike", type: "subclass", subclassName: "Tempest Domain" }],
    () => ({
      name: "Divine Strike",
      entries: [
        "Once on each of your turns when you hit a creature with a weapon attack, you can cause the attack to deal an extra 1d8 thunder damage to the target.",
      ],
    })
  );
  const tokens = weapons.getCharacterWeaponProficiencyTokens(getClericCatalog(), { class: "Cleric" });
  assert.equal(tokens.has("martial weapons"), false);
});

test("named weapon grants from item tags are collected", () => {
  const weapons = createWeaponsForFeatures(
    [{ className: "Bard", name: "Bonus Proficiencies", type: "subclass", subclassName: "College of Swords" }],
    () => ({
      name: "Bonus Proficiencies",
      entries: ["You gain proficiency with medium armor and the {@item scimitar|PHB}."],
    })
  );
  const tokens = weapons.getCharacterWeaponProficiencyTokens(
    {
      classes: [
        {
          name: "Bard",
          startingProficiencies: {
            weapons: ["simple"],
          },
        },
      ],
    },
    { class: "Bard" }
  );
  assert.equal(tokens.has("scimitar"), true);
  assert.equal(tokens.has("martial weapons"), false);
});

test("auto attacks add proficiency bonus only when proficient", () => {
  const baseState = {
    catalogs: {
      classes: [
        {
          name: "Fighter",
          startingProficiencies: {
            weapons: ["simple weapons"],
          },
        },
      ],
    },
    derived: {
      mods: { str: 2, dex: 0 },
      proficiencyBonus: 2,
    },
  };

  const proficientState = {
    ...baseState,
    character: {
      class: "Fighter",
      inventory: [
        {
          name: "Club",
          weaponCategory: "simple melee weapon",
          damageDice: "1d4",
          damageType: "B",
          equipped: true,
        },
      ],
    },
  };
  const nonProficientState = {
    ...baseState,
    character: {
      class: "Fighter",
      inventory: [
        {
          name: "Longsword",
          weaponCategory: "martial melee weapon",
          damageDice: "1d8",
          damageType: "S",
          equipped: true,
        },
      ],
    },
  };

  const proficientAttack = autoAttackRules.getAutoAttacks(proficientState).find((entry) => entry?.name === "Club");
  const nonProficientAttack = autoAttackRules.getAutoAttacks(nonProficientState).find((entry) => entry?.name === "Longsword");

  assert.equal(proficientAttack?.proficient, true);
  assert.equal(proficientAttack?.toHit, "+4");
  assert.equal(nonProficientAttack?.proficient, false);
  assert.equal(nonProficientAttack?.toHit, "+2");
});

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

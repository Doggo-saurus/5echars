export function createAutoAttackRules({
  toNumber,
  signed,
  getCharacterFightingStyleSet,
  inventoryWeapons,
}) {
  function getAutoAttacks(state) {
    const character = state?.character ?? {};
    const equippedWeapons = inventoryWeapons
      .getInventoryObjectEntries(character)
      .filter((entry) => Boolean(entry?.equipped) && inventoryWeapons.isInventoryWeapon(entry));
    const featureAttacks = inventoryWeapons.getClassFeatureAutoAttacks(state);
    if (!equippedWeapons.length) return featureAttacks;
    const fightingStyles = getCharacterFightingStyleSet(character, state?.catalogs);
    const hasArcheryStyle = fightingStyles.has("archery");
    const hasDuelingStyle = fightingStyles.has("dueling");
    const equippedWeaponCount = equippedWeapons.length;

    const profTokens = inventoryWeapons.getCharacterWeaponProficiencyTokens(state?.catalogs, character);
    const weaponAttacks = equippedWeapons
      .map((entry) => {
        const name = inventoryWeapons.getInventoryItemName(entry);
        if (!name) return null;
        const ability = inventoryWeapons.getWeaponAttackAbility(entry, state?.derived);
        const properties = inventoryWeapons.getInventoryWeaponProperties(entry);
        const isRanged = inventoryWeapons.isRangedWeaponEntry(entry);
        const isMelee = !isRanged;
        const isTwoHanded = properties.includes("2H");
        const proficient = inventoryWeapons.isWeaponProficient(entry, profTokens);
        const proficiencyBonus = proficient ? toNumber(state?.derived?.proficiencyBonus, 0) : 0;
        const nameBonus = inventoryWeapons.getWeaponNameBonus(entry);
        const attackBonus = inventoryWeapons.parseItemWeaponBonus(entry?.weaponAttackBonus, nameBonus);
        const damageBonus = inventoryWeapons.parseItemWeaponBonus(entry?.weaponDamageBonus, nameBonus);
        const styleAttackBonus = hasArcheryStyle && isRanged ? 2 : 0;
        const styleDamageBonus = hasDuelingStyle && isMelee && !isTwoHanded && equippedWeaponCount === 1 ? 2 : 0;
        const toHit = signed(ability.mod + proficiencyBonus + attackBonus + styleAttackBonus);
        const rawDamageDice = String(entry?.damageDice ?? entry?.dmg1 ?? "").trim();
        const baseDamage = rawDamageDice
          ? inventoryWeapons.formatDamageNotation(rawDamageDice, ability.mod + damageBonus + styleDamageBonus)
          : "";
        const damageType = inventoryWeapons.normalizeDamageTypeLabel(entry?.damageType ?? entry?.dmgType);
        const damage = baseDamage && damageType ? `${baseDamage} ${damageType}` : baseDamage;
        return {
          source: "auto",
          name,
          toHit,
          damage,
          proficient,
          ability: ability.key,
        };
      })
      .filter(Boolean);
    return [...featureAttacks, ...weaponAttacks];
  }

  return {
    getAutoAttacks,
  };
}

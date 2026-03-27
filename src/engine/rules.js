function abilityMod(score) {
  return Math.floor((Number(score || 0) - 10) / 2);
}

function proficiencyBonus(level) {
  const lvl = Math.max(1, Number(level || 1));
  return 2 + Math.floor((lvl - 1) / 4);
}

function getEquippedInventoryEntries(character) {
  const inventory = Array.isArray(character?.inventory) ? character.inventory : [];
  return inventory.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && Boolean(entry.equipped));
}

function normalizeItemTypeCode(value) {
  return String(value ?? "")
    .split("|")[0]
    .trim()
    .toUpperCase();
}

function getArmorClassFromEquipment(character, dexMod) {
  const equippedItems = getEquippedInventoryEntries(character);
  if (!equippedItems.length) return 10 + dexMod;

  let bestArmorAc = null;
  let shieldBonus = 0;

  equippedItems.forEach((entry) => {
    const typeCode = normalizeItemTypeCode(entry.itemType ?? entry.type);
    const isShield = typeCode === "S" || Boolean(entry.isShield);
    const isArmor = ["LA", "MA", "HA"].includes(typeCode) || Boolean(entry.armor);
    const parsedAc = Number(entry.ac);

    if (isShield) {
      const bonus = Number.isFinite(parsedAc) && parsedAc > 0 ? parsedAc : 2;
      shieldBonus = Math.max(shieldBonus, bonus);
      return;
    }

    if (!isArmor || !Number.isFinite(parsedAc) || parsedAc <= 0) return;

    let dexContribution = dexMod;
    if (typeCode === "MA") dexContribution = Math.min(2, dexMod);
    if (typeCode === "HA") dexContribution = 0;
    const total = parsedAc + dexContribution;
    if (bestArmorAc == null || total > bestArmorAc) bestArmorAc = total;
  });

  if (bestArmorAc != null) return bestArmorAc + shieldBonus;
  return 10 + dexMod + shieldBonus;
}

export function computeDerivedStats(character) {
  const abilities = character.abilities ?? {};
  const mods = {
    str: abilityMod(abilities.str),
    dex: abilityMod(abilities.dex),
    con: abilityMod(abilities.con),
    int: abilityMod(abilities.int),
    wis: abilityMod(abilities.wis),
    cha: abilityMod(abilities.cha),
  };
  const prof = proficiencyBonus(character.level);
  const hp = Math.max(1, 8 + mods.con + (Number(character.level || 1) - 1) * (5 + mods.con));
  const ac = getArmorClassFromEquipment(character, mods.dex);

  return {
    mods,
    proficiencyBonus: prof,
    hp,
    ac,
    passivePerception: 10 + mods.wis,
  };
}

function abilityMod(score) {
  return Math.floor((Number(score || 0) - 10) / 2);
}

function proficiencyBonus(level) {
  const lvl = Math.max(1, Number(level || 1));
  return 2 + Math.floor((lvl - 1) / 4);
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
  const ac = 10 + mods.dex;

  return {
    mods,
    proficiencyBonus: prof,
    hp,
    ac,
    passivePerception: 10 + mods.wis,
  };
}

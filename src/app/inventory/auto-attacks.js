export function createAutoAttackRules({
  toNumber,
  signed,
  getCharacterFightingStyleSet,
  inventoryWeapons,
}) {
  function normalizeName(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function isFeatSelected(character, featName) {
    const wanted = normalizeName(featName);
    const feats = Array.isArray(character?.feats) ? character.feats : [];
    return feats.some((entry) => normalizeName(entry?.name) === wanted);
  }

  function hasUnlockedFeature(character, featureName) {
    const wanted = normalizeName(featureName);
    const features = Array.isArray(character?.progression?.unlockedFeatures) ? character.progression.unlockedFeatures : [];
    return features.some((entry) => normalizeName(entry?.name).startsWith(wanted));
  }

  function isWeaponNameMatch(entry, names) {
    const weaponName = normalizeName(inventoryWeapons.getInventoryItemName(entry));
    if (!weaponName || !Array.isArray(names) || !names.length) return false;
    return names.some((candidate) => weaponName.includes(normalizeName(candidate)));
  }

  function buildWeaponAttack(entry, context = {}) {
    if (!entry) return null;
    const {
      state,
      profTokens,
      hasArcheryStyle = false,
      hasDuelingStyle = false,
      equippedWeaponCount = 0,
      source = "auto",
      autoSourceLabel = "",
      actionType = "",
      nameOverride = "",
      damageDiceOverride = "",
      damageTypeOverride = "",
    } = context;
    const name = String(nameOverride || inventoryWeapons.getInventoryItemName(entry)).trim();
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
    const rawDamageDice = String(damageDiceOverride || entry?.damageDice || entry?.dmg1 || "").trim();
    const baseDamage = rawDamageDice
      ? inventoryWeapons.formatDamageNotation(rawDamageDice, ability.mod + damageBonus + styleDamageBonus)
      : "";
    const damageType = inventoryWeapons.normalizeDamageTypeLabel(damageTypeOverride || entry?.damageType || entry?.dmgType);
    const damage = baseDamage && damageType ? `${baseDamage} ${damageType}` : baseDamage;
    return {
      source,
      autoSourceLabel,
      actionType,
      name,
      toHit,
      damage,
      proficient,
      ability: ability.key,
    };
  }

  function getBonusActionAttacks(state, equippedWeapons, context = {}) {
    const character = state?.character ?? {};
    const derived = state?.derived ?? {};
    const {
      profTokens,
      hasArcheryStyle = false,
      hasDuelingStyle = false,
      equippedWeaponCount = 0,
    } = context;
    const bonusAttacks = [];
    const addBonusAttack = (attack) => {
      if (!attack) return;
      const dedupeKey = `${normalizeName(attack?.name)}|${normalizeName(attack?.autoSourceLabel)}|${normalizeName(attack?.actionType)}`;
      if (!dedupeKey) return;
      if (bonusAttacks.some((entry) => `${normalizeName(entry?.name)}|${normalizeName(entry?.autoSourceLabel)}|${normalizeName(entry?.actionType)}` === dedupeKey)) {
        return;
      }
      bonusAttacks.push(attack);
    };

    const polearmCandidates = equippedWeapons.filter((entry) => isWeaponNameMatch(entry, ["glaive", "halberd", "quarterstaff", "spear"]));
    if (isFeatSelected(character, "Polearm Master") && polearmCandidates.length) {
      polearmCandidates.forEach((entry) => {
        addBonusAttack(
          buildWeaponAttack(entry, {
            state,
            profTokens,
            hasArcheryStyle,
            hasDuelingStyle,
            equippedWeaponCount,
            source: "auto-bonus",
            autoSourceLabel: "Polearm Master",
            actionType: "Bonus Action",
            nameOverride: `${inventoryWeapons.getInventoryItemName(entry)} (Polearm Master)`,
            damageDiceOverride: "1d4",
            damageTypeOverride: "bludgeoning",
          })
        );
      });
    }

    if (isFeatSelected(character, "Crossbow Expert")) {
      equippedWeapons
        .filter((entry) => isWeaponNameMatch(entry, ["hand crossbow"]))
        .forEach((entry) => {
          addBonusAttack(
            buildWeaponAttack(entry, {
              state,
              profTokens,
              hasArcheryStyle,
              hasDuelingStyle,
              equippedWeaponCount,
              source: "auto-bonus",
              autoSourceLabel: "Crossbow Expert",
              actionType: "Bonus Action",
              nameOverride: `${inventoryWeapons.getInventoryItemName(entry)} (Crossbow Expert)`,
            })
          );
        });
    }

    const supportsBonusMeleeFollowup =
      isFeatSelected(character, "Great Weapon Master")
      || hasUnlockedFeature(character, "frenzy")
      || hasUnlockedFeature(character, "war priest");
    if (supportsBonusMeleeFollowup) {
      const sourceLabel = isFeatSelected(character, "Great Weapon Master")
        ? "Great Weapon Master"
        : hasUnlockedFeature(character, "frenzy")
          ? "Frenzy"
          : "War Priest";
      equippedWeapons
        .filter((entry) => !inventoryWeapons.isRangedWeaponEntry(entry))
        .forEach((entry) => {
          addBonusAttack(
            buildWeaponAttack(entry, {
              state,
              profTokens,
              hasArcheryStyle,
              hasDuelingStyle,
              equippedWeaponCount,
              source: "auto-bonus",
              autoSourceLabel: sourceLabel,
              actionType: "Bonus Action",
              nameOverride: `${inventoryWeapons.getInventoryItemName(entry)} (${sourceLabel})`,
            })
          );
        });
    }

    if (hasUnlockedFeature(character, "martial arts")) {
      const dexMod = toNumber(derived?.mods?.dex, 0);
      const strMod = toNumber(derived?.mods?.str, 0);
      const abilityMod = Math.max(dexMod, strMod);
      const ability = dexMod >= strMod ? "dex" : "str";
      const proficiencyBonus = toNumber(derived?.proficiencyBonus, 0);
      addBonusAttack({
        source: "auto-bonus",
        autoSourceLabel: "Martial Arts",
        actionType: "Bonus Action",
        name: "Unarmed Strike (Martial Arts)",
        toHit: signed(abilityMod + proficiencyBonus),
        damage: inventoryWeapons.formatDamageNotation("1d4", abilityMod) ? `${inventoryWeapons.formatDamageNotation("1d4", abilityMod)} bludgeoning` : "",
        proficient: true,
        ability,
      });
    }

    if (isFeatSelected(character, "Shield Master")) {
      addBonusAttack({
        source: "auto-bonus",
        autoSourceLabel: "Shield Master",
        actionType: "Bonus Action",
        name: "Shield Shove (Shield Master)",
        toHit: "",
        damage: "",
        proficient: false,
        ability: "",
      });
    }

    if (isFeatSelected(character, "Tavern Brawler")) {
      addBonusAttack({
        source: "auto-bonus",
        autoSourceLabel: "Tavern Brawler",
        actionType: "Bonus Action",
        name: "Grapple Attempt (Tavern Brawler)",
        toHit: "",
        damage: "",
        proficient: false,
        ability: "",
      });
    }

    return bonusAttacks;
  }

  function getAutoAttacks(state) {
    const character = state?.character ?? {};
    const equippedWeapons = inventoryWeapons
      .getInventoryObjectEntries(character)
      .filter((entry) => Boolean(entry?.equipped) && inventoryWeapons.isInventoryWeapon(entry));
    const featureAttacks = inventoryWeapons.getClassFeatureAutoAttacks(state);
    const fightingStyles = getCharacterFightingStyleSet(character, state?.catalogs);
    const hasArcheryStyle = fightingStyles.has("archery");
    const hasDuelingStyle = fightingStyles.has("dueling");
    const equippedWeaponCount = equippedWeapons.length;

    const profTokens = inventoryWeapons.getCharacterWeaponProficiencyTokens(state?.catalogs, character);
    const weaponAttacks = equippedWeapons
      .map((entry) => {
        return buildWeaponAttack(entry, {
          state,
          profTokens,
          hasArcheryStyle,
          hasDuelingStyle,
          equippedWeaponCount,
          source: "auto",
        });
      })
      .filter(Boolean);
    const bonusActionAttacks = getBonusActionAttacks(state, equippedWeapons, {
      profTokens,
      hasArcheryStyle,
      hasDuelingStyle,
      equippedWeaponCount,
    });
    return [...featureAttacks, ...weaponAttacks, ...bonusActionAttacks];
  }

  return {
    getAutoAttacks,
  };
}

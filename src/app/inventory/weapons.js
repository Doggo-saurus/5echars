export function createInventoryWeapons({
  cleanSpellInlineTags,
  extractSimpleNotation,
  toNumber,
  signed,
  getRuleDescriptionLines,
  getClassLevelTracks,
  getClassCatalogEntry,
  getUnlockedFeatures,
  resolveFeatureEntryFromCatalogs,
}) {
  function getInventoryObjectEntries(character) {
    const inventory = Array.isArray(character?.inventory) ? character.inventory : [];
    return inventory.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
  }

  function normalizeItemTypeCode(value) {
    return String(value ?? "").split("|")[0].trim().toUpperCase();
  }

  function normalizeWeaponProficiencyToken(value) {
    const cleanedValue = cleanSpellInlineTags(String(value ?? ""));
    const normalized = cleanedValue.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
    if (normalized.includes("martial weapon")) return "martial weapons";
    if (normalized.includes("simple weapon")) return "simple weapons";
    if (normalized.includes("firearm")) return "firearms";
    if (normalized.includes("improvised")) return "improvised";
    return normalized;
  }

  function collectWeaponProficiencyStrings(value, out = []) {
    if (typeof value === "string") {
      const token = normalizeWeaponProficiencyToken(value);
      if (token) out.push(token);
      return out;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => collectWeaponProficiencyStrings(entry, out));
      return out;
    }
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([key, entry]) => {
        if (entry === true) {
          const token = normalizeWeaponProficiencyToken(key);
          if (token) out.push(token);
          return;
        }
        collectWeaponProficiencyStrings(entry, out);
      });
    }
    return out;
  }

  function getCharacterWeaponProficiencyTokens(catalogs, character) {
    const tracks = getClassLevelTracks(character);
    const tokens = new Set();
    tracks.forEach((track) => {
      const classEntry = getClassCatalogEntry(catalogs, track.className);
      if (!classEntry) return;
      const primaryWeapons = Array.isArray(classEntry?.startingProficiencies?.weapons) ? classEntry.startingProficiencies.weapons : [];
      const multiclassWeapons = Array.isArray(classEntry?.multiclassing?.proficienciesGained?.weapons)
        ? classEntry.multiclassing.proficienciesGained.weapons
        : [];
      const sourceEntries = track.isPrimary ? primaryWeapons : multiclassWeapons;
      collectWeaponProficiencyStrings(sourceEntries).forEach((token) => tokens.add(token));
    });
    const unlockedFeatures = getUnlockedFeatures(catalogs, character);
    unlockedFeatures.forEach((feature) => {
      const detail = resolveFeatureEntryFromCatalogs(catalogs, feature);
      collectWeaponProficiencyStrings(detail?.weaponProficiencies).forEach((token) => tokens.add(token));
      collectWeaponProficiencyStrings(detail?.startingProficiencies?.weapons).forEach((token) => tokens.add(token));
      const featureName = String(feature?.name ?? "").trim().toLowerCase();
      const className = String(feature?.className ?? "").trim().toLowerCase();
      if (className === "cleric" && featureName === "protector") {
        tokens.add("martial weapons");
        tokens.add("martial weapon");
        tokens.add("martial");
      }
    });
    const selectedFeats = Array.isArray(character?.feats) ? character.feats : [];
    const featEntries = Array.isArray(catalogs?.feats) ? catalogs.feats : [];
    selectedFeats.forEach((feat) => {
      const featName = String(feat?.name ?? "").trim().toLowerCase();
      if (!featName) return;
      const featSource = String(feat?.source ?? "").trim().toLowerCase();
      const detail = featEntries.find((entry) => {
        if (String(entry?.name ?? "").trim().toLowerCase() !== featName) return false;
        if (!featSource) return true;
        return String(entry?.source ?? "").trim().toLowerCase() === featSource;
      }) ?? featEntries.find((entry) => String(entry?.name ?? "").trim().toLowerCase() === featName);
      if (!detail) return;
      collectWeaponProficiencyStrings(detail?.weaponProficiencies).forEach((token) => tokens.add(token));
    });
    return tokens;
  }

  function getInventoryItemName(entry) {
    return String(entry?.name ?? "").trim();
  }

  function isInventoryWeapon(entry) {
    return Boolean(entry?.weapon) || Boolean(entry?.damageDice) || Boolean(entry?.dmg1) || Boolean(entry?.weaponCategory);
  }

  function getInventoryWeaponCategory(entry) {
    return String(entry?.weaponCategory ?? "").trim().toLowerCase();
  }

  function normalizeWeaponPropertyToken(value) {
    const token = String(value ?? "").trim().toUpperCase().replace(/\./g, "");
    if (!token) return "";
    // Some data sources contain common finesse misspellings; normalize them.
    if (token === "FINESSE" || token === "FINESE" || token === "FINESS") return "F";
    if (token === "LIGHT") return "L";
    if (token === "THROWN") return "T";
    if (token === "VERSATILE") return "V";
    if (token === "HEAVY") return "H";
    if (token === "RANGED") return "RANGED";
    if (token === "TWO-HANDED" || token === "TWO HANDED") return "2H";
    return token;
  }

  function collectWeaponPropertyTokens(value, out = []) {
    if (value == null) return out;
    if (Array.isArray(value)) {
      value.forEach((entry) => collectWeaponPropertyTokens(entry, out));
      return out;
    }
    if (typeof value === "object") {
      Object.entries(value).forEach(([key, entryValue]) => {
        if (entryValue === true) out.push(key);
        else collectWeaponPropertyTokens(entryValue, out);
      });
      return out;
    }
    const raw = String(value ?? "").trim();
    if (!raw) return out;
    const parts = raw.split(/[,/;|]/).map((part) => part.trim()).filter(Boolean);
    if (!parts.length) out.push(raw);
    else out.push(...parts);
    return out;
  }

  function getInventoryWeaponProperties(entry) {
    const tokens = [...collectWeaponPropertyTokens(entry?.properties), ...collectWeaponPropertyTokens(entry?.property)]
      .map((prop) => normalizeWeaponPropertyToken(prop))
      .filter(Boolean);
    return [...new Set(tokens)];
  }

  function getInventoryWeaponFamily(entry) {
    const category = getInventoryWeaponCategory(entry);
    if (category.includes("simple")) return "simple";
    if (category.includes("martial")) return "martial";
    return "";
  }

  function isFirearmWeaponEntry(entry) {
    const category = getInventoryWeaponCategory(entry);
    const properties = getInventoryWeaponProperties(entry);
    const name = getInventoryItemName(entry).toLowerCase();
    return category.includes("firearm") || properties.includes("FIREARM") || name.includes("firearm");
  }

  function isImprovisedWeaponEntry(entry) {
    const category = getInventoryWeaponCategory(entry);
    const properties = getInventoryWeaponProperties(entry);
    const name = getInventoryItemName(entry).toLowerCase();
    return category.includes("improvised") || properties.includes("IMPROVISED") || name.includes("improvised");
  }

  function isRangedWeaponEntry(entry) {
    const category = getInventoryWeaponCategory(entry);
    const typeCode = normalizeItemTypeCode(entry?.itemType ?? entry?.type);
    const properties = getInventoryWeaponProperties(entry);
    // "R" is commonly "reach" in weapon property shorthands, not ranged.
    return category.includes("ranged") || properties.includes("RANGED") || typeCode === "R";
  }

  function normalizeItemNameForProficiency(name) {
    return String(name ?? "").toLowerCase().replace(/\+\d+/g, "").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  }

  function isWeaponProficient(entry, proficiencyTokens) {
    if (!(proficiencyTokens instanceof Set) || !proficiencyTokens.size) return false;
    if (proficiencyTokens.has("all") || proficiencyTokens.has("all weapons")) return true;
    const tokenList = [...proficiencyTokens];
    const family = getInventoryWeaponFamily(entry);
    const isRanged = isRangedWeaponEntry(entry);
    const isMelee = !isRanged;
    const isFirearm = isFirearmWeaponEntry(entry);
    const isImprovised = isImprovisedWeaponEntry(entry);
    const hasSimpleWeaponProficiency = tokenList.some((token) => token === "simple" || token === "simple weapon" || token === "simple weapons");
    const hasMartialWeaponProficiency = tokenList.some((token) => token === "martial" || token === "martial weapon" || token === "martial weapons");
    const hasRangedWeaponProficiency = tokenList.some((token) => token === "ranged weapon" || token === "ranged weapons");
    const hasMeleeWeaponProficiency = tokenList.some((token) => token === "melee weapon" || token === "melee weapons");
    const hasFirearmsProficiency = tokenList.some((token) => token === "firearm" || token === "firearms");
    const hasImprovisedWeaponProficiency = tokenList.some((token) => token === "improvised" || token === "improvised weapon" || token === "improvised weapons");
    if (family === "simple" && hasSimpleWeaponProficiency) return true;
    if (family === "martial" && hasMartialWeaponProficiency) return true;
    if (isRanged && hasRangedWeaponProficiency) return true;
    if (isMelee && hasMeleeWeaponProficiency) return true;
    if (isFirearm && hasFirearmsProficiency) return true;
    if (isImprovised && hasImprovisedWeaponProficiency) return true;
    const itemName = normalizeItemNameForProficiency(getInventoryItemName(entry));
    if (itemName && tokenList.some((token) => normalizeItemNameForProficiency(token) === itemName)) return true;
    return false;
  }

  function getWeaponAttackAbility(entry, derived) {
    const mods = derived?.mods ?? {};
    const strMod = toNumber(mods.str, 0);
    const dexMod = toNumber(mods.dex, 0);
    const properties = getInventoryWeaponProperties(entry);
    const isRanged = isRangedWeaponEntry(entry);
    const hasFinesse = properties.includes("F");
    if (isRanged) return { key: "dex", mod: dexMod };
    if (hasFinesse) return dexMod >= strMod ? { key: "dex", mod: dexMod } : { key: "str", mod: strMod };
    return { key: "str", mod: strMod };
  }

  function formatDamageNotation(diceNotation, modifier) {
    const notation = String(diceNotation ?? "").trim();
    if (!notation) return "";
    const mod = toNumber(modifier, 0);
    if (!mod) return notation;
    return `${notation} ${mod > 0 ? "+" : "-"} ${Math.abs(mod)}`;
  }

  function parseItemWeaponBonus(value, fallback = 0) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const text = String(value ?? "").trim();
    if (!text) return fallback;
    const direct = Number(text);
    if (Number.isFinite(direct)) return direct;
    const match = text.match(/[+\-]?\d+/);
    if (!match) return fallback;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeDamageTypeLabel(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const code = raw.toUpperCase();
    const byCode = {
      A: "acid",
      B: "bludgeoning",
      C: "cold",
      F: "fire",
      I: "poison",
      L: "lightning",
      N: "necrotic",
      O: "force",
      P: "piercing",
      R: "radiant",
      S: "slashing",
      T: "thunder",
      Y: "psychic",
    };
    if (byCode[code]) return byCode[code];
    return raw.toLowerCase();
  }

  function getWeaponNameBonus(entry) {
    const match = getInventoryItemName(entry).match(/(?:^|\s)\+(\d+)(?:\s|$|\))/i);
    if (!match) return 0;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function normalizeFeatureAttackToken(value) {
    return cleanSpellInlineTags(String(value ?? ""))
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function scoreFeatureAttackNameOverlap(left, right) {
    const a = normalizeFeatureAttackToken(left);
    const b = normalizeFeatureAttackToken(right);
    if (!a || !b) return 0;
    if (a === b) return 100;
    if (a.includes(b) || b.includes(a)) return 60;
    const aTokens = new Set(a.split(" ").filter(Boolean));
    const bTokens = new Set(b.split(" ").filter(Boolean));
    let overlap = 0;
    aTokens.forEach((token) => {
      if (bTokens.has(token)) overlap += 1;
    });
    return overlap;
  }

  function getClassFeatureAttackBuilders() {
    const buildUnarmedStrikeAttack = (context) => {
      const rollNotation = extractSimpleNotation(context?.effect?.rollNotation ?? context?.effect?.value ?? "");
      if (!rollNotation) return null;
      const featureText = String(context?.featureText ?? "").toLowerCase();
      const effectLabel = String(context?.effect?.label ?? "");
      const hintsUnarmed = /unarmed strike|unarmed attacks?|unarmed/.test(featureText);
      const hintsAttack = /\battack\b/.test(featureText);
      const labelHints = /martial arts/i.test(effectLabel);
      if (!(labelHints || (hintsUnarmed && hintsAttack))) return null;

      const strMod = toNumber(context?.derived?.mods?.str, 0);
      const dexMod = toNumber(context?.derived?.mods?.dex, 0);
      const allowsDex = /dexterity (?:modifier )?instead of strength/.test(featureText) || /martial arts/i.test(effectLabel);
      const ability = allowsDex && dexMod >= strMod ? { key: "dex", mod: dexMod } : { key: "str", mod: strMod };
      const proficiencyBonus = toNumber(context?.derived?.proficiencyBonus, 0);
      const damageNotation = formatDamageNotation(rollNotation, ability.mod);
      if (!damageNotation) return null;
      return {
        source: "auto-feature",
        autoSourceLabel: cleanSpellInlineTags(context?.effect?.label || context?.feature?.name || "Class Feature"),
        name: "Unarmed Strike",
        toHit: signed(ability.mod + proficiencyBonus),
        damage: `${damageNotation} bludgeoning`,
        proficient: true,
        ability: ability.key,
      };
    };

    return [buildUnarmedStrikeAttack];
  }

  function getClassFeatureAutoAttacks(state) {
    const character = state?.character ?? {};
    const progression = character?.progression ?? {};
    const effects = Array.isArray(progression?.classTableEffects) ? progression.classTableEffects : [];
    const unlocked = Array.isArray(progression?.unlockedFeatures) ? progression.unlockedFeatures : [];
    if (!effects.length || !unlocked.length) return [];

    const effectCandidates = effects.filter((effect) => extractSimpleNotation(effect?.rollNotation ?? effect?.value ?? ""));
    if (!effectCandidates.length) return [];

    const builders = getClassFeatureAttackBuilders();
    const attacks = [];
    const seen = new Set();

    effectCandidates.forEach((effect) => {
      const className = String(effect?.className ?? "").trim().toLowerCase();
      if (!className) return;
      let bestFeature = null;
      let bestScore = 0;
      unlocked.forEach((feature) => {
        if (String(feature?.className ?? "").trim().toLowerCase() !== className) return;
        const score = scoreFeatureAttackNameOverlap(effect?.label, feature?.name);
        if (score > bestScore) {
          bestScore = score;
          bestFeature = feature;
        }
      });
      if (!bestFeature) return;
      const detail = resolveFeatureEntryFromCatalogs(state?.catalogs, bestFeature);
      const featureText = getRuleDescriptionLines(detail).join(" ");
      const context = {
        state,
        derived: state?.derived ?? {},
        effect,
        feature: bestFeature,
        featureText,
      };
      builders.forEach((builder) => {
        const attack = builder(context);
        if (!attack) return;
        const key = `${String(attack?.name ?? "").trim().toLowerCase()}|${String(attack?.autoSourceLabel ?? "").trim().toLowerCase()}`;
        if (!key || seen.has(key)) return;
        seen.add(key);
        attacks.push(attack);
      });
    });

    return attacks;
  }

  return {
    getInventoryObjectEntries,
    normalizeItemTypeCode,
    normalizeWeaponProficiencyToken,
    collectWeaponProficiencyStrings,
    getCharacterWeaponProficiencyTokens,
    getInventoryItemName,
    isInventoryWeapon,
    getInventoryWeaponCategory,
    normalizeWeaponPropertyToken,
    collectWeaponPropertyTokens,
    getInventoryWeaponProperties,
    getInventoryWeaponFamily,
    isRangedWeaponEntry,
    normalizeItemNameForProficiency,
    isWeaponProficient,
    getWeaponAttackAbility,
    formatDamageNotation,
    parseItemWeaponBonus,
    normalizeDamageTypeLabel,
    getWeaponNameBonus,
    getClassFeatureAutoAttacks,
  };
}

import { getActiveInventoryCatalogItems } from "../catalog/inventory-item-rules.js";
import { shouldShowSpeciesTraitEntry } from "./species-traits.js";

export function createFeatureResourceRules({
  toNumber,
  toTitleCase,
  normalizeSourceTag,
  buildEntityId,
  cleanSpellInlineTags,
  parseCountToken,
  progressionCore,
  characterProgressionDomain,
  catalogLookupDomain,
  parseDieFacesByClassLevel,
  getAdditionalThresholdsForCombatSuperiority,
  getResourceRechargeHint,
  hasFirstUseFreeAfterLongRestRule,
  inferResourceLabelFromLines,
  parseExplicitResourceCostFromLines,
  parseResourceCountFromProficiencyBonus,
  parseResourceCountFromTable,
  scoreResourceLabelMatch,
  autoResourceIdPrefix,
}) {
  function getClassLevelMap(character) {
    const map = new Map();
    progressionCore.getClassLevelTracks(character).forEach((track) => {
      const key = String(track.className ?? "").trim().toLowerCase();
      if (!key) return;
      map.set(key, Math.max(toNumber(map.get(key), 0), toNumber(track.level, 0)));
    });
    return map;
  }

  function getProficiencyBonusByLevel(level) {
    const normalizedLevel = Math.max(1, Math.floor(toNumber(level, 1)));
    return Math.max(2, Math.floor((normalizedLevel - 1) / 4) + 2);
  }

  function getClassResourceAutoId(feature, resourceName) {
    const className = String(feature?.className ?? "").trim();
    const name = cleanSpellInlineTags(resourceName);
    if (!className || !name) return "";
    return `${autoResourceIdPrefix}${buildEntityId(["resource", className, name])}`;
  }

  function stripUseCountSuffix(value) {
    return cleanSpellInlineTags(value)
      .replace(/\s*\(\s*\d+\s*\/\s*(?:rest|short rest|long rest|day|sr|lr|sr\/lr)\s*\)\s*$/i, "")
      .trim();
  }

  function getFeatureResourceIdentity(feature) {
    const type = String(feature?.type ?? "class").trim().toLowerCase();
    const className = String(feature?.className ?? "").trim().toLowerCase();
    const subclassName = String(feature?.subclassName ?? "").trim().toLowerCase();
    const name = stripUseCountSuffix(feature?.tableDisplayName || feature?.name).toLowerCase();
    if (!className || !name) return "";
    return [type, className, subclassName, name].join("|");
  }

  function getRepeatedFeatureResourceIdentities(features) {
    const counts = new Map();
    (Array.isArray(features) ? features : []).forEach((feature) => {
      const identity = getFeatureResourceIdentity(feature);
      if (!identity) return;
      counts.set(identity, toNumber(counts.get(identity), 0) + 1);
    });
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([identity]) => identity));
  }

  function setBestTracker(byId, tracker) {
    const autoId = String(tracker?.autoId ?? "").trim();
    if (!autoId) return;
    const existing = byId.get(autoId);
    if (!existing || toNumber(tracker?.max, 0) >= toNumber(existing?.max, 0)) {
      byId.set(autoId, tracker);
    }
  }

  function getAbilityModifierByName(character, abilityName) {
    const keyByName = {
      strength: "str",
      dexterity: "dex",
      constitution: "con",
      intelligence: "int",
      wisdom: "wis",
      charisma: "cha",
    };
    const key = keyByName[String(abilityName ?? "").trim().toLowerCase()] ?? "";
    if (!key) return 0;
    const readScore = (container) => {
      if (!container || typeof container !== "object" || Array.isArray(container)) return Number.NaN;
      const fullName = String(abilityName ?? "").trim().toLowerCase();
      const candidates = [
        container[key],
        container[fullName],
        container[key]?.score,
        container[fullName]?.score,
        container[key]?.value,
        container[fullName]?.value,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === "string" && !candidate.trim()) continue;
        const score = toNumber(candidate, Number.NaN);
        if (Number.isFinite(score) && score > 0) return score;
      }
      return Number.NaN;
    };
    const scoreCandidates = [
      readScore(character?.abilities),
      readScore(character?.abilityBase),
      readScore(character?.baseAbilities),
    ];
    const score = scoreCandidates.find((candidate) => Number.isFinite(candidate)) ?? 10;
    return Math.floor((score - 10) / 2);
  }

  function parseResourceCountFromAbilityModifier(lines, character) {
    const joined = lines.join(" ");
    const abilityPattern = "(strength|dexterity|constitution|intelligence|wisdom|charisma)";
    const minimumPattern = "(?:\\s*\\(\\s*(?:a\\s+)?(?:minimum of|minimum|min(?:imum)?\\.?)\\s*(once|one|twice|two|thrice|three|\\d+)(?:\\s+[a-z]+)?\\s*\\))?";
    const patterns = [
      new RegExp(`you can (?:use (?:this|it|this feature|this trait|this action|this benefit|this ability|this option|this invocation)|do so).{0,240}?\\ba number of times equal to your\\s+${abilityPattern}\\s+modifier${minimumPattern}`, "i"),
      new RegExp(`\\b(?:a\\s+)?number of times equal to your\\s+${abilityPattern}\\s+modifier${minimumPattern}`, "i"),
      new RegExp(`\\buses? equal to your\\s+${abilityPattern}\\s+modifier${minimumPattern}`, "i"),
    ];
    let match = null;
    for (const pattern of patterns) {
      match = joined.match(pattern);
      if (match) break;
    }
    if (!match?.[1]) return null;
    const abilityMod = getAbilityModifierByName(character, match[1]);
    const minimum = Math.max(0, parseCountToken(match?.[2] ?? "0", 0));
    const max = Math.max(minimum, abilityMod);
    if (max <= 0) return null;
    const nounMatch = joined.match(/number of ([a-z][a-z\s'-]{1,48}?)(?:\s+equal to your\s+(?:strength|dexterity|constitution|intelligence|wisdom|charisma)\s+modifier|\s+you have|\s+that|\s+which|[,.])/i);
    const noun = String(nounMatch?.[1] ?? "").trim();
    const resourceName = noun && !/^times?$/i.test(noun) ? toTitleCase(noun) : "Uses";
    return {
      max,
      resourceName,
    };
  }

  function parseResourceCountFromDisplayName(displayName) {
    const label = cleanSpellInlineTags(displayName);
    const match = label.match(/^(.+?)\s*\((\d+)\s*\/\s*(rest|short rest|long rest|day|sr|lr|sr\/lr)\)$/i);
    if (!match?.[1] || !match?.[2]) return null;
    const max = Math.max(0, Math.floor(toNumber(match[2], 0)));
    if (max <= 0) return null;
    const rechargeToken = String(match[3] ?? "").trim().toLowerCase();
    let recharge = "";
    if (rechargeToken === "rest" || rechargeToken === "short rest" || rechargeToken === "sr" || rechargeToken === "sr/lr") {
      recharge = "shortOrLong";
    } else if (rechargeToken === "long rest" || rechargeToken === "lr") {
      recharge = "long";
    } else if (rechargeToken === "day") {
      recharge = "day";
    }
    return {
      max,
      resourceName: cleanSpellInlineTags(match[1]).trim(),
      recharge,
    };
  }

  function findBestFeatureUseTrackerKey(featureUses, resourceLabel, preferredKey = "") {
    const trackers =
      featureUses && typeof featureUses === "object" && !Array.isArray(featureUses)
        ? Object.entries(featureUses).filter(([, tracker]) => tracker && typeof tracker === "object")
        : [];
    if (!trackers.length || !resourceLabel) return "";
    let bestKey = "";
    let bestScore = 0;
    trackers.forEach(([key, tracker]) => {
      const name = String(tracker?.name ?? "").trim();
      if (!name) return;
      let score = scoreResourceLabelMatch(name, resourceLabel);
      if (key === preferredKey && score > 0) score += 10;
      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
        return;
      }
      if (score === bestScore && score > 0) {
        const isCurrentTable = /table-effect/i.test(bestKey);
        const isNextTable = /table-effect/i.test(key);
        if (isCurrentTable && !isNextTable) bestKey = key;
        const bestTracker = featureUses?.[bestKey];
        if (!isCurrentTable && !isNextTable && toNumber(tracker?.max, 0) > toNumber(bestTracker?.max, 0)) bestKey = key;
      }
    });
    if (bestScore < 1) return "";
    return bestKey;
  }

  function getClassLevelForFeature(character, feature) {
    const className = String(feature?.className ?? "").trim().toLowerCase();
    if (!className) return Math.max(1, progressionCore.getCharacterHighestClassLevel(character));
    const classLevelMap = getClassLevelMap(character);
    const classLevel = toNumber(classLevelMap.get(className), 0);
    if (classLevel > 0) return classLevel;
    return Math.max(1, progressionCore.getCharacterHighestClassLevel(character));
  }

  function inferResourceDieFacesFromUnlockedFeatures(catalogs, character, resourceLabel, fallbackClassLevel = 1) {
    const unlockedFeatures = Array.isArray(character?.progression?.unlockedFeatures)
      ? character.progression.unlockedFeatures
      : [];
    let bestFaces = 0;
    unlockedFeatures.forEach((feature) => {
      const detail = characterProgressionDomain.resolveFeatureEntryFromCatalogs(catalogs, feature);
      const lines = characterProgressionDomain.getRuleDescriptionLinesForParsing(detail);
      const classLevel = getClassLevelForFeature(character, feature) || fallbackClassLevel;
      const descriptor = getResourceDescriptorFromEntry(detail, feature?.name, classLevel, character, feature?.tableDisplayName);
      if (!descriptor || scoreResourceLabelMatch(descriptor.name, resourceLabel) < 1) return;
      const faces = parseDieFacesByClassLevel(lines, classLevel);
      if (faces > bestFaces) bestFaces = faces;
    });
    return bestFaces;
  }

  function getSuperiorityDieFacesByClassLevel(level) {
    const normalizedLevel = Math.max(1, Math.floor(toNumber(level, 1)));
    if (normalizedLevel >= 18) return 12;
    if (normalizedLevel >= 10) return 10;
    return 8;
  }

  function getActivationRollNotation(catalogs, character, feature, lines, resourceLabel, amount) {
    if (/superiority die|superiority dice/i.test(String(resourceLabel ?? ""))) {
      const classLevel = getClassLevelForFeature(character, feature);
      const faces = getSuperiorityDieFacesByClassLevel(classLevel);
      const count = Math.max(1, Math.floor(toNumber(amount, 1)));
      return `${count}d${faces}`;
    }
    const joined = lines.join(" ");
    if (!/\broll\b/i.test(joined)) return "";
    const rollResourceRegex = /roll\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+([a-z][a-z\s'-]{1,64}?(?:dice?|die|charges?|points?|tokens?|uses?))/i;
    const rollResourceMatch = joined.match(rollResourceRegex);
    if (!rollResourceMatch) return "";
    const rolledLabel = toTitleCase(rollResourceMatch[2]);
    if (scoreResourceLabelMatch(rolledLabel, resourceLabel) < 1) return "";
    const notationMatch = joined.match(/\b(\d+)d(\d+)\b/i);
    if (notationMatch?.[0]) return String(notationMatch[0]).replace(/\s+/g, "");
    if (!/\b(die|dice)\b/i.test(resourceLabel)) return "";
    const classLevel = getClassLevelForFeature(character, feature);
    const faces = inferResourceDieFacesFromUnlockedFeatures(catalogs, character, resourceLabel, classLevel);
    if (faces <= 0) return "";
    const count = Math.max(1, Math.floor(toNumber(amount, 1)));
    return `${count}d${faces}`;
  }

  function inferFirstUseFreeFromResourcePool(catalogs, character, resourceLabel, currentFeatureId = "") {
    if (!resourceLabel) return false;
    const unlockedFeatures = Array.isArray(character?.progression?.unlockedFeatures)
      ? character.progression.unlockedFeatures
      : [];
    return unlockedFeatures.some((entry) => {
      const featureId = String(entry?.id ?? "").trim();
      if (featureId && currentFeatureId && featureId === currentFeatureId) return false;
      const classLevel = getClassLevelForFeature(character, entry);
      const detail = characterProgressionDomain.resolveFeatureEntryFromCatalogs(catalogs, entry);
      const lines = characterProgressionDomain.getRuleDescriptionLinesForParsing(detail);
      if (!hasFirstUseFreeAfterLongRestRule(lines)) return false;
      const descriptor = getResourceDescriptorFromEntry(detail, entry?.name, classLevel, character, entry?.tableDisplayName);
      if (!descriptor) return false;
      return scoreResourceLabelMatch(descriptor.name, resourceLabel) > 0;
    });
  }

  function getResourceDescriptorFromEntry(detail, fallbackName, classLevel = 0, character = null, displayName = "") {
    const lines = characterProgressionDomain.getRuleDescriptionLinesForParsing(detail);
    const recharge = getResourceRechargeHint(lines);
    let max = 0;
    let resourceName = cleanSpellInlineTags(detail?.consumes?.name ?? "");
    let displayRecharge = "";

    const displayBased = parseResourceCountFromDisplayName(displayName);
    if (displayBased) {
      max = displayBased.max;
      if (!resourceName && displayBased.resourceName) resourceName = displayBased.resourceName;
      displayRecharge = displayBased.recharge;
    }

    const usesRaw = detail?.uses;
    if (usesRaw != null) {
      if (typeof usesRaw === "number") max = Math.max(0, usesRaw);
      else if (typeof usesRaw === "string") max = Math.max(0, parseCountToken(usesRaw, 0));
    }

    if (max <= 0) {
      const proficiencyBonus = getProficiencyBonusByLevel(classLevel);
      const pbBased = parseResourceCountFromProficiencyBonus(lines, proficiencyBonus);
      if (pbBased && pbBased.max > 0) {
        max = pbBased.max;
        if (!resourceName && pbBased.resourceName) resourceName = pbBased.resourceName;
      }
    }

    if (max <= 0) {
      const abilityBased = parseResourceCountFromAbilityModifier(lines, character);
      if (abilityBased && abilityBased.max > 0) {
        max = abilityBased.max;
        if (!resourceName && abilityBased.resourceName) resourceName = abilityBased.resourceName;
      }
    }

    if (max <= 0) {
      const fromTable = parseResourceCountFromTable(detail, classLevel);
      if (fromTable && fromTable.max > 0) {
        max = fromTable.max;
        if (!resourceName && fromTable.resourceName) resourceName = fromTable.resourceName;
      }
    }

    if (max <= 0) {
      for (const line of lines) {
        const generic = line.match(
          /you have\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+([a-z][a-z\s'-]{1,48}?)(?:,|\s+which|\s+that|\.)/i
        );
        if (!generic) continue;
        const noun = String(generic[2] ?? "").toLowerCase();
        if (!/\b(dice?|die|charge|charges|point|points|pool|use|uses|token|tokens)\b/.test(noun)) continue;
        max = parseCountToken(generic[1], 0);
        if (!resourceName) resourceName = toTitleCase(generic[2]);
        break;
      }
    }

    if (max <= 0) {
      const text = lines.join(" ").toLowerCase();
      const hasOnceUsePattern =
        /\bonce per day\b/.test(text)
        || /\bonce a day\b/.test(text)
        || /\byou can use (?:this|it) once\b/.test(text)
        || /\byou can cast\b.{0,180}?\bonce\b.{0,120}?\b(?:with|using|through) this (?:trait|feature|ability|benefit)\b/.test(text)
        || /\bregain the ability to (?:do so|cast (?:it|this spell|the spell)) when you finish a (?:short|long) rest\b/.test(text)
        || /\bonce before you finish a (?:short|long) rest\b/.test(text)
        || /\bonce you use this (?:feature|ability|benefit)\b/.test(text)
        || /\byou can't (?:do so|use (?:this|it)) again until you finish a (?:short|long) rest\b/.test(text)
        || /\byou can(?:not|'t) (?:do so|use (?:this|it)) again until you finish a (?:short|long) rest\b/.test(text);
      if (hasOnceUsePattern) max = 1;
    }

    const normalizedName = String(resourceName || fallbackName || "").toLowerCase();
    if (max > 0 && /superiority die|superiority dice/.test(normalizedName)) {
      const thresholds = getAdditionalThresholdsForCombatSuperiority(lines);
      thresholds.forEach((level) => {
        if (classLevel >= level) max += 1;
      });
    }

    if (max <= 0) return null;
    if (/^spellcasting$/i.test(String(fallbackName ?? "").trim())) return null;
    const normalizedResourceName = String(resourceName ?? "").trim();
    const needsInferredName =
      !normalizedResourceName
      || /^(uses?|dice?|die|number|pool)$/i.test(normalizedResourceName);
    const nextResourceName = needsInferredName
      ? inferResourceLabelFromLines(lines, normalizedResourceName)
      : normalizedResourceName;
    return {
      name: nextResourceName || cleanSpellInlineTags(fallbackName || "Feature Uses"),
      max,
      recharge: recharge || displayRecharge,
    };
  }

  function getAutoResourceMaxFromFeatureName(featureName) {
    const name = String(featureName ?? "").trim();
    if (!name) return 0;
    if (/action surge/i.test(name)) {
      if (/three uses/i.test(name)) return 3;
      if (/two uses/i.test(name)) return 2;
      return 1;
    }
    if (/indomitable/i.test(name)) {
      if (/three uses/i.test(name)) return 3;
      if (/two uses/i.test(name)) return 2;
      return 1;
    }
    if (/second wind/i.test(name)) return 1;
    return 0;
  }

  function getSpeciesTraitId(raceEntry, traitName) {
    const source = normalizeSourceTag(raceEntry?.source);
    const slug = String(traitName ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");
    return `species:${source}:${slug}`;
  }

  function getAutoResourcesFromRaceTraits(catalogs, character) {
    const sourceOrder = catalogLookupDomain.getPreferredSourceOrder(character);
    const raceEntry = catalogLookupDomain.getEffectiveRaceEntry(catalogs, character, sourceOrder);
    if (!catalogLookupDomain.isRecordObject(raceEntry)) return [];
    const traitEntries = Array.isArray(raceEntry?.entries) ? raceEntry.entries : [];
    const byId = new Map();
    traitEntries.forEach((entry) => {
      if (!shouldShowSpeciesTraitEntry(raceEntry, entry)) return;
      const name = String(entry?.name ?? "").trim();
      const descriptor = getResourceDescriptorFromEntry(entry, name, Math.max(1, toNumber(character?.level, 1)), character);
      if (!descriptor || descriptor.max <= 0) return;
      const id = getSpeciesTraitId(raceEntry, name);
      byId.set(`${autoResourceIdPrefix}${id}`, {
        autoId: `${autoResourceIdPrefix}${id}`,
        name: descriptor.name,
        current: descriptor.max,
        max: descriptor.max,
        recharge: descriptor.recharge,
      });
    });
    return [...byId.values()];
  }

  function getItemResourceBonusDescriptors(catalogs, character) {
    return getActiveInventoryCatalogItems(catalogs, character)
      .flatMap(({ inventoryEntry, catalogItem }) => {
        const label = String(inventoryEntry?.name ?? catalogItem?.name ?? "Item").trim() || "Item";
        const lines = characterProgressionDomain.getRuleDescriptionLinesForParsing(catalogItem);
        const text = lines.join(" ").toLowerCase();
        const bonuses = [];
        if (
          /channel divinity/.test(text)
          && /without expending (?:one of )?(?:the feature's |your )?uses?/.test(text)
          && /\bonce\b/.test(text)
        ) {
          bonuses.push({
            label,
            resourceLabel: "Channel Divinity",
            value: 1,
          });
        }
        return bonuses;
      });
  }

  function applyItemResourceBonuses(byId, catalogs, character) {
    getItemResourceBonusDescriptors(catalogs, character).forEach((bonus) => {
      const amount = Math.max(0, Math.floor(toNumber(bonus?.value, 0)));
      const resourceLabel = String(bonus?.resourceLabel ?? "").trim();
      if (amount <= 0 || !resourceLabel) return;
      let bestKey = "";
      let bestScore = 0;
      byId.forEach((tracker, key) => {
        const score = scoreResourceLabelMatch(resourceLabel, tracker?.name);
        if (score > bestScore) {
          bestKey = key;
          bestScore = score;
        }
      });
      if (!bestKey || bestScore < 1) return;
      const tracker = byId.get(bestKey);
      const nextMax = Math.max(0, toNumber(tracker?.max, 0)) + amount;
      byId.set(bestKey, {
        ...tracker,
        current: nextMax,
        max: nextMax,
      });
    });
  }

  function getAutoResourcesFromRules(catalogs, character, features, feats, optionalFeatures) {
    const classLevelMap = getClassLevelMap(character);
    const byId = new Map();
    const repeatedResourceIdentities = getRepeatedFeatureResourceIdentities(features);

    features.forEach((feature) => {
      const detail = characterProgressionDomain.resolveFeatureEntryFromCatalogs(catalogs, feature);
      const classLevel = toNumber(classLevelMap.get(String(feature.className ?? "").trim().toLowerCase()), 0);
      const descriptor = getResourceDescriptorFromEntry(detail, feature.name, classLevel, character, feature?.tableDisplayName);
      if (descriptor) {
        const useSharedClassResource = feature?.tableDisplayName || repeatedResourceIdentities.has(getFeatureResourceIdentity(feature));
        const autoId = useSharedClassResource
          ? getClassResourceAutoId(feature, descriptor.name)
          : `${autoResourceIdPrefix}${feature.id}`;
        if (!autoId) return;
        setBestTracker(byId, {
          autoId,
          name: descriptor.name,
          current: descriptor.max,
          max: descriptor.max,
          recharge: descriptor.recharge,
        });
        return;
      }

      const fallbackMax = getAutoResourceMaxFromFeatureName(feature?.name);
      if (fallbackMax <= 0) return;
      const useSharedClassResource = repeatedResourceIdentities.has(getFeatureResourceIdentity(feature));
      const fallbackName = stripUseCountSuffix(feature?.name);
      const autoId = useSharedClassResource
        ? getClassResourceAutoId(feature, fallbackName)
        : `${autoResourceIdPrefix}${feature.id}`;
      setBestTracker(byId, {
        autoId,
        name: fallbackName || cleanSpellInlineTags(feature.name),
        current: fallbackMax,
        max: fallbackMax,
        recharge: "",
      });
    });

    (Array.isArray(feats) ? feats : []).forEach((feat) => {
      const featDetail = (catalogs?.feats ?? []).find((entry) => buildEntityId(["feat", entry?.name, entry?.source]) === feat.id);
      const descriptor = getResourceDescriptorFromEntry(featDetail, feat.name, progressionCore.getCharacterHighestClassLevel(character), character);
      if (!descriptor) return;
      byId.set(`${autoResourceIdPrefix}${feat.id}`, {
        autoId: `${autoResourceIdPrefix}${feat.id}`,
        name: descriptor.name,
        current: descriptor.max,
        max: descriptor.max,
        recharge: descriptor.recharge,
      });
    });

    (Array.isArray(optionalFeatures) ? optionalFeatures : []).forEach((feature) => {
      const optionalFeatureDetail = (catalogs?.optionalFeatures ?? []).find(
        (entry) => buildEntityId(["optionalfeature", entry?.name, entry?.source]) === feature.id
      );
      const descriptor = getResourceDescriptorFromEntry(
        optionalFeatureDetail,
        feature.name,
        progressionCore.getCharacterHighestClassLevel(character),
        character
      );
      if (!descriptor) return;
      byId.set(`${autoResourceIdPrefix}${feature.id}`, {
        autoId: `${autoResourceIdPrefix}${feature.id}`,
        name: descriptor.name,
        current: descriptor.max,
        max: descriptor.max,
        recharge: descriptor.recharge,
      });
    });

    getAutoResourcesFromRaceTraits(catalogs, character).forEach((tracker) => {
      byId.set(String(tracker?.autoId ?? ""), tracker);
    });

    applyItemResourceBonuses(byId, catalogs, character);

    return [...byId.values()];
  }

  function getAutoResourcesFromClassTableEffects(catalogs, character, unlockedFeatures, classTableEffects) {
    const classLevelMap = getClassLevelMap(character);
    const candidatesByClass = new Map();
    (Array.isArray(unlockedFeatures) ? unlockedFeatures : []).forEach((feature) => {
      const className = String(feature?.className ?? "").trim();
      if (!className) return;
      const classKey = className.toLowerCase();
      const detail = characterProgressionDomain.resolveFeatureEntryFromCatalogs(catalogs, feature);
      const classLevel = toNumber(classLevelMap.get(classKey), 0);
      const descriptor = getResourceDescriptorFromEntry(detail, feature?.name, classLevel, character, feature?.tableDisplayName);
      const rechargeHint = getResourceRechargeHint(characterProgressionDomain.getRuleDescriptionLinesForParsing(detail));
      const list = candidatesByClass.get(classKey) ?? [];
      if (descriptor) {
        list.push({
          label: String(descriptor?.name ?? "").trim(),
          recharge: String(descriptor?.recharge ?? ""),
          source: "descriptor",
        });
      }
      if (rechargeHint) {
        list.push({
          label: String(feature?.name ?? "").trim(),
          recharge: rechargeHint,
          source: "feature",
        });
      }
      if (list.length) candidatesByClass.set(classKey, list);
    });

    return (Array.isArray(classTableEffects) ? classTableEffects : [])
      .map((effect) => {
        const id = String(effect?.id ?? "").trim();
        const label = String(effect?.label ?? "").trim();
        const classKey = String(effect?.className ?? "").trim().toLowerCase();
        const valueText = String(effect?.value ?? "").trim();
        if (!id || !label || !classKey || !valueText) return null;
        const max = toNumber(valueText.match(/[+\-]?\d+/)?.[0], Number.NaN);
        if (!Number.isFinite(max) || max <= 0) return null;
        const candidates = candidatesByClass.get(classKey) ?? [];
        let best = null;
        let bestScore = 0;
        candidates.forEach((candidate) => {
          const score = scoreResourceLabelMatch(label, candidate?.label);
          if (score > bestScore) {
            bestScore = score;
            best = candidate;
          }
        });
        if (!best || bestScore < 1) return null;
        if (best.source !== "descriptor" && !String(best?.recharge ?? "").trim()) return null;
        const autoId =
          best.source === "descriptor"
            ? getClassResourceAutoId({ className: effect?.className }, label) || `${autoResourceIdPrefix}${id}`
            : `${autoResourceIdPrefix}${id}`;
        return {
          autoId,
          name: label,
          current: max,
          max,
          recharge: String(best?.recharge ?? ""),
        };
      })
      .filter(Boolean);
  }

  function getFeatureActivationDescriptor(catalogs, character, feature, featureUses) {
    if (!feature || typeof feature !== "object") return null;
    const featureId = String(feature?.id ?? "").trim();
    let detail = characterProgressionDomain.resolveFeatureEntryFromCatalogs(catalogs, feature);
    if (!detail && featureId) {
      detail =
        (Array.isArray(catalogs?.optionalFeatures)
          ? catalogs.optionalFeatures.find((entry) => buildEntityId(["optionalfeature", entry?.name, entry?.source]) === featureId)
          : null)
        || (Array.isArray(catalogs?.feats) ? catalogs.feats.find((entry) => buildEntityId(["feat", entry?.name, entry?.source]) === featureId) : null)
        || null;
    }
    if (!detail) return null;
    const lines = characterProgressionDomain.getRuleDescriptionLinesForParsing(detail);
    const consumedResourceName = cleanSpellInlineTags(detail?.consumes?.name ?? "").trim();
    const consumedResourceAmount = Math.max(1, Math.floor(toNumber(detail?.consumes?.amount, 1)));
    const cost = parseExplicitResourceCostFromLines(lines)
      || (consumedResourceName ? { amount: consumedResourceAmount, resourceLabel: consumedResourceName } : null);
    if (!cost || cost.amount < 1 || !cost.resourceLabel) return null;
    const preferredKey = `${autoResourceIdPrefix}${featureId}`;
    const trackerKey = findBestFeatureUseTrackerKey(featureUses, cost.resourceLabel, preferredKey);
    if (!trackerKey) return null;
    const tracker =
      featureUses && typeof featureUses === "object" && !Array.isArray(featureUses) ? featureUses[trackerKey] : null;
    const current = Math.max(0, toNumber(tracker?.current, 0));
    const max = Math.max(0, toNumber(tracker?.max, 0));
    const firstUseFreeAfterLongRest =
      hasFirstUseFreeAfterLongRestRule(lines)
      || inferFirstUseFreeFromResourcePool(catalogs, character, cost.resourceLabel, featureId);
    const rollNotation = getActivationRollNotation(catalogs, character, feature, lines, cost.resourceLabel, cost.amount);
    return {
      featureId,
      trackerKey,
      amount: Math.max(1, Math.floor(toNumber(cost.amount, 1))),
      resourceLabel: String(cost.resourceLabel ?? "").trim(),
      current,
      max,
      firstUseFreeAfterLongRest,
      rollNotation,
    };
  }

  function parseFeatureRefValue(value, kind = "subclass") {
    const parts = String(value ?? "")
      .split("|")
      .map((part) => String(part ?? "").trim());
    if (!parts[0]) return null;
    if (kind === "class") {
      const levelRaw = parts[3] ?? "";
      const level = toNumber(levelRaw, Number.NaN);
      return {
        name: parts[0] || "",
        className: parts[1] || "",
        source: normalizeSourceTag(parts[2] || ""),
        level: Number.isFinite(level) ? level : Number.NaN,
      };
    }
    const levelRaw = parts[5] ?? "";
    const level = toNumber(levelRaw, Number.NaN);
    return {
      name: parts[0] || "",
      className: parts[1] || "",
      classSource: normalizeSourceTag(parts[2] || ""),
      subclassName: parts[3] || "",
      source: normalizeSourceTag(parts[4] || ""),
      level: Number.isFinite(level) ? level : Number.NaN,
    };
  }

  function collectFeatureRefStrings(entries, refs = []) {
    if (entries == null) return refs;
    if (Array.isArray(entries)) {
      entries.forEach((entry) => collectFeatureRefStrings(entry, refs));
      return refs;
    }
    if (!catalogLookupDomain.isRecordObject(entries)) return refs;
    const subclassRef = String(entries?.subclassFeature ?? "").trim();
    if (subclassRef) refs.push({ type: "subclass", value: subclassRef });
    const classRef = String(entries?.classFeature ?? "").trim();
    if (classRef) refs.push({ type: "class", value: classRef });
    if (Array.isArray(entries.entries)) collectFeatureRefStrings(entries.entries, refs);
    if (Array.isArray(entries.items)) collectFeatureRefStrings(entries.items, refs);
    if (catalogLookupDomain.isRecordObject(entries.entry)) collectFeatureRefStrings(entries.entry, refs);
    return refs;
  }

  function getReferencedUnlockedFeatureIds(catalogs, unlockedFeatures) {
    const features = Array.isArray(unlockedFeatures) ? unlockedFeatures : [];
    if (!features.length) return [];
    const matchesFeatureRef = (feature, ref) => {
      const featureName = String(feature?.name ?? "").trim().toLowerCase();
      const className = String(feature?.className ?? "").trim().toLowerCase();
      const source = normalizeSourceTag(feature?.source);
      const level = toNumber(feature?.level, Number.NaN);
      if (featureName !== String(ref?.name ?? "").trim().toLowerCase()) return false;
      if (className !== String(ref?.className ?? "").trim().toLowerCase()) return false;
      if (ref?.source && source && source !== ref.source) return false;
      if (Number.isFinite(ref?.level) && Number.isFinite(level) && level !== ref.level) return false;
      if (ref?.subclassName != null) {
        const subclassName = String(feature?.subclassName ?? "").trim().toLowerCase();
        if (subclassName !== String(ref?.subclassName ?? "").trim().toLowerCase()) return false;
      }
      return true;
    };
    const referencedIds = new Set();
    features.forEach((feature) => {
      const parentId = String(feature?.id ?? "").trim();
      if (!parentId) return;
      const detail = characterProgressionDomain.resolveFeatureEntryFromCatalogs(catalogs, feature);
      if (!detail) return;
      const refs = collectFeatureRefStrings(detail?.entries ?? []);
      refs.forEach((rawRef) => {
        const parsed = rawRef.type === "class" ? parseFeatureRefValue(rawRef.value, "class") : parseFeatureRefValue(rawRef.value, "subclass");
        if (!parsed) return;
        const matched = features.find((candidate) => {
          const candidateId = String(candidate?.id ?? "").trim();
          if (!candidateId || candidateId === parentId) return false;
          return matchesFeatureRef(candidate, parsed);
        });
        if (!matched?.id) return;
        referencedIds.add(String(matched.id));
      });
    });
    return [...referencedIds.values()];
  }

  function syncAutoFeatureUses(play, trackers) {
    const previous =
      play?.featureUses && typeof play.featureUses === "object" && !Array.isArray(play.featureUses)
        ? play.featureUses
        : {};
    const getPreviousTrackerForAutoResource = (key, tracker) => {
      const direct = previous[key];
      if (direct && typeof direct === "object") return direct;
      if (!key.startsWith(`${autoResourceIdPrefix}resource__`)) return null;
      const name = String(tracker?.name ?? "").trim().toLowerCase();
      if (!name) return null;
      let best = null;
      Object.values(previous).forEach((candidate) => {
        if (!candidate || typeof candidate !== "object") return;
        if (String(candidate?.name ?? "").trim().toLowerCase() !== name) return;
        if (!best || toNumber(candidate?.max, 0) > toNumber(best?.max, 0)) best = candidate;
      });
      return best;
    };
    const next = {};
    trackers.forEach((tracker) => {
      const key = String(tracker?.autoId ?? "").trim();
      if (!key) return;
      const prev = getPreviousTrackerForAutoResource(key, tracker);
      const max = Math.max(0, toNumber(tracker.max, 0));
      const prevMax = prev && typeof prev === "object" ? Math.max(0, toNumber(prev.max, max)) : max;
      const prevCurrent = prev && typeof prev === "object" ? Math.max(0, Math.min(prevMax, toNumber(prev.current, prevMax))) : max;
      const spent = prev && typeof prev === "object" ? Math.max(0, prevMax - prevCurrent) : 0;
      next[key] = {
        name: String(tracker.name ?? ""),
        max,
        current: Math.max(0, Math.min(max, max - spent)),
        recharge: String(tracker.recharge ?? ""),
      };
    });
    return next;
  }

  return {
    getClassLevelMap,
    getProficiencyBonusByLevel,
    getFeatureActivationDescriptor,
    getReferencedUnlockedFeatureIds,
    getAutoResourcesFromRules,
    getAutoResourcesFromClassTableEffects,
    syncAutoFeatureUses,
  };
}

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
      const descriptor = getResourceDescriptorFromEntry(detail, feature?.name, classLevel);
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
      const descriptor = getResourceDescriptorFromEntry(detail, entry?.name, classLevel);
      if (!descriptor) return false;
      return scoreResourceLabelMatch(descriptor.name, resourceLabel) > 0;
    });
  }

  function getResourceDescriptorFromEntry(detail, fallbackName, classLevel = 0) {
    const lines = characterProgressionDomain.getRuleDescriptionLinesForParsing(detail);
    const recharge = getResourceRechargeHint(lines);
    let max = 0;
    let resourceName = cleanSpellInlineTags(detail?.consumes?.name ?? "");

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
      recharge,
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
    const ignoredTraitNames = new Set(["age", "alignment", "size", "language", "languages", "creature type"]);
    const byId = new Map();
    traitEntries.forEach((entry) => {
      if (!catalogLookupDomain.isRecordObject(entry)) return;
      const name = String(entry?.name ?? "").trim();
      if (!name || ignoredTraitNames.has(name.toLowerCase())) return;
      const descriptor = getResourceDescriptorFromEntry(entry, name, Math.max(1, toNumber(character?.level, 1)));
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

  function getAutoResourcesFromRules(catalogs, character, features, feats, optionalFeatures) {
    const classLevelMap = getClassLevelMap(character);
    const byId = new Map();

    features.forEach((feature) => {
      const detail = characterProgressionDomain.resolveFeatureEntryFromCatalogs(catalogs, feature);
      const classLevel = toNumber(classLevelMap.get(String(feature.className ?? "").trim().toLowerCase()), 0);
      const descriptor = getResourceDescriptorFromEntry(detail, feature.name, classLevel);
      if (descriptor) {
        byId.set(`${autoResourceIdPrefix}${feature.id}`, {
          autoId: `${autoResourceIdPrefix}${feature.id}`,
          name: descriptor.name,
          current: descriptor.max,
          max: descriptor.max,
          recharge: descriptor.recharge,
        });
        return;
      }

      const fallbackMax = getAutoResourceMaxFromFeatureName(feature?.name);
      if (fallbackMax <= 0) return;
      byId.set(`${autoResourceIdPrefix}${feature.id}`, {
        autoId: `${autoResourceIdPrefix}${feature.id}`,
        name: cleanSpellInlineTags(feature.name),
        current: fallbackMax,
        max: fallbackMax,
        recharge: "",
      });
    });

    (Array.isArray(feats) ? feats : []).forEach((feat) => {
      const featDetail = (catalogs?.feats ?? []).find((entry) => buildEntityId(["feat", entry?.name, entry?.source]) === feat.id);
      const descriptor = getResourceDescriptorFromEntry(featDetail, feat.name, progressionCore.getCharacterHighestClassLevel(character));
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
        progressionCore.getCharacterHighestClassLevel(character)
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
      const descriptor = getResourceDescriptorFromEntry(detail, feature?.name, classLevel);
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
        return {
          autoId: `${autoResourceIdPrefix}${id}`,
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
    const cost = parseExplicitResourceCostFromLines(lines);
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
    const next = {};
    trackers.forEach((tracker) => {
      const key = String(tracker?.autoId ?? "").trim();
      if (!key) return;
      const prev = previous[key];
      const prevCurrent = prev && typeof prev === "object" ? toNumber(prev.current, tracker.max) : tracker.max;
      const max = Math.max(0, toNumber(tracker.max, 0));
      next[key] = {
        name: String(tracker.name ?? ""),
        max,
        current: Math.max(0, Math.min(max, prevCurrent)),
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

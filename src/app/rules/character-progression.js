export function createCharacterProgressionDomain({
  toNumber,
  signed,
  isRecordObject,
  normalizeSourceTag,
  buildEntityId,
  cleanSpellInlineTags,
  parseClassFeatureToken,
  parseSubclassFeatureToken,
  getClassLevelTracks,
  getPreferredSourceOrder,
  getClassCatalogEntry,
  getSelectedSubclassEntry,
  getEffectiveRaceEntry,
  findCatalogEntryByNameWithSelectedSourcePreference,
  asiFeatureNameRegex,
  extractSimpleNotation,
  collectSpellEntryLines,
}) {
  function getUnlockedFeatures(catalogs, character) {
    const unlocked = [];
    const seen = new Set();
    const tracks = getClassLevelTracks(character);
    const getOptionLabel = (option) => {
      if (!option) return "";
      if (typeof option === "string") return cleanSpellInlineTags(option.split("|")[0]);
      if (!isRecordObject(option)) return "";
      if (typeof option.name === "string" && option.name.trim()) return cleanSpellInlineTags(option.name);
      if (typeof option.optionalfeature === "string") return cleanSpellInlineTags(option.optionalfeature.split("|")[0]);
      if (typeof option.subclassFeature === "string") return cleanSpellInlineTags(option.subclassFeature.split("|")[0]);
      if (typeof option.classFeature === "string") return cleanSpellInlineTags(option.classFeature.split("|")[0]);
      if (typeof option.feature === "string") return cleanSpellInlineTags(option.feature.split("|")[0]);
      if (typeof option.entry === "string") return cleanSpellInlineTags(option.entry);
      return "";
    };

    const collectReferencedTokens = (entry, acc = [], context = {}) => {
      if (entry == null) return acc;
      if (Array.isArray(entry)) {
        entry.forEach((value) => collectReferencedTokens(value, acc, context));
        return acc;
      }
      if (!isRecordObject(entry)) return acc;
      if (entry.type === "options" && Array.isArray(entry.entries)) {
        const optionValues = [...new Set(entry.entries.map((option) => getOptionLabel(option)).filter(Boolean))];
        const maxCount = Math.max(1, Math.min(optionValues.length, Math.floor(toNumber(entry.count, 1))));
        const modeId = buildEntityId(["feature-mode", context.featureId, context.entryIndex]);
        const rawModeSelection = character?.play?.featureModes?.[modeId];
        const currentValues = Array.isArray(rawModeSelection)
          ? rawModeSelection.map((value) => String(value ?? "").trim())
          : [String(rawModeSelection ?? "").trim()];
        const selected = [...new Set(currentValues.filter((value) => value && optionValues.includes(value)))];
        if (!selected.length) selected.push(...optionValues.slice(0, maxCount));
        const selectedValues = new Set(selected.slice(0, maxCount));
        entry.entries.forEach((option) => {
          const label = getOptionLabel(option);
          if (!label || !selectedValues.has(label)) return;
          collectReferencedTokens(option, acc, context);
        });
        return acc;
      }
      if (entry.type === "refSubclassFeature" && typeof entry.subclassFeature === "string") {
        acc.push({ type: "subclass", token: entry.subclassFeature });
      }
      if (entry.type === "refClassFeature" && typeof entry.classFeature === "string") {
        acc.push({ type: "class", token: entry.classFeature });
      }
      Object.values(entry).forEach((value) => collectReferencedTokens(value, acc, context));
      return acc;
    };

    const enqueueFeature = (feature, trackLevel, classNameHint = "", subclassNameHint = "") => {
      if (!feature || feature.level == null || feature.level > trackLevel || !feature.id) return;
      if (seen.has(feature.id)) return;
      seen.add(feature.id);
      unlocked.push(feature);

      const detail = resolveFeatureEntryFromCatalogs(catalogs, feature);
      const entries = Array.isArray(detail?.entries) ? detail.entries : [];
      entries.forEach((entry, entryIndex) => {
        const refTokens = collectReferencedTokens(entry, [], { featureId: feature.id, entryIndex });
        refTokens.forEach((ref) => {
          if (!ref?.token) return;
          if (ref.type === "subclass") {
            const parsed = parseSubclassFeatureToken(
              ref.token,
              feature.source,
              classNameHint || feature.className,
              subclassNameHint || feature.subclassName
            );
            if (!parsed || parsed.level == null || parsed.level > trackLevel) return;
            const nextClassName = parsed.className || classNameHint || feature.className;
            const nextSubclassName = parsed.subclassName || subclassNameHint || feature.subclassName;
            enqueueFeature(
              {
                ...parsed,
                className: nextClassName,
                subclassName: nextSubclassName,
              },
              trackLevel,
              nextClassName,
              nextSubclassName
            );
            return;
          }

          const parsed = parseClassFeatureToken(ref.token, feature.source, classNameHint || feature.className);
          if (!parsed || parsed.level == null || parsed.level > trackLevel) return;
          const nextClassName = parsed.className || classNameHint || feature.className;
          enqueueFeature(
            {
              ...parsed,
              className: nextClassName,
            },
            trackLevel,
            nextClassName,
            subclassNameHint || feature.subclassName
          );
        });
      });
    };

    const sourceOrder = getPreferredSourceOrder(character);
    tracks.forEach((track) => {
      const selectedClassSource = track.isPrimary ? character?.classSource : "";
      const classEntry = getClassCatalogEntry(catalogs, track.className, selectedClassSource, sourceOrder);
      if (!classEntry) return;
      const classSource = normalizeSourceTag(classEntry.source);
      const classFeatures = Array.isArray(classEntry.classFeatures) ? classEntry.classFeatures : [];
      classFeatures.forEach((featureEntry) => {
        const token = typeof featureEntry === "string" ? featureEntry : featureEntry?.classFeature;
        const parsed = parseClassFeatureToken(token, classSource, classEntry.name);
        if (!parsed || parsed.level == null || parsed.level > track.level) return;
        enqueueFeature(
          {
            ...parsed,
            className: classEntry.name,
          },
          track.level,
          classEntry.name,
          ""
        );
      });

      if (track.isPrimary) {
        const subclassEntry = getSelectedSubclassEntry(catalogs, character);
        if (!subclassEntry) return;
        const subclassFeatures = Array.isArray(subclassEntry.subclassFeatures) ? subclassEntry.subclassFeatures : [];
        subclassFeatures.forEach((token) => {
          const parsed = parseSubclassFeatureToken(token, subclassEntry.source, classEntry.name, subclassEntry.name);
          if (!parsed || parsed.level == null || parsed.level > track.level) return;
          const resolvedSubclassName = parsed.subclassName || subclassEntry.shortName || subclassEntry.name;
          enqueueFeature(
            {
              ...parsed,
              className: classEntry.name,
              subclassName: resolvedSubclassName,
            },
            track.level,
            classEntry.name,
            resolvedSubclassName
          );
        });
      }
    });

    return unlocked.sort((a, b) => {
      const levelDelta = toNumber(a.level, 0) - toNumber(b.level, 0);
      if (levelDelta !== 0) return levelDelta;
      return String(a.name).localeCompare(String(b.name));
    });
  }

  function getFeatSlotsForClass(classEntry, classLevel) {
    if (!classEntry || classLevel <= 0) return [];
    const slots = [];

    const normalizeFeatCategoryList = (value) => {
      if (Array.isArray(value)) return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
      const single = String(value ?? "").trim();
      return single ? [single] : [];
    };

    const featProgression = Array.isArray(classEntry.featProgression) ? classEntry.featProgression : [];
    featProgression.forEach((progressionEntry, progressionIndex) => {
      const progression = progressionEntry?.progression;
      if (!progression || typeof progression !== "object") return;
      const slotType = progressionEntry?.name ? cleanSpellInlineTags(progressionEntry.name) : "Feat";
      const featCategories = normalizeFeatCategoryList(progressionEntry?.category);
      Object.entries(progression).forEach(([levelRaw, countRaw]) => {
        const level = toNumber(levelRaw, NaN);
        const count = Math.max(0, toNumber(countRaw, 0));
        if (!Number.isFinite(level) || level > classLevel || count <= 0) return;
        for (let idx = 0; idx < count; idx += 1) {
          const id = buildEntityId(["feat-slot", classEntry.name, classEntry.source, slotType, level, progressionIndex, idx]);
          slots.push({
            id,
            className: classEntry.name,
            classSource: normalizeSourceTag(classEntry.source),
            level,
            count: 1,
            slotType,
            featCategories,
          });
        }
      });
    });

    if (slots.length) return slots;

    const classFeatures = Array.isArray(classEntry.classFeatures) ? classEntry.classFeatures : [];
    classFeatures.forEach((featureEntry, featureIndex) => {
      const token = typeof featureEntry === "string" ? featureEntry : featureEntry?.classFeature;
      const parsed = parseClassFeatureToken(token, classEntry.source, classEntry.name);
      if (!parsed || parsed.level == null || parsed.level > classLevel) return;
      if (!asiFeatureNameRegex.test(parsed.name)) return;
      const id = buildEntityId(["feat-slot", classEntry.name, classEntry.source, "asi", parsed.level, featureIndex]);
      slots.push({
        id,
        className: classEntry.name,
        classSource: normalizeSourceTag(classEntry.source),
        level: parsed.level,
        count: 1,
        slotType: "Ability Score Improvement",
        featCategories: [],
      });
    });
    return slots;
  }

  function getFeatSlotsForEntity(entry, context = {}) {
    if (!entry || typeof entry !== "object") return [];
    const featDefinitions = Array.isArray(entry?.feats) ? entry.feats : [];
    if (!featDefinitions.length) return [];

    const normalizeFeatCategoryList = (value) => {
      if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean);
      const single = String(value ?? "").trim();
      return single ? [single] : [];
    };

    const entityType = String(context.type ?? "entity").trim().toLowerCase() || "entity";
    const entityName = String(context.name ?? entry?.name ?? "").trim() || "Feat Source";
    const entitySource = normalizeSourceTag(context.source ?? entry?.source);
    const level = Math.max(1, Math.floor(toNumber(context.level, 1)));
    const slotType = String(context.slotType ?? "Feat").trim() || "Feat";

    const slots = [];
    featDefinitions.forEach((featDef, featIndex) => {
      let count = 0;
      let featCategories = [];

      if (typeof featDef === "number" || Number.isFinite(toNumber(featDef, NaN))) {
        count = Math.max(0, Math.floor(toNumber(featDef, 0)));
      } else if (featDef && typeof featDef === "object" && !Array.isArray(featDef)) {
        if (Number.isFinite(toNumber(featDef.any, NaN))) {
          count = Math.max(count, Math.floor(toNumber(featDef.any, 0)));
        }
        if (featDef.anyFromCategory && typeof featDef.anyFromCategory === "object" && !Array.isArray(featDef.anyFromCategory)) {
          const categoryCount = Math.max(0, Math.floor(toNumber(featDef.anyFromCategory.count, 1)));
          count = Math.max(count, categoryCount);
          featCategories = normalizeFeatCategoryList(featDef.anyFromCategory.category);
        }
        if (Array.isArray(featDef.from)) {
          const fromCount = Math.max(0, Math.floor(toNumber(featDef.count, 1)));
          count = Math.max(count, fromCount);
        }
      }

      if (count <= 0) return;
      for (let slotIndex = 0; slotIndex < count; slotIndex += 1) {
        const id = buildEntityId(["feat-slot", entityType, entityName, entitySource || "unknown", level, featIndex, slotIndex]);
        slots.push({
          id,
          className: entityName,
          classSource: entitySource,
          level,
          count: 1,
          slotType,
          featCategories,
        });
      }
    });

    return slots;
  }

  function getFeatSlotsForSubclass(subclassEntry, classLevel) {
    if (!subclassEntry || classLevel <= 0) return [];
    const normalizeFeatCategoryList = (value) => {
      if (Array.isArray(value)) return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
      const single = String(value ?? "").trim();
      return single ? [single] : [];
    };
    const slots = [];
    const featProgression = Array.isArray(subclassEntry?.featProgression) ? subclassEntry.featProgression : [];
    featProgression.forEach((progressionEntry, progressionIndex) => {
      const progression = progressionEntry?.progression;
      if (!progression || typeof progression !== "object") return;
      const slotType = progressionEntry?.name ? cleanSpellInlineTags(progressionEntry.name) : "Feat";
      const featCategories = normalizeFeatCategoryList(progressionEntry?.category);
      Object.entries(progression).forEach(([levelRaw, countRaw]) => {
        const level = toNumber(levelRaw, NaN);
        const count = Math.max(0, toNumber(countRaw, 0));
        if (!Number.isFinite(level) || level > classLevel || count <= 0) return;
        for (let idx = 0; idx < count; idx += 1) {
          const id = buildEntityId([
            "feat-slot",
            "subclass",
            subclassEntry.className,
            subclassEntry.classSource,
            subclassEntry.name,
            subclassEntry.source,
            slotType,
            level,
            progressionIndex,
            idx,
          ]);
          slots.push({
            id,
            className: String(subclassEntry?.className ?? "").trim(),
            classSource: normalizeSourceTag(subclassEntry?.classSource),
            subclassName: String(subclassEntry?.name ?? "").trim(),
            level,
            count: 1,
            slotType,
            featCategories,
          });
        }
      });
    });
    return slots;
  }

  function getFeatSlots(catalogs, character) {
    const sourceOrder = getPreferredSourceOrder(character);
    const raceEntry = getEffectiveRaceEntry(catalogs, character, sourceOrder);
    const backgroundEntry = findCatalogEntryByNameWithSelectedSourcePreference(
      catalogs?.backgrounds,
      character?.background,
      character?.backgroundSource,
      sourceOrder
    );

    const raceSlots = getFeatSlotsForEntity(raceEntry, {
      type: "race",
      name: String(character?.subrace ?? "").trim() ? `${String(raceEntry?.name ?? "").trim()} (${String(character.subrace).trim()})` : raceEntry?.name,
      source: raceEntry?.source,
      level: 1,
      slotType: "Feat",
    });
    const backgroundSlots = getFeatSlotsForEntity(backgroundEntry, {
      type: "background",
      name: backgroundEntry?.name,
      source: backgroundEntry?.source,
      level: 1,
      slotType: "Feat",
    });

    const tracks = getClassLevelTracks(character);
    const selectedPrimarySubclass = getSelectedSubclassEntry(catalogs, character);
    const slots = tracks.flatMap((track) => {
      const classEntry = getClassCatalogEntry(catalogs, track.className);
      const classSlots = getFeatSlotsForClass(classEntry, track.level);
      if (!track.isPrimary || !selectedPrimarySubclass) return classSlots;
      const subclassClassName = String(selectedPrimarySubclass?.className ?? "").trim().toLowerCase();
      const trackClassName = String(track?.className ?? "").trim().toLowerCase();
      if (!subclassClassName || subclassClassName !== trackClassName) return classSlots;
      return [...classSlots, ...getFeatSlotsForSubclass(selectedPrimarySubclass, track.level)];
    });
    return [...raceSlots, ...backgroundSlots, ...slots].sort((a, b) => {
      const levelDelta = a.level - b.level;
      if (levelDelta !== 0) return levelDelta;
      const classDelta = String(a.className).localeCompare(String(b.className));
      if (classDelta !== 0) return classDelta;
      return String(a.slotType).localeCompare(String(b.slotType));
    });
  }

  function normalizeOptionalFeatureTypeList(value) {
    if (Array.isArray(value)) return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
    const single = String(value ?? "").trim();
    return single ? [single] : [];
  }

  function getProgressionCountAtLevel(progression, classLevel) {
    if (Array.isArray(progression)) {
      const idx = Math.max(0, Math.min(progression.length - 1, classLevel - 1));
      return Math.max(0, toNumber(progression[idx], 0));
    }
    if (isRecordObject(progression)) {
      let count = 0;
      Object.entries(progression).forEach(([levelRaw, countRaw]) => {
        const level = toNumber(levelRaw, NaN);
        if (!Number.isFinite(level) || level > classLevel) return;
        count = Math.max(count, Math.max(0, toNumber(countRaw, 0)));
      });
      return count;
    }
    return 0;
  }

  function getOptionalFeatureSlotsForClass(classEntry, classLevel) {
    if (!classEntry || classLevel <= 0) return [];
    const slots = [];
    const groups = Array.isArray(classEntry?.optionalfeatureProgression) ? classEntry.optionalfeatureProgression : [];
    groups.forEach((group, groupIndex) => {
      const count = getProgressionCountAtLevel(group?.progression, classLevel);
      if (count <= 0) return;
      const featureTypes = normalizeOptionalFeatureTypeList(group?.featureType);
      const featureType = featureTypes[0] || "";
      const slotType = cleanSpellInlineTags(group?.name || "Optional Feature");
      for (let idx = 0; idx < count; idx += 1) {
        const id = buildEntityId(["optional-slot", classEntry.name, classEntry.source, slotType, featureType, classLevel, groupIndex, idx]);
        slots.push({
          id,
          className: classEntry.name,
          classSource: normalizeSourceTag(classEntry.source),
          level: classLevel,
          count: 1,
          slotType,
          featureType,
        });
      }
    });
    return slots;
  }

  function getOptionalFeatureSlotsForSubclass(subclassEntry, classLevel) {
    if (!subclassEntry || classLevel <= 0) return [];
    const slots = [];
    const groups = Array.isArray(subclassEntry?.optionalfeatureProgression) ? subclassEntry.optionalfeatureProgression : [];
    groups.forEach((group, groupIndex) => {
      const count = getProgressionCountAtLevel(group?.progression, classLevel);
      if (count <= 0) return;
      const featureTypes = normalizeOptionalFeatureTypeList(group?.featureType);
      const featureType = featureTypes[0] || "";
      const slotType = cleanSpellInlineTags(group?.name || "Optional Feature");
      for (let idx = 0; idx < count; idx += 1) {
        const id = buildEntityId([
          "optional-slot",
          "subclass",
          subclassEntry.className,
          subclassEntry.classSource,
          subclassEntry.name,
          subclassEntry.source,
          slotType,
          featureType,
          classLevel,
          groupIndex,
          idx,
        ]);
        slots.push({
          id,
          className: String(subclassEntry?.className ?? "").trim(),
          classSource: normalizeSourceTag(subclassEntry?.classSource),
          subclassName: String(subclassEntry?.name ?? "").trim(),
          level: classLevel,
          count: 1,
          slotType,
          featureType,
        });
      }
    });
    return slots;
  }

  function getOptionalFeatureSlots(catalogs, character) {
    const tracks = getClassLevelTracks(character);
    const selectedPrimarySubclass = getSelectedSubclassEntry(catalogs, character);
    return tracks
      .flatMap((track) => {
        const classEntry = getClassCatalogEntry(catalogs, track.className);
        const classSlots = getOptionalFeatureSlotsForClass(classEntry, track.level);
        if (!track.isPrimary || !selectedPrimarySubclass) return classSlots;
        const subclassClassName = String(selectedPrimarySubclass?.className ?? "").trim().toLowerCase();
        const trackClassName = String(track?.className ?? "").trim().toLowerCase();
        if (!subclassClassName || subclassClassName !== trackClassName) return classSlots;
        return [...classSlots, ...getOptionalFeatureSlotsForSubclass(selectedPrimarySubclass, track.level)];
      })
      .sort((a, b) => {
        const levelDelta = a.level - b.level;
        if (levelDelta !== 0) return levelDelta;
        const classDelta = String(a.className).localeCompare(String(b.className));
        if (classDelta !== 0) return classDelta;
        return String(a.slotType).localeCompare(String(b.slotType));
      });
  }

  function getClassTableEffects(catalogs, character) {
    const formatClassTableRollNotation = (toRoll) => {
      if (typeof toRoll === "string") {
        const notation = extractSimpleNotation(toRoll);
        return notation || String(toRoll).replace(/\s+/g, "");
      }
      const terms = Array.isArray(toRoll) ? toRoll : isRecordObject(toRoll) ? [toRoll] : [];
      const notation = terms
        .map((term) => {
          if (typeof term === "string") return extractSimpleNotation(term);
          if (!isRecordObject(term)) return "";
          const count = Math.max(1, toNumber(term.number, 1));
          const faces = Math.max(0, toNumber(term.faces, 0));
          if (!faces) return "";
          return `${count}d${faces}`;
        })
        .filter(Boolean)
        .join("+");
      return extractSimpleNotation(notation);
    };

    const effects = [];
    const tracks = getClassLevelTracks(character);
    tracks.forEach((track) => {
      const classEntry = getClassCatalogEntry(catalogs, track.className);
      if (!classEntry) return;
      const groups = Array.isArray(classEntry.classTableGroups) ? classEntry.classTableGroups : [];
      const levelIndex = Math.max(0, Math.min(19, toNumber(track.level, 1) - 1));
      groups.forEach((group, groupIndex) => {
        const labels = Array.isArray(group?.colLabels) ? group.colLabels : [];
        const rows = Array.isArray(group?.rows) ? group.rows : [];
        const row = Array.isArray(rows[levelIndex]) ? rows[levelIndex] : null;
        if (!row) return;
        labels.forEach((labelRaw, idx) => {
          const label = cleanSpellInlineTags(labelRaw);
          const key = label.toLowerCase();
          if (!label) return;
          if (!/(point|die|dice|movement|speed|rage|inspiration|mastery|indomitable|channel divinity|sneak attack|martial arts|wild shape|sorcery|ki)/i.test(key)) {
            return;
          }
          const value = row[idx];
          let effectValue = "";
          let kind = "text";
          if (isRecordObject(value) && value.toRoll != null) {
            effectValue = formatClassTableRollNotation(value.toRoll);
            kind = "dice";
          } else if (isRecordObject(value) && value.type === "bonus") {
            effectValue = signed(toNumber(value.value, 0));
            kind = "number";
          } else if (isRecordObject(value) && value.type === "bonusSpeed") {
            effectValue = `+${Math.max(0, toNumber(value.value, 0))} ft`;
            kind = "number";
          } else if (typeof value === "number" || Number.isFinite(toNumber(value, NaN))) {
            effectValue = String(Math.max(0, toNumber(value, 0)));
            kind = "number";
          } else {
            effectValue = String(value ?? "").trim();
          }
          if (!effectValue) return;
          effects.push({
            id: buildEntityId(["table-effect", classEntry.name, groupIndex, idx, label]),
            className: classEntry.name,
            label,
            kind,
            value: effectValue,
            rollNotation: kind === "dice" ? extractSimpleNotation(effectValue) : "",
          });
        });
      });
    });
    return effects;
  }

  function extractFeatureModeDescriptors(catalogs, features) {
    const getOptionLabel = (option) => {
      if (!option) return "";
      if (typeof option === "string") return cleanSpellInlineTags(option.split("|")[0]);
      if (!isRecordObject(option)) return "";
      if (typeof option.name === "string" && option.name.trim()) return cleanSpellInlineTags(option.name);
      if (typeof option.optionalfeature === "string") return cleanSpellInlineTags(option.optionalfeature.split("|")[0]);
      if (typeof option.subclassFeature === "string") return cleanSpellInlineTags(option.subclassFeature.split("|")[0]);
      if (typeof option.classFeature === "string") return cleanSpellInlineTags(option.classFeature.split("|")[0]);
      if (typeof option.feature === "string") return cleanSpellInlineTags(option.feature.split("|")[0]);
      if (typeof option.entry === "string") return cleanSpellInlineTags(option.entry);
      return "";
    };

    const normalizeModeCount = (raw) => {
      const parsed = Math.max(1, Math.floor(toNumber(raw, 1)));
      return Number.isFinite(parsed) ? parsed : 1;
    };

    const modes = [];
    const collectOptionEntries = (entry, out = []) => {
      if (entry == null) return out;
      if (Array.isArray(entry)) {
        entry.forEach((value) => collectOptionEntries(value, out));
        return out;
      }
      if (!isRecordObject(entry)) return out;
      if (entry.type === "options" && Array.isArray(entry.entries)) out.push(entry);
      Object.values(entry).forEach((value) => collectOptionEntries(value, out));
      return out;
    };
    (Array.isArray(features) ? features : []).forEach((feature) => {
      const detail = resolveFeatureEntryFromCatalogs(catalogs, feature);
      const optionEntries = collectOptionEntries(detail?.entries ?? []);
      optionEntries.forEach((entry, entryIndex) => {
        if (!isRecordObject(entry) || entry.type !== "options" || !Array.isArray(entry.entries)) return;
        const optionValues = [...new Set(entry.entries.map((option) => getOptionLabel(option)).filter(Boolean))];
        const count = Math.min(optionValues.length, normalizeModeCount(entry.count));
        if (optionValues.length < 2 || count < 1) return;
        modes.push({
          id: buildEntityId(["feature-mode", feature.id, entryIndex]),
          featureId: feature.id,
          featureName: feature.name,
          className: feature.className,
          optionValues,
          count,
        });
      });
    });
    return modes;
  }

  function recomputeCharacterProgression(catalogs, character) {
    const unlockedFeatures = getUnlockedFeatures(catalogs, character);
    const featSlots = getFeatSlots(catalogs, character);
    const optionalFeatureSlots = getOptionalFeatureSlots(catalogs, character);
    const classTableEffects = getClassTableEffects(catalogs, character);
    const featureModes = extractFeatureModeDescriptors(catalogs, unlockedFeatures);
    const existingFeats = Array.isArray(character?.feats) ? character.feats : [];
    const existingOptionalFeatures = Array.isArray(character?.optionalFeatures) ? character.optionalFeatures : [];
    const slotIds = new Set(featSlots.map((slot) => slot.id));
    const optionalSlotIds = new Set(optionalFeatureSlots.map((slot) => slot.id));
    const nextFeats = existingFeats.filter((feat) => feat && feat.name && (!feat.slotId || slotIds.has(feat.slotId)));
    const nextOptionalFeatures = existingOptionalFeatures.filter(
      (feature) => feature && feature.name && (!feature.slotId || optionalSlotIds.has(feature.slotId))
    );
    const selectedFeatIds = nextFeats.map((feat) => feat.id).filter(Boolean);
    const selectedOptionalFeatureIds = nextOptionalFeatures.map((feature) => feature.id).filter(Boolean);
    const pendingFeatSlotIds = featSlots.filter((slot) => !nextFeats.some((feat) => feat.slotId === slot.id)).map((slot) => slot.id);
    const pendingOptionalFeatureSlotIds = optionalFeatureSlots
      .filter((slot) => !nextOptionalFeatures.some((feature) => feature.slotId === slot.id))
      .map((slot) => slot.id);
    return {
      unlockedFeatures,
      featSlots,
      pendingFeatSlotIds,
      selectedFeatIds,
      optionalFeatureSlots,
      pendingOptionalFeatureSlotIds,
      selectedOptionalFeatureIds,
      classTableEffects,
      featureModes,
    };
  }

  function resolveFeatureEntryFromCatalogs(catalogs, feature) {
    if (!feature) return null;
    const normalizedName = String(feature.name ?? "").trim().toLowerCase();
    const normalizedClassName = String(feature.className ?? "").trim().toLowerCase();
    const level = toNumber(feature.level, 0);
    const featureSource = normalizeSourceTag(feature.source);

    if (feature.type === "subclass") {
      const normalizedSubclassName = String(feature.subclassName ?? "").trim().toLowerCase();
      const matches = (catalogs?.subclassFeatures ?? []).filter((entry) => {
        const entryName = String(entry?.name ?? "").trim().toLowerCase();
        const entryClassName = String(entry?.className ?? "").trim().toLowerCase();
        const entrySubclassName = String(entry?.subclassShortName ?? "").trim().toLowerCase();
        const entryLevel = toNumber(entry?.level, 0);
        if (entryName !== normalizedName || entryClassName !== normalizedClassName || entryLevel !== level) return false;
        if (normalizedSubclassName && entrySubclassName !== normalizedSubclassName) return false;
        if (!featureSource) return true;
        return normalizeSourceTag(entry?.source) === featureSource;
      });
      const match = matches[0] ?? null;
      if (!match) return null;
      if (Array.isArray(match?.entries) && match.entries.length) return match;
      const copy = isRecordObject(match?._copy) ? match._copy : null;
      if (!copy) return match;
      const copiedName = String(copy?.name ?? "").trim().toLowerCase();
      const copiedClassName = String(copy?.className ?? "").trim().toLowerCase();
      const copiedSubclassName = String(copy?.subclassShortName ?? "").trim().toLowerCase();
      const copiedLevel = toNumber(copy?.level, NaN);
      const copiedSource = normalizeSourceTag(copy?.source);
      const copiedEntry = (catalogs?.subclassFeatures ?? []).find((entry) => {
        if (String(entry?.name ?? "").trim().toLowerCase() !== copiedName) return false;
        if (String(entry?.className ?? "").trim().toLowerCase() !== copiedClassName) return false;
        if (String(entry?.subclassShortName ?? "").trim().toLowerCase() !== copiedSubclassName) return false;
        if (Number.isFinite(copiedLevel) && toNumber(entry?.level, NaN) !== copiedLevel) return false;
        if (copiedSource && normalizeSourceTag(entry?.source) !== copiedSource) return false;
        return true;
      });
      return copiedEntry ?? match;
    }

    const matches = (catalogs?.classFeatures ?? []).filter((entry) => {
      const entryName = String(entry?.name ?? "").trim().toLowerCase();
      const entryClassName = String(entry?.className ?? "").trim().toLowerCase();
      const entryLevel = toNumber(entry?.level, 0);
      if (entryName !== normalizedName || entryClassName !== normalizedClassName || entryLevel !== level) return false;
      if (!featureSource) return true;
      return normalizeSourceTag(entry?.source) === featureSource;
    });
    const match = matches[0] ?? null;
    if (!match) return null;
    if (Array.isArray(match?.entries) && match.entries.length) return match;
    const copy = isRecordObject(match?._copy) ? match._copy : null;
    if (!copy) return match;
    const copiedName = String(copy?.name ?? "").trim().toLowerCase();
    const copiedClassName = String(copy?.className ?? "").trim().toLowerCase();
    const copiedLevel = toNumber(copy?.level, NaN);
    const copiedSource = normalizeSourceTag(copy?.source);
    const copiedEntry = (catalogs?.classFeatures ?? []).find((entry) => {
      if (String(entry?.name ?? "").trim().toLowerCase() !== copiedName) return false;
      if (String(entry?.className ?? "").trim().toLowerCase() !== copiedClassName) return false;
      if (Number.isFinite(copiedLevel) && toNumber(entry?.level, NaN) !== copiedLevel) return false;
      if (copiedSource && normalizeSourceTag(entry?.source) !== copiedSource) return false;
      return true;
    });
    return copiedEntry ?? match;
  }

  function getRuleDescriptionLines(entry) {
    return collectSpellEntryLines(entry?.entries ?? [], 0, { includeTables: false }).filter(Boolean);
  }

  function getRuleDescriptionLinesForParsing(entry) {
    return collectSpellEntryLines(entry?.entries ?? [], 0, { includeTables: true }).filter(Boolean);
  }

  return {
    getUnlockedFeatures,
    getFeatSlotsForClass,
    getFeatSlotsForEntity,
    getFeatSlotsForSubclass,
    getFeatSlots,
    normalizeOptionalFeatureTypeList,
    getProgressionCountAtLevel,
    getOptionalFeatureSlotsForClass,
    getOptionalFeatureSlotsForSubclass,
    getOptionalFeatureSlots,
    getClassTableEffects,
    extractFeatureModeDescriptors,
    recomputeCharacterProgression,
    resolveFeatureEntryFromCatalogs,
    getRuleDescriptionLines,
    getRuleDescriptionLinesForParsing,
  };
}

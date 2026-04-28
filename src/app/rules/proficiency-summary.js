import { getActiveInventoryCatalogItems } from "../catalog/inventory-item-rules.js";

export function createProficiencySummaryRules({
  toNumber,
  cleanSpellInlineTags,
  normalizeSourceTag,
  buildEntityId,
  catalogLookupDomain,
  proficiencyRules,
  inventoryWeapons,
  resolveFeatureEntryFromCatalogs,
}) {
  const STANDARD_LANGUAGE_OPTIONS = [
    "Common",
    "Dwarvish",
    "Elvish",
    "Giant",
    "Gnomish",
    "Goblin",
    "Halfling",
    "Orc",
  ];
  const EXOTIC_LANGUAGE_OPTIONS = [
    "Abyssal",
    "Celestial",
    "Deep Speech",
    "Draconic",
    "Druidic",
    "Infernal",
    "Primordial",
    "Sylvan",
    "Undercommon",
    "Thieves' Cant",
  ];
  const ALL_LANGUAGE_OPTIONS = [...STANDARD_LANGUAGE_OPTIONS, ...EXOTIC_LANGUAGE_OPTIONS];
  const CHOICE_LANGUAGE_OPTIONS = ALL_LANGUAGE_OPTIONS.filter(
    (language) => proficiencyRules.normalizeChoiceToken(language) !== "common"
  );
  function formatSourceSummaryLabel(value) {
    const token = String(value ?? "").trim();
    if (!token) return "";
    return cleanSpellInlineTags(token)
      .toLowerCase()
      .replace(/(^|[\s(/-])([a-z])/g, (match, prefix, letter) => `${prefix}${letter.toUpperCase()}`)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeSummaryLabel(value) {
    return formatSourceSummaryLabel(value).toLowerCase();
  }

  function createSummaryCollector() {
    const byLabel = new Map();
    const add = (label, source = "") => {
      const normalized = normalizeSummaryLabel(label);
      if (!normalized) return;
      if (!byLabel.has(normalized)) byLabel.set(normalized, { label: formatSourceSummaryLabel(label), sourceSet: new Set() });
      if (source) byLabel.get(normalized).sourceSet.add(formatSourceSummaryLabel(source));
    };
    const list = () =>
      [...byLabel.values()]
        .map((entry) => ({
          label: entry.label,
          sources: [...entry.sourceSet].filter(Boolean).sort((a, b) => a.localeCompare(b)),
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    return { add, list };
  }

  function formatToolCategoryLabel(key, count = 1) {
    const normalized = normalizeToolCategoryKey(key);
    const total = Math.max(1, toNumber(count, 1));
    if (normalized === "any") return total > 1 ? `Any tools (${total})` : "Any tool";
    if (normalized === "anytool") return total > 1 ? `Any tools (${total})` : "Any tool";
    if (normalized === "anyartisantool") return total > 1 ? `Any artisan's tools (${total})` : "Any artisan's tool";
    if (normalized === "anymusicalinstrument") return total > 1 ? `Any musical instruments (${total})` : "Any musical instrument";
    if (normalized === "anygamingset") return total > 1 ? `Any gaming sets (${total})` : "Any gaming set";
    const cleaned = formatSourceSummaryLabel(key);
    if (!cleaned) return "";
    return total > 1 ? `${cleaned} (${total})` : cleaned;
  }

  function normalizeToolTypeCode(value) {
    return String(value ?? "")
      .split("|")[0]
      .trim()
      .toUpperCase();
  }

  function normalizeToolCategoryKey(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    const compact = raw.replace(/['’]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (compact === "any") return "any";
    if (compact === "anytool") return "anytool";
    if (compact === "anyartisantool" || compact === "anyartisanstool") return "anyartisantool";
    if (compact === "anymusicalinstrument") return "anymusicalinstrument";
    if (compact === "anygamingset") return "anygamingset";
    const words = raw
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/['’]/g, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map((word) => (word.endsWith("s") && word.length > 3 ? word.slice(0, -1) : word));
    if (!words.length) return "";
    if (words.length === 1 && words[0] === "any") return "any";
    if (!words.includes("any")) return words.join("");
    if (words.includes("artisan") && words.includes("tool")) return "anyartisantool";
    if (words.includes("musical") && words.includes("instrument")) return "anymusicalinstrument";
    if (words.includes("gaming") && words.includes("set")) return "anygamingset";
    if (words.includes("tool")) return "anytool";
    return words.join("");
  }

  function isMundaneToolCatalogItem(entry) {
    if (!catalogLookupDomain.isRecordObject(entry)) return false;
    const rarity = String(entry?.rarity ?? "").trim().toLowerCase();
    const hasAttunement = String(entry?.reqAttune ?? "").trim().length > 0;
    const isMundaneRarity = !rarity || rarity === "none" || rarity === "unknown";
    return isMundaneRarity && !hasAttunement;
  }

  function getToolPoolsFromCatalogs(catalogs) {
    const items = Array.isArray(catalogs?.items) ? catalogs.items : [];
    const normalizeToolName = (value) => formatSourceSummaryLabel(value).toLowerCase();
    const dedupeByName = (list) =>
      list.filter((entry, index, arr) => arr.findIndex((other) => normalizeToolName(other) === normalizeToolName(entry)) === index);
    const allTools = dedupeByName(
      items
        .filter((entry) => ["AT", "INS", "GS", "T"].includes(normalizeToolTypeCode(entry?.type ?? entry?.itemType)))
        .filter((entry) => isMundaneToolCatalogItem(entry))
        .map((entry) => formatSourceSummaryLabel(entry?.name))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    );
    const artisansTools = dedupeByName(
      items
        .filter((entry) => normalizeToolTypeCode(entry?.type ?? entry?.itemType) === "AT")
        .filter((entry) => isMundaneToolCatalogItem(entry))
        .map((entry) => formatSourceSummaryLabel(entry?.name))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    );
    const musicalInstruments = dedupeByName(
      items
        .filter((entry) => normalizeToolTypeCode(entry?.type ?? entry?.itemType) === "INS")
        .filter((entry) => isMundaneToolCatalogItem(entry))
        .map((entry) => formatSourceSummaryLabel(entry?.name))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    );
    const gamingSets = dedupeByName(
      items
        .filter((entry) => normalizeToolTypeCode(entry?.type ?? entry?.itemType) === "GS")
        .filter((entry) => isMundaneToolCatalogItem(entry))
        .map((entry) => formatSourceSummaryLabel(entry?.name))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
    );
    return { allTools, artisansTools, musicalInstruments, gamingSets };
  }

  function getToolPoolForCategory(categoryKey, pools) {
    const normalized = normalizeToolCategoryKey(categoryKey);
    if (normalized === "any" || normalized === "anytool") return pools.allTools;
    if (normalized === "anyartisantool") return pools.artisansTools;
    if (normalized === "anymusicalinstrument") return pools.musicalInstruments;
    if (normalized === "anygamingset") return pools.gamingSets;
    return [];
  }

  function addToolProficienciesFromStructuredSpec(collector, spec, sourceLabel = "", options = {}) {
    if (!Array.isArray(spec)) return;
    const sourceKey = String(options?.sourceKey ?? "").trim();
    const play = options?.play;
    const pools = options?.pools ?? getToolPoolsFromCatalogs(options?.catalogs);
    spec.forEach((entry, optionIndex) => {
      if (typeof entry === "string") {
        const label = formatSourceSummaryLabel(entry);
        if (label) collector.add(label, sourceLabel);
        return;
      }
      if (!catalogLookupDomain.isRecordObject(entry)) return;
      Object.entries(entry).forEach(([key, value]) => {
        if (key === "choose" && catalogLookupDomain.isRecordObject(value)) {
          const from = (Array.isArray(value.from) ? value.from : [])
            .map((item) => formatSourceSummaryLabel(item))
            .filter(Boolean);
          const count = Math.max(1, toNumber(value.count, 1));
          if (sourceKey && from.length) {
            const choiceId = `t:${optionIndex}:choose`;
            const selected = proficiencyRules.getStoredAutoChoiceSelectedValues(play, sourceKey, choiceId, from, count, {
              allowDuplicates: false,
              preserveStoredOrder: false,
            });
            if (selected.length) {
              selected.forEach((selectedTool) => collector.add(selectedTool, sourceLabel));
              return;
            }
          }
          if (from.length) collector.add(`Choose ${count} tool${count > 1 ? "s" : ""}`, sourceLabel);
          return;
        }
        if (value === true) {
          collector.add(formatToolCategoryLabel(key, 1), sourceLabel);
          return;
        }
        if (Number.isFinite(toNumber(value, Number.NaN)) && toNumber(value, 0) > 0) {
          const count = Math.max(1, toNumber(value, 1));
          const pool = getToolPoolForCategory(key, pools);
          if (sourceKey && pool.length) {
            const choiceId = `t:${optionIndex}:${String(key ?? "").trim().toLowerCase()}`;
            const selected = proficiencyRules.getStoredAutoChoiceSelectedValues(play, sourceKey, choiceId, pool, count, {
              allowDuplicates: false,
              preserveStoredOrder: false,
            });
            if (selected.length) {
              selected.forEach((selectedTool) => collector.add(selectedTool, sourceLabel));
              return;
            }
          }
          collector.add(formatToolCategoryLabel(key, count), sourceLabel);
        }
      });
    });
  }

  function formatDefenseTypeLabel(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized) return "";
    const words = normalized.split(/[^a-z0-9]+/).filter(Boolean);
    if (!words.length) return "";
    return words
      .map((word) => (word.length <= 2 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)))
      .join(" ");
  }

  function addDefenseEntries(collector, entries, sourceLabel = "", options = {}) {
    const singular = String(options?.singular ?? "type").trim();
    const sourceKey = String(options?.sourceKey ?? "").trim();
    const play = catalogLookupDomain.isRecordObject(options?.play) ? options.play : null;
    const entryKey = String(options?.entryKey ?? "").trim();
    if (!Array.isArray(entries)) return;
    entries.forEach((entry, optionIndex) => {
      if (typeof entry === "string") {
        const label = formatDefenseTypeLabel(entry);
        if (label) collector.add(label, sourceLabel);
        return;
      }
      if (!catalogLookupDomain.isRecordObject(entry)) return;
      const choose = catalogLookupDomain.isRecordObject(entry.choose) ? entry.choose : null;
      if (!choose) return;
      const from = (Array.isArray(choose.from) ? choose.from : [])
        .map((item) => formatDefenseTypeLabel(item))
        .filter(Boolean);
      const count = Math.max(1, toNumber(choose.count, 1));
      if (!from.length) return;
      if (sourceKey && play && entryKey) {
        const choiceId = `d:${entryKey}:${optionIndex}:choose`;
        const selected = proficiencyRules.getStoredAutoChoiceSelectedValues(play, sourceKey, choiceId, from, count, {
          allowDuplicates: false,
          preserveStoredOrder: false,
        });
        if (selected.length) {
          selected.forEach((selectedType) => collector.add(selectedType, sourceLabel));
          return;
        }
      }
      collector.add(`Choose ${count} ${singular}${count > 1 ? "s" : ""}: ${from.join(", ")}`, sourceLabel);
    });
  }

  function addSimpleProficienciesFromStructuredSpec(collector, spec, sourceLabel = "", options = {}) {
    if (!Array.isArray(spec)) return;
    const sourceKey = String(options?.sourceKey ?? "").trim();
    const play = catalogLookupDomain.isRecordObject(options?.play) ? options.play : null;
    const fallbackLabel = String(options?.fallbackLabel ?? "proficiency").trim();
    const fallbackPluralLabel = String(options?.fallbackPluralLabel ?? `${fallbackLabel}s`).trim();
    spec.forEach((entry, optionIndex) => {
      if (typeof entry === "string") {
        const label = formatSourceSummaryLabel(entry);
        if (label) collector.add(label, sourceLabel);
        return;
      }
      if (!catalogLookupDomain.isRecordObject(entry)) return;
      Object.entries(entry).forEach(([key, value]) => {
        if (key === "choose" && catalogLookupDomain.isRecordObject(value)) {
          const from = (Array.isArray(value.from) ? value.from : [])
            .map((item) => formatSourceSummaryLabel(item))
            .filter(Boolean);
          const count = Math.max(1, toNumber(value.count, 1));
          if (sourceKey && play && from.length) {
            const choiceId = `${String(options?.choicePrefix ?? "p")}:${optionIndex}:choose`;
            const selected = proficiencyRules.getStoredAutoChoiceSelectedValues(play, sourceKey, choiceId, from, count, {
              allowDuplicates: false,
              preserveStoredOrder: true,
            });
            if (selected.length) {
              selected.forEach((selectedEntry) => collector.add(selectedEntry, sourceLabel));
              return;
            }
          }
          collector.add(`Choose ${count} ${count > 1 ? fallbackPluralLabel : fallbackLabel}`, sourceLabel);
          return;
        }
        if (value === true) {
          collector.add(formatSourceSummaryLabel(key), sourceLabel);
          return;
        }
        const count = Math.max(0, toNumber(value, 0));
        if (count > 0) {
          const normalizedKey = proficiencyRules.normalizeChoiceToken(key);
          const isLanguageSummary = fallbackLabel.toLowerCase() === "language";
          if (isLanguageSummary && sourceKey && play) {
            let choicePool = [];
            if (normalizedKey === "any" || normalizedKey === "anylanguage" || normalizedKey === "other") {
              choicePool = CHOICE_LANGUAGE_OPTIONS;
            }
            else if (
              normalizedKey === "anystandard" ||
              normalizedKey === "anystandardlanguage" ||
              normalizedKey === "anyexotic" ||
              normalizedKey === "anyexoticlanguage"
            ) {
              choicePool = CHOICE_LANGUAGE_OPTIONS;
            }
            if (choicePool.length) {
              const choiceId = `${String(options?.choicePrefix ?? "p")}:${optionIndex}:${normalizedKey}`;
              const selected = proficiencyRules.getStoredAutoChoiceSelectedValues(play, sourceKey, choiceId, choicePool, count, {
                allowDuplicates: false,
                preserveStoredOrder: true,
              });
              if (selected.length) {
                selected.forEach((selectedEntry) => collector.add(selectedEntry, sourceLabel));
                return;
              }
              collector.add(`Choose ${count} ${count > 1 ? fallbackPluralLabel : fallbackLabel}`, sourceLabel);
              return;
            }
          }
          if (normalizedKey === "any" || normalizedKey === "anylanguage" || normalizedKey === "other") {
            collector.add(`Any ${fallbackLabel}${count > 1 ? ` (${count})` : ""}`, sourceLabel);
          }
          else collector.add(`${formatSourceSummaryLabel(key)}${count > 1 ? ` (${count})` : ""}`, sourceLabel);
        }
      });
    });
  }

  function addSkillToolLanguageEntries(toolCollector, languageCollector, spec, sourceLabel = "", options = {}) {
    if (!Array.isArray(spec)) return;
    const sourceKey = String(options?.sourceKey ?? "").trim();
    const play = catalogLookupDomain.isRecordObject(options?.play) ? options.play : null;
    const toolPools = options?.pools ?? getToolPoolsFromCatalogs(options?.catalogs);
    const normalizeToolToken = (value) => normalizeSummaryLabel(value).replace(/\s+/g, "");
    spec.forEach((entry, optionIndex) => {
      if (!catalogLookupDomain.isRecordObject(entry)) return;
      const chooseList = Array.isArray(entry?.choose) ? entry.choose : [entry?.choose];
      chooseList.forEach((choose, chooseIndex) => {
        if (!catalogLookupDomain.isRecordObject(choose)) return;
        const from = Array.isArray(choose?.from) ? choose.from.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
        const count = Math.max(1, toNumber(choose?.count, 1));
        const selectionMap = sourceKey && play ? proficiencyRules.getAutoChoiceSelectionMap(play, sourceKey) : {};
        const choiceId = `stl:${optionIndex}:choose:${chooseIndex}`;
        const selectedRaw = Array.isArray(selectionMap?.[choiceId]) ? selectionMap[choiceId] : [];
        const selected = selectedRaw.map((item) => String(item ?? "").trim()).filter(Boolean);
        if (selected.length) {
          selected.forEach((value) => {
            const raw = String(value ?? "").trim();
            if (!raw) return;
            if (raw.startsWith("tool:")) {
              toolCollector.add(raw.slice(5), sourceLabel);
              return;
            }
            if (raw.startsWith("language:")) {
              const languageValue = raw.slice(9);
              if (!languageValue || proficiencyRules.normalizeChoiceToken(languageValue) === "any") {
                languageCollector.add("Any language", sourceLabel);
              }
              else languageCollector.add(languageValue, sourceLabel);
              return;
            }
            if (raw.startsWith("skill:")) return;
            const normalizedRaw = normalizeToolToken(raw);
            const toolMatch = toolPools.allTools.find((toolName) => normalizeToolToken(toolName) === normalizedRaw);
            if (toolMatch) {
              toolCollector.add(toolMatch, sourceLabel);
              return;
            }
            languageCollector.add(raw, sourceLabel);
          });
          return;
        }
        const hasAnyTool = from.some((value) => proficiencyRules.normalizeChoiceToken(value) === "anytool");
        const hasAnyLanguage = from.some((value) => proficiencyRules.normalizeChoiceToken(value) === "anylanguage");
        if (hasAnyTool && hasAnyLanguage) {
          toolCollector.add(`Choose ${count} skills/tools/languages`, sourceLabel);
          return;
        }
        if (hasAnyTool) {
          toolCollector.add(`Choose ${count} skill/tool proficiency${count > 1 ? "ies" : "y"}`, sourceLabel);
          return;
        }
        if (hasAnyLanguage) {
          languageCollector.add(`Choose ${count} language${count > 1 ? "s" : ""}`, sourceLabel);
        }
      });
    });
  }

  function addSenseEntries(collector, entries, sourceLabel = "") {
    if (entries == null) return;
    const payloads = Array.isArray(entries)
      ? entries.filter((entry) => catalogLookupDomain.isRecordObject(entry))
      : catalogLookupDomain.isRecordObject(entries)
        ? [entries]
        : [];
    payloads.forEach((entry) => {
      Object.entries(entry).forEach(([key, value]) => {
        const amount = Math.max(0, toNumber(value, 0));
        const label = formatSourceSummaryLabel(key);
        if (!label) return;
        if (amount > 0) collector.add(`${label} ${amount} ft`, sourceLabel);
      });
    });
  }

  function addCharacterLanguages(languageCollector, character, sourceLabel = "Additional") {
    const languages = Array.isArray(character?.languages) ? character.languages : [];
    languages.forEach((entry) => {
      const label = formatSourceSummaryLabel(entry);
      if (label) languageCollector.add(label, sourceLabel);
    });
  }

  function collectEntryTextLines(entry, out = []) {
    if (entry == null) return out;
    if (typeof entry === "string") {
      const line = cleanSpellInlineTags(entry).trim();
      if (line) out.push(line);
      return out;
    }
    if (Array.isArray(entry)) {
      entry.forEach((value) => collectEntryTextLines(value, out));
      return out;
    }
    if (!catalogLookupDomain.isRecordObject(entry)) return out;
    collectEntryTextLines(entry.entry, out);
    collectEntryTextLines(entry.text, out);
    collectEntryTextLines(entry.entries, out);
    collectEntryTextLines(entry.items, out);
    return out;
  }

  function parseLanguageChoiceCountToken(token) {
    const normalized = String(token ?? "").trim().toLowerCase();
    if (normalized === "a" || normalized === "an" || normalized === "one") return 1;
    if (normalized === "two") return 2;
    if (normalized === "three") return 3;
    if (normalized === "four") return 4;
    if (normalized === "five") return 5;
    return Math.max(0, toNumber(normalized, 0));
  }

  function addSet2024BaselineLanguages(languageCollector, character) {
    if (String(character?.sourcePreset ?? "").trim() !== "set2024") return;
    languageCollector.add("Common", "Rules");
    if (String(character?.class ?? "").trim().toLowerCase() === "rogue") return;
    const sourceKey = "rules:2024";
    const choiceId = "core2024:language:standard:0";
    const standardPool = CHOICE_LANGUAGE_OPTIONS;
    const selected = proficiencyRules.getStoredAutoChoiceSelectedValues(character?.play, sourceKey, choiceId, standardPool, 2, {
      allowDuplicates: false,
      preserveStoredOrder: true,
    });
    if (selected.length) {
      selected.forEach((language) => languageCollector.add(language, "Rules"));
    } else languageCollector.add("Choose 2 languages", "Rules");
  }

  function addSet2024RogueLanguages(languageCollector, character) {
    if (String(character?.sourcePreset ?? "").trim() !== "set2024") return;
    if (String(character?.class ?? "").trim().toLowerCase() !== "rogue") return;
    languageCollector.add("Thieves' Cant", "Class Feature");
    const sourceKey = "rules:2024:rogue";
    const choiceId = "rogue2024:language:other:0";
    const pool = CHOICE_LANGUAGE_OPTIONS.filter((language) => proficiencyRules.normalizeChoiceToken(language) !== "thievescant");
    const selected = proficiencyRules.getStoredAutoChoiceSelectedValues(character?.play, sourceKey, choiceId, pool, 1, {
      allowDuplicates: false,
      preserveStoredOrder: true,
    });
    if (selected.length) {
      selected.forEach((language) => languageCollector.add(language, "Class Feature"));
    } else languageCollector.add("Choose 1 language", "Class Feature");
  }

  function addLanguagesFromEntryText(languageCollector, entry, sourceLabel = "", options = {}) {
    const lines = collectEntryTextLines(entry?.entries ?? []);
    if (!lines.length) return;
    const sourceKey = String(options?.sourceKey ?? "").trim();
    const play = catalogLookupDomain.isRecordObject(options?.play) ? options.play : null;
    let choiceIndex = 0;
    const knownLanguages = [...new Set(ALL_LANGUAGE_OPTIONS.map((value) => formatSourceSummaryLabel(value)).filter(Boolean))];
    lines.forEach((line) => {
      const normalizedLine = String(line ?? "").replace(/\s+/g, " ").trim();
      if (!/(you can speak,\s*read,\s*and\s*write|you know)/i.test(normalizedLine)) return;
      const sentence = normalizedLine.split(/[.?!]/)[0].trim();
      if (!sentence) return;
      const explicitLanguages = knownLanguages.filter((language) => {
        const escaped = language.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`\\b${escaped}\\b`, "i").test(sentence);
      });
      const choices = [...sentence.matchAll(/\b(one|two|three|four|five|\d+)\s+other\s+languages?\s+of\s+your\s+choice\b/gi)];
      choices.forEach((match) => {
        const count = parseLanguageChoiceCountToken(match?.[1]);
        const sentenceHasThievesCant = /\bthieves'? cant\b/i.test(sentence);
        const choicePool = CHOICE_LANGUAGE_OPTIONS.filter(
          (language) => {
            const token = proficiencyRules.normalizeChoiceToken(language);
            if (sentenceHasThievesCant && token === "thievescant") return false;
            return !explicitLanguages.some((fixed) => proficiencyRules.normalizeChoiceToken(fixed) === token);
          }
        );
        if (count > 0 && sourceKey && play) {
          const selected = proficiencyRules.getStoredAutoChoiceSelectedValues(play, sourceKey, `lt:${choiceIndex}:other`, choicePool, count, {
            allowDuplicates: false,
            preserveStoredOrder: true,
          });
          if (selected.length) selected.forEach((language) => languageCollector.add(language, sourceLabel));
          else languageCollector.add(`Choose ${count} language${count > 1 ? "s" : ""}`, sourceLabel);
        } else if (count > 0) {
          languageCollector.add(`Choose ${count} language${count > 1 ? "s" : ""}`, sourceLabel);
        }
        choiceIndex += 1;
      });
      explicitLanguages.forEach((language) => languageCollector.add(language, sourceLabel));
    });
  }

  function addUnlockedFeatureLanguages(languageCollector, catalogs, character) {
    const unlockedFeatures = Array.isArray(character?.progression?.unlockedFeatures) ? character.progression.unlockedFeatures : [];
    if (typeof resolveFeatureEntryFromCatalogs !== "function" || !unlockedFeatures.length) return;
    unlockedFeatures.forEach((feature, featureIndex) => {
      const detail = resolveFeatureEntryFromCatalogs(catalogs, feature);
      if (!catalogLookupDomain.isRecordObject(detail)) return;
      const entryData = catalogLookupDomain.isRecordObject(detail?.entryData) ? detail.entryData : {};
      const sourceKey = `feature:${String(feature?.id ?? "").trim() || String(buildEntityId?.([
        "feature",
        feature?.name,
        feature?.className,
        feature?.subclassName,
        feature?.source,
        feature?.level,
        featureIndex,
      ]) ?? "").trim() || `feature-${featureIndex}`}`;
      addSimpleProficienciesFromStructuredSpec(
        languageCollector,
        Array.isArray(detail?.languageProficiencies) ? detail.languageProficiencies : entryData?.languageProficiencies,
        "Class Feature",
        {
          sourceKey,
          play: character?.play,
          fallbackLabel: "language",
          choicePrefix: "l",
        }
      );
      const directLanguages = Array.isArray(detail?.languages) ? detail.languages : Array.isArray(entryData?.languages) ? entryData.languages : [];
      directLanguages.forEach((language) => languageCollector.add(language, "Class Feature"));
      const isRogue2024ThievesCantFeature =
        String(character?.sourcePreset ?? "").trim() === "set2024"
        && String(character?.class ?? "").trim().toLowerCase() === "rogue"
        && String(detail?.name ?? "").trim().toLowerCase() === "thieves' cant";
      if (!isRogue2024ThievesCantFeature) {
        addLanguagesFromEntryText(languageCollector, detail, "Class Feature", { sourceKey, play: character?.play });
      }
    });
  }

  function getCharacterToolAndDefenseSummary(catalogs, character) {
    const sourceOrder = catalogLookupDomain.getPreferredSourceOrder(character);
    const raceEntry = catalogLookupDomain.getEffectiveRaceEntry(catalogs, character, sourceOrder);
    const backgroundEntry = catalogLookupDomain.findCatalogEntryByNameWithSelectedSourcePreference(
      catalogs?.backgrounds,
      character?.background,
      character?.backgroundSource,
      sourceOrder
    );
    const classEntry = catalogLookupDomain.getClassCatalogEntry(catalogs, character?.class, character?.classSource, sourceOrder);
    const toolCollector = createSummaryCollector();
    const resistanceCollector = createSummaryCollector();
    const immunityCollector = createSummaryCollector();
    const conditionImmunityCollector = createSummaryCollector();
    const vulnerabilityCollector = createSummaryCollector();
    const weaponCollector = createSummaryCollector();
    const armorCollector = createSummaryCollector();
    const languageCollector = createSummaryCollector();
    const senseCollector = createSummaryCollector();
    const toolPools = getToolPoolsFromCatalogs(catalogs);
    const attackWeaponTokens = typeof inventoryWeapons?.getCharacterWeaponProficiencyTokens === "function"
      ? inventoryWeapons.getCharacterWeaponProficiencyTokens(catalogs, character)
      : new Set();

    if (attackWeaponTokens instanceof Set) {
      attackWeaponTokens.forEach((token) => {
        weaponCollector.add(token, "Attack Rules");
      });
    }

    addToolProficienciesFromStructuredSpec(toolCollector, raceEntry?.toolProficiencies, "Race", {
      sourceKey: "race",
      play: character?.play,
      pools: toolPools,
    });
    addSimpleProficienciesFromStructuredSpec(languageCollector, raceEntry?.languageProficiencies, "Race", {
      sourceKey: "race",
      play: character?.play,
      fallbackLabel: "language",
      choicePrefix: "l",
    });
    addLanguagesFromEntryText(languageCollector, raceEntry, "Race", { sourceKey: "race", play: character?.play });
    if (Array.isArray(raceEntry?.languages)) {
      raceEntry.languages.forEach((language) => languageCollector.add(language, "Race"));
    }
    addSet2024BaselineLanguages(languageCollector, character);
    addSet2024RogueLanguages(languageCollector, character);
    addToolProficienciesFromStructuredSpec(toolCollector, backgroundEntry?.toolProficiencies, "Background", {
      sourceKey: "background",
      play: character?.play,
      pools: toolPools,
    });
    addSimpleProficienciesFromStructuredSpec(languageCollector, backgroundEntry?.languageProficiencies, "Background", {
      sourceKey: "background",
      play: character?.play,
      fallbackLabel: "language",
      choicePrefix: "l",
    });
    addLanguagesFromEntryText(languageCollector, backgroundEntry, "Background", { sourceKey: "background", play: character?.play });
    if (Array.isArray(backgroundEntry?.languages)) {
      backgroundEntry.languages.forEach((language) => languageCollector.add(language, "Background"));
    }
    const classSourceKey = `class:${String(classEntry?.name ?? character?.class ?? "").trim().toLowerCase() || "primary"}`;
    addToolProficienciesFromStructuredSpec(toolCollector, classEntry?.startingProficiencies?.toolProficiencies, "Class", {
      sourceKey: classSourceKey,
      play: character?.play,
      pools: toolPools,
    });
    const classHasStructuredTools = Array.isArray(classEntry?.startingProficiencies?.toolProficiencies)
      && classEntry.startingProficiencies.toolProficiencies.length > 0;
    if (!classHasStructuredTools && Array.isArray(classEntry?.startingProficiencies?.tools)) {
      classEntry.startingProficiencies.tools.forEach((tool) => toolCollector.add(tool, "Class"));
    }
    addSimpleProficienciesFromStructuredSpec(
      languageCollector,
      classEntry?.startingProficiencies?.languageProficiencies,
      "Class",
      {
        sourceKey: classSourceKey,
        play: character?.play,
        fallbackLabel: "language",
        choicePrefix: "l",
      }
    );
    addLanguagesFromEntryText(languageCollector, classEntry, "Class", { sourceKey: classSourceKey, play: character?.play });
    if (Array.isArray(classEntry?.startingProficiencies?.languages)) {
      classEntry.startingProficiencies.languages.forEach((language) => languageCollector.add(language, "Class"));
    }
    const normalizedClassName = String(classEntry?.name ?? character?.class ?? "").trim().toLowerCase();
    if (normalizedClassName === "rogue") {
      languageCollector.add("Thieves' Cant", "Class Feature");
    }

    const multiclassEntries = Array.isArray(character?.multiclass) ? character.multiclass : [];
    multiclassEntries.forEach((entry) => {
      const className = String(entry?.class ?? "").trim();
      if (!className) return;
      const classCatalogEntry = catalogLookupDomain.getClassCatalogEntry(catalogs, className, "", sourceOrder);
      const tools = classCatalogEntry?.multiclassing?.proficienciesGained?.tools;
      const multiclassHasStructuredTools = Array.isArray(classCatalogEntry?.multiclassing?.proficienciesGained?.toolProficiencies)
        && classCatalogEntry.multiclassing.proficienciesGained.toolProficiencies.length > 0;
      if (!multiclassHasStructuredTools && Array.isArray(tools)) {
        tools.forEach((tool) => toolCollector.add(tool, "Multiclass"));
      }
      const multiclassSourceKey = `multiclass:${className.toLowerCase() || "class"}`;
      addToolProficienciesFromStructuredSpec(
        toolCollector,
        classCatalogEntry?.multiclassing?.proficienciesGained?.toolProficiencies,
        "Multiclass",
        {
          sourceKey: multiclassSourceKey,
          play: character?.play,
          pools: toolPools,
        }
      );
      addSimpleProficienciesFromStructuredSpec(
        languageCollector,
        classCatalogEntry?.multiclassing?.proficienciesGained?.languageProficiencies,
        "Multiclass",
        {
          sourceKey: multiclassSourceKey,
          play: character?.play,
          fallbackLabel: "language",
          choicePrefix: "l",
        }
      );
      addLanguagesFromEntryText(
        languageCollector,
        classCatalogEntry?.multiclassing?.proficienciesGained,
        "Multiclass",
        { sourceKey: multiclassSourceKey, play: character?.play }
      );
      if (Array.isArray(classCatalogEntry?.multiclassing?.proficienciesGained?.languages)) {
        classCatalogEntry.multiclassing.proficienciesGained.languages.forEach((language) =>
          languageCollector.add(language, "Multiclass")
        );
      }
    });

    const feats = Array.isArray(character?.feats) ? character.feats : [];
    feats.forEach((feat) => {
      const featEntry = catalogLookupDomain.findCatalogEntryByNameWithSelectedSourcePreference(catalogs?.feats, feat?.name, feat?.source, sourceOrder);
      if (!featEntry) return;
      const featSourceKey = `feat:${String(feat?.id ?? featEntry?.name ?? "").trim() || String(featEntry?.name ?? "").trim()}`;
      addToolProficienciesFromStructuredSpec(toolCollector, featEntry?.toolProficiencies, "Feat", {
        sourceKey: featSourceKey,
        play: character?.play,
        pools: toolPools,
      });
      addSimpleProficienciesFromStructuredSpec(weaponCollector, featEntry?.weaponProficiencies, "Feat", {
        sourceKey: featSourceKey,
        play: character?.play,
        fallbackLabel: "weapon proficiency",
        fallbackPluralLabel: "weapon proficiencies",
        choicePrefix: "w",
      });
      addSimpleProficienciesFromStructuredSpec(armorCollector, featEntry?.armorProficiencies, "Feat", {
        sourceKey: featSourceKey,
        play: character?.play,
        fallbackLabel: "armor proficiency",
        fallbackPluralLabel: "armor proficiencies",
        choicePrefix: "a",
      });
      addSimpleProficienciesFromStructuredSpec(languageCollector, featEntry?.languageProficiencies, "Feat", {
        sourceKey: featSourceKey,
        play: character?.play,
        fallbackLabel: "language",
        choicePrefix: "l",
      });
      addSkillToolLanguageEntries(toolCollector, languageCollector, featEntry?.skillToolLanguageProficiencies, "Feat", {
        sourceKey: featSourceKey,
        play: character?.play,
        pools: toolPools,
      });
      addSenseEntries(senseCollector, featEntry?.senses, "Feat");
      addSenseEntries(senseCollector, featEntry?.bonusSenses, "Feat");
      addDefenseEntries(resistanceCollector, featEntry?.resist, "Feat", { singular: "resistance" });
      addDefenseEntries(immunityCollector, featEntry?.immune, "Feat", { singular: "immunity" });
      addDefenseEntries(conditionImmunityCollector, featEntry?.conditionImmune, "Feat", { singular: "condition immunity" });
      addDefenseEntries(vulnerabilityCollector, featEntry?.vulnerable, "Feat", { singular: "vulnerability" });
    });

    const optionalFeatures = Array.isArray(character?.optionalFeatures) ? character.optionalFeatures : [];
    optionalFeatures.forEach((feature) => {
      const entry = catalogLookupDomain.findCatalogEntryByNameWithSelectedSourcePreference(
        catalogs?.optionalFeatures,
        feature?.name,
        feature?.source,
        sourceOrder
      );
      if (!entry) return;
      const sourceKey = `optionalfeature:${String(feature?.id ?? entry?.name ?? "").trim() || String(entry?.name ?? "").trim()}`;
      addToolProficienciesFromStructuredSpec(toolCollector, entry?.toolProficiencies, "Optional Feature", {
        sourceKey,
        play: character?.play,
        pools: toolPools,
      });
      addSimpleProficienciesFromStructuredSpec(weaponCollector, entry?.weaponProficiencies, "Optional Feature", {
        sourceKey,
        play: character?.play,
        fallbackLabel: "weapon proficiency",
        fallbackPluralLabel: "weapon proficiencies",
        choicePrefix: "w",
      });
      addSimpleProficienciesFromStructuredSpec(armorCollector, entry?.armorProficiencies, "Optional Feature", {
        sourceKey,
        play: character?.play,
        fallbackLabel: "armor proficiency",
        fallbackPluralLabel: "armor proficiencies",
        choicePrefix: "a",
      });
      addSimpleProficienciesFromStructuredSpec(languageCollector, entry?.languageProficiencies, "Optional Feature", {
        sourceKey,
        play: character?.play,
        fallbackLabel: "language",
        choicePrefix: "l",
      });
      addSkillToolLanguageEntries(toolCollector, languageCollector, entry?.skillToolLanguageProficiencies, "Optional Feature", {
        sourceKey,
        play: character?.play,
        pools: toolPools,
      });
      addSenseEntries(senseCollector, entry?.senses, "Optional Feature");
      addSenseEntries(senseCollector, entry?.bonusSenses, "Optional Feature");
      addDefenseEntries(resistanceCollector, entry?.resist, "Optional Feature", { singular: "resistance" });
      addDefenseEntries(immunityCollector, entry?.immune, "Optional Feature", { singular: "immunity" });
      addDefenseEntries(conditionImmunityCollector, entry?.conditionImmune, "Optional Feature", { singular: "condition immunity" });
      addDefenseEntries(vulnerabilityCollector, entry?.vulnerable, "Optional Feature", { singular: "vulnerability" });
    });
    getActiveInventoryCatalogItems(catalogs, character).forEach(({ inventoryEntry, catalogItem }) => {
      const sourceLabel = String(inventoryEntry?.name ?? catalogItem?.name ?? "Item").trim() || "Item";
      const sourceKey = `item:${String(inventoryEntry?.id ?? "").trim() || sourceLabel.toLowerCase()}`;
      addToolProficienciesFromStructuredSpec(toolCollector, catalogItem?.toolProficiencies, sourceLabel, {
        sourceKey,
        play: character?.play,
        pools: toolPools,
      });
      addSimpleProficienciesFromStructuredSpec(weaponCollector, catalogItem?.weaponProficiencies, sourceLabel, {
        sourceKey,
        play: character?.play,
        fallbackLabel: "weapon proficiency",
        fallbackPluralLabel: "weapon proficiencies",
        choicePrefix: "w",
      });
      addSimpleProficienciesFromStructuredSpec(armorCollector, catalogItem?.armorProficiencies, sourceLabel, {
        sourceKey,
        play: character?.play,
        fallbackLabel: "armor proficiency",
        fallbackPluralLabel: "armor proficiencies",
        choicePrefix: "a",
      });
      addSimpleProficienciesFromStructuredSpec(languageCollector, catalogItem?.languageProficiencies, sourceLabel, {
        sourceKey,
        play: character?.play,
        fallbackLabel: "language",
        choicePrefix: "l",
      });
      addSkillToolLanguageEntries(toolCollector, languageCollector, catalogItem?.skillToolLanguageProficiencies, sourceLabel, {
        sourceKey,
        play: character?.play,
        pools: toolPools,
      });
      addSenseEntries(senseCollector, catalogItem?.senses, sourceLabel);
      addSenseEntries(senseCollector, catalogItem?.bonusSenses, sourceLabel);
      addDefenseEntries(resistanceCollector, catalogItem?.resist, sourceLabel, {
        singular: "resistance",
        sourceKey,
        play: character?.play,
        entryKey: "resist",
      });
      addDefenseEntries(immunityCollector, catalogItem?.immune, sourceLabel, {
        singular: "immunity",
        sourceKey,
        play: character?.play,
        entryKey: "immune",
      });
      addDefenseEntries(conditionImmunityCollector, catalogItem?.conditionImmune, sourceLabel, {
        singular: "condition immunity",
        sourceKey,
        play: character?.play,
        entryKey: "conditionImmune",
      });
      addDefenseEntries(vulnerabilityCollector, catalogItem?.vulnerable, sourceLabel, {
        singular: "vulnerability",
        sourceKey,
        play: character?.play,
        entryKey: "vulnerable",
      });
    });
    addUnlockedFeatureLanguages(languageCollector, catalogs, character);

    addDefenseEntries(resistanceCollector, raceEntry?.resist, "Race", {
      singular: "resistance",
      sourceKey: "race",
      play: character?.play,
      entryKey: "resist",
    });
    addDefenseEntries(immunityCollector, raceEntry?.immune, "Race", {
      singular: "immunity",
      sourceKey: "race",
      play: character?.play,
      entryKey: "immune",
    });
    addDefenseEntries(conditionImmunityCollector, raceEntry?.conditionImmune, "Race", {
      singular: "condition immunity",
      sourceKey: "race",
      play: character?.play,
      entryKey: "conditionImmune",
    });
    addDefenseEntries(vulnerabilityCollector, raceEntry?.vulnerable, "Race", {
      singular: "vulnerability",
      sourceKey: "race",
      play: character?.play,
      entryKey: "vulnerable",
    });
    addSenseEntries(senseCollector, raceEntry?.senses, "Race");
    addSenseEntries(senseCollector, raceEntry?.bonusSenses, "Race");
    addCharacterLanguages(languageCollector, character, "Additional");

    return {
      tools: toolCollector.list(),
      weapons: weaponCollector.list(),
      armor: armorCollector.list(),
      languages: languageCollector.list(),
      senses: senseCollector.list(),
      resistances: resistanceCollector.list(),
      immunities: immunityCollector.list(),
      conditionImmunities: conditionImmunityCollector.list(),
      vulnerabilities: vulnerabilityCollector.list(),
    };
  }

  return {
    getCharacterToolAndDefenseSummary,
  };
}

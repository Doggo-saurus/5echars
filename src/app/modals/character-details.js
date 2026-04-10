export function createCharacterDetailsModals({
  openModal,
  esc,
  toNumber,
  toTitleCase,
  buildEntityId,
  sourceLabels,
  normalizeSourceTag,
  parseClassFeatureToken,
  parseSubclassFeatureToken,
  getRuleDescriptionLines,
  renderTextWithInlineDiceButtons,
  rollVisualNotation,
  setDiceResult,
  recomputeCharacterProgression,
  getClassCatalogEntry,
  getSelectedSubclassEntry,
  resolveFeatureEntryFromCatalogs,
  getPreferredSourceOrder,
  getEffectiveRaceEntry,
}) {
  function findCatalogEntryByNameWithSelectedSourcePreference(entries, selectedName, selectedSource = "", preferredSources = []) {
    if (!Array.isArray(entries)) return null;
    const normalizedName = String(selectedName ?? "").trim().toLowerCase();
    if (!normalizedName) return null;
    const matches = entries.filter((entry) => String(entry?.name ?? "").trim().toLowerCase() === normalizedName);
    if (!matches.length) return null;
    if (matches.length === 1) return matches[0];
    const normalizedSelectedSource = normalizeSourceTag(selectedSource);
    if (normalizedSelectedSource) {
      const explicitMatch = matches.find((entry) => normalizeSourceTag(entry?.source) === normalizedSelectedSource);
      if (explicitMatch) return explicitMatch;
    }
    const sourceOrder = (Array.isArray(preferredSources) ? preferredSources : []).map((source) => normalizeSourceTag(source)).filter(Boolean);
    for (const source of sourceOrder) {
      const sourceMatch = matches.find((entry) => normalizeSourceTag(entry?.source) === source);
      if (sourceMatch) return sourceMatch;
    }
    return matches[0];
  }

  function bindInlineDiceRoll(close, label) {
    document.querySelectorAll("[data-spell-roll]").forEach((button) => {
      button.addEventListener("click", () => {
        const notation = button.dataset.spellRoll;
        if (!notation) return;
        close();
        rollVisualNotation(label, notation);
      });
    });
  }

  function linesToHtml(lines, emptyMessage) {
    return lines.length
      ? lines
          .map((line) => {
            const body = renderTextWithInlineDiceButtons(line);
            return `<p>${body}</p>`;
          })
          .join("")
      : `<p class='muted'>${emptyMessage}</p>`;
  }

  function openFeatureDetailsModal(state, featureId) {
    const unlockedFeatures = Array.isArray(state.character?.progression?.unlockedFeatures)
      ? state.character.progression.unlockedFeatures
      : [];
    const featureRef = String(featureId ?? "").trim();
    if (!featureRef) return;
    let feature = unlockedFeatures.find((it) => String(it?.id ?? "").trim() === featureRef);
    if (!feature && featureRef.startsWith("name:")) {
      const rawParts = featureRef.split("|");
      const tokenMap = new Map(
        rawParts.map((part) => {
          const [key, ...valueParts] = part.split(":");
          return [String(key ?? "").trim(), String(valueParts.join(":") ?? "").trim()];
        })
      );
      const nameToken = String(tokenMap.get("name") ?? "").trim().toLowerCase();
      const classToken = String(tokenMap.get("class") ?? "").trim().toLowerCase();
      const subclassToken = String(tokenMap.get("subclass") ?? "").trim().toLowerCase();
      const levelToken = toNumber(tokenMap.get("level"), NaN);
      feature = unlockedFeatures.find((entry) => {
        const entryName = String(entry?.name ?? "").trim().toLowerCase();
        if (!entryName || entryName !== nameToken) return false;
        if (classToken && String(entry?.className ?? "").trim().toLowerCase() !== classToken) return false;
        if (subclassToken && String(entry?.subclassName ?? "").trim().toLowerCase() !== subclassToken) return false;
        if (Number.isFinite(levelToken) && toNumber(entry?.level, NaN) !== levelToken) return false;
        return true;
      });
    }
    if (!feature) return;
    const detail = resolveFeatureEntryFromCatalogs(state.catalogs, feature);
    const lines = getRuleDescriptionLines(detail);
    const bodyHtml = linesToHtml(lines, "No description is available for this feature.");
    const metaRows = [
      { label: "Type", value: feature.type === "subclass" ? "Subclass Feature" : "Class Feature" },
      { label: "Class", value: feature.className || "" },
      { label: "Subclass", value: feature.subclassName || "" },
      { label: "Level", value: feature.level ? String(feature.level) : "" },
      { label: "Source", value: detail?.sourceLabel ?? detail?.source ?? feature.source ?? "" },
    ].filter((row) => row.value);
    const close = openModal({
      title: feature.name,
      bodyHtml: `
        <div class="spell-meta-grid">
          ${metaRows.map((row) => `<div><strong>${esc(row.label)}:</strong> ${esc(row.value)}</div>`).join("")}
        </div>
        <div class="spell-description">${bodyHtml}</div>
      `,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });
    bindInlineDiceRoll(close, feature.name);
  }

  function openFeatDetailsModal(state, featId) {
    const feat = (state.character?.feats ?? []).find((it) => it.id === featId);
    if (!feat) return;
    const detail = (state.catalogs?.feats ?? []).find((entry) => buildEntityId(["feat", entry?.name, entry?.source]) === featId) ?? null;
    const lines = getRuleDescriptionLines(detail);
    const bodyHtml = linesToHtml(lines, "No description is available for this feat.");
    const metaRows = [
      { label: "Source", value: detail?.sourceLabel ?? detail?.source ?? feat.source ?? "" },
      { label: "Granted At Level", value: feat.levelGranted ? String(feat.levelGranted) : "" },
      { label: "Via", value: feat.via || "" },
    ].filter((row) => row.value);
    const close = openModal({
      title: feat.name,
      bodyHtml: `
        <div class="spell-meta-grid">
          ${metaRows.map((row) => `<div><strong>${esc(row.label)}:</strong> ${esc(row.value)}</div>`).join("")}
        </div>
        <div class="spell-description">${bodyHtml}</div>
      `,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });
    bindInlineDiceRoll(close, feat.name);
  }

  function openOptionalFeatureDetailsModal(state, featureId) {
    const selectedFeature = (state.character?.optionalFeatures ?? []).find((it) => it.id === featureId);
    if (!selectedFeature) return;
    const detail =
      (state.catalogs?.optionalFeatures ?? []).find((entry) => buildEntityId(["optionalfeature", entry?.name, entry?.source]) === featureId)
      ?? null;
    const lines = getRuleDescriptionLines(detail);
    const bodyHtml = linesToHtml(lines, "No description is available for this optional feature.");
    const featureTypes = Array.isArray(detail?.featureType)
      ? detail.featureType.map((entry) => String(entry ?? "").trim()).filter(Boolean)
      : [String(detail?.featureType ?? selectedFeature?.featureType ?? "").trim()].filter(Boolean);
    const metaRows = [
      { label: "Source", value: detail?.sourceLabel ?? detail?.source ?? selectedFeature?.source ?? "" },
      { label: "Granted At Level", value: selectedFeature.levelGranted ? String(selectedFeature.levelGranted) : "" },
      { label: "Class", value: selectedFeature.className || "" },
      { label: "Type", value: selectedFeature.slotType || "" },
      { label: "Feature Type", value: featureTypes.join(", ") },
    ].filter((row) => row.value);
    const close = openModal({
      title: selectedFeature.name,
      bodyHtml: `
        <div class="spell-meta-grid">
          ${metaRows.map((row) => `<div><strong>${esc(row.label)}:</strong> ${esc(row.value)}</div>`).join("")}
        </div>
        <div class="spell-description">${bodyHtml}</div>
      `,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });
    bindInlineDiceRoll(close, selectedFeature.name);
  }

  function openSpeciesTraitDetailsModal(state, traitName) {
    const selectedTraitName = String(traitName ?? "").trim();
    if (!selectedTraitName) return;
    const sourceOrder = getPreferredSourceOrder(state.character);
    const raceEntry = getEffectiveRaceEntry(state.catalogs, state.character, sourceOrder);
    if (!raceEntry) return;
    const ignoredTraitNames = new Set(["age", "alignment", "size", "language", "languages", "creature type"]);
    const traitEntry = (Array.isArray(raceEntry?.entries) ? raceEntry.entries : []).find((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const name = String(entry?.name ?? "").trim();
      if (!name) return false;
      if (ignoredTraitNames.has(name.toLowerCase())) return false;
      return name.toLowerCase() === selectedTraitName.toLowerCase();
    });
    const lines = getRuleDescriptionLines(traitEntry);
    const bodyHtml = linesToHtml(lines, "No description is available for this trait.");
    const raceName = String(raceEntry?.name ?? state.character?.race ?? "").trim();
    const close = openModal({
      title: selectedTraitName,
      bodyHtml: `
        <div class="spell-meta-grid">
          <div><strong>Type:</strong> Species Trait</div>
          ${raceName ? `<div><strong>Species:</strong> ${esc(raceName)}</div>` : ""}
          <div><strong>Source:</strong> ${esc(raceEntry?.sourceLabel ?? raceEntry?.source ?? "")}</div>
        </div>
        <div class="spell-description">${bodyHtml}</div>
      `,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });
    bindInlineDiceRoll(close, selectedTraitName);
  }

  function openRaceDetailsModal(state) {
    const raceName = String(state.character?.race ?? "").trim();
    if (!raceName) {
      setDiceResult("Race details unavailable: no race selected.", true);
      return;
    }
    const sourceOrder = getPreferredSourceOrder(state.character);
    const raceEntry = findCatalogEntryByNameWithSelectedSourcePreference(
      state.catalogs?.races,
      raceName,
      state.character?.raceSource,
      sourceOrder
    );
    if (!raceEntry) {
      setDiceResult(`Race details unavailable: ${raceName}`, true);
      return;
    }
    const lines = getRuleDescriptionLines(raceEntry);
    const bodyHtml = linesToHtml(lines, "No description is available for this species.");
    const sizeText = Array.isArray(raceEntry?.size)
      ? raceEntry.size.map((entry) => toTitleCase(String(entry ?? ""))).filter(Boolean).join(", ")
      : toTitleCase(String(raceEntry?.size ?? "").trim());
    const speedText = toNumber(raceEntry?.speed, NaN);
    const metaRows = [
      { label: "Type", value: "Species" },
      { label: "Source", value: raceEntry?.sourceLabel ?? raceEntry?.source ?? "" },
      { label: "Size", value: sizeText },
      { label: "Speed", value: Number.isFinite(speedText) ? `${speedText} ft` : "" },
    ].filter((row) => row.value);
    const close = openModal({
      title: `${raceEntry.name} Details`,
      bodyHtml: `
        <div class="spell-meta-grid">
          ${metaRows.map((row) => `<div><strong>${esc(row.label)}:</strong> ${esc(row.value)}</div>`).join("")}
        </div>
        <div class="spell-description">${bodyHtml}</div>
      `,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });
    bindInlineDiceRoll(close, raceEntry.name);
  }

  function openSubraceDetailsModal(state) {
    const subraceName = String(state.character?.subrace ?? "").trim();
    if (!subraceName) {
      setDiceResult("Subrace details unavailable: no subrace selected.", true);
      return;
    }
    const sourceOrder = getPreferredSourceOrder(state.character);
    const raceEntry = findCatalogEntryByNameWithSelectedSourcePreference(
      state.catalogs?.races,
      state.character?.race,
      state.character?.raceSource,
      sourceOrder
    );
    const raceName = String(raceEntry?.name ?? state.character?.race ?? "").trim().toLowerCase();
    const subracePool = (Array.isArray(state.catalogs?.subraces) ? state.catalogs.subraces : []).filter((entry) => {
      if (!raceName) return true;
      return String(entry?.raceName ?? "").trim().toLowerCase() === raceName;
    });
    const subraceEntry = findCatalogEntryByNameWithSelectedSourcePreference(
      subracePool,
      subraceName,
      state.character?.subraceSource,
      sourceOrder
    );
    if (!subraceEntry) {
      setDiceResult(`Subrace details unavailable: ${subraceName}`, true);
      return;
    }
    const lines = getRuleDescriptionLines(subraceEntry);
    const bodyHtml = linesToHtml(lines, "No description is available for this subrace.");
    const metaRows = [
      { label: "Type", value: "Subrace" },
      { label: "Source", value: subraceEntry?.sourceLabel ?? subraceEntry?.source ?? "" },
      { label: "Base Species", value: subraceEntry?.raceName ?? raceEntry?.name ?? "" },
    ].filter((row) => row.value);
    const close = openModal({
      title: `${subraceEntry.name} Details`,
      bodyHtml: `
        <div class="spell-meta-grid">
          ${metaRows.map((row) => `<div><strong>${esc(row.label)}:</strong> ${esc(row.value)}</div>`).join("")}
        </div>
        <div class="spell-description">${bodyHtml}</div>
      `,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });
    bindInlineDiceRoll(close, subraceEntry.name);
  }

  function openBackgroundDetailsModal(state) {
    const backgroundName = String(state.character?.background ?? "").trim();
    if (!backgroundName) {
      setDiceResult("Background details unavailable: no background selected.", true);
      return;
    }
    const sourceOrder = getPreferredSourceOrder(state.character);
    const backgroundEntry = findCatalogEntryByNameWithSelectedSourcePreference(
      state.catalogs?.backgrounds,
      backgroundName,
      state.character?.backgroundSource,
      sourceOrder
    );
    if (!backgroundEntry) {
      setDiceResult(`Background details unavailable: ${backgroundName}`, true);
      return;
    }
    const lines = getRuleDescriptionLines(backgroundEntry);
    const bodyHtml = linesToHtml(lines, "No description is available for this background.");
    const metaRows = [
      { label: "Type", value: "Background" },
      { label: "Source", value: backgroundEntry?.sourceLabel ?? backgroundEntry?.source ?? "" },
    ].filter((row) => row.value);
    const close = openModal({
      title: `${backgroundEntry.name} Details`,
      bodyHtml: `
        <div class="spell-meta-grid">
          ${metaRows.map((row) => `<div><strong>${esc(row.label)}:</strong> ${esc(row.value)}</div>`).join("")}
        </div>
        <div class="spell-description">${bodyHtml}</div>
      `,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });
    bindInlineDiceRoll(close, backgroundEntry.name);
  }

  function normalizeAbilityLabel(value) {
    const key = String(value ?? "").trim().toLowerCase();
    const labels = {
      str: "STR",
      dex: "DEX",
      con: "CON",
      int: "INT",
      wis: "WIS",
      cha: "CHA",
    };
    if (labels[key]) return labels[key];
    return String(value ?? "").trim().toUpperCase();
  }

  function formatClassPrimaryAbility(classEntry) {
    const primary = classEntry?.primaryAbility;
    if (!primary) return "";
    if (Array.isArray(primary)) return primary.map((entry) => normalizeAbilityLabel(entry)).join(", ");
    if (typeof primary === "object") {
      const abilitySets = Object.values(primary)
        .flatMap((group) => (group && typeof group === "object" ? Object.entries(group) : []))
        .filter(([, enabled]) => enabled === true)
        .map(([key]) => normalizeAbilityLabel(key));
      return [...new Set(abilitySets)].join(", ");
    }
    return normalizeAbilityLabel(primary);
  }

  function formatClassStartingSkills(classEntry) {
    const skills = classEntry?.startingProficiencies?.skills;
    if (!skills) return "";
    const fromList = Array.isArray(skills.from) ? skills.from : [];
    const amount = Math.max(0, toNumber(skills.choose ?? 0, 0));
    if (!fromList.length || amount <= 0) return "";
    const labels = fromList.map((entry) => toTitleCase(String(entry ?? "").replace(/\|.+$/, ""))).filter(Boolean);
    if (!labels.length) return "";
    return `${amount} from ${labels.join(", ")}`;
  }

  function formatClassRequirementSet(requirements) {
    if (!requirements || typeof requirements !== "object") return "";
    const pairs = Object.entries(requirements)
      .filter(([, score]) => Number.isFinite(toNumber(score, NaN)))
      .map(([ability, score]) => `${normalizeAbilityLabel(ability)} ${toNumber(score, 0)}`);
    return pairs.join(" and ");
  }

  function formatClassMulticlassRequirements(classEntry) {
    const requirements = classEntry?.multiclassing?.requirements;
    if (!requirements || typeof requirements !== "object") return "";

    if (Array.isArray(requirements.or) && requirements.or.length) {
      const alternatives = requirements.or.map((set) => formatClassRequirementSet(set)).filter(Boolean);
      if (alternatives.length) return alternatives.join(" or ");
    }

    return formatClassRequirementSet(requirements);
  }

  function getClassFeatureRows(classEntry) {
    const features = Array.isArray(classEntry?.classFeatures) ? classEntry.classFeatures : [];
    return features
      .map((feature) => {
        const token = typeof feature === "string" ? feature : feature?.classFeature;
        const parsed = parseClassFeatureToken(token, classEntry?.source, classEntry?.name);
        if (!parsed) return null;
        return { name: parsed.name, level: parsed.level };
      })
      .filter(Boolean);
  }

  function getSubclassFeatureRows(subclassEntry) {
    const features = Array.isArray(subclassEntry?.subclassFeatures) ? subclassEntry.subclassFeatures : [];
    return features
      .map((feature) => {
        const token = typeof feature === "string" ? feature : feature?.subclassFeature;
        const parsed = parseSubclassFeatureToken(
          token,
          subclassEntry?.source,
          subclassEntry?.className,
          subclassEntry?.shortName ?? subclassEntry?.name
        );
        if (!parsed) return null;
        return { name: parsed.name, level: parsed.level };
      })
      .filter(Boolean);
  }

  function renderEntryDescriptionHtml(entry, emptyMessage) {
    const lines = getRuleDescriptionLines(entry);
    if (!lines.length) return `<p class='muted'>${esc(emptyMessage)}</p>`;
    const maxLines = 14;
    const clipped = lines.slice(0, maxLines);
    const lineHtml = clipped.map((line) => `<p>${renderTextWithInlineDiceButtons(line)}</p>`).join("");
    const overflowNote = lines.length > maxLines ? "<p class='muted'>Additional rules text omitted for brevity.</p>" : "";
    return `${lineHtml}${overflowNote}`;
  }

  function renderFeatureTimelineHtml(rows, currentLevel, emptyMessage) {
    const sortedRows = [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
      const levelDelta = toNumber(a?.level, 999) - toNumber(b?.level, 999);
      if (levelDelta !== 0) return levelDelta;
      return String(a?.name ?? "").localeCompare(String(b?.name ?? ""));
    });
    const deduped = sortedRows.filter(
      (row, idx, list) =>
        list.findIndex(
          (other) =>
            String(other?.name ?? "").trim().toLowerCase() === String(row?.name ?? "").trim().toLowerCase()
            && toNumber(other?.level, -1) === toNumber(row?.level, -1)
        ) === idx
    );
    if (!deduped.length) return `<p class='muted'>${esc(emptyMessage)}</p>`;
    return `
      <ul class="class-feature-list">
        ${deduped
          .map((row) => {
            const rowLevel = Math.max(0, toNumber(row?.level, 0));
            const unlocked = rowLevel > 0 && rowLevel <= currentLevel;
            const statusPill = unlocked ? '<span class="pill">Unlocked</span>' : '<span class="pill">Locked</span>';
            return `<li class="feature-row"><span class="class-feature-level">Lv ${esc(rowLevel || "?")}</span><span class="feature-main"><span>${esc(
              String(row?.name ?? "")
            )}</span>${statusPill}</span></li>`;
          })
          .join("")}
      </ul>
    `;
  }

  function openClassDetailsModal(state) {
    const className = state.character?.class;
    if (!className) {
      setDiceResult("Class details unavailable: no class selected.", true);
      return;
    }

    const classEntry = getClassCatalogEntry(state.catalogs, className);
    if (!classEntry) {
      setDiceResult(`Class details unavailable: ${className}`, true);
      return;
    }

    const currentLevel = Math.max(1, Math.min(20, toNumber(state.character?.level, 1)));
    const hitDie = classEntry?.hd?.faces ? `d${classEntry.hd.faces}` : "";
    const saveProficiencies = Array.isArray(classEntry?.proficiency)
      ? classEntry.proficiency.map((ability) => normalizeAbilityLabel(ability)).join(", ")
      : "";
    const armorProficiencies = Array.isArray(classEntry?.startingProficiencies?.armor)
      ? classEntry.startingProficiencies.armor.map((entry) => toTitleCase(entry)).join(", ")
      : "";
    const weaponProficiencies = Array.isArray(classEntry?.startingProficiencies?.weapons)
      ? classEntry.startingProficiencies.weapons.map((entry) => toTitleCase(entry)).join(", ")
      : "";
    const skillChoices = formatClassStartingSkills(classEntry);
    const primaryAbility = formatClassPrimaryAbility(classEntry);
    const multiclassRequirements = formatClassMulticlassRequirements(classEntry);

    const metaRows = [
      { label: "Source", value: classEntry.sourceLabel ?? classEntry.source ?? "" },
      { label: "Hit Die", value: hitDie },
      { label: "Primary Ability", value: primaryAbility },
      { label: "Saving Throws", value: saveProficiencies },
      { label: "Armor Proficiencies", value: armorProficiencies },
      { label: "Weapon Proficiencies", value: weaponProficiencies },
      { label: "Skill Proficiencies", value: skillChoices },
      { label: "Multiclass Requirement", value: multiclassRequirements },
    ].filter((row) => row.value);

    const progression = recomputeCharacterProgression(state.catalogs, state.character);
    const unlockedRows = progression.unlockedFeatures
      .filter((row) => row.level == null || row.level <= currentLevel)
      .map((row) => {
        const subtype = row.type === "subclass" ? ` (${row.subclassName || "Subclass"})` : "";
        return `<li><span class="class-feature-level">Lv ${row.level ?? "?"}</span><span>${esc(`${row.name}${subtype}`)}</span></li>`;
      })
      .join("");
    const classFeatureRows = getClassFeatureRows(classEntry);
    const classOverviewHtml = renderEntryDescriptionHtml(classEntry, "No class description is available for this entry.");
    const classTimelineHtml = renderFeatureTimelineHtml(
      classFeatureRows,
      currentLevel,
      "No class feature progression list is available for this entry."
    );
    const subclassEntry = getSelectedSubclassEntry(state.catalogs, state.character);

    const close = openModal({
      title: `${classEntry.name} Details`,
      bodyHtml: `
        <div class="spell-meta-grid">
          ${metaRows.map((row) => `<div><strong>${esc(row.label)}:</strong> ${esc(row.value)}</div>`).join("")}
        </div>
        ${
          subclassEntry
            ? `<p class="muted">Subclass: <strong>${esc(subclassEntry.name)}</strong> (${esc(subclassEntry.sourceLabel ?? subclassEntry.source ?? "Unknown source")})</p>`
            : ""
        }
        <h4>Overview</h4>
        <div class="spell-description">${classOverviewHtml}</div>
        <h4>Class Feature Progression</h4>
        ${classTimelineHtml}
        <h4>Current Features Through Level ${currentLevel}</h4>
        ${
          unlockedRows
            ? `<ul class="class-feature-list">${unlockedRows}</ul>`
            : "<p class='muted'>No class feature list available for this entry.</p>"
        }
      `,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });
    bindInlineDiceRoll(close, classEntry.name);
  }

  function openSubclassDetailsModal(state) {
    const subclassEntry = getSelectedSubclassEntry(state.catalogs, state.character);
    if (!subclassEntry) {
      setDiceResult("Subclass details unavailable: no subclass selected.", true);
      return;
    }
    const currentLevel = Math.max(1, Math.min(20, toNumber(state.character?.level, 1)));
    const className = String(subclassEntry?.className ?? state.character?.class ?? "").trim();
    const classSourceLabel = sourceLabels[normalizeSourceTag(subclassEntry?.classSource)] ?? subclassEntry?.classSource ?? "";
    const metaRows = [
      { label: "Source", value: subclassEntry.sourceLabel ?? subclassEntry.source ?? "" },
      { label: "Class", value: className },
      { label: "Class Source", value: classSourceLabel },
    ].filter((row) => row.value);
    const progression = recomputeCharacterProgression(state.catalogs, state.character);
    const unlockedRows = progression.unlockedFeatures
      .filter((row) => row.type === "subclass")
      .filter((row) => String(row?.subclassName ?? "").trim().toLowerCase() === String(subclassEntry?.name ?? "").trim().toLowerCase())
      .filter((row) => row.level == null || row.level <= currentLevel)
      .map((row) => `<li><span class="class-feature-level">Lv ${row.level ?? "?"}</span><span>${esc(String(row?.name ?? "").trim())}</span></li>`)
      .join("");
    const subclassFeatureRows = getSubclassFeatureRows(subclassEntry);
    const subclassOverviewHtml = renderEntryDescriptionHtml(subclassEntry, "No subclass description is available for this entry.");
    const subclassTimelineHtml = renderFeatureTimelineHtml(
      subclassFeatureRows,
      currentLevel,
      "No subclass feature progression list is available for this entry."
    );
    const close = openModal({
      title: `${subclassEntry.name} Details`,
      bodyHtml: `
        <div class="spell-meta-grid">
          ${metaRows.map((row) => `<div><strong>${esc(row.label)}:</strong> ${esc(row.value)}</div>`).join("")}
        </div>
        <h4>Overview</h4>
        <div class="spell-description">${subclassOverviewHtml}</div>
        <h4>Subclass Feature Progression</h4>
        ${subclassTimelineHtml}
        <h4>Current Subclass Features Through Level ${currentLevel}</h4>
        ${
          unlockedRows
            ? `<ul class="class-feature-list">${unlockedRows}</ul>`
            : "<p class='muted'>No subclass feature list available for this entry.</p>"
        }
      `,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });
    bindInlineDiceRoll(close, subclassEntry.name);
  }

  return {
    openClassDetailsModal,
    openSubclassDetailsModal,
    openRaceDetailsModal,
    openSubraceDetailsModal,
    openBackgroundDetailsModal,
    openFeatureDetailsModal,
    openFeatDetailsModal,
    openOptionalFeatureDetailsModal,
    openSpeciesTraitDetailsModal,
  };
}

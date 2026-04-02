export function createSpellTextAndContext({
  cleanSpellInlineTags,
  flattenTableCellToText,
  toNumber,
  esc,
  diceNotationRegex,
  abilityLabels,
  getClassSpellcastingAbility,
}) {
  function getSpellByName(state, spellName) {
    const normalized = cleanSpellInlineTags(String(spellName ?? "").trim());
    if (!normalized) return null;
    const exact = state.catalogs.spells.find((spell) => spell.name === normalized);
    if (exact) return exact;
    const lowered = normalized.toLowerCase();
    return state.catalogs.spells.find((spell) => String(spell?.name ?? "").trim().toLowerCase() === lowered) ?? null;
  }

  function getSpellLevelLabel(level) {
    return toNumber(level, 0) === 0 ? "Cantrip" : `Level ${toNumber(level, 0)}`;
  }

  function collectSpellEntryLines(entry, depth = 0, options = {}) {
    const includeTables = options?.includeTables === true;
    if (entry == null) return [];
    if (typeof entry === "string") {
      const line = cleanSpellInlineTags(entry);
      return line ? [line] : [];
    }
    if (Array.isArray(entry)) return entry.flatMap((it) => collectSpellEntryLines(it, depth, options));
    if (typeof entry !== "object") return [];

    const lines = [];
    const name = typeof entry.name === "string" ? cleanSpellInlineTags(entry.name) : "";

    if (Array.isArray(entry.entries)) {
      if (name) lines.push(depth > 0 ? `- ${name}:` : `${name}:`);
      lines.push(...entry.entries.flatMap((it) => collectSpellEntryLines(it, depth + 1, options)));
      return lines;
    }

    if (Array.isArray(entry.items)) {
      if (name) lines.push(depth > 0 ? `- ${name}:` : `${name}:`);
      entry.items.forEach((item) => {
        const itemLines = collectSpellEntryLines(item, depth + 1, options);
        if (!itemLines.length) return;
        const [first, ...rest] = itemLines;
        lines.push(`- ${first}`);
        rest.forEach((line) => lines.push(line));
      });
      return lines;
    }

    if (includeTables && entry.type === "table" && Array.isArray(entry.rows)) {
      const caption = cleanSpellInlineTags(String(entry.caption ?? name ?? "")).trim();
      if (caption) lines.push(depth > 0 ? `- ${caption}:` : `${caption}:`);
      const labels = Array.isArray(entry.colLabels) ? entry.colLabels.map((label) => cleanSpellInlineTags(String(label ?? "")).trim()) : [];
      if (labels.some(Boolean)) lines.push(`${labels.filter(Boolean).join(" | ")}`);
      entry.rows.forEach((row) => {
        const cells = Array.isArray(row) ? row : [];
        const parts = cells
          .map((cell) => flattenTableCellToText(cell))
          .map((value) => String(value ?? "").trim())
          .filter(Boolean);
        if (!parts.length) return;
        lines.push(`- ${parts.join(" | ")}`);
      });
      return lines;
    }

    if (typeof entry.entry === "string") {
      const line = cleanSpellInlineTags(entry.entry);
      if (!line) return lines;
      lines.push(name ? `${name}: ${line}` : line);
      return lines;
    }
    if (typeof entry.optionalfeature === "string") {
      const line = cleanSpellInlineTags(entry.optionalfeature.split("|")[0]);
      if (line) lines.push(name ? `${name}: ${line}` : line);
      return lines;
    }
    if (typeof entry.classFeature === "string") {
      const line = cleanSpellInlineTags(entry.classFeature.split("|")[0]);
      if (line) lines.push(name ? `${name}: ${line}` : line);
      return lines;
    }
    if (typeof entry.subclassFeature === "string") {
      const line = cleanSpellInlineTags(entry.subclassFeature.split("|")[0]);
      if (line) lines.push(name ? `${name}: ${line}` : line);
      return lines;
    }
    if (typeof entry.spell === "string") {
      const line = cleanSpellInlineTags(entry.spell.split("|")[0]);
      if (line) lines.push(name ? `${name}: ${line}` : line);
      return lines;
    }
    if (typeof entry.text === "string") {
      const line = cleanSpellInlineTags(entry.text);
      if (!line) return lines;
      lines.push(name ? `${name}: ${line}` : line);
      return lines;
    }
    return lines;
  }

  function getSpellDescriptionLines(spell) {
    if (!spell || typeof spell !== "object") return [];
    const lines = collectSpellEntryLines(spell.entries ?? [], 0, { includeTables: false });
    const higherLevelLines = collectSpellEntryLines(spell.entriesHigherLevel ?? [], 0, { includeTables: false });
    if (higherLevelLines.length) {
      lines.push("At Higher Levels:");
      lines.push(...higherLevelLines);
    }
    return lines.filter(Boolean);
  }

  function getSpellPrimaryDiceNotation(spell) {
    const lines = getSpellDescriptionLines(spell);
    for (const line of lines) {
      diceNotationRegex.lastIndex = 0;
      const match = diceNotationRegex.exec(String(line));
      if (match?.[0]) return String(match[0]).replace(/\s+/g, "");
    }
    return "";
  }

  function getSpellSaveAbilityKeys(spell, descriptionText = "") {
    const keys = [];
    const addKey = (value) => {
      const key = String(value ?? "").trim().toLowerCase().slice(0, 3);
      if (!["str", "dex", "con", "int", "wis", "cha"].includes(key) || keys.includes(key)) return;
      keys.push(key);
    };
    const savingThrowList = Array.isArray(spell?.savingThrow) ? spell.savingThrow : [];
    savingThrowList.forEach((entry) => addKey(entry));
    if (!keys.length && spell?.save && typeof spell.save === "object") {
      Object.keys(spell.save).forEach((entry) => addKey(entry));
    }
    if (!keys.length && descriptionText) {
      const matches = [...descriptionText.matchAll(/\b(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving\s+throw\b/gi)];
      matches.forEach((match) => addKey(match[1]));
    }
    return keys;
  }

  function getSpellCombatContext(state, spell) {
    if (!spell || typeof spell !== "object") {
      return { hasSpellAttack: false, attackLabel: "Spell Attack", attackBonus: null, hasSave: false, saveDc: null, saveText: "" };
    }
    const lines = getSpellDescriptionLines(spell);
    const descriptionText = lines.join(" ").toLowerCase();
    const hasMeleeSpellAttack = /melee spell attack/.test(descriptionText);
    const hasRangedSpellAttack = /ranged spell attack/.test(descriptionText);
    const hasGenericSpellAttack = /spell attack/.test(descriptionText);
    const hasSpellAttack = hasMeleeSpellAttack || hasRangedSpellAttack || hasGenericSpellAttack;
    const attackLabel = hasMeleeSpellAttack ? "Melee Spell Attack" : hasRangedSpellAttack ? "Ranged Spell Attack" : "Spell Attack";
    const saveAbilityKeys = getSpellSaveAbilityKeys(spell, descriptionText);
    const hasSave = saveAbilityKeys.length > 0 || /\bsaving throw\b/.test(descriptionText);
    const spellcastingAbility = getClassSpellcastingAbility(state?.catalogs, state?.character);
    const spellcastingMod = spellcastingAbility ? toNumber(state?.derived?.mods?.[spellcastingAbility], 0) : 0;
    const proficiencyBonus = toNumber(state?.derived?.proficiencyBonus, 0);
    const hasSpellcastingAbility = Boolean(spellcastingAbility);
    const attackBonus = hasSpellAttack && hasSpellcastingAbility ? spellcastingMod + proficiencyBonus : null;
    const saveDc = hasSave && hasSpellcastingAbility ? 8 + proficiencyBonus + spellcastingMod : null;
    const saveText = saveAbilityKeys.length
      ? `${saveAbilityKeys.map((key) => abilityLabels[key] ?? key.toUpperCase()).join("/")} save`
      : hasSave
        ? "save"
        : "";
    return { hasSpellAttack, attackLabel, attackBonus, hasSave, saveDc, saveText };
  }

  function renderTextWithInlineDiceButtons(text) {
    const source = String(text ?? "");
    diceNotationRegex.lastIndex = 0;
    const matches = [...source.matchAll(diceNotationRegex)];
    if (!matches.length) return esc(source);
    let html = "";
    let cursor = 0;
    matches.forEach((match) => {
      const notationText = String(match[0] ?? "");
      const notation = notationText.replace(/\s+/g, "");
      const index = toNumber(match.index, cursor);
      html += esc(source.slice(cursor, index));
      html += `<button type="button" class="inline-dice-btn" data-spell-roll="${esc(notation)}" title="Roll ${esc(notation)}">${esc(notationText)}</button>`;
      cursor = index + notationText.length;
    });
    html += esc(source.slice(cursor));
    return html;
  }

  function formatSpellTime(spell) {
    if (!Array.isArray(spell?.time) || !spell.time.length) return "";
    return spell.time
      .map((entry) => {
        const amount = entry.number == null ? "" : `${entry.number} `;
        const unit = entry.unit ? String(entry.unit) : "";
        const condition = entry.condition ? ` (${cleanSpellInlineTags(entry.condition)})` : "";
        return `${amount}${unit}${condition}`.trim();
      })
      .filter(Boolean)
      .join(", ");
  }

  function formatSpellRange(spell) {
    const range = spell?.range;
    if (!range || typeof range !== "object") return "";
    if (range.type === "point") {
      const distanceType = range.distance?.type ?? "";
      const distanceAmount = range.distance?.amount;
      if (!distanceType) return "Point";
      if (distanceType === "self" || distanceType === "touch" || distanceType === "sight" || distanceType === "unlimited") {
        return String(distanceType).replace(/^\w/, (char) => char.toUpperCase());
      }
      if (distanceAmount == null) return String(distanceType);
      return `${distanceAmount} ${distanceType}`;
    }
    return String(range.type ?? "");
  }

  function formatSpellDuration(spell) {
    if (!Array.isArray(spell?.duration) || !spell.duration.length) return "";
    return spell.duration
      .map((entry) => {
        const concentration = entry.concentration ? "Concentration, " : "";
        if (entry.type === "instant") return `${concentration}Instantaneous`;
        if (entry.type === "permanent") return `${concentration}Permanent`;
        if (entry.type === "special") return `${concentration}Special`;
        if (entry.type === "timed") {
          const amount = entry.duration?.amount;
          const unit = entry.duration?.type;
          if (amount != null && unit) return `${concentration}${amount} ${unit}`;
        }
        return concentration.trim();
      })
      .filter(Boolean)
      .join(", ");
  }

  function formatSpellComponents(spell) {
    const components = spell?.components;
    if (!components || typeof components !== "object") return "";
    const values = [];
    if (components.v) values.push("V");
    if (components.s) values.push("S");
    if (components.m) {
      if (typeof components.m === "string") values.push(`M (${cleanSpellInlineTags(components.m)})`);
      else if (typeof components.m === "object" && typeof components.m.text === "string") {
        values.push(`M (${cleanSpellInlineTags(components.m.text)})`);
      } else {
        values.push("M");
      }
    }
    return values.join(", ");
  }

  return {
    getSpellByName,
    getSpellLevelLabel,
    collectSpellEntryLines,
    getSpellDescriptionLines,
    getSpellPrimaryDiceNotation,
    getSpellSaveAbilityKeys,
    getSpellCombatContext,
    renderTextWithInlineDiceButtons,
    formatSpellTime,
    formatSpellRange,
    formatSpellDuration,
    formatSpellComponents,
  };
}

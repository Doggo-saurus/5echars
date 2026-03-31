export function createPickers(deps) {
  const {
    openModal,
    store,
    esc,
    toNumber,
    matchesSearchQuery,
    buildEntityId,
    doesCharacterMeetFeatPrerequisites,
    doesCharacterMeetOptionalFeaturePrerequisites,
    updateCharacterWithRequiredSettings,
    getSpellByName,
    getSpellLevelLabel,
    spellSchoolLabels,
    formatSpellTime,
    formatSpellRange,
    formatSpellDuration,
    formatSpellComponents,
    getSpellDescriptionLines,
    getRuleDescriptionLines,
    renderTextWithInlineDiceButtons,
    rollVisualNotation,
    setDiceResult,
  } = deps;

  function openSpellDetailsModal(state, spellName) {
    const spell = getSpellByName(state, spellName);
    if (!spell) {
      setDiceResult(`Spell details unavailable: ${spellName}`, true);
      return;
    }

    const metaRows = [
      { label: "Level", value: getSpellLevelLabel(spell.level) },
      { label: "School", value: spellSchoolLabels[spell.school] ?? spell.school ?? "" },
      { label: "Casting Time", value: formatSpellTime(spell) },
      { label: "Range", value: formatSpellRange(spell) },
      { label: "Duration", value: formatSpellDuration(spell) },
      { label: "Components", value: formatSpellComponents(spell) },
      { label: "Source", value: spell.sourceLabel ?? spell.source ?? "" },
    ].filter((row) => row.value);

    const descriptionLines = getSpellDescriptionLines(spell);
    const descriptionHtml = descriptionLines.length
      ? descriptionLines
          .map((line) => {
            const body = renderTextWithInlineDiceButtons(line);
            return `<p>${body}</p>`;
          })
          .join("")
      : "<p class='muted'>No description available for this spell.</p>";

    openModal({
      title: spell.name,
      bodyHtml: `
      <div class="spell-meta-grid">
        ${metaRows.map((row) => `<div><strong>${esc(row.label)}:</strong> ${esc(row.value)}</div>`).join("")}
      </div>
      <p class="muted spell-detail-help">Click a dice expression in the text to roll it.</p>
      <div class="spell-description">${descriptionHtml}</div>
    `,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });

    document.querySelectorAll("[data-spell-roll]").forEach((button) => {
      button.addEventListener("click", () => {
        const notation = button.dataset.spellRoll;
        if (!notation) return;
        close();
        rollVisualNotation(`${spell.name}`, notation);
      });
    });
  }

  function openSpellModal(state) {
    const normalizeName = (value) => String(value ?? "").trim().toLowerCase();
    const getCharacterClasses = (character) => {
      const classes = [];
      const primaryClass = String(character?.class ?? "").trim();
      if (primaryClass) classes.push(primaryClass);
      const multiclass = Array.isArray(character?.multiclass) ? character.multiclass : [];
      multiclass.forEach((entry) => {
        const className = String(entry?.class ?? "").trim();
        if (className) classes.push(className);
      });
      return [...new Set(classes.map((name) => normalizeName(name)).filter(Boolean))];
    };
    const getSelectedSubclass = (character) => {
      const subclassSelection = character?.classSelection?.subclass;
      if (subclassSelection && typeof subclassSelection === "object") {
        const subclassName = String(subclassSelection.name ?? "").trim();
        const className = String(subclassSelection.className ?? character?.class ?? "").trim();
        if (subclassName && className) return { subclassName, className };
      }
      const legacySubclassName = String(character?.subclass ?? "").trim();
      const className = String(character?.class ?? "").trim();
      if (legacySubclassName && className) return { subclassName: legacySubclassName, className };
      return null;
    };
    const doesLookupListClass = (lookup, className) => {
      const normalizedClass = normalizeName(className);
      if (!normalizedClass || !lookup || typeof lookup !== "object") return false;
      return Object.values(lookup).some((sourceMap) =>
        Object.keys(sourceMap ?? {}).some((listedClass) => normalizeName(listedClass) === normalizedClass)
      );
    };
    const doesLookupListSubclass = (lookup, className, subclassName) => {
      const normalizedClass = normalizeName(className);
      const normalizedSubclass = normalizeName(subclassName);
      if (!normalizedClass || !normalizedSubclass || !lookup || typeof lookup !== "object") return false;
      return Object.values(lookup).some((classMap) =>
        Object.entries(classMap ?? {}).some(([listedClass, subclassBySource]) => {
          if (normalizeName(listedClass) !== normalizedClass) return false;
          return Object.values(subclassBySource ?? {}).some((subclassMap) =>
            Object.keys(subclassMap ?? {}).some((listedSubclass) => normalizeName(listedSubclass) === normalizedSubclass)
          );
        })
      );
    };
    const isSpellAvailableToCharacter = (spell, character) => {
      const classNames = getCharacterClasses(character);
      if (!classNames.length) return true;
      const spellSourceEntry = spell?.spellSourceEntry;
      const classLookup = spellSourceEntry?.class;
      const subclassLookup = spellSourceEntry?.subclass;
      if (!classLookup && !subclassLookup) return true;
      if (classNames.some((className) => doesLookupListClass(classLookup, className))) return true;
      const selectedSubclass = getSelectedSubclass(character);
      if (!selectedSubclass) return false;
      return doesLookupListSubclass(subclassLookup, selectedSubclass.className, selectedSubclass.subclassName);
    };
    const getEligibilityHint = (character) => {
      const classNames = getCharacterClasses(character);
      if (!classNames.length) return "Showing all spells (no class selected).";
      const classLabel = classNames.map((name) => name.slice(0, 1).toUpperCase() + name.slice(1)).join(", ");
      const selectedSubclass = getSelectedSubclass(character);
      if (selectedSubclass) {
        return `Showing spells for ${classLabel} and ${selectedSubclass.subclassName}.`;
      }
      return `Showing spells for ${classLabel}.`;
    };

    const allSpells = state.catalogs.spells;
    const spellLevelByName = new Map(
      (Array.isArray(allSpells) ? allSpells : [])
        .map((spell) => [String(spell?.name ?? "").trim(), Math.max(0, toNumber(spell?.level, 0))])
        .filter(([name]) => name)
    );
    const resolveClassCantripLimit = (character) => {
      if (!character || typeof character !== "object") return 0;
      const tracks = [];
      const primaryClassName = String(character.class ?? "").trim();
      const totalLevel = Math.max(1, Math.min(20, toNumber(character.level, 1)));
      const multiclassEntries = Array.isArray(character.multiclass) ? character.multiclass : [];
      const cleanedMulticlass = multiclassEntries
        .map((entry) => ({
          className: String(entry?.class ?? "").trim(),
          level: Math.max(1, Math.min(20, toNumber(entry?.level, 1))),
        }))
        .filter((entry) => entry.className);
      const multiclassTotal = cleanedMulticlass.reduce((sum, entry) => sum + entry.level, 0);
      const primaryLevel = Math.max(1, totalLevel - multiclassTotal);
      if (primaryClassName) tracks.push({ className: primaryClassName, level: primaryLevel });
      cleanedMulticlass.forEach((entry) => tracks.push(entry));
      if (!tracks.length) return 0;

      const classEntries = Array.isArray(state.catalogs?.classes) ? state.catalogs.classes : [];
      const findClassEntry = (className) => {
        const key = String(className ?? "").trim().toLowerCase();
        if (!key) return null;
        return classEntries.find((entry) => String(entry?.name ?? "").trim().toLowerCase() === key) ?? null;
      };

      return tracks.reduce((sum, track) => {
        const classEntry = findClassEntry(track.className);
        const progression = Array.isArray(classEntry?.cantripProgression) ? classEntry.cantripProgression : [];
        if (!progression.length) return sum;
        const index = Math.max(0, Math.min(progression.length - 1, Math.floor(track.level) - 1));
        return sum + Math.max(0, toNumber(progression[index], 0));
      }, 0);
    };
    const sourceOptions = [...new Set(allSpells.map((it) => it.source).filter(Boolean))].sort();
    openModal({
      title: "Choose Spells",
      bodyHtml: `
      <div class="row">
        <label>Search
          <input id="spell-search" placeholder="Search spells...">
        </label>
        <label>Level
          <select id="spell-level">
            <option value="">All levels</option>
            ${Array.from({ length: 10 }, (_, i) => `<option value="${i}">${i}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="row">
        <label>Source
          <select id="spell-source">
            <option value="">All sources</option>
            ${sourceOptions.map((src) => `<option value="${esc(src)}">${esc(src)}</option>`).join("")}
          </select>
        </label>
      </div>
      <p class="muted">${esc(getEligibilityHint(state.character))}</p>
      <div class="option-list" id="spell-list"></div>
    `,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });

    const searchEl = document.getElementById("spell-search");
    const levelEl = document.getElementById("spell-level");
    const sourceEl = document.getElementById("spell-source");
    const listEl = document.getElementById("spell-list");

    function renderSpellRows() {
      const searchValue = searchEl.value.trim();
      const levelValue = levelEl.value;
      const sourceValue = sourceEl.value;
      const currentCharacter = store.getState().character;
      const cantripLimit = resolveClassCantripLimit(currentCharacter);
      const selectedCantripCount = (Array.isArray(currentCharacter?.spells) ? currentCharacter.spells : []).reduce(
        (count, spellName) => count + (toNumber(spellLevelByName.get(String(spellName ?? "").trim()), 0) === 0 ? 1 : 0),
        0
      );
      const autoClassListSet = new Set(
        (Array.isArray(currentCharacter?.play?.autoClassListSpells) ? currentCharacter.play.autoClassListSpells : [])
          .map((name) => String(name ?? "").trim().toLowerCase())
          .filter(Boolean)
      );
      const filtered = allSpells
        .filter((spell) => isSpellAvailableToCharacter(spell, state.character))
        .filter((spell) => matchesSearchQuery(searchValue, spell.name, spell.sourceLabel, spell.source))
        .filter((spell) => !levelValue || String(spell.level ?? 0) === levelValue)
        .filter((spell) => !sourceValue || spell.source === sourceValue)
        .sort((a, b) => {
          const levelDelta = toNumber(a?.level, 0) - toNumber(b?.level, 0);
          if (levelDelta !== 0) return levelDelta;
          return String(a?.name ?? "").localeCompare(String(b?.name ?? ""));
        })
        .slice(0, 200);

      listEl.innerHTML = filtered.length
        ? filtered
            .map((spell) => {
              const spellNameKey = String(spell?.name ?? "").trim();
              const isAutoManaged = autoClassListSet.has(spellNameKey.toLowerCase());
              const isSelected = store.getState().character.spells.includes(spell.name);
              const isCantrip = toNumber(spell?.level, 0) === 0;
              const canAddCantrip = !isCantrip || isSelected || selectedCantripCount < cantripLimit;
              const disablePick = isAutoManaged || !canAddCantrip;
              const title = isAutoManaged
                ? "This spell is auto-managed from class access."
                : !canAddCantrip
                  ? `Cantrip limit reached (${cantripLimit}).`
                  : "";
              const label = isAutoManaged ? "Auto" : !canAddCantrip ? "Max" : isSelected ? "Remove" : "Add";
              return `
            <div class="option-row">
              <div>
                <button type="button" class="spell-picker-name-btn" data-spell-view="${esc(spell.name)}">${esc(spell.name)}</button>
                <div class="muted">Level ${esc(spell.level ?? 0)} - ${esc(spell.sourceLabel ?? spell.source)}</div>
              </div>
              <div class="option-row-actions">
                <button type="button" class="btn secondary" data-spell-view="${esc(spell.name)}">View</button>
                <button
                  type="button"
                  class="btn secondary"
                  data-pick="${esc(spell.name)}"
                  ${disablePick ? "disabled" : ""}
                  title="${title}"
                >${label}</button>
              </div>
            </div>
          `
            })
            .join("")
        : "<p class='muted'>No spells match these filters or your class/subclass spell list.</p>";

      listEl.querySelectorAll("[data-spell-view]").forEach((button) => {
        button.addEventListener("click", () => {
          const spellName = button.dataset.spellView;
          if (!spellName) return;
          openSpellDetailsModal(state, spellName);
        });
      });

      listEl.querySelectorAll("[data-pick]").forEach((button) => {
        button.addEventListener("click", () => {
          const spellName = button.dataset.pick;
          if (!spellName) return;
          const autoClassListSet = new Set(
            (Array.isArray(store.getState().character?.play?.autoClassListSpells) ? store.getState().character.play.autoClassListSpells : [])
              .map((name) => String(name ?? "").trim().toLowerCase())
              .filter(Boolean)
          );
          if (autoClassListSet.has(String(spellName ?? "").trim().toLowerCase())) return;
          const selectedSpells = store.getState().character.spells ?? [];
          const isCantrip = toNumber(spellLevelByName.get(String(spellName ?? "").trim()), 0) === 0;
          if (!selectedSpells.includes(spellName) && isCantrip) {
            const cantripLimit = resolveClassCantripLimit(store.getState().character);
            const selectedCantripCount = selectedSpells.reduce(
              (count, name) => count + (toNumber(spellLevelByName.get(String(name ?? "").trim()), 0) === 0 ? 1 : 0),
              0
            );
            if (selectedCantripCount >= cantripLimit) return;
          }
          if (selectedSpells.includes(spellName)) store.removeSpell(spellName);
          else store.addSpell(spellName);
          renderSpellRows();
        });
      });
    }

    [searchEl, levelEl, sourceEl].forEach((el) => {
      el.addEventListener("input", renderSpellRows);
      el.addEventListener("change", renderSpellRows);
    });
    renderSpellRows();
  }

  function openItemModal(state) {
    const allItems = state.catalogs.items;
    const sourceOptions = [...new Set(allItems.map((it) => it.source).filter(Boolean))].sort();
    const itemNameCollator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true, ignorePunctuation: true });
    const close = openModal({
      title: "Choose Items",
      bodyHtml: `
      <div class="row">
        <label>Search
          <input id="item-search" placeholder="Search items...">
        </label>
        <label>Source
          <select id="item-source">
            <option value="">All sources</option>
            ${sourceOptions.map((src) => `<option value="${esc(src)}">${esc(src)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="option-list" id="item-list"></div>
    `,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });

    const searchEl = document.getElementById("item-search");
    const sourceEl = document.getElementById("item-source");
    const listEl = document.getElementById("item-list");

    function normalizeItemTypeCode(value) {
      return String(value ?? "")
        .split("|")[0]
        .trim()
        .toUpperCase();
    }

    function parseNumericBonus(value, fallback = 0) {
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

    function extractWeaponBonusFromName(name) {
      const match = String(name ?? "").match(/(?:^|\s)\+(\d+)(?:\s|$|\))/i);
      if (!match) return 0;
      const parsed = Number(match[1]);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    function firstNonEmpty(...values) {
      for (const value of values) {
        if (value == null) continue;
        if (typeof value === "string" && !value.trim()) continue;
        return value;
      }
      return "";
    }

    function mergeProperties(...sets) {
      return [...new Set(sets.flatMap((set) => (Array.isArray(set) ? set : [])).map((prop) => String(prop ?? "").trim()).filter(Boolean))];
    }

    function buildInventoryEntry(item, nameOverride = "", options = {}) {
      const variantItem = options.variantItem ?? null;
      const inherits = variantItem?.inherits && typeof variantItem.inherits === "object" ? variantItem.inherits : {};
      const name = String(nameOverride || variantItem?.name || item?.name || "").trim();
      if (!name) return null;
      const source = String(variantItem?.source ?? item?.source ?? "").trim();
      const sourceLabel = String(variantItem?.sourceLabel ?? item?.sourceLabel ?? source).trim();
      const typeCode = normalizeItemTypeCode(firstNonEmpty(variantItem?.type, inherits?.type, item?.type));
      const acValue = Number(firstNonEmpty(variantItem?.ac, inherits?.ac, item?.ac));
      const damageType = String(firstNonEmpty(variantItem?.dmgType, inherits?.dmgType, item?.dmgType) ?? "").trim();
      const damageDice = String(firstNonEmpty(variantItem?.dmg1, inherits?.dmg1, item?.dmg1, variantItem?.dmg2, inherits?.dmg2, item?.dmg2) ?? "").trim();
      const nameBonus = extractWeaponBonusFromName(name);
      const sharedWeaponBonus = parseNumericBonus(firstNonEmpty(variantItem?.bonusWeapon, inherits?.bonusWeapon, item?.bonusWeapon), 0);
      const attackBonus = parseNumericBonus(
        firstNonEmpty(variantItem?.bonusWeaponAttack, inherits?.bonusWeaponAttack, item?.bonusWeaponAttack),
        sharedWeaponBonus || nameBonus
      );
      const damageBonus = parseNumericBonus(
        firstNonEmpty(variantItem?.bonusWeaponDamage, inherits?.bonusWeaponDamage, item?.bonusWeaponDamage),
        sharedWeaponBonus || nameBonus
      );
      const properties = mergeProperties(item?.property, inherits?.property, variantItem?.property);
      const weaponCategory = String(firstNonEmpty(variantItem?.weaponCategory, inherits?.weaponCategory, item?.weaponCategory) ?? "").trim();
      const weaponFlag =
        Boolean(variantItem?.weapon) || Boolean(inherits?.weapon) || Boolean(item?.weapon) || Boolean(damageDice) || Boolean(weaponCategory);
      const armorFlag =
        Boolean(variantItem?.armor) ||
        Boolean(inherits?.armor) ||
        Boolean(item?.armor) ||
        ["LA", "MA", "HA", "S"].includes(typeCode);
      return {
        id: buildEntityId(["inv", name, source, Date.now(), Math.random()]),
        itemId: buildEntityId(["item", variantItem?.name || item?.name, source]),
        name,
        source,
        sourceLabel,
        itemType: typeCode,
        weaponCategory,
        damageDice,
        damageType,
        properties,
        ac: Number.isFinite(acValue) ? acValue : null,
        weapon: weaponFlag,
        armor: armorFlag,
        weaponAttackBonus: attackBonus,
        weaponDamageBonus: damageBonus,
        equipped: false,
      };
    }

    function normalizeItemType(value) {
      return String(value ?? "")
        .split("|")[0]
        .trim()
        .toLowerCase();
    }

    function normalizeRequirementValue(value) {
      const text = String(value ?? "").trim();
      if (!text) return "";
      return text
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim();
    }

    function titleCaseRequirement(value) {
      const normalized = normalizeRequirementValue(value);
      if (!normalized) return "";
      return normalized
        .split(" ")
        .map((word) => {
          if (!word) return "";
          const lower = word.toLowerCase();
          if (["of", "the", "and", "or", "in", "with", "to"].includes(lower)) return lower;
          return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(" ")
        .replace(/\b(ac)\b/gi, "AC");
    }

    function addRequirementTokens(targetSet, rawValue) {
      if (rawValue == null) return;
      if (typeof rawValue === "boolean") return;
      if (Array.isArray(rawValue)) {
        rawValue.forEach((entry) => addRequirementTokens(targetSet, entry));
        return;
      }
      if (typeof rawValue === "object") {
        Object.values(rawValue).forEach((entry) => addRequirementTokens(targetSet, entry));
        return;
      }
      const normalized = titleCaseRequirement(rawValue);
      if (normalized) targetSet.add(normalized);
    }

    function extractRequirementFromSentence(sentence) {
      const text = String(sentence ?? "").trim();
      if (!text) return "";
      let cleaned = text
        .replace(/^.*?\bproficient\b\s*(?:with|in)?\s*/i, "")
        .replace(/^with\s+/i, "")
        .replace(/^in\s+/i, "")
        .replace(/\b(?:to|at)\s+attune\b.*$/i, "")
        .replace(/[.,;:!?]+$/g, "")
        .trim();
      if (!cleaned) return "";
      cleaned = cleaned.replace(/\bweapons?\b/i, (match) => match.toLowerCase());
      return titleCaseRequirement(cleaned);
    }

    function collectItemProficiencyRequirements(item) {
      const weapon = new Set();
      const armor = new Set();
      const other = new Set();
      const addRequirement = (bucket, value) => addRequirementTokens(bucket, value);

      const attuneTags = [];
      if (Array.isArray(item?.reqAttuneTags)) attuneTags.push(...item.reqAttuneTags);
      if (Array.isArray(item?.reqAttuneAltTags)) attuneTags.push(...item.reqAttuneAltTags);
      attuneTags.forEach((tag) => {
        if (!tag || typeof tag !== "object" || Array.isArray(tag)) return;
        Object.entries(tag).forEach(([key, value]) => {
          const keyText = String(key ?? "").toLowerCase();
          if (keyText.includes("weapon")) {
            addRequirement(weapon, value);
            return;
          }
          if (keyText.includes("armor") || keyText.includes("shield")) {
            addRequirement(armor, value);
            return;
          }
          if (keyText.includes("proficiency")) {
            const valueText = typeof value === "boolean" ? "" : String(value ?? "").trim();
            const label = titleCaseRequirement(valueText || keyText.replace(/proficiency/gi, "").trim());
            if (label) other.add(label);
          }
        });
      });

      const proficiencyText = [item?.reqAttune, item?.reqAttuneAlt]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
        .join(" ");
      if (proficiencyText) {
        const matches = proficiencyText.match(/[^.?!;]*\bproficien(?:t|cy)\b[^.?!;]*/gi) ?? [];
        matches.forEach((sentence) => {
          const lowered = sentence.toLowerCase();
          const requirement = extractRequirementFromSentence(sentence);
          if (!requirement) return;
          if (/\bweapon(s)?\b/.test(lowered)) {
            weapon.add(requirement);
          } else if (/\barmor\b|\barmour\b|\bshield(s)?\b/.test(lowered)) {
            armor.add(requirement);
          } else {
            other.add(requirement);
          }
        });
      }

      const typeCode = normalizeItemTypeCode(item?.type ?? item?.itemType);
      const weaponCategory = titleCaseRequirement(item?.weaponCategory);
      const isWeaponLike = Boolean(item?.weapon) || Boolean(item?.dmg1) || Boolean(item?.dmg2) || Boolean(weaponCategory);
      const isArmorLike = Boolean(item?.armor) || ["LA", "MA", "HA", "S"].includes(typeCode);

      if (!weapon.size && isWeaponLike) {
        if (weaponCategory) {
          if (/simple/i.test(weaponCategory)) weapon.add("Simple Weapons");
          else if (/martial/i.test(weaponCategory)) weapon.add("Martial Weapons");
          else weapon.add(weaponCategory);
        } else {
          weapon.add("Weapon Proficiency");
        }
      }

      if (!armor.size && isArmorLike) {
        if (typeCode === "LA") armor.add("Light Armor");
        else if (typeCode === "MA") armor.add("Medium Armor");
        else if (typeCode === "HA") armor.add("Heavy Armor");
        else if (typeCode === "S") armor.add("Shields");
        else armor.add("Armor Proficiency");
      }

      return {
        weapon: [...weapon],
        armor: [...armor],
        other: [...other],
      };
    }

    function formatItemProficiencyRequirements(item) {
      const requirements = collectItemProficiencyRequirements(item);
      const parts = [];
      if (requirements.weapon.length) parts.push(`Weapon: ${requirements.weapon.join(", ")}`);
      if (requirements.armor.length) parts.push(`Armor: ${requirements.armor.join(", ")}`);
      if (requirements.other.length) parts.push(`Other: ${requirements.other.join(", ")}`);
      return parts.join(" | ");
    }

    function getItemSortName(item) {
      const name = String(item?.name ?? "").trim();
      if (!name) return "";
      // Sort "+1 Longsword" with "Longsword" entries instead of before "A".
      return name.replace(/^\+\d+\s+/u, "").trim();
    }

    function compareItemsByName(a, b) {
      const nameA = getItemSortName(a);
      const nameB = getItemSortName(b);
      const byBaseName = itemNameCollator.compare(nameA, nameB);
      if (byBaseName !== 0) return byBaseName;
      const byFullName = itemNameCollator.compare(String(a?.name ?? ""), String(b?.name ?? ""));
      if (byFullName !== 0) return byFullName;
      return itemNameCollator.compare(String(a?.source ?? ""), String(b?.source ?? ""));
    }

    function matchesRequirement(item, requirement) {
      if (!requirement || typeof requirement !== "object") return false;
      return Object.entries(requirement).every(([key, expected]) => {
        if (key === "type") {
          const expectedType = normalizeItemType(expected);
          const itemType = normalizeItemType(item?.type);
          if (!expectedType || !itemType) return false;
          return itemType === expectedType;
        }

        if (expected === true) {
          if (key === "weapon") return Boolean(item?.weapon) || Boolean(item?.dmg1) || Boolean(item?.weaponCategory);
          if (key === "armor") return Boolean(item?.armor) || ["la", "ma", "ha"].includes(normalizeItemType(item?.type));
          return Boolean(item?.[key]);
        }

        if (expected === false) return !item?.[key];
        return String(item?.[key] ?? "").toLowerCase() === String(expected ?? "").toLowerCase();
      });
    }

    function isExcludedByVariant(item, excludes) {
      if (!excludes || typeof excludes !== "object") return false;
      return Object.entries(excludes).some(([key, expected]) => {
        if (expected === true) return Boolean(item?.[key]);
        if (key === "type") return normalizeItemType(item?.type) === normalizeItemType(expected);
        return String(item?.[key] ?? "").toLowerCase() === String(expected ?? "").toLowerCase();
      });
    }

    function getVariantBaseItemCandidates(variant) {
      const requirements = Array.isArray(variant?.requires) ? variant.requires : [];
      if (!requirements.length) return [];

      return allItems
        .filter((item) => item && !Array.isArray(item.requires))
        .filter((item) => requirements.some((requirement) => matchesRequirement(item, requirement)))
        .filter((item) => !isExcludedByVariant(item, variant?.excludes))
        .sort(compareItemsByName)
        .slice(0, 500);
    }

    function buildVariantItemName(variant, baseItem) {
      const prefix = String(variant?.inherits?.namePrefix ?? "");
      const suffix = String(variant?.inherits?.nameSuffix ?? "");
      const baseName = String(baseItem?.name ?? "").trim();
      const combined = `${prefix}${baseName}${suffix}`.replace(/\s+/g, " ").trim();
      if (combined) return combined;
      return `${String(variant?.name ?? "Magic Variant").trim()} (${baseName})`.trim();
    }

    function openVariantBasePicker(variantItem) {
      const candidateItems = getVariantBaseItemCandidates(variantItem);
      const variantLabel = String(variantItem?.name ?? "Magic Variant");
      if (!candidateItems.length) {
        alert(`No compatible base items found for ${variantLabel}.`);
        return;
      }

      const variantSources = [...new Set(candidateItems.map((item) => String(item.source ?? "").trim()).filter(Boolean))].sort();

      const closeVariantPicker = openModal({
        title: `${variantLabel} - Choose Base Item`,
        bodyHtml: `
        <p class="subtitle">Select which base item to apply this variant to.</p>
        <div class="row">
          <label>Search
            <input id="variant-base-search" placeholder="Search base items...">
          </label>
          <label>Source
            <select id="variant-base-source">
              <option value="">All sources</option>
              ${variantSources.map((src) => `<option value="${esc(src)}">${esc(src)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="option-list" id="variant-base-list"></div>
      `,
        actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
      });

      const baseSearchEl = document.getElementById("variant-base-search");
      const baseSourceEl = document.getElementById("variant-base-source");
      const baseListEl = document.getElementById("variant-base-list");
      let filteredVariantCandidates = [];

      function renderVariantBaseRows() {
        const searchValue = String(baseSearchEl?.value ?? "").trim();
        const sourceValue = String(baseSourceEl?.value ?? "").trim();
        filteredVariantCandidates = candidateItems
          .filter((item) => matchesSearchQuery(searchValue, item.name, item.sourceLabel, item.source))
          .filter((item) => !sourceValue || item.source === sourceValue)
          .slice(0, 250);

        baseListEl.innerHTML = filteredVariantCandidates.length
          ? filteredVariantCandidates
              .map(
                (item, idx) => {
                  const requirementLabel = formatItemProficiencyRequirements(item);
                  return `
                <div class="option-row">
                  <div>
                    <strong>${esc(item.name)}</strong>
                    <div class="muted">${esc(item.sourceLabel ?? item.source)}</div>
                  </div>
                  <div class="option-row-actions">
                    ${requirementLabel ? `<div class="option-row-requirements muted" title="Required proficiency">${esc(requirementLabel)}</div>` : ""}
                    <button class="btn secondary" data-variant-base-pick="${idx}">Use</button>
                  </div>
                </div>
              `;
                }
              )
              .join("")
          : "<p class='muted'>No base items match these filters.</p>";

        baseListEl.querySelectorAll("[data-variant-base-pick]").forEach((button) => {
          button.addEventListener("mousedown", (evt) => {
            evt.preventDefault();
          });
          button.addEventListener("click", () => {
            const idx = toNumber(button.dataset.variantBasePick, -1);
            const baseItem = filteredVariantCandidates[idx];
            if (!baseItem) return;
            const concreteName = buildVariantItemName(variantItem, baseItem);
            if (!concreteName) return;
            const inventoryEntry = buildInventoryEntry(baseItem, concreteName, { variantItem });
            if (!inventoryEntry) return;
            store.addItem(inventoryEntry);
            closeVariantPicker();
          });
        });
      }

      baseSearchEl?.addEventListener("input", renderVariantBaseRows);
      baseSourceEl?.addEventListener("input", renderVariantBaseRows);
      baseSourceEl?.addEventListener("change", renderVariantBaseRows);
      renderVariantBaseRows();
    }

    function renderItemRows() {
      const searchValue = searchEl.value.trim();
      const sourceValue = sourceEl.value;
      filteredItems = allItems
        .filter((item) => matchesSearchQuery(searchValue, item.name, item.sourceLabel, item.source))
        .filter((item) => !sourceValue || item.source === sourceValue)
        .sort(compareItemsByName);

      listEl.innerHTML = filteredItems.length
        ? filteredItems
            .map(
              (item, idx) => {
                const requirementLabel = formatItemProficiencyRequirements(item);
                return `
            <div class="option-row">
              <div>
                <strong>${esc(item.name)}</strong>
                <div class="muted">${esc(item.sourceLabel ?? item.source)}</div>
              </div>
              <div class="option-row-actions">
                ${requirementLabel ? `<div class="option-row-requirements muted" title="Required proficiency">${esc(requirementLabel)}</div>` : ""}
                <button class="btn secondary" data-item-pick="${idx}">Add</button>
              </div>
            </div>
          `;
              }
            )
            .join("")
        : "<p class='muted'>No items match these filters.</p>";

      listEl.querySelectorAll("[data-item-pick]").forEach((button) => {
        button.addEventListener("mousedown", (evt) => {
          evt.preventDefault();
        });
        button.addEventListener("click", () => {
          const idx = toNumber(button.dataset.itemPick, -1);
          const item = filteredItems[idx];
          if (!item) return;
          const isMagicVariant = Array.isArray(item.requires) && item.requires.length > 0;
          if (isMagicVariant) {
            close();
            openVariantBasePicker(item);
            return;
          }
          const inventoryEntry = buildInventoryEntry(item);
          if (!inventoryEntry) return;
          store.addItem(inventoryEntry);
          close();
        });
      });
    }

    let filteredItems = [];

    searchEl?.addEventListener("input", renderItemRows);
    sourceEl?.addEventListener("input", renderItemRows);
    sourceEl?.addEventListener("change", renderItemRows);
    renderItemRows();
  }
 
  function getFeatSlotById(character, slotId) {
    const slots = Array.isArray(character?.progression?.featSlots) ? character.progression.featSlots : [];
    return slots.find((slot) => slot.id === slotId) ?? null;
  }

  function normalizeFeatCategoryList(value) {
    if (Array.isArray(value)) {
      return value
        .map((entry) => String(entry ?? "").trim().toUpperCase())
        .filter(Boolean);
    }
    const single = String(value ?? "").trim().toUpperCase();
    return single ? [single] : [];
  }

  function doesFeatMatchSlot(slot, featEntry) {
    const slotCategories = normalizeFeatCategoryList(slot?.featCategories);
    if (!slotCategories.length) return true;
    const featCategories = normalizeFeatCategoryList(featEntry?.category);
    if (!featCategories.length) return false;
    return slotCategories.some((category) => featCategories.includes(category));
  }

  function upsertFeatForSlot(state, slotId, featEntry) {
    const slot = getFeatSlotById(state.character, slotId);
    if (!slot || !featEntry) return;
    const featId = buildEntityId(["feat", featEntry.name, featEntry.source]);
    const nextFeats = (state.character.feats ?? []).filter((feat) => feat.slotId !== slotId && feat.id !== featId);
    nextFeats.push({
      id: featId,
      name: featEntry.name,
      source: featEntry.source,
      via: slot.slotType || "feat",
      levelGranted: toNumber(slot.level, 0),
      slotId,
    });
    updateCharacterWithRequiredSettings(state, { feats: nextFeats }, { preserveUserOverrides: true });
  }

  function buildFeatInlineDetails(featEntry) {
    const lines = getRuleDescriptionLines(featEntry);
    const descriptionHtml = lines.length
      ? lines
          .map((line) => {
            const body = renderTextWithInlineDiceButtons(line);
            return `<p>${body}</p>`;
          })
          .join("")
      : "<p class='muted'>No description is available for this feat.</p>";
    const categories = normalizeFeatCategoryList(featEntry.category);
    const prerequisites = Array.isArray(featEntry?.prerequisite) ? featEntry.prerequisite : [];
    return `
      <div class="feat-inline-details">
        <div class="feat-inline-meta muted">
          <span><strong>Source:</strong> ${esc(featEntry.sourceLabel ?? featEntry.source ?? "Unknown Source")}</span>
          ${categories.length ? `<span><strong>Category:</strong> ${esc(categories.join(", "))}</span>` : ""}
          ${prerequisites.length ? `<span><strong>Prerequisites:</strong> ${esc(String(prerequisites.length))}</span>` : ""}
        </div>
        <div class="spell-description">${descriptionHtml}</div>
      </div>
    `;
  }

  function openFeatModal(state, slotId) {
    const slot = getFeatSlotById(state.character, slotId);
    if (!slot) return;
    const allFeats = Array.isArray(state.catalogs.feats) ? state.catalogs.feats : [];
    const sourceOptions = [...new Set(allFeats.map((it) => it.source).filter(Boolean))].sort();
    const close = openModal({
      title: `Pick Feat (${slot.className} Lv ${slot.level})`,
      bodyHtml: `
      <div class="row">
        <label>Search
          <input id="feat-search" placeholder="Search feats...">
        </label>
        <label>Source
          <select id="feat-source">
            <option value="">All sources</option>
            ${sourceOptions.map((src) => `<option value="${esc(src)}">${esc(src)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="option-list" id="feat-list"></div>
    `,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });

    const searchEl = document.getElementById("feat-search");
    const sourceEl = document.getElementById("feat-source");
    const listEl = document.getElementById("feat-list");
    const selectedFeatId = (state.character.feats ?? []).find((feat) => feat.slotId === slot.id)?.id ?? "";
    const expandedFeatIds = new Set();

    function renderFeatRows() {
      const searchValue = String(searchEl?.value ?? "").trim();
      const sourceValue = String(sourceEl?.value ?? "").trim();
      const filtered = allFeats
        .filter((feat) => doesFeatMatchSlot(slot, feat))
        .filter((feat) => matchesSearchQuery(searchValue, feat.name, feat.sourceLabel, feat.source))
        .filter((feat) => !sourceValue || feat.source === sourceValue)
        .slice(0, 250);

      listEl.innerHTML = filtered.length
        ? filtered
            .map((feat) => {
              const featId = buildEntityId(["feat", feat.name, feat.source]);
              const isSelected = selectedFeatId === featId;
              const meetsPrereq = doesCharacterMeetFeatPrerequisites(state.character, feat);
              const isExpanded = expandedFeatIds.has(featId);
              const detailsHtml = isExpanded ? buildFeatInlineDetails(feat) : "";
              return `
              <div class="option-row">
                <div>
                  <div class="feat-picker-title-row">
                    <strong>${esc(feat.name)}</strong>
                    <button type="button" class="btn secondary feat-inline-toggle-btn" data-toggle-feat="${esc(featId)}">
                      ${isExpanded ? "Hide" : "Show"}
                    </button>
                  </div>
                  <div class="muted">${esc(feat.sourceLabel ?? feat.source ?? "Unknown Source")}${meetsPrereq ? "" : " - prerequisites not met"}</div>
                  ${detailsHtml}
                </div>
                <div class="option-row-actions">
                  <button type="button" class="btn secondary" data-pick-feat="${esc(featId)}" ${meetsPrereq ? "" : "disabled"}>
                    ${isSelected ? "Selected" : "Pick"}
                  </button>
                </div>
              </div>
            `;
            })
            .join("")
        : "<p class='muted'>No feats match these filters.</p>";

      listEl.querySelectorAll("[data-toggle-feat]").forEach((button) => {
        button.addEventListener("click", () => {
          const featId = button.dataset.toggleFeat;
          if (!featId) return;
          if (expandedFeatIds.has(featId)) expandedFeatIds.delete(featId);
          else expandedFeatIds.add(featId);
          renderFeatRows();
        });
      });

      listEl.querySelectorAll("[data-spell-roll]").forEach((button) => {
        button.addEventListener("click", () => {
          const notation = button.dataset.spellRoll;
          if (!notation) return;
          const row = button.closest(".option-row");
          const featName = row?.querySelector(".feat-picker-title-row strong")?.textContent ?? "Feat";
          rollVisualNotation(featName, notation);
        });
      });

      listEl.querySelectorAll("[data-pick-feat]").forEach((button) => {
        button.addEventListener("click", () => {
          const featId = button.dataset.pickFeat;
          const feat = filtered.find((entry) => buildEntityId(["feat", entry.name, entry.source]) === featId);
          if (!feat) return;
          upsertFeatForSlot(state, slot.id, feat);
          close();
        });
      });
    }

    [searchEl, sourceEl].forEach((el) => {
      el?.addEventListener("input", renderFeatRows);
      el?.addEventListener("change", renderFeatRows);
    });
    renderFeatRows();
  }

  function getOptionalFeatureSlotById(character, slotId) {
    const slots = Array.isArray(character?.progression?.optionalFeatureSlots) ? character.progression.optionalFeatureSlots : [];
    return slots.find((slot) => slot.id === slotId) ?? null;
  }

  function upsertOptionalFeatureForSlot(state, slotId, featureEntry) {
    const slot = getOptionalFeatureSlotById(state.character, slotId);
    if (!slot || !featureEntry) return;
    const featureId = buildEntityId(["optionalfeature", featureEntry.name, featureEntry.source]);
    const next = (state.character.optionalFeatures ?? []).filter((feature) => feature.slotId !== slotId && feature.id !== featureId);
    next.push({
      id: featureId,
      name: featureEntry.name,
      source: featureEntry.source,
      levelGranted: toNumber(slot.level, 0),
      slotId,
      className: slot.className,
      slotType: slot.slotType || "Optional Feature",
      featureType: slot.featureType || "",
    });
    updateCharacterWithRequiredSettings(state, { optionalFeatures: next }, { preserveUserOverrides: true });
  }

  function doesOptionalFeatureMatchSlot(slot, featureEntry) {
    const slotType = String(slot?.featureType ?? "").trim();
    if (!slotType) return true;
    const featureTypes = Array.isArray(featureEntry?.featureType)
      ? featureEntry.featureType.map((entry) => String(entry ?? "").trim())
      : [String(featureEntry?.featureType ?? "").trim()].filter(Boolean);
    return featureTypes.includes(slotType);
  }

  function openOptionalFeatureModal(state, slotId) {
    const slot = getOptionalFeatureSlotById(state.character, slotId);
    if (!slot) return;
    const allOptionalFeatures = Array.isArray(state.catalogs.optionalFeatures) ? state.catalogs.optionalFeatures : [];
    const matchingOptionalFeatures = allOptionalFeatures.filter((feature) => doesOptionalFeatureMatchSlot(slot, feature));
    const sourceOptions = [...new Set(matchingOptionalFeatures.map((it) => it.source).filter(Boolean))].sort();
    const close = openModal({
      title: `Pick ${slot.slotType || "Optional Feature"} (${slot.className} Lv ${slot.level})`,
      bodyHtml: `
      <div class="row">
        <label>Search
          <input id="optional-feature-search" placeholder="Search features...">
        </label>
        <label>Source
          <select id="optional-feature-source">
            <option value="">All sources</option>
            ${sourceOptions.map((src) => `<option value="${esc(src)}">${esc(src)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="option-list" id="optional-feature-list"></div>
    `,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });

    const searchEl = document.getElementById("optional-feature-search");
    const sourceEl = document.getElementById("optional-feature-source");
    const listEl = document.getElementById("optional-feature-list");
    const selectedId = (state.character.optionalFeatures ?? []).find((feature) => feature.slotId === slot.id)?.id ?? "";

    function renderOptionalFeatureRows() {
      const searchValue = String(searchEl?.value ?? "").trim();
      const sourceValue = String(sourceEl?.value ?? "").trim();
      const filtered = matchingOptionalFeatures
        .filter((feature) => matchesSearchQuery(searchValue, feature.name, feature.sourceLabel, feature.source))
        .filter((feature) => !sourceValue || feature.source === sourceValue)
        .slice(0, 250);
      listEl.innerHTML = filtered.length
        ? filtered
            .map((feature) => {
              const featureId = buildEntityId(["optionalfeature", feature.name, feature.source]);
              const isSelected = featureId === selectedId;
              const meetsPrereq = doesCharacterMeetOptionalFeaturePrerequisites(state.character, feature);
              return `
              <div class="option-row">
                <div>
                  <strong>${esc(feature.name)}</strong>
                  <div class="muted">${esc(feature.sourceLabel ?? feature.source ?? "Unknown Source")}${meetsPrereq ? "" : " - prerequisites not met"}</div>
                </div>
                <div class="option-row-actions">
                  <button type="button" class="btn secondary" data-pick-optional-feature="${esc(featureId)}" ${meetsPrereq ? "" : "disabled"}>
                    ${isSelected ? "Selected" : "Pick"}
                  </button>
                </div>
              </div>
            `;
            })
            .join("")
        : "<p class='muted'>No optional features match this slot.</p>";

      listEl.querySelectorAll("[data-pick-optional-feature]").forEach((button) => {
        button.addEventListener("click", () => {
          const featureId = button.dataset.pickOptionalFeature;
          const feature = filtered.find((entry) => buildEntityId(["optionalfeature", entry.name, entry.source]) === featureId);
          if (!feature) return;
          upsertOptionalFeatureForSlot(state, slot.id, feature);
          close();
        });
      });
    }

    [searchEl, sourceEl].forEach((el) => {
      el?.addEventListener("input", renderOptionalFeatureRows);
      el?.addEventListener("change", renderOptionalFeatureRows);
    });
    renderOptionalFeatureRows();
  }

  return { openSpellDetailsModal, openSpellModal, openItemModal, openFeatModal, openOptionalFeatureModal };
}

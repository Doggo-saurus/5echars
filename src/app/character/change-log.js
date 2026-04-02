export function createCharacterChangeLogDomain({
  toNumber,
  toTitleCase,
  esc,
  characterSyncMetaKey,
  characterChangeLogKey,
  characterChangeLogLimit,
  uiState,
  getState,
  render,
  queueRemoteSave,
  isUuid,
  isOnboardingHome,
}) {
  const abilityLabels = {
    str: "STR",
    dex: "DEX",
    con: "CON",
    int: "INT",
    wis: "WIS",
    cha: "CHA",
  };
  let persistenceNoticeMessage = "";
  let restoreDiceStateFromCharacterLog = () => {};
  let renderCharacterState = typeof render === "function" ? render : () => {};
  let queueRemoteCharacterSave = typeof queueRemoteSave === "function" ? queueRemoteSave : () => {};

  function setRestoreDiceStateFromCharacterLog(handler) {
    restoreDiceStateFromCharacterLog = typeof handler === "function" ? handler : () => {};
  }

  function setRender(handler) {
    renderCharacterState = typeof handler === "function" ? handler : () => {};
  }

  function setQueueRemoteSave(handler) {
    queueRemoteCharacterSave = typeof handler === "function" ? handler : () => {};
  }

  function getSyncMeta(character) {
    if (!character || typeof character !== "object" || Array.isArray(character)) return {};
    const meta = character[characterSyncMetaKey];
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
    return meta;
  }

  function getCharacterVersion(character) {
    const version = Number(getSyncMeta(character).version);
    return Number.isFinite(version) && version > 0 ? Math.floor(version) : 0;
  }

  function getCharacterUpdatedAtMs(character) {
    const updatedAt = getSyncMeta(character).updatedAt;
    if (typeof updatedAt !== "string" || !updatedAt.trim()) return 0;
    const parsed = Date.parse(updatedAt);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function withSyncMeta(character, version, updatedAt = null) {
    return {
      ...character,
      [characterSyncMetaKey]: {
        version: Math.max(1, Math.floor(Number(version) || 1)),
        updatedAt: typeof updatedAt === "string" && updatedAt ? updatedAt : new Date().toISOString(),
      },
    };
  }

  function stripSyncMeta(character) {
    if (!character || typeof character !== "object" || Array.isArray(character)) return character;
    const next = { ...character };
    delete next[characterSyncMetaKey];
    return next;
  }

  function buildCharacterFingerprint(character) {
    try {
      return JSON.stringify(stripSyncMeta(character) ?? {});
    } catch {
      return "";
    }
  }

  function createCharacterLogEntryId() {
    const stamp = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `clog_${stamp}_${rand}`;
  }

  function sanitizeCharacterLogEntry(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const summaryParts = Array.isArray(entry.summaryParts)
      ? entry.summaryParts
          .map((part) => {
            const text = String(part?.text ?? "");
            if (!text) return null;
            const style = part?.style === "bold" || part?.style === "highlight" ? part.style : "plain";
            return { text, style };
          })
          .filter(Boolean)
      : [];
    const details = Array.isArray(entry.details)
      ? entry.details
          .map((row) => {
            const label = String(row?.label ?? "").trim();
            const before = String(row?.before ?? "").trim();
            const after = String(row?.after ?? "").trim();
            if (!label && !before && !after) return null;
            return { label, before: before || "empty", after: after || "empty" };
          })
          .filter(Boolean)
      : [];
    const at = typeof entry.at === "string" && entry.at ? entry.at : new Date().toISOString();
    const rawSectionLabel = String(entry.sectionLabel ?? "").trim() || "Character";
    const sectionKey = String(entry.sectionKey ?? "").trim() || "character";
    const sectionLabel = sectionKey === "play" && rawSectionLabel.toLowerCase() === "play state"
      ? "Character Sheet"
      : rawSectionLabel;
    return {
      id: String(entry.id ?? "").trim() || createCharacterLogEntryId(),
      at,
      sectionKey,
      sectionLabel,
      summaryParts: summaryParts.length ? summaryParts : [{ text: "Updated character", style: "plain" }],
      details,
    };
  }

  function loadCharacterChangeLog(character) {
    const raw = character?.play?.[characterChangeLogKey];
    if (!Array.isArray(raw)) return [];
    return raw.map((entry) => sanitizeCharacterLogEntry(entry)).filter(Boolean).slice(0, characterChangeLogLimit);
  }

  function withCharacterChangeLog(character) {
    const nextCharacter = character && typeof character === "object" && !Array.isArray(character) ? { ...character } : {};
    const nextPlay = nextCharacter.play && typeof nextCharacter.play === "object" && !Array.isArray(nextCharacter.play)
      ? { ...nextCharacter.play }
      : {};
    nextPlay[characterChangeLogKey] = uiState.characterChangeLog.slice(0, characterChangeLogLimit);
    nextCharacter.play = nextPlay;
    return nextCharacter;
  }

  function seedCharacterLogState(character) {
    uiState.characterChangeLog = loadCharacterChangeLog(character);
    restoreDiceStateFromCharacterLog(uiState.characterChangeLog);
    uiState.lastCharacterSnapshot = stripSyncMeta(character) ?? null;
    uiState.lastCharacterLogFingerprint = buildCharacterFingerprint(character);
  }

  function getCharacterLogSectionLabel(sectionKey) {
    const labels = {
      id: "Character ID",
      name: "Name",
      critStyle: "Crit Style",
      showDiceTray: "Dice Tray",
      level: "Level",
      sourcePreset: "Source Preset",
      race: "Race",
      background: "Background",
      class: "Class",
      subclass: "Subclass",
      abilities: "Abilities",
      abilityBase: "Base Abilities",
      inventory: "Inventory",
      spells: "Spells",
      feats: "Feats",
      optionalFeatures: "Optional Features",
      notes: "Notes",
      multiclass: "Multiclass",
      classSelection: "Subclass Selection",
      progression: "Progression",
      hitPointRollOverrides: "Hit Point Rolls",
      play: "Character Sheet",
    };
    return labels[sectionKey] ?? toTitleCase(String(sectionKey ?? "Character"));
  }

  function serializeForDiff(value) {
    try {
      return JSON.stringify(value ?? null);
    } catch {
      return String(value);
    }
  }

  function truncateLogValue(value, maxLength = 64) {
    const text = String(value ?? "");
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
  }

  function summarizeLogValue(value) {
    if (value == null) return "empty";
    if (typeof value === "string") {
      const parsed = value.trim();
      return parsed ? truncateLogValue(`"${parsed}"`) : "empty";
    }
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
    if (typeof value === "object") {
      const size = Object.keys(value).length;
      return `${size} field${size === 1 ? "" : "s"}`;
    }
    return truncateLogValue(String(value));
  }

  function isPlainLogValue(value) {
    return value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
  }

  function buildSummaryPartsForSimpleChange(sectionLabel, beforeValue, afterValue) {
    return [
      { text: "Updated ", style: "plain" },
      { text: sectionLabel, style: "highlight" },
      { text: ": ", style: "plain" },
      { text: summarizeLogValue(beforeValue), style: "bold" },
      { text: " -> ", style: "plain" },
      { text: summarizeLogValue(afterValue), style: "bold" },
    ];
  }

  function normalizeLogRowValue(value) {
    if (value == null) return "empty";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return truncateLogValue(value, 80);
    return summarizeLogValue(value);
  }

  function buildObjectChangeRows(beforeValue, afterValue, maxRows = 8) {
    const beforeObj = beforeValue && typeof beforeValue === "object" && !Array.isArray(beforeValue) ? beforeValue : {};
    const afterObj = afterValue && typeof afterValue === "object" && !Array.isArray(afterValue) ? afterValue : {};
    const allKeys = [...new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])];
    const changedKeys = allKeys.filter((key) => serializeForDiff(beforeObj[key]) !== serializeForDiff(afterObj[key]));
    const visibleKeys = changedKeys.slice(0, maxRows);
    const rows = visibleKeys.map((key) => ({
      label: key,
      before: normalizeLogRowValue(beforeObj[key]),
      after: normalizeLogRowValue(afterObj[key]),
    }));
    if (changedKeys.length > visibleKeys.length) {
      rows.push({
        label: "more",
        before: `${changedKeys.length - visibleKeys.length} additional changes`,
        after: "…",
      });
    }
    return rows;
  }

  function buildArrayChangeRows(beforeValue, afterValue) {
    const beforeList = Array.isArray(beforeValue) ? beforeValue : [];
    const afterList = Array.isArray(afterValue) ? afterValue : [];
    const rows = [
      {
        label: "count",
        before: String(beforeList.length),
        after: String(afterList.length),
      },
    ];
    const primitiveToken = (value) =>
      value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
    if (!beforeList.every(primitiveToken) || !afterList.every(primitiveToken)) return rows;
    const beforeSet = new Set(beforeList.map((value) => String(value)));
    const afterSet = new Set(afterList.map((value) => String(value)));
    const added = [...afterSet].filter((value) => !beforeSet.has(value)).slice(0, 3);
    const removed = [...beforeSet].filter((value) => !afterSet.has(value)).slice(0, 3);
    if (added.length) rows.push({ label: "added", before: "-", after: truncateLogValue(added.join(", "), 80) });
    if (removed.length) rows.push({ label: "removed", before: truncateLogValue(removed.join(", "), 80), after: "-" });
    return rows;
  }

  function getLogEntityName(entry) {
    if (entry == null) return null;
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") return String(entry);
    if (typeof entry !== "object" || Array.isArray(entry)) return null;
    const byName = String(entry.name ?? "").trim();
    if (byName) return byName;
    const byClass = String(entry.class ?? "").trim();
    if (byClass) return byClass;
    const byId = String(entry.id ?? "").trim();
    if (byId) return byId;
    return null;
  }

  function buildNamedArrayRows(beforeValue, afterValue) {
    const beforeList = Array.isArray(beforeValue) ? beforeValue : [];
    const afterList = Array.isArray(afterValue) ? afterValue : [];
    const beforeNames = beforeList.map((entry) => getLogEntityName(entry)).filter(Boolean);
    const afterNames = afterList.map((entry) => getLogEntityName(entry)).filter(Boolean);
    const rows = [{ label: "count", before: String(beforeList.length), after: String(afterList.length) }];
    if (!beforeNames.length && !afterNames.length) return rows;
    const beforeSet = new Set(beforeNames);
    const afterSet = new Set(afterNames);
    const added = [...afterSet].filter((name) => !beforeSet.has(name)).slice(0, 3);
    const removed = [...beforeSet].filter((name) => !afterSet.has(name)).slice(0, 3);
    if (added.length) rows.push({ label: "added", before: "-", after: truncateLogValue(added.join(", "), 80) });
    if (removed.length) rows.push({ label: "removed", before: truncateLogValue(removed.join(", "), 80), after: "-" });
    return rows;
  }

  function buildStructuredChangeRows(beforeValue, afterValue) {
    if (Array.isArray(beforeValue) || Array.isArray(afterValue)) {
      const namedRows = buildNamedArrayRows(beforeValue, afterValue);
      if (namedRows.length > 1) return namedRows;
      return buildArrayChangeRows(beforeValue, afterValue);
    }
    if (
      (beforeValue && typeof beforeValue === "object" && !Array.isArray(beforeValue))
      || (afterValue && typeof afterValue === "object" && !Array.isArray(afterValue))
    ) {
      return buildObjectChangeRows(beforeValue, afterValue);
    }
    return [];
  }

  function buildAbilityChangeRows(beforeValue, afterValue) {
    const rows = [];
    const abilityKeys = ["str", "dex", "con", "int", "wis", "cha"];
    abilityKeys.forEach((ability) => {
      const beforeScore = toNumber(beforeValue?.[ability], Number.NaN);
      const afterScore = toNumber(afterValue?.[ability], Number.NaN);
      if (!Number.isFinite(beforeScore) && !Number.isFinite(afterScore)) return;
      if (beforeScore === afterScore) return;
      rows.push({
        label: abilityLabels[ability] ?? ability.toUpperCase(),
        before: Number.isFinite(beforeScore) ? String(beforeScore) : "empty",
        after: Number.isFinite(afterScore) ? String(afterScore) : "empty",
      });
    });
    return rows;
  }

  function buildPlayStateRows(beforeValue, afterValue) {
    const beforePlay = beforeValue && typeof beforeValue === "object" && !Array.isArray(beforeValue) ? beforeValue : {};
    const afterPlay = afterValue && typeof afterValue === "object" && !Array.isArray(afterValue) ? afterValue : {};
    const rows = [];
    const fieldMap = [
      { key: "hpCurrent", label: "HP" },
      { key: "hpTemp", label: "Temp HP" },
      { key: "speed", label: "Speed" },
      { key: "initiativeBonus", label: "Initiative" },
      { key: "deathSavesSuccess", label: "Death Saves (Success)" },
      { key: "deathSavesFail", label: "Death Saves (Fail)" },
    ];
    fieldMap.forEach((field) => {
      const beforeField = beforePlay[field.key];
      const afterField = afterPlay[field.key];
      if (serializeForDiff(beforeField) === serializeForDiff(afterField)) return;
      rows.push({
        label: field.label,
        before: summarizeLogValue(beforeField),
        after: summarizeLogValue(afterField),
      });
    });
    const conditionRows = buildNamedArrayRows(beforePlay.conditions, afterPlay.conditions);
    if (conditionRows.length > 1) {
      conditionRows.forEach((row) => rows.push({ ...row, label: row.label === "count" ? "Conditions" : row.label }));
    }
    return rows.slice(0, 8);
  }

  function buildPlayerFacingChangeEntry(key, beforeValue, afterValue, timestamp) {
    const sectionLabel = getCharacterLogSectionLabel(key);
    if (isPlainLogValue(beforeValue) && isPlainLogValue(afterValue)) {
      return {
        id: createCharacterLogEntryId(),
        at: timestamp,
        sectionKey: key,
        sectionLabel,
        summaryParts: buildSummaryPartsForSimpleChange(sectionLabel, beforeValue, afterValue),
        details: [],
      };
    }
    if (key === "abilities") {
      const abilityRows = buildAbilityChangeRows(beforeValue, afterValue);
      return {
        id: createCharacterLogEntryId(),
        at: timestamp,
        sectionKey: key,
        sectionLabel,
        summaryParts: [
          { text: "Updated ", style: "plain" },
          { text: "ability scores", style: "highlight" },
        ],
        details: abilityRows,
      };
    }
    if (key === "inventory" || key === "spells" || key === "feats" || key === "optionalFeatures" || key === "multiclass") {
      const nounMap = {
        inventory: "inventory",
        spells: "spells",
        feats: "feats",
        optionalFeatures: "optional features",
        multiclass: "class levels",
      };
      return {
        id: createCharacterLogEntryId(),
        at: timestamp,
        sectionKey: key,
        sectionLabel,
        summaryParts: [
          { text: "Updated ", style: "plain" },
          { text: nounMap[key] ?? sectionLabel.toLowerCase(), style: "highlight" },
        ],
        details: buildNamedArrayRows(beforeValue, afterValue),
      };
    }
    if (key === "play") {
      return {
        id: createCharacterLogEntryId(),
        at: timestamp,
        sectionKey: key,
        sectionLabel,
        summaryParts: [
          { text: "Updated ", style: "plain" },
          { text: "character sheet stats", style: "highlight" },
        ],
        details: buildPlayStateRows(beforeValue, afterValue),
      };
    }
    if (key === "progression" || key === "classSelection" || key === "hitPointRollOverrides") {
      return {
        id: createCharacterLogEntryId(),
        at: timestamp,
        sectionKey: key,
        sectionLabel,
        summaryParts: [
          { text: "Updated ", style: "plain" },
          { text: sectionLabel.toLowerCase(), style: "highlight" },
        ],
        details: [],
      };
    }
    const details = buildStructuredChangeRows(beforeValue, afterValue);
    return {
      id: createCharacterLogEntryId(),
      at: timestamp,
      sectionKey: key,
      sectionLabel,
      summaryParts: [
        { text: "Updated ", style: "plain" },
        { text: sectionLabel.toLowerCase(), style: "highlight" },
      ],
      details: details.slice(0, 6),
    };
  }

  function buildCharacterChangeEntries(previousCharacter, nextCharacter) {
    const previous = previousCharacter && typeof previousCharacter === "object" && !Array.isArray(previousCharacter) ? previousCharacter : {};
    const next = nextCharacter && typeof nextCharacter === "object" && !Array.isArray(nextCharacter) ? nextCharacter : {};
    const ignoredLogKeys = new Set([characterSyncMetaKey, "editPassword"]);
    const keyOrder = [
      "name",
      "critStyle",
      "showDiceTray",
      "level",
      "race",
      "background",
      "class",
      "subclass",
      "abilities",
      "inventory",
      "spells",
      "feats",
      "optionalFeatures",
      "multiclass",
      "play",
      "notes",
      "progression",
    ];
    const allKeys = [...new Set([...Object.keys(previous), ...Object.keys(next)])]
      .filter((key) => !ignoredLogKeys.has(key))
      .sort((a, b) => {
        const aIndex = keyOrder.indexOf(a);
        const bIndex = keyOrder.indexOf(b);
        if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
        if (aIndex >= 0) return -1;
        if (bIndex >= 0) return 1;
        return a.localeCompare(b);
      });
    const timestamp = new Date().toISOString();
    const entries = [];
    allKeys.forEach((key) => {
      const beforeValue = previous[key];
      const afterValue = next[key];
      if (serializeForDiff(beforeValue) === serializeForDiff(afterValue)) return;
      entries.push(buildPlayerFacingChangeEntry(key, beforeValue, afterValue, timestamp));
    });
    return entries;
  }

  function captureCharacterLogChanges(character) {
    const nextFingerprint = buildCharacterFingerprint(character);
    if (!nextFingerprint || nextFingerprint === uiState.lastCharacterLogFingerprint) return;
    const nextSnapshot = stripSyncMeta(character) ?? null;
    const previousSnapshot = uiState.lastCharacterSnapshot;
    uiState.lastCharacterSnapshot = nextSnapshot;
    uiState.lastCharacterLogFingerprint = nextFingerprint;
    if (!previousSnapshot || !nextSnapshot) return;
    if (previousSnapshot.id !== nextSnapshot.id) return;
    const nextEntries = buildCharacterChangeEntries(previousSnapshot, nextSnapshot);
    if (!nextEntries.length) return;
    uiState.characterChangeLog = [...nextEntries, ...uiState.characterChangeLog].slice(0, characterChangeLogLimit);
  }

  function appendCharacterLogEntry(entry, options = {}) {
    const normalized = sanitizeCharacterLogEntry(entry);
    if (!normalized) return;
    uiState.characterChangeLog = [normalized, ...uiState.characterChangeLog].slice(0, characterChangeLogLimit);
    if (options.renderNow !== false && !isOnboardingHome()) renderCharacterState(getState());
    if (options.syncRemote !== false) {
      const snapshot = getState();
      if (isUuid(snapshot.character?.id)) queueRemoteCharacterSave(snapshot);
    }
  }

  function appendDiceRollLog({ label, notation, total, rollValues = [], rollMode = "normal" }) {
    const parsedLabel = String(label ?? "").trim() || "Roll";
    const parsedNotation = String(notation ?? "").trim();
    const parsedTotal = Number.isFinite(total) ? String(total) : "n/a";
    const modeLabel = rollMode === "advantage" ? " (Advantage)" : rollMode === "disadvantage" ? " (Disadvantage)" : "";
    const detailRows = [];
    if (parsedNotation) detailRows.push({ label: "Roll", before: parsedNotation, after: parsedTotal });
    else detailRows.push({ label: "Total", before: "-", after: parsedTotal });
    if (Array.isArray(rollValues) && rollValues.length) {
      detailRows.push({
        label: "Dice",
        before: "-",
        after: truncateLogValue(rollValues.join(", "), 80),
      });
    }
    appendCharacterLogEntry({
      id: createCharacterLogEntryId(),
      at: new Date().toISOString(),
      sectionKey: "dice",
      sectionLabel: "Dice",
      summaryParts: [
        { text: "Rolled ", style: "plain" },
        { text: `${parsedLabel}${modeLabel}`, style: "highlight" },
        { text: " -> ", style: "plain" },
        { text: parsedTotal, style: "bold" },
      ],
      details: detailRows,
    });
  }

  function compareCharacterRecency(a, b) {
    const versionDiff = getCharacterVersion(a) - getCharacterVersion(b);
    if (versionDiff !== 0) return versionDiff;
    return getCharacterUpdatedAtMs(a) - getCharacterUpdatedAtMs(b);
  }

  function isRemoteSameOrNewer(localCharacter, remoteCharacter) {
    if (!remoteCharacter) return false;
    if (!localCharacter) return true;
    return compareCharacterRecency(remoteCharacter, localCharacter) >= 0;
  }

  function setPersistenceNotice(message) {
    const nextMessage = String(message ?? "").trim();
    if (persistenceNoticeMessage === nextMessage) return;
    persistenceNoticeMessage = nextMessage;
    if (!isOnboardingHome()) renderCharacterState(getState());
  }

  function updatePersistenceStatusFromPayload(payload) {
    const storage = payload?.storage;
    if (!storage || typeof storage !== "object" || Array.isArray(storage)) return;
    if (storage.durable) {
      setPersistenceNotice("");
      return;
    }
    const detail = typeof storage.warning === "string" ? storage.warning.trim() : "";
    setPersistenceNotice(
      detail
        ? `Server persistence is running in temporary non-durable mode (${detail}). Your recent edits are currently only guaranteed in this browser.`
        : "Server persistence is running in temporary non-durable mode. Your recent edits are currently only guaranteed in this browser."
    );
  }

  function markBrowserOnlyPersistence(error) {
    const sanitizedMessage =
      error instanceof Error && error.message
        ? error.message
            .replaceAll(/edit password/gi, "password")
            .replaceAll(/invalid password/gi, "Invalid password")
        : "";
    const detail = sanitizedMessage ? ` (${sanitizedMessage})` : "";
    setPersistenceNotice(
      `Server sync is currently unavailable${detail}. Your changes are saved in this browser for now, but not confirmed on the server.`
    );
  }

  function renderPersistenceNotice() {
    if (!persistenceNoticeMessage) return "";
    return `<p class="muted persistence-warning">${esc(persistenceNoticeMessage)}</p>`;
  }

  return {
    setRestoreDiceStateFromCharacterLog,
    setRender,
    setQueueRemoteSave,
    getSyncMeta,
    getCharacterVersion,
    getCharacterUpdatedAtMs,
    withSyncMeta,
    stripSyncMeta,
    buildCharacterFingerprint,
    sanitizeCharacterLogEntry,
    loadCharacterChangeLog,
    withCharacterChangeLog,
    seedCharacterLogState,
    createCharacterLogEntryId,
    getCharacterLogSectionLabel,
    serializeForDiff,
    truncateLogValue,
    summarizeLogValue,
    isPlainLogValue,
    buildSummaryPartsForSimpleChange,
    normalizeLogRowValue,
    buildObjectChangeRows,
    buildArrayChangeRows,
    getLogEntityName,
    buildNamedArrayRows,
    buildStructuredChangeRows,
    buildAbilityChangeRows,
    buildPlayStateRows,
    buildPlayerFacingChangeEntry,
    buildCharacterChangeEntries,
    captureCharacterLogChanges,
    appendCharacterLogEntry,
    appendDiceRollLog,
    compareCharacterRecency,
    isRemoteSameOrNewer,
    setPersistenceNotice,
    updatePersistenceStatusFromPayload,
    markBrowserOnlyPersistence,
    renderPersistenceNotice,
  };
}

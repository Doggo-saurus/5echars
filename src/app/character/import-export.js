export function createCharacterImportExport({
  isUuid,
  getCharacter,
  saveCharacter,
  createCharacter,
  getCharacterVersion,
  getCharacterFromApiPayload,
  withSyncMeta,
  withCharacterChangeLog,
  applyRemoteCharacterPayload,
  setCharacterIdInUrl,
  getCharacterDisplayName,
  loadCharacterHistory,
  buildImportOverwriteMessage,
  getCurrentCharacterId,
  getCurrentCharacterName,
  getLocalCharacterVersion,
}) {
  function readFileText(file) {
    if (!file || typeof file.text !== "function") throw new Error("Choose a JSON file to import.");
    return file.text();
  }

  function isImportEnvelope(candidate) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    if (!candidate.character || typeof candidate.character !== "object" || Array.isArray(candidate.character)) return false;
    const keys = Object.keys(candidate);
    return keys.every((key) =>
      key === "id" ||
      key === "character" ||
      key === "storage" ||
      key === "meta" ||
      key === "updatedAt" ||
      key === "version" ||
      key === "createdAt"
    );
  }

  function parseImportedCharacterPayload(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid JSON payload");
    }

    let candidate = parsed;
    let envelopeId = isUuid(parsed.id) ? parsed.id : null;
    let guard = 0;
    while (isImportEnvelope(candidate) && guard < 3) {
      if (!envelopeId && isUuid(candidate.id)) {
        envelopeId = candidate.id;
      }
      candidate = candidate.character;
      guard += 1;
    }

    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Invalid JSON payload");
    }

    const characterId = isUuid(candidate.id) ? candidate.id : envelopeId;
    return {
      id: characterId,
      character: characterId ? { ...candidate, id: characterId } : candidate,
    };
  }

  function sanitizeFileNamePart(value) {
    const parsed = String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return parsed || "character";
  }

  function normalizeImportedLanguages(candidate) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return candidate;
    if (Array.isArray(candidate.languages)) return candidate;
    if (!Array.isArray(candidate.customLanguages)) return candidate;
    return {
      ...candidate,
      languages: [...candidate.customLanguages],
    };
  }

  function exportCharacterToJsonFile(character) {
    if (!character || typeof character !== "object" || Array.isArray(character)) {
      throw new Error("No character available to export.");
    }
    const fileNameBase = sanitizeFileNamePart(character.name);
    const blob = new Blob([JSON.stringify(character, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileNameBase}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function doesRemoteCharacterExist(id) {
    if (!isUuid(id)) return false;
    try {
      await getCharacter(id);
      return true;
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && error.status === 404) return false;
      throw error;
    }
  }

  async function importCharacterFromParsedJson(parsed, options = {}) {
    const importedPayload = parseImportedCharacterPayload(parsed);
    const sourceLabel = String(options.sourceLabel ?? "Import");
    const importedId = importedPayload.id;
    const currentId = getCurrentCharacterId();
    const nextVersion = Math.max(getLocalCharacterVersion(), getCharacterVersion(importedPayload.character)) + 1;
    const preparedCharacter = withSyncMeta(
      withCharacterChangeLog(normalizeImportedLanguages(importedPayload.character)),
      nextVersion
    );

    if (importedId) {
      const isCurrentCharacter = importedId === currentId;
      const existingHistoryEntry = loadCharacterHistory().find((entry) => entry.id === importedId) ?? null;
      const existsRemotely = await doesRemoteCharacterExist(importedId);
      if (isCurrentCharacter || existsRemotely) {
        const displayName = isCurrentCharacter
          ? getCharacterDisplayName(getCurrentCharacterName())
          : getCharacterDisplayName(existingHistoryEntry?.name);
        const shouldContinue = window.confirm(
          buildImportOverwriteMessage(importedId, {
            sourceLabel,
            isCurrentCharacter,
            displayName,
          })
        );
        if (!shouldContinue) return { cancelled: true, id: importedId };
      }

      const payload = existsRemotely
        ? await saveCharacter(importedId, { ...preparedCharacter, id: importedId })
        : await createCharacter({ ...preparedCharacter, id: importedId });
      const normalized = getCharacterFromApiPayload(payload, importedId);
      setCharacterIdInUrl(normalized.id, false);
      await applyRemoteCharacterPayload(payload, normalized.id);
      return { cancelled: false, id: normalized.id };
    }

    const payload = await createCharacter(preparedCharacter);
    const normalized = getCharacterFromApiPayload(payload, null);
    setCharacterIdInUrl(normalized.id, false);
    await applyRemoteCharacterPayload(payload, normalized.id);
    return { cancelled: false, id: normalized.id };
  }

  async function importCharacterFromJsonFile(file, options = {}) {
    const text = await readFileText(file);
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON payload");
    }
    return importCharacterFromParsedJson(parsed, options);
  }

  return {
    readFileText,
    isImportEnvelope,
    parseImportedCharacterPayload,
    sanitizeFileNamePart,
    exportCharacterToJsonFile,
    buildImportOverwriteMessage,
    importCharacterFromParsedJson,
    importCharacterFromJsonFile,
  };
}

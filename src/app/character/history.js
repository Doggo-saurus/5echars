export function createCharacterHistory({
  toNumber,
  esc,
  isUuid,
  lastCharacterIdKey,
  characterHistoryKey,
  characterHistoryLimit,
  newCharacterOptionValue,
}) {
  function getCharacterIdFromUrl() {
    const parsed = String(new URL(window.location.href).searchParams.get("char") ?? "").trim().toLowerCase();
    return isUuid(parsed) ? parsed : null;
  }

  function setCharacterIdInUrl(id, replace = false) {
    const nextUrl = new URL(window.location.href);
    if (isUuid(id)) nextUrl.searchParams.set("char", String(id).trim().toLowerCase());
    else nextUrl.searchParams.delete("char");
    const nextHref = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    if (replace) window.history.replaceState({}, "", nextHref);
    else window.history.pushState({}, "", nextHref);
  }

  function getLastCharacterId() {
    const parsed = String(localStorage.getItem(lastCharacterIdKey) ?? "").trim().toLowerCase();
    return isUuid(parsed) ? parsed : null;
  }

  function rememberLastCharacterId(id) {
    if (!isUuid(id)) return;
    localStorage.setItem(lastCharacterIdKey, String(id).trim().toLowerCase());
  }

  function clearLastCharacterId() {
    localStorage.removeItem(lastCharacterIdKey);
  }

  function getCharacterDisplayName(name) {
    const value = String(name ?? "").trim();
    return value || "Unnamed Character";
  }

  function buildClassLevelSummary(character, fallbackClassName = "", fallbackLevel = 1) {
    const className = String(character?.class ?? fallbackClassName ?? "").trim() || "Unknown class";
    const level = Math.max(1, Math.min(20, toNumber(character?.level, fallbackLevel)));
    const multiclass = Array.isArray(character?.multiclass) ? character.multiclass : [];
    if (!multiclass.length) return `${className} ${level}`;
    const parts = [`${className} ${level}`];
    multiclass.forEach((entry) => {
      const name = String(entry?.class ?? "").trim();
      if (!name) return;
      const mcLevel = Math.max(1, Math.min(20, toNumber(entry?.level, 1)));
      parts.push(`${name} ${mcLevel}`);
    });
    return parts.join(" / ");
  }

  function formatCharacterHistoryEntrySummary(entry) {
    if (!entry || typeof entry !== "object") return "Unnamed Character";
    const name = getCharacterDisplayName(entry.name);
    const classSummary = String(entry.classSummary ?? "").trim() || buildClassLevelSummary(entry, entry.className, entry.level);
    return `${name} - ${classSummary}`;
  }

  function loadCharacterHistory() {
    let parsed = [];
    try {
      parsed = JSON.parse(localStorage.getItem(characterHistoryKey) ?? "[]");
    } catch {
      parsed = [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        const id = String(entry?.id ?? "").trim().toLowerCase();
        if (!isUuid(id)) return null;
        const name = getCharacterDisplayName(entry?.name);
        const level = Math.max(1, Math.min(20, toNumber(entry?.level, 1)));
        const className = String(entry?.className ?? "").trim();
        const classSummary = String(entry?.classSummary ?? "").trim() || `${className || "Unknown class"} ${level}`;
        const lastAccessedAt = typeof entry?.lastAccessedAt === "string" && entry.lastAccessedAt
          ? entry.lastAccessedAt
          : new Date().toISOString();
        return { id, name, level, className, classSummary, lastAccessedAt };
      })
      .filter(Boolean)
      .slice(0, characterHistoryLimit);
  }

  function saveCharacterHistory(entries) {
    if (!Array.isArray(entries)) return;
    localStorage.setItem(characterHistoryKey, JSON.stringify(entries.slice(0, characterHistoryLimit)));
  }

  function upsertCharacterHistory(character, options = {}) {
    const id = typeof character?.id === "string" ? character.id.trim().toLowerCase() : "";
    if (!isUuid(id)) return;
    const shouldTouchAccess = options.touchAccess !== false;
    const entries = loadCharacterHistory();
    const current = entries.find((entry) => entry.id === id) ?? null;
    const nextName = getCharacterDisplayName(character?.name || current?.name);
    const nextLevel = Math.max(1, Math.min(20, toNumber(character?.level, current?.level ?? 1)));
    const nextClassName = String(character?.class ?? current?.className ?? "").trim();
    const nextClassSummary = buildClassLevelSummary(character, current?.className, current?.level ?? nextLevel);

    if (!current) {
      saveCharacterHistory([
        {
          id,
          name: nextName,
          level: nextLevel,
          className: nextClassName,
          classSummary: nextClassSummary,
          lastAccessedAt: new Date().toISOString(),
        },
        ...entries,
      ]);
      return;
    }

    if (!shouldTouchAccess) {
      saveCharacterHistory(
        entries.map((entry) =>
          entry.id === id
            ? { ...entry, name: nextName, level: nextLevel, className: nextClassName, classSummary: nextClassSummary }
            : entry
        )
      );
      return;
    }

    const withoutCurrent = entries.filter((entry) => entry.id !== id);
    saveCharacterHistory([
      {
        id,
        name: nextName,
        level: nextLevel,
        className: nextClassName,
        classSummary: nextClassSummary,
        lastAccessedAt: new Date().toISOString(),
      },
      ...withoutCurrent,
    ]);
  }

  function removeCharacterFromHistory(characterId) {
    const parsedCharacterId = String(characterId ?? "").trim().toLowerCase();
    if (!isUuid(parsedCharacterId)) return;
    const entries = loadCharacterHistory();
    if (!entries.some((entry) => entry.id === parsedCharacterId)) return;
    const nextEntries = entries.filter((entry) => entry.id !== parsedCharacterId);
    saveCharacterHistory(nextEntries);
    const nextLastCharacterId = String(nextEntries[0]?.id ?? "").trim();
    if (isUuid(nextLastCharacterId)) rememberLastCharacterId(nextLastCharacterId);
    else clearLastCharacterId();
  }

  function renderCharacterHistorySelector(selectId, selectedCharacterId = null, options = {}) {
    const className = String(options.className ?? "character-history-control");
    const entries = loadCharacterHistory();
    return `
      <label class="${esc(className)}">
        <select id="${esc(selectId)}" data-character-history-select>
          ${entries
            .map((entry) => {
              const selected = selectedCharacterId === entry.id ? "selected" : "";
              const label = formatCharacterHistoryEntrySummary(entry);
              return `<option value="${esc(entry.id)}" ${selected}>${esc(label)}</option>`;
            })
            .join("")}
          <option value="${newCharacterOptionValue}">New character</option>
        </select>
      </label>
    `;
  }

  return {
    getCharacterIdFromUrl,
    setCharacterIdInUrl,
    getLastCharacterId,
    rememberLastCharacterId,
    clearLastCharacterId,
    getCharacterDisplayName,
    buildClassLevelSummary,
    formatCharacterHistoryEntrySummary,
    loadCharacterHistory,
    saveCharacterHistory,
    upsertCharacterHistory,
    removeCharacterFromHistory,
    renderCharacterHistorySelector,
  };
}

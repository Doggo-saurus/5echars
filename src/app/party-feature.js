import { createParty, getParty, getStoredPartyPassword, saveParty, setStoredPartyPassword } from "../party-api.js";
import { getCharacter } from "../character-api.js";
import { computeDerivedStats } from "../engine/rules.js";

const PARTY_HISTORY_KEY = "fivee-party-history";
const PARTY_HISTORY_LIMIT = 20;
const NEW_PARTY_OPTION_VALUE = "__new_party__";
const PARTY_AUTO_REFRESH_INTERVAL_MS = 30_000;

export function createPartyFeature(deps) {
  const {
    app,
    appState,
    store,
    isUuid,
    esc,
    toNumber,
    openModal,
    loadCharacterHistory,
    loadCharacterById,
    getCatalogsForCharacter,
    openClassDetailsModalForCharacter,
    openSubclassDetailsModalForCharacter,
    render,
  } = deps;
  const memberCharacterCache = new Map();
  const memberDerivedCache = new Map();
  let partyAutoRefreshTimer = null;
  let isPartyAutoRefreshInFlight = false;

  const readPartyHistory = () => {
    let parsed = [];
    try {
      const raw = localStorage.getItem(PARTY_HISTORY_KEY);
      const json = raw ? JSON.parse(raw) : [];
      if (Array.isArray(json)) parsed = json;
    } catch {
      parsed = [];
    }
    return parsed
      .map((entry) => {
        const id = typeof entry?.id === "string" ? entry.id.trim().toLowerCase() : "";
        if (!isUuid(id)) return null;
        const name = String(entry?.name ?? "").trim() || "Untitled Party";
        const memberCount = Math.max(0, toNumber(entry?.memberCount, 0));
        const lastAccessedAt = typeof entry?.lastAccessedAt === "string" ? entry.lastAccessedAt : "";
        return { id, name, memberCount, lastAccessedAt };
      })
      .filter(Boolean)
      .slice(0, PARTY_HISTORY_LIMIT);
  };

  const writePartyHistory = (entries) => {
    if (!Array.isArray(entries)) return;
    localStorage.setItem(PARTY_HISTORY_KEY, JSON.stringify(entries.slice(0, PARTY_HISTORY_LIMIT)));
  };

  const removePartyFromHistory = (partyId) => {
    const parsedPartyId = String(partyId ?? "").trim().toLowerCase();
    if (!isUuid(parsedPartyId)) return;
    const nextEntries = readPartyHistory().filter((entry) => entry.id !== parsedPartyId);
    writePartyHistory(nextEntries);
  };

  const formatPartyHistoryEntrySummary = (entry) => {
    const name = String(entry?.name ?? "").trim() || "Untitled Party";
    return name;
  };

  const getLastPartyEntry = () => readPartyHistory()[0] ?? null;

  const getLastPartyId = () => {
    const id = String(getLastPartyEntry()?.id ?? "").trim();
    return isUuid(id) ? id : null;
  };

  const getLastPartySummary = () => {
    const entry = getLastPartyEntry();
    if (!entry) return "No recent party found in this browser.";
    return formatPartyHistoryEntrySummary(entry);
  };

  const upsertPartyHistory = (party, options = {}) => {
    const id = typeof party?.id === "string" ? party.id.trim().toLowerCase() : "";
    if (!isUuid(id)) return;
    const shouldTouchAccess = options.touchAccess !== false;
    const entries = readPartyHistory();
    const current = entries.find((entry) => entry.id === id) ?? null;
    const nextEntry = {
      id,
      name: String(party?.name ?? current?.name ?? "").trim() || "Untitled Party",
      memberCount: Array.isArray(party?.members) ? party.members.length : Math.max(0, toNumber(current?.memberCount, 0)),
      lastAccessedAt: new Date().toISOString(),
    };
    if (!current) {
      writePartyHistory([nextEntry, ...entries]);
      return;
    }
    if (!shouldTouchAccess) {
      writePartyHistory(entries.map((entry) => (entry.id === id ? { ...entry, ...nextEntry, lastAccessedAt: entry.lastAccessedAt } : entry)));
      return;
    }
    const withoutCurrent = entries.filter((entry) => entry.id !== id);
    writePartyHistory([nextEntry, ...withoutCurrent]);
  };

  const getPartyIdFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("party");
    return isUuid(id) ? id : null;
  };

  const setCharacterInUrl = (characterId, replace = false) => {
    if (!isUuid(characterId)) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("party");
    url.searchParams.set("char", characterId);
    if (replace) window.history.replaceState({}, "", url.toString());
    else window.history.pushState({}, "", url.toString());
  };

  const getCharacterUrl = (characterId) => {
    if (!isUuid(characterId)) return "#";
    const url = new URL(window.location.href);
    url.searchParams.delete("party");
    url.searchParams.set("char", characterId);
    return url.toString();
  };

  const setPartyIdInUrl = (id, replace = false) => {
    const url = new URL(window.location.href);
    if (isUuid(id)) url.searchParams.set("party", id);
    else url.searchParams.delete("party");
    url.searchParams.delete("char");
    if (replace) window.history.replaceState({}, "", url.toString());
    else window.history.pushState({}, "", url.toString());
  };

  const clearPartyIdInUrl = (replace = true) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("party");
    if (replace) window.history.replaceState({}, "", url.toString());
    else window.history.pushState({}, "", url.toString());
  };

  const stopPartyAutoRefresh = () => {
    if (partyAutoRefreshTimer != null) {
      window.clearInterval(partyAutoRefreshTimer);
      partyAutoRefreshTimer = null;
    }
  };

  const refreshActivePartyFromRemote = async (options = {}) => {
    if (isPartyAutoRefreshInFlight) return;
    const partyId = String(appState.activePartyId ?? appState.activeParty?.id ?? "").trim();
    if (!isUuid(partyId)) return;
    isPartyAutoRefreshInFlight = true;
    try {
      const payload = await getParty(partyId);
      const party = payload?.party;
      if (!party || typeof party !== "object" || Array.isArray(party)) return;
      const nextActiveParty = { ...party, id: partyId };
      const currentSerialized = JSON.stringify(appState.activeParty ?? null);
      const nextSerialized = JSON.stringify(nextActiveParty);
      const didPartyChange = currentSerialized !== nextSerialized;
      if (didPartyChange) {
        appState.activePartyId = partyId;
        appState.activeParty = nextActiveParty;
        upsertPartyHistory(appState.activeParty, { touchAccess: false });
        render(store.getState());
      }
      void hydratePartyMemberSnapshots(nextActiveParty, { forceRefresh: true });
    } catch (error) {
      if (options.suppressErrors === true) return;
      throw error;
    } finally {
      isPartyAutoRefreshInFlight = false;
    }
  };

  const startPartyAutoRefresh = () => {
    stopPartyAutoRefresh();
    partyAutoRefreshTimer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshActivePartyFromRemote({ suppressErrors: true });
    }, PARTY_AUTO_REFRESH_INTERVAL_MS);
  };

  const clearActiveParty = () => {
    stopPartyAutoRefresh();
    memberCharacterCache.clear();
    memberDerivedCache.clear();
    appState.activePartyId = null;
    appState.activeParty = null;
    clearPartyIdInUrl(true);
  };

  const forgetActivePartyAndRedirectHome = () => {
    const partyId = String(appState.activePartyId ?? appState.activeParty?.id ?? "").trim();
    if (!isUuid(partyId)) return;
    removePartyFromHistory(partyId);
    // Also remove locally cached password for forgotten parties.
    setStoredPartyPassword(partyId, "");
    clearActiveParty();
    window.location.replace("/");
  };

  const isCharacterInActiveParty = (characterId) => {
    const parsedId = String(characterId ?? "").trim();
    if (!isUuid(parsedId)) return false;
    return Array.isArray(appState.activeParty?.members)
      ? appState.activeParty.members.some((member) => String(member?.characterId ?? "").trim() === parsedId)
      : false;
  };

  const renderPartyHistorySelector = (selectId, selectedPartyId = null, options = {}) => {
    const className = String(options.className ?? "party-history-control");
    const entries = readPartyHistory();
    return `
      <label class="${esc(className)}">
        <select id="${esc(selectId)}" data-party-history-select>
          ${entries
            .map((entry) => {
              const selected = selectedPartyId === entry.id ? "selected" : "";
              return `<option value="${esc(entry.id)}" ${selected}>${esc(formatPartyHistoryEntrySummary(entry))}</option>`;
            })
            .join("")}
          <option value="${NEW_PARTY_OPTION_VALUE}">New party</option>
        </select>
      </label>
    `;
  };

  const getSelectedPartyIdFromPage = () => {
    const selectedValue = String(app.querySelector("#party-history-select")?.value ?? "").trim();
    if (isUuid(selectedValue)) return selectedValue;
    if (isUuid(appState.activePartyId)) return appState.activePartyId;
    const firstHistoryId = readPartyHistory()[0]?.id;
    return isUuid(firstHistoryId) ? firstHistoryId : null;
  };

  const extractCharacterIdFromInput = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    if (isUuid(raw)) return raw;
    try {
      const url = new URL(raw);
      const candidate = String(url.searchParams.get("char") ?? "").trim();
      return isUuid(candidate) ? candidate : null;
    } catch {
      const match = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
      return isUuid(match?.[0]) ? String(match[0]).toLowerCase() : null;
    }
  };

  const buildCharacterHistorySummary = (entry) => {
    const name = String(entry?.name ?? "").trim() || "Unnamed Character";
    const level = Math.max(1, Math.min(20, toNumber(entry?.level, 1)));
    const classSummary = String(entry?.classSummary ?? entry?.className ?? "").trim();
    return classSummary ? `${name} (Level ${level} ${classSummary})` : name;
  };

  const addCharacterToActiveParty = async (characterId) => {
    const parsedCharacterId = String(characterId ?? "").trim();
    const activeParty = appState.activeParty;
    const partyId = String(activeParty?.id ?? appState.activePartyId ?? "").trim();
    if (!isUuid(parsedCharacterId) || !isUuid(partyId) || !activeParty) {
      throw new Error("No active party selected.");
    }
    const members = Array.isArray(activeParty.members) ? activeParty.members : [];
    if (members.some((member) => String(member?.characterId ?? "").trim() === parsedCharacterId)) {
      throw new Error("Character is already in the party.");
    }
    await saveActiveParty({
      ...activeParty,
      id: partyId,
      members: [...members, { characterId: parsedCharacterId, pinned: false }],
    });
  };

  const openAddCharacterModal = () => {
    const activeParty = appState.activeParty;
    if (!activeParty || typeof activeParty !== "object" || Array.isArray(activeParty)) return;
    const memberIds = new Set(
      (Array.isArray(activeParty.members) ? activeParty.members : [])
        .map((member) => String(member?.characterId ?? "").trim())
        .filter((id) => isUuid(id))
    );
    const availableCharacters = loadCharacterHistory().filter(
      (entry) => isUuid(entry?.id) && !memberIds.has(String(entry.id).trim())
    );
    let isSubmitting = false;
    openModal({
      title: "Add Character to Party",
      bodyHtml: `
        <div class="party-add-modal">
          <label>
            Paste character link or UUID
            <input id="party-add-character-input" type="text" placeholder="https://.../character?char=... or UUID">
          </label>
          <p class="muted party-add-modal-separator">or</p>
          <label>
            Choose from characters saved in this browser
            <select id="party-add-character-select">
              <option value="">Select a character</option>
              ${availableCharacters
                .map((entry) => `<option value="${esc(String(entry.id))}">${esc(buildCharacterHistorySummary(entry))}</option>`)
                .join("")}
            </select>
          </label>
        </div>
      `,
      actions: [
        {
          label: "Add Character",
          onClick: async (done) => {
            if (isSubmitting) return;
            const inputEl = document.getElementById("party-add-character-input");
            const selectEl = document.getElementById("party-add-character-select");
            const inputCharacterId = extractCharacterIdFromInput(inputEl?.value ?? "");
            const selectedCharacterId = isUuid(selectEl?.value) ? String(selectEl.value).trim() : null;
            const characterId = inputCharacterId ?? selectedCharacterId;
            if (!isUuid(characterId)) {
              alert("Paste a valid character link/UUID or choose one from the list.");
              return;
            }
            isSubmitting = true;
            try {
              await addCharacterToActiveParty(characterId);
              done();
              render(store.getState());
            } catch (error) {
              alert(error instanceof Error ? error.message : "Failed to add character to party");
            } finally {
              isSubmitting = false;
            }
          },
        },
        { label: "Cancel", secondary: true, onClick: (done) => done() },
      ],
    });
  };

  const renderActivePartyPanel = () => {
    const party = appState.activeParty;
    const partyId = String(appState.activePartyId ?? "").trim();
    if (!isUuid(partyId) || !party || typeof party !== "object" || Array.isArray(party)) {
      return `
        <section class="party-panel">
          <p class="muted">Open a party to view members and manage the roster.</p>
        </section>
      `;
    }
    const historyById = new Map(loadCharacterHistory().map((entry) => [entry.id, entry]));
    const getMemberSnapshot = (characterId) => {
      const snapshot = memberCharacterCache.get(characterId);
      return snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : null;
    };
    const getMemberDerived = (snapshot, characterId = "") => {
      if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
      const parsedId = String(characterId ?? "").trim();
      if (isUuid(parsedId)) {
        const cached = memberDerivedCache.get(parsedId);
        if (cached && typeof cached === "object" && !Array.isArray(cached)) return cached;
      }
      try {
        return computeDerivedStats(snapshot, store.getState()?.catalogs ?? null);
      } catch {
        return null;
      }
    };
    const buildClassSummary = (snapshot, history) => {
      const level = Math.max(1, Math.min(20, toNumber(snapshot?.level ?? history?.level, 1)));
      const className = String(snapshot?.class ?? history?.classSummary ?? history?.className ?? "").trim();
      const subclass = String(snapshot?.subclass ?? "").trim();
      return { level, className, subclass };
    };
    const buildSpeciesSummary = (snapshot) => {
      const race = String(snapshot?.race ?? "").trim();
      const subrace = String(snapshot?.subrace ?? "").trim();
      if (race && subrace) return `${race} (${subrace})`;
      return race || "Unknown ancestry";
    };
    const buildBackgroundSummary = (snapshot) => String(snapshot?.background ?? "").trim() || "No background";
    const normalizeSkillProficiencyMode = (value) => {
      const mode = String(value ?? "").trim().toLowerCase();
      if (mode === "half" || mode === "proficient" || mode === "expertise") return mode;
      return "none";
    };
    const getSkillProficiencyBonus = (proficiencyBonus, mode) => {
      if (mode === "expertise") return proficiencyBonus * 2;
      if (mode === "proficient") return proficiencyBonus;
      if (mode === "half") return Math.floor(proficiencyBonus / 2);
      return 0;
    };
    const readFiniteNumber = (value) => {
      if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const direct = Number(trimmed);
        if (Number.isFinite(direct)) return direct;
        const matched = trimmed.match(/-?\d+(\.\d+)?/);
        if (!matched) return null;
        const parsed = Number(matched[0]);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };
    const getMetricValue = (snapshot, ...candidates) => {
      for (const candidate of candidates) {
        let rawValue = candidate;
        if (typeof candidate === "function") {
          const computed = candidate(snapshot);
          rawValue = computed;
        }
        const value = readFiniteNumber(rawValue);
        if (value !== null) return String(value);
      }
      return "Unknown";
    };
    const getHpSummary = (snapshot, derived) => {
      const current = readFiniteNumber(snapshot?.play?.hpCurrent);
      const max = getMetricValue(snapshot, derived?.hp);
      const temp = readFiniteNumber(snapshot?.play?.hpTemp) ?? 0;
      if (current !== null && max !== "Unknown") {
        return temp > 0 ? `${Math.max(0, current)}/${max} (+${temp} temp)` : `${Math.max(0, current)}/${max}`;
      }
      if (current !== null) {
        return temp > 0 ? `${Math.max(0, current)} (+${temp} temp)` : String(Math.max(0, current));
      }
      if (max !== "Unknown") return temp > 0 ? `${max}/${max} (+${temp} temp)` : `${max}/${max}`;
      return temp > 0 ? `Unknown (+${temp} temp)` : "Unknown";
    };
    const getArmorClassSummary = (snapshot, derived) =>
      getMetricValue(snapshot, derived?.ac, snapshot?.play?.armorClass, snapshot?.armorClass, snapshot?.ac);
    const getSpeedSummary = (snapshot) =>
      getMetricValue(snapshot, snapshot?.play?.speed, snapshot?.speed, (value) => {
        const walkFromSelf = readFiniteNumber(value?.walk);
        if (walkFromSelf !== null) return walkFromSelf;
        const walkFromNested = readFiniteNumber(value?.speed?.walk);
        if (walkFromNested !== null) return walkFromNested;
        return null;
      });
    const getInitiativeSummary = (snapshot, derived) => {
      const dexMod = readFiniteNumber(derived?.mods?.dex);
      const bonus = readFiniteNumber(snapshot?.play?.initiativeBonus) ?? 0;
      if (dexMod !== null) {
        const total = dexMod + bonus;
        return total >= 0 ? `+${total}` : String(total);
      }
      const direct = readFiniteNumber(snapshot?.initiative) ?? readFiniteNumber(snapshot?.play?.initiative);
      if (direct !== null) return direct >= 0 ? `+${direct}` : String(direct);
      return "Unknown";
    };
    const getPassiveSkills = (snapshot, derived) => {
      const play = snapshot?.play ?? {};
      const proficiencyBonus = readFiniteNumber(derived?.proficiencyBonus) ?? 2;
      const abilityModFromScore = (abilityKey) => {
        const score = readFiniteNumber(snapshot?.abilities?.[abilityKey]);
        if (score === null) return 0;
        return Math.floor((score - 10) / 2);
      };
      const getAbilityMod = (abilityKey) => {
        const fromDerived = readFiniteNumber(derived?.mods?.[abilityKey]);
        if (fromDerived !== null) return fromDerived;
        return abilityModFromScore(abilityKey);
      };
      const computePassiveSkill = (skillKey, abilityKey) => {
        const mode = normalizeSkillProficiencyMode(
          play.skillProficiencyModes?.[skillKey] ?? (play.skillProficiencies?.[skillKey] ? "proficient" : "none")
        );
        const proficiency = getSkillProficiencyBonus(proficiencyBonus, mode);
        return 10 + getAbilityMod(abilityKey) + proficiency;
      };
      const derivedPerception = readFiniteNumber(derived?.passivePerception);
      const derivedInsight = readFiniteNumber(derived?.passiveInsight);
      const derivedInvestigation = readFiniteNumber(derived?.passiveInvestigation);
      return {
        perception: derivedPerception ?? computePassiveSkill("perception", "wis"),
        insight: derivedInsight ?? computePassiveSkill("insight", "wis"),
        investigation: derivedInvestigation ?? computePassiveSkill("investigation", "int"),
      };
    };
    const members = Array.isArray(party.members) ? party.members : [];
    const cards = members
      .map((member, index) => {
        const characterId = String(member?.characterId ?? "").trim();
        if (!isUuid(characterId)) return "";
        const snapshot = getMemberSnapshot(characterId);
        const history = historyById.get(characterId) ?? null;
        const fallbackName = `Character ${index + 1}`;
        const name =
          String(member?.nickname ?? "").trim()
          || String(snapshot?.name ?? "").trim()
          || String(history?.name ?? "").trim()
          || fallbackName;
        const classSummary = buildClassSummary(snapshot, history);
        const speciesSummary = buildSpeciesSummary(snapshot);
        const backgroundSummary = buildBackgroundSummary(snapshot);
        const derived = getMemberDerived(snapshot, characterId);
        const hpSummary = getHpSummary(snapshot, derived);
        const acSummary = getArmorClassSummary(snapshot, derived);
        const speedSummary = getSpeedSummary(snapshot);
        const initiativeSummary = getInitiativeSummary(snapshot, derived);
        const passiveSkills = getPassiveSkills(snapshot, derived);
        return `
          <li class="party-member-row">
            <div class="party-member-details">
              <div class="party-member-top">
                <h4 class="party-member-heading">
                  <span class="party-member-name">${esc(name)}</span>
                  <span class="muted party-member-subtitle">
                    <span class="party-member-level">Level ${esc(String(classSummary.level))}</span>
                    ${
                      classSummary.className
                        ? `<button
                            class="party-member-inline-action"
                            type="button"
                            data-party-open-class-info="${esc(characterId)}"
                            title="View class details"
                          >${esc(classSummary.className)}</button>`
                        : `<span>${esc("Adventurer")}</span>`
                    }
                    ${
                      classSummary.subclass
                        ? `<span class="party-member-subtitle-separator" aria-hidden="true">-</span>
                           <button
                             class="party-member-inline-action"
                             type="button"
                             data-party-open-subclass-info="${esc(characterId)}"
                             title="View subclass details"
                           >${esc(classSummary.subclass)}</button>`
                        : ""
                    }
                  </span>
                </h4>
              </div>
              <div class="party-member-meta party-member-tags">
                <span class="party-meta-chip">${esc(speciesSummary)}</span>
                <span class="party-meta-chip">${esc(backgroundSummary)}</span>
              </div>
              <div class="party-member-stats-grid">
                <div class="party-stat">
                  <span class="party-stat-label">HP</span>
                  <span class="party-stat-value">${esc(hpSummary)}</span>
                </div>
                <div class="party-stat">
                  <span class="party-stat-label">AC</span>
                  <span class="party-stat-value">${esc(acSummary)}</span>
                </div>
                <div class="party-stat">
                  <span class="party-stat-label">Initiative</span>
                  <span class="party-stat-value">${esc(initiativeSummary)}</span>
                </div>
                <div class="party-stat">
                  <span class="party-stat-label">Speed</span>
                  <span class="party-stat-value">${esc(speedSummary)}</span>
                </div>
              </div>
              <div class="party-member-passive-list" aria-label="Passive skills">
                <div class="party-passive-stat">
                  <span class="party-passive-label">Passive Perception</span>
                  <span class="party-passive-value">${esc(String(passiveSkills.perception))}</span>
                </div>
                <div class="party-passive-stat">
                  <span class="party-passive-label">Passive Insight</span>
                  <span class="party-passive-value">${esc(String(passiveSkills.insight))}</span>
                </div>
                <div class="party-passive-stat">
                  <span class="party-passive-label">Passive Investigation</span>
                  <span class="party-passive-value">${esc(String(passiveSkills.investigation))}</span>
                </div>
              </div>
            </div>
            <div class="party-member-actions">
              <a class="btn secondary" href="${esc(getCharacterUrl(characterId))}" data-party-open-character="${esc(characterId)}">Open</a>
              <button class="btn secondary" type="button" data-party-remove-character="${esc(characterId)}">Remove</button>
            </div>
          </li>
        `;
      })
      .filter(Boolean)
      .join("");
    const partyName = String(party.name ?? "").trim() || "Untitled Party";
    return `
      <section class="party-panel">
        <div class="party-panel-header">
          <h3 class="title">Party Details</h3>
          <label class="party-name-edit">
            Party name
            <div class="party-name-edit-row">
              <input id="party-name-input" type="text" maxlength="120" value="${esc(partyName)}">
            </div>
          </label>
        </div>
        <div class="party-panel-actions">
          <button class="btn secondary" id="party-open-add-character-modal" type="button">Add Character</button>
        </div>
        ${cards ? `<ul class="party-member-list">${cards}</ul>` : `<p class="muted">No characters in this party yet. Use Add Character to get started.</p>`}
      </section>
    `;
  };

  const renderPartyPage = () => {
    const recentParties = readPartyHistory();
    const selectedPartyId = isUuid(appState.activePartyId) ? appState.activePartyId : recentParties[0]?.id ?? null;
    const canForgetActiveParty = isUuid(appState.activePartyId);
    return `
      <main class="layout layout-play">
        <section>
          <div class="card">
            <div class="title-with-history play-title-with-actions">
              <a class="app-brand-link" href="/" aria-label="Go to home">
                <img class="app-brand-logo" src="/icons/icon.svg" alt="Action Surge logo" />
              </a>
              <h1 class="title">Parties</h1>
              ${renderPartyHistorySelector("party-history-select", selectedPartyId, {
                className: "character-history-control character-history-control-inline",
              })}
            </div>
            ${
              appState.startupErrorMessage
                ? `<p class="muted onboarding-warning">${esc(appState.startupErrorMessage)}</p>`
                : ""
            }
            ${renderActivePartyPanel()}
            ${
              canForgetActiveParty
                ? `<div class="party-page-footer-actions">
                     <button class="btn secondary danger" id="party-forget-active" type="button">Forget Party</button>
                   </div>`
                : ""
            }
          </div>
        </section>
      </main>
    `;
  };

  const loadPartyIntoContext = async (partyId, options = {}) => {
    if (!isUuid(partyId)) throw new Error("Invalid party id");
    const payload = await getParty(partyId);
    const party = payload?.party;
    if (!party || typeof party !== "object" || Array.isArray(party)) {
      throw new Error("Invalid party payload");
    }
    appState.activePartyId = partyId;
    appState.activeParty = { ...party, id: partyId };
    upsertPartyHistory(appState.activeParty, { touchAccess: true });
    appState.showOnboardingHome = false;
    appState.startupErrorMessage = "";
    setPartyIdInUrl(partyId, options.replaceUrl === true);
    startPartyAutoRefresh();
    render(store.getState());
    void hydratePartyMemberSnapshots(appState.activeParty);
  };

  const createAndOpenNewParty = async () => {
    const payload = await createParty({
      name: "Untitled Party",
      members: [],
      notes: "",
      visibility: "unlisted",
    });
    await loadPartyIntoContext(payload.id, { replaceUrl: true });
  };

  const saveActiveParty = async (nextParty, options = {}) => {
    const partyId = String(nextParty?.id ?? appState.activePartyId ?? "").trim();
    if (!isUuid(partyId)) throw new Error("No active party selected.");
    const baseParty = nextParty && typeof nextParty === "object" && !Array.isArray(nextParty)
      ? nextParty
      : appState.activeParty;
    let passwordAttempt = getStoredPartyPassword(partyId);
    try {
      const payload = await saveParty(partyId, baseParty, { passwordAttempt });
      appState.activePartyId = partyId;
      appState.activeParty = { ...payload.party, id: partyId };
      upsertPartyHistory(appState.activeParty, { touchAccess: true });
      void hydratePartyMemberSnapshots(appState.activeParty);
      return payload.party;
    } catch (error) {
      const invalidPassword = Number(error?.status) === 403 && String(error?.payload?.code ?? "") === "INVALID_PARTY_PASSWORD";
      if (!invalidPassword || options.allowPasswordPrompt === false) throw error;
      const entered = window.prompt("Enter party password");
      if (entered == null) throw error;
      passwordAttempt = String(entered);
      const payload = await saveParty(partyId, baseParty, { passwordAttempt });
      setStoredPartyPassword(partyId, passwordAttempt);
      appState.activePartyId = partyId;
      appState.activeParty = { ...payload.party, id: partyId };
      upsertPartyHistory(appState.activeParty, { touchAccess: true });
      void hydratePartyMemberSnapshots(appState.activeParty);
      return payload.party;
    }
  };

  const hydratePartyMemberSnapshots = async (party, options = {}) => {
    if (!party || typeof party !== "object" || Array.isArray(party)) return;
    const partyId = String(party.id ?? appState.activePartyId ?? "").trim();
    if (!isUuid(partyId)) return;
    const members = Array.isArray(party.members) ? party.members : [];
    const forceRefresh = options.forceRefresh === true;
    const pendingIds = [...new Set(
      members
        .map((member) => String(member?.characterId ?? "").trim())
        .filter((id) => isUuid(id) && (forceRefresh || !memberCharacterCache.has(id)))
    )];
    if (!pendingIds.length) return;
    const responses = await Promise.allSettled(pendingIds.map((id) => getCharacter(id)));
    let didUpdate = false;
    const refreshedMembers = [];
    responses.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      const characterId = pendingIds[index];
      const candidate = result.value?.character;
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
      const snapshot = { ...candidate, id: characterId };
      memberCharacterCache.set(characterId, snapshot);
      refreshedMembers.push({ characterId, snapshot });
      didUpdate = true;
    });
    if (refreshedMembers.length && typeof getCatalogsForCharacter === "function") {
      const derivedResults = await Promise.allSettled(
        refreshedMembers.map(async ({ characterId, snapshot }) => {
          const catalogs = await getCatalogsForCharacter(snapshot);
          return { characterId, derived: computeDerivedStats(snapshot, catalogs) };
        })
      );
      derivedResults.forEach((result) => {
        if (result.status !== "fulfilled") return;
        const { characterId, derived } = result.value;
        if (!isUuid(characterId) || !derived || typeof derived !== "object" || Array.isArray(derived)) return;
        memberDerivedCache.set(characterId, derived);
      });
    }
    if (!didUpdate) return;
    if (String(appState.activePartyId ?? "").trim() !== partyId) return;
    render(store.getState());
  };

  const getPartyMemberSnapshotForModal = async (characterId) => {
    const parsedId = String(characterId ?? "").trim();
    if (!isUuid(parsedId)) return null;
    const cached = memberCharacterCache.get(parsedId);
    if (cached && typeof cached === "object" && !Array.isArray(cached)) {
      return cached;
    }
    const payload = await getCharacter(parsedId);
    const candidate = payload?.character;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const snapshot = { ...candidate, id: parsedId };
    memberCharacterCache.set(parsedId, snapshot);
    return snapshot;
  };

  const bindPartyEvents = () => {
    const removeConfirmTimers = new Map();
    const resetRemoveButton = (button) => {
      if (!(button instanceof HTMLButtonElement)) return;
      const timerId = removeConfirmTimers.get(button);
      if (timerId) {
        window.clearTimeout(timerId);
        removeConfirmTimers.delete(button);
      }
      button.dataset.confirming = "";
      button.textContent = "Remove";
    };
    const markRemoveButtonForConfirm = (button) => {
      app.querySelectorAll("[data-party-remove-character]").forEach((candidate) => {
        if (candidate === button) return;
        resetRemoveButton(candidate);
      });
      resetRemoveButton(button);
      button.dataset.confirming = "true";
      button.textContent = "Confirm";
      const timerId = window.setTimeout(() => {
        resetRemoveButton(button);
      }, 4000);
      removeConfirmTimers.set(button, timerId);
    };

    app.querySelector("#party-history-select")?.addEventListener("change", async (evt) => {
      const selectedId = String(evt.target.value || "").trim();
      if (!selectedId) return;
      if (selectedId === NEW_PARTY_OPTION_VALUE) {
        evt.target.disabled = true;
        try {
          await createAndOpenNewParty();
        } catch (error) {
          appState.startupErrorMessage = error instanceof Error ? error.message : "Failed to create party";
          appState.showOnboardingHome = false;
          render(store.getState());
        } finally {
          evt.target.disabled = false;
        }
        return;
      }
      if (!isUuid(selectedId)) return;
      evt.target.disabled = true;
      try {
        await loadPartyIntoContext(selectedId, { replaceUrl: false });
      } catch (error) {
        appState.startupErrorMessage = error instanceof Error ? error.message : "Failed to load selected party";
        appState.showOnboardingHome = false;
        render(store.getState());
      } finally {
        evt.target.disabled = false;
      }
    });

    app.querySelectorAll("[data-party-open-character]").forEach((trigger) => {
      trigger.addEventListener("click", async (evt) => {
        const isPlainLeftClick =
          evt.button === 0 && !evt.metaKey && !evt.ctrlKey && !evt.shiftKey && !evt.altKey;
        if (!isPlainLeftClick) return;
        evt.preventDefault();
        const characterId = String(trigger.getAttribute("data-party-open-character") ?? "").trim();
        if (!isUuid(characterId)) return;
        trigger.setAttribute("aria-disabled", "true");
        try {
          await loadCharacterById(characterId);
          setCharacterInUrl(characterId, false);
          render(store.getState());
        } catch (error) {
          appState.startupErrorMessage = error instanceof Error ? error.message : "Failed to load character";
          appState.showOnboardingHome = false;
          render(store.getState());
        } finally {
          trigger.removeAttribute("aria-disabled");
        }
      });
    });

    const openPartyMemberInfoModal = async (button, modalType) => {
      const dataAttr = modalType === "class" ? "data-party-open-class-info" : "data-party-open-subclass-info";
      const characterId = String(button.getAttribute(dataAttr) ?? "").trim();
      if (!isUuid(characterId)) return;
      if (modalType === "class" && typeof openClassDetailsModalForCharacter !== "function") return;
      if (modalType === "subclass" && typeof openSubclassDetailsModalForCharacter !== "function") return;
      button.disabled = true;
      try {
        const snapshot = await getPartyMemberSnapshotForModal(characterId);
        if (!snapshot) throw new Error("Failed to load character details");
        if (modalType === "class") await openClassDetailsModalForCharacter(snapshot);
        else await openSubclassDetailsModalForCharacter(snapshot);
      } catch (error) {
        alert(error instanceof Error ? error.message : "Failed to open character details");
      } finally {
        button.disabled = false;
      }
    };

    app.querySelectorAll("[data-party-open-class-info]").forEach((button) => {
      button.addEventListener("click", async () => {
        await openPartyMemberInfoModal(button, "class");
      });
    });

    app.querySelectorAll("[data-party-open-subclass-info]").forEach((button) => {
      button.addEventListener("click", async () => {
        await openPartyMemberInfoModal(button, "subclass");
      });
    });

    app.querySelectorAll("[data-party-remove-character]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (button.dataset.confirming !== "true") {
          markRemoveButtonForConfirm(button);
          return;
        }
        const characterId = String(button.getAttribute("data-party-remove-character") ?? "").trim();
        const activeParty = appState.activeParty;
        const partyId = String(activeParty?.id ?? appState.activePartyId ?? "").trim();
        if (!isUuid(characterId) || !isUuid(partyId) || !activeParty) return;
        const nextMembers = (Array.isArray(activeParty.members) ? activeParty.members : []).filter(
          (member) => String(member?.characterId ?? "").trim() !== characterId
        );
        resetRemoveButton(button);
        button.disabled = true;
        try {
          await saveActiveParty({ ...activeParty, id: partyId, members: nextMembers });
          render(store.getState());
        } catch (error) {
          alert(error instanceof Error ? error.message : "Failed to remove character from party");
        } finally {
          button.disabled = false;
        }
      });
    });

    let savingPartyName = false;
    const savePartyName = async () => {
      if (savingPartyName) return;
      const input = app.querySelector("#party-name-input");
      const activeParty = appState.activeParty;
      const partyId = String(activeParty?.id ?? appState.activePartyId ?? "").trim();
      if (!isUuid(partyId) || !activeParty || !input) return;
      const nextName = String(input.value ?? "").trim() || "Untitled Party";
      const currentName = String(activeParty.name ?? "").trim() || "Untitled Party";
      if (nextName === currentName) return;
      savingPartyName = true;
      input.disabled = true;
      try {
        await saveActiveParty({ ...activeParty, id: partyId, name: nextName });
        render(store.getState());
      } catch (error) {
        alert(error instanceof Error ? error.message : "Failed to rename party");
      } finally {
        savingPartyName = false;
        input.disabled = false;
      }
    };

    app.querySelector("#party-name-input")?.addEventListener("keydown", async (evt) => {
      const input = evt.currentTarget;
      if (!(input instanceof HTMLInputElement)) return;
      if (evt.key === "Escape") {
        const activeParty = appState.activeParty;
        input.value = String(activeParty?.name ?? "").trim() || "Untitled Party";
        input.blur();
        return;
      }
      if (evt.key !== "Enter") return;
      evt.preventDefault();
      await savePartyName();
      input.blur();
    });

    app.querySelector("#party-name-input")?.addEventListener("blur", () => {
      void savePartyName();
    });

    app.querySelector("#party-open-add-character-modal")?.addEventListener("click", () => {
      openAddCharacterModal();
    });

    app.querySelector("#party-forget-active")?.addEventListener("click", () => {
      const activeName = String(appState.activeParty?.name ?? "").trim() || "this party";
      const confirmed = window.confirm(
        `Forget "${activeName}" on this browser? This only removes local history/password and returns to home.`
      );
      if (!confirmed) return;
      forgetActivePartyAndRedirectHome();
    });
  };

  return {
    getPartyIdFromUrl,
    setPartyIdInUrl,
    clearPartyIdInUrl,
    clearActiveParty,
    isCharacterInActiveParty,
    renderPartyPage,
    bindPartyEvents,
    loadPartyIntoContext,
    createAndOpenNewParty,
    getLastPartyId,
    getLastPartySummary,
  };
}

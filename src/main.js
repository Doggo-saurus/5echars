import {
  DEFAULT_SOURCE_PRESET,
  SOURCE_PRESETS,
  SOURCE_PRESET_LABELS,
  getAllowedSources,
} from "./config/sources.js";
import { loadCatalogs } from "./data-loader.js";
import { STEPS, createInitialCharacter, createStore } from "./state/character-store.js";
import { loadAppState, saveAppState } from "./state/persistence.js";
import { openModal } from "./ui/modals/modal.js";

const app = document.getElementById("app");
const persistedState = loadAppState();
const store = createStore(persistedState?.character ?? createInitialCharacter());
const DICE_MODULE_URL = "https://unpkg.com/@3d-dice/dice-box@1.1.4/dist/dice-box.es.min.js";
const DICE_ASSET_ORIGIN = "https://unpkg.com/@3d-dice/dice-box@1.1.4/dist/";
const DICE_STYLE_PRESETS = {
  ember: { label: "Ember Gold", themeColor: "#f59e0b", lightIntensity: 1.05, shadowTransparency: 0.75 },
  arcane: { label: "Arcane Cyan", themeColor: "#22d3ee", lightIntensity: 1.15, shadowTransparency: 0.82 },
  forest: { label: "Forest Jade", themeColor: "#34d399", lightIntensity: 0.95, shadowTransparency: 0.72 },
  ruby: { label: "Ruby Red", themeColor: "#ef4444", lightIntensity: 1.2, shadowTransparency: 0.8 },
};
const DEFAULT_DICE_RESULT_MESSAGE = "Roll a save or skill to throw dice.";
const ROLL_HISTORY_LIMIT = 10;
let selectedDiceStyle = "arcane";
let diceBox = null;
let diceBoxPromise = null;
let latestDiceResultMessage = DEFAULT_DICE_RESULT_MESSAGE;
let latestDiceResultIsError = false;
let rollHistory = [];

const SKILLS = [
  { key: "acrobatics", label: "Acrobatics", ability: "dex" },
  { key: "animalHandling", label: "Animal Handling", ability: "wis" },
  { key: "arcana", label: "Arcana", ability: "int" },
  { key: "athletics", label: "Athletics", ability: "str" },
  { key: "deception", label: "Deception", ability: "cha" },
  { key: "history", label: "History", ability: "int" },
  { key: "insight", label: "Insight", ability: "wis" },
  { key: "intimidation", label: "Intimidation", ability: "cha" },
  { key: "investigation", label: "Investigation", ability: "int" },
  { key: "medicine", label: "Medicine", ability: "wis" },
  { key: "nature", label: "Nature", ability: "int" },
  { key: "perception", label: "Perception", ability: "wis" },
  { key: "performance", label: "Performance", ability: "cha" },
  { key: "persuasion", label: "Persuasion", ability: "cha" },
  { key: "religion", label: "Religion", ability: "int" },
  { key: "sleightOfHand", label: "Sleight of Hand", ability: "dex" },
  { key: "stealth", label: "Stealth", ability: "dex" },
  { key: "survival", label: "Survival", ability: "wis" },
];

const SAVE_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const SPELL_SLOT_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const SPELL_SCHOOL_LABELS = {
  A: "Abjuration",
  C: "Conjuration",
  D: "Divination",
  E: "Enchantment",
  V: "Evocation",
  I: "Illusion",
  N: "Necromancy",
  T: "Transmutation",
};
const DICE_NOTATION_REGEX = /\b\d+d\d+(?:\s*[+\-]\s*\d+)?\b/gi;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toNumber(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

function signed(value) {
  return value >= 0 ? `+${value}` : `${value}`;
}

function formatNotationWithModifier(baseNotation, modifier) {
  if (modifier === 0) return baseNotation;
  const op = modifier > 0 ? "+" : "-";
  return `${baseNotation} ${op} ${Math.abs(modifier)}`;
}

function formatEvaluatedWithModifier(baseValue, modifier) {
  if (modifier === 0) return String(baseValue);
  const op = modifier > 0 ? "+" : "-";
  return `${baseValue} ${op} ${Math.abs(modifier)}`;
}

function formatEvaluatedNotation(rollValues, total) {
  if (!Array.isArray(rollValues) || !rollValues.length || !Number.isFinite(total)) return null;
  const sum = rollValues.reduce((acc, value) => acc + value, 0);
  const diceExpression = rollValues.length > 1 ? `(${rollValues.join(" + ")})` : `${rollValues[0]}`;
  const delta = total - sum;
  if (delta === 0) return diceExpression;
  const op = delta > 0 ? "+" : "-";
  return `${diceExpression} ${op} ${Math.abs(delta)}`;
}

function formatD20ResultMessage(label, modifier, dieValue, total) {
  const inputExpression = formatNotationWithModifier("1d20", modifier);
  if (dieValue != null && total != null) {
    const evaluated = formatEvaluatedWithModifier(dieValue, modifier);
    return `${label}: ${inputExpression} | ${evaluated} = ${total}`;
  }
  if (total != null) {
    return `${label}: ${inputExpression} | total = ${total}`;
  }
  return `${label}: ${inputExpression} | roll completed.`;
}

function formatNotationResultMessage(label, notation, total, rollValues) {
  const inputExpression = String(notation || "").trim();
  const evaluated = formatEvaluatedNotation(rollValues, total);
  if (evaluated && total != null) {
    return `${label}: ${inputExpression} | ${evaluated} = ${total}`;
  }
  if (total != null) {
    return `${label}: ${inputExpression} | total = ${total}`;
  }
  return `${label}: ${inputExpression} | roll completed.`;
}

function renderRollHistory() {
  const listEl = document.getElementById("dice-history-list");
  if (!listEl) return;

  if (!rollHistory.length) {
    listEl.innerHTML = `<div class="dice-history-empty muted">No rolls yet.</div>`;
    return;
  }

  listEl.innerHTML = rollHistory
    .map(
      (entry) => `
        <div class="dice-history-entry ${entry.isError ? "is-error" : ""}">
          <span class="dice-history-time">${esc(entry.timeLabel)}</span>
          <span class="dice-history-message">${esc(entry.message)}</span>
        </div>
      `
    )
    .join("");
}

function syncDiceResultElements() {
  const resultEls = [document.getElementById("dice-result"), document.getElementById("dice-result-inline")].filter(Boolean);
  resultEls.forEach((resultEl) => {
    resultEl.textContent = latestDiceResultMessage;
    resultEl.classList.toggle("is-error", latestDiceResultIsError);
  });
}

function setDiceResult(message, isError = false, options = {}) {
  const shouldRecord = options.record !== false;
  latestDiceResultMessage = String(message ?? "");
  latestDiceResultIsError = Boolean(isError);
  syncDiceResultElements();

  if (!shouldRecord) return;

  rollHistory = [
    {
      message: latestDiceResultMessage,
      isError: latestDiceResultIsError,
      timeLabel: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    },
    ...rollHistory,
  ].slice(0, ROLL_HISTORY_LIMIT);
  renderRollHistory();
}

function scrollDiceTrayIntoView() {
  const tray = document.getElementById("dice-tray");
  if (!tray) return;

  const rect = tray.getBoundingClientRect();
  const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
  if (isVisible) return;

  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const targetY = Math.max(0, window.scrollY + rect.top - 16);
  window.scrollTo({
    top: targetY,
    behavior: prefersReducedMotion ? "auto" : "smooth",
  });
}

function applyDiceStyle(box = diceBox) {
  const overlay = document.getElementById("dice-overlay");
  if (overlay) {
    overlay.dataset.diceStyle = selectedDiceStyle;
  }

  if (!box || typeof box.updateConfig !== "function") return;
  const preset = DICE_STYLE_PRESETS[selectedDiceStyle] ?? DICE_STYLE_PRESETS.ember;
  box.updateConfig({
    theme: "default",
    themeColor: preset.themeColor,
    lightIntensity: preset.lightIntensity,
    shadowTransparency: preset.shadowTransparency,
  });
}

function renderDiceStyleOptions() {
  return Object.entries(DICE_STYLE_PRESETS)
    .map(
      ([key, preset]) => `<option value="${esc(key)}" ${selectedDiceStyle === key ? "selected" : ""}>${esc(preset.label)}</option>`
    )
    .join("");
}

async function getDiceBox() {
  if (diceBox) return diceBox;
  if (diceBoxPromise) return diceBoxPromise;

  diceBoxPromise = (async () => {
    try {
      const tray = document.getElementById("dice-tray");
      if (!tray) return null;

      const module = await import(DICE_MODULE_URL);
      const DiceBox = module?.default;
      if (!DiceBox) return null;

      const box = new DiceBox({
        container: "#dice-tray",
        assetPath: "assets/",
        origin: DICE_ASSET_ORIGIN,
        theme: "default",
        scale: 12,
        gravity: 1.8,
        throwForce: 2.1,
        spinForce: 2.4,
        startingHeight: 5,
        linearDamping: 0.68,
        angularDamping: 0.68,
        settleTimeout: 900,
      });
      await box.init();
      diceBox = box;
      applyDiceStyle(box);
      return box;
    } catch (error) {
      console.error("Dice Box failed to initialize", error);
      setDiceResult("Visual dice failed to load.", true);
      return null;
    }
  })();

  return diceBoxPromise;
}

async function rollVisualD20(label, modifier = 0) {
  const notation = modifier === 0 ? "1d20" : `1d20${signed(modifier)}`;
  scrollDiceTrayIntoView();
  setDiceResult(`${label}: rolling ${notation}...`, false, { record: false });
  const box = await getDiceBox();
  if (!box) return null;

  try {
    const rollGroups = await box.roll(notation);
    const group = rollGroups?.[0] ?? {};
    const rawDieValue = Number(group?.rolls?.[0]?.value);
    const rawTotal = Number(group?.value);
    const hasRawTotal = Number.isFinite(rawTotal);
    const normalizedDieFromResult = Number.isFinite(rawDieValue) && rawDieValue >= 1 && rawDieValue <= 20 ? rawDieValue : null;
    const derivedDieFromTotal = hasRawTotal ? rawTotal - modifier : null;
    const dieValue =
      normalizedDieFromResult ?? (Number.isFinite(derivedDieFromTotal) && derivedDieFromTotal >= 1 && derivedDieFromTotal <= 20 ? derivedDieFromTotal : null);
    const total = hasRawTotal ? rawTotal : dieValue != null ? dieValue + modifier : null;
    setDiceResult(formatD20ResultMessage(label, modifier, dieValue, total));
    return {
      label,
      notation,
      modifier,
      dieValue,
      total,
    };
  } catch (error) {
    console.error("Dice roll failed", error);
    setDiceResult(`${label}: roll failed.`, true);
    return null;
  }
}

async function rollVisualNotation(label, notation) {
  const cleanNotation = String(notation || "").trim();
  if (!cleanNotation) {
    setDiceResult(`${label}: no dice notation.`, true);
    return;
  }

  scrollDiceTrayIntoView();
  setDiceResult(`${label}: rolling ${cleanNotation}...`, false, { record: false });
  const box = await getDiceBox();
  if (!box) return;

  try {
    const rollGroups = await box.roll(cleanNotation);
    const group = rollGroups?.[0] ?? {};
    const rawTotal = Number(group?.value);
    const rollValues = Array.isArray(group?.rolls)
      ? group.rolls.map((it) => toNumber(it?.value, NaN)).filter((it) => Number.isFinite(it))
      : [];
    const inferredTotal = rollValues.length ? rollValues.reduce((acc, value) => acc + value, 0) : null;
    const total = Number.isFinite(rawTotal) ? rawTotal : inferredTotal;
    setDiceResult(formatNotationResultMessage(label, cleanNotation, total, rollValues));
  } catch (error) {
    console.error("Dice roll failed", error);
    setDiceResult(`${label}: roll failed.`, true);
  }
}

function getActiveInputSnapshot() {
  const active = document.activeElement;
  if (!active || !app.contains(active)) return null;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement)) return null;
  if (!active.id) return null;

  return {
    id: active.id,
    selectionStart: typeof active.selectionStart === "number" ? active.selectionStart : null,
    selectionEnd: typeof active.selectionEnd === "number" ? active.selectionEnd : null,
  };
}

function restoreActiveInput(snapshot) {
  if (!snapshot?.id) return;
  const next = app.querySelector(`#${snapshot.id}`);
  if (!next) return;

  next.focus();
  if (
    typeof snapshot.selectionStart === "number" &&
    typeof snapshot.selectionEnd === "number" &&
    typeof next.setSelectionRange === "function"
  ) {
    next.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }
}

function getModeToggle(mode) {
  return `
    <div class="stepper mode-toggle">
      <button data-mode="play" class="${mode === "play" ? "active" : ""}">Play Mode</button>
      <button data-mode="build" class="${mode === "build" ? "active" : ""}">Build Mode</button>
    </div>
  `;
}

function renderStepper(stepIndex) {
  return `
    <div class="stepper">
      ${STEPS.map(
        (step, i) => `
        <button data-step="${i}" class="${i === stepIndex ? "active" : ""}">${i + 1}. ${esc(step)}</button>
      `
      ).join("")}
    </div>
  `;
}

function optionList(options, selected) {
  return options
    .map(
      (opt) =>
        `<option value="${esc(opt.name)}" ${selected === opt.name ? "selected" : ""}>${esc(opt.name)} (${esc(
          opt.sourceLabel ?? opt.source ?? "UNK"
        )})</option>`
    )
    .join("");
}

function renderBuildEditor(state) {
  const { character, stepIndex, catalogs } = state;
  if (stepIndex === 0) {
    return `
      <h2 class="title">Source Preset</h2>
      <p class="subtitle">Choose what books are legal in this builder run.</p>
      <label>Preset
        <select id="source-preset">
          ${Object.keys(SOURCE_PRESETS)
            .map(
              (key) =>
                `<option value="${key}" ${key === character.sourcePreset ? "selected" : ""}>${esc(
                  SOURCE_PRESET_LABELS[key] ?? key
                )}</option>`
            )
            .join("")}
        </select>
      </label>
      <p class="muted">Allowed sources: ${getAllowedSources(character.sourcePreset).join(", ")}</p>
    `;
  }
  if (stepIndex === 1) {
    return `
      <h2 class="title">Basics</h2>
      <div class="row">
        <label>Name <input id="name" value="${esc(character.name)}"></label>
        <label>Level <input type="number" min="1" max="20" id="level" value="${esc(character.level)}"></label>
      </div>
      <label>Notes <input id="notes" value="${esc(character.notes)}"></label>
    `;
  }
  if (stepIndex === 2) {
    return `
      <h2 class="title">Ancestry & Background</h2>
      <div class="row">
        <label>Race
          <select id="race">
            <option value="">Select race</option>
            ${optionList(catalogs.races, character.race)}
          </select>
        </label>
        <label>Background
          <select id="background">
            <option value="">Select background</option>
            ${optionList(catalogs.backgrounds, character.background)}
          </select>
        </label>
      </div>
    `;
  }
  if (stepIndex === 3) {
    return `
      <h2 class="title">Class & Multiclass</h2>
      <div class="row">
        <label>Class
          <select id="class">
            <option value="">Select class</option>
            ${optionList(catalogs.classes, character.class)}
          </select>
        </label>
        <label>Subclass <input id="subclass" value="${esc(character.subclass)}" placeholder="e.g. Battle Master"></label>
      </div>
      <div class="toolbar">
        <button class="btn secondary" id="open-multiclass">Edit Multiclass</button>
      </div>
    `;
  }
  if (stepIndex === 4) {
    return `
      <h2 class="title">Abilities</h2>
      <div class="row">
        ${Object.entries(character.abilities)
          .map(
            ([key, val]) => `
          <label>${esc(key.toUpperCase())}
            <input id="ability-${esc(key)}" type="number" min="1" max="30" data-ability="${esc(key)}" value="${esc(val)}">
          </label>
        `
          )
          .join("")}
      </div>
    `;
  }
  if (stepIndex === 5) {
    return `
      <h2 class="title">Equipment</h2>
      <p class="subtitle">Simple inventory list with modal picker.</p>
      <div class="toolbar">
        <button class="btn secondary" id="open-items">Pick Items</button>
      </div>
      <div>${character.inventory.map((it) => `<span class="pill">${esc(it)}</span>`).join(" ") || "<span class='muted'>No items selected.</span>"}</div>
    `;
  }
  if (stepIndex === 6) {
    return `
      <h2 class="title">Spells</h2>
      <p class="subtitle">Use modal for quick search and selection.</p>
      <div class="toolbar">
        <button class="btn secondary" id="open-spells">Pick Spells</button>
      </div>
      <div>${character.spells.map((it) => `<span class="pill">${esc(it)}</span>`).join(" ") || "<span class='muted'>No spells selected.</span>"}</div>
    `;
  }
  return `
    <h2 class="title">Review & Export</h2>
    <p class="subtitle">Copy JSON to move this sheet between machines.</p>
    <textarea id="export-json" rows="12" style="width:100%; background:#0b1220; color:#e5e7eb; border:1px solid rgba(255,255,255,0.2); border-radius:10px; padding:0.6rem;">${esc(
      JSON.stringify(character, null, 2)
    )}</textarea>
    <div class="toolbar">
      <button class="btn secondary" id="import-json">Import JSON</button>
    </div>
  `;
}

function renderSummary(state) {
  const { character, derived } = state;
  return `
    <h3 class="title">Character Snapshot</h3>
    <p class="subtitle">${esc(character.name || "Unnamed Hero")} - Level ${esc(character.level)} ${esc(character.class || "Adventurer")}</p>
    <div class="summary-grid">
      <div class="pill">AC ${derived.ac}</div>
      <div class="pill">HP ${derived.hp}</div>
      <div class="pill">Prof +${derived.proficiencyBonus}</div>
      <div class="pill">Passive Perception ${derived.passivePerception}</div>
    </div>
    <h4>Ability Mods</h4>
    <div class="summary-grid">
      ${Object.entries(derived.mods)
        .map(([k, v]) => `<div class="pill">${esc(k.toUpperCase())} ${v >= 0 ? "+" : ""}${v}</div>`)
        .join("")}
    </div>
    <h4>Multiclass</h4>
    <p class="muted">${character.multiclass.length ? character.multiclass.map((m) => `${m.class} ${m.level}`).join(", ") : "None"}</p>
  `;
}

function getSpellSlotRow(play, level) {
  const slot = play.spellSlots?.[String(level)] ?? { max: 0, used: 0 };
  return `
    <div class="play-inline-row">
      <span>Level ${level}</span>
      <label class="inline-field">Max
        <input id="slot-max-${level}" type="number" min="0" max="9" data-slot-max="${level}" value="${esc(slot.max)}">
      </label>
      <span>Used ${slot.used}/${slot.max}</span>
      <button class="btn secondary" data-slot-delta="${level}" data-delta="-1">-</button>
      <button class="btn secondary" data-slot-delta="${level}" data-delta="1">+</button>
    </div>
  `;
}

function getSpellByName(state, spellName) {
  return state.catalogs.spells.find((spell) => spell.name === spellName) ?? null;
}

function getSpellLevelLabel(level) {
  return toNumber(level, 0) === 0 ? "Cantrip" : `Level ${toNumber(level, 0)}`;
}

function cleanSpellInlineTags(value) {
  const text = String(value ?? "");
  return text
    .replace(/\{@([a-zA-Z]+)\s+([^}]+)\}/g, (_, rawTag, rawPayload) => {
      const tag = rawTag.toLowerCase();
      const payload = String(rawPayload ?? "");
      const [primary] = payload.split("|");
      const main = String(primary ?? "").trim();
      if (!main) return "";

      if (tag === "dc") return `DC ${main}`;
      if (tag === "hit") {
        if (main.startsWith("+") || main.startsWith("-")) return `${main} to hit`;
        return `+${main} to hit`;
      }
      if (tag === "dice" || tag === "damage" || tag === "d20" || tag === "scaledice") return main;
      return main;
    })
    .replace(/\{@[a-zA-Z]+\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function collectSpellEntryLines(entry, depth = 0) {
  if (entry == null) return [];
  if (typeof entry === "string") {
    const line = cleanSpellInlineTags(entry);
    return line ? [line] : [];
  }
  if (Array.isArray(entry)) return entry.flatMap((it) => collectSpellEntryLines(it, depth));
  if (typeof entry !== "object") return [];

  const lines = [];
  const name = typeof entry.name === "string" ? cleanSpellInlineTags(entry.name) : "";

  if (Array.isArray(entry.entries)) {
    if (name) lines.push(depth > 0 ? `- ${name}:` : `${name}:`);
    lines.push(...entry.entries.flatMap((it) => collectSpellEntryLines(it, depth + 1)));
    return lines;
  }

  if (Array.isArray(entry.items)) {
    if (name) lines.push(depth > 0 ? `- ${name}:` : `${name}:`);
    entry.items.forEach((item) => {
      const itemLines = collectSpellEntryLines(item, depth + 1);
      if (!itemLines.length) return;
      const [first, ...rest] = itemLines;
      lines.push(`- ${first}`);
      rest.forEach((line) => lines.push(line));
    });
    return lines;
  }

  if (typeof entry.entry === "string") {
    const line = cleanSpellInlineTags(entry.entry);
    if (!line) return lines;
    lines.push(name ? `${name}: ${line}` : line);
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
  const lines = collectSpellEntryLines(spell.entries ?? []);
  const higherLevelLines = collectSpellEntryLines(spell.entriesHigherLevel ?? []);
  if (higherLevelLines.length) {
    lines.push("At Higher Levels:");
    lines.push(...higherLevelLines);
  }
  return lines.filter(Boolean);
}

function renderTextWithInlineDiceButtons(text) {
  const source = String(text ?? "");
  DICE_NOTATION_REGEX.lastIndex = 0;
  const matches = [...source.matchAll(DICE_NOTATION_REGEX)];
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

function renderSpellGroupsByLevel(state) {
  const play = state.character.play ?? {};
  const grouped = new Map();

  (state.character.spells ?? []).forEach((name) => {
    const spell = getSpellByName(state, name);
    const level = spell ? toNumber(spell.level, 0) : 99;
    const existing = play.preparedSpells?.[name];
    const isPrepared = existing == null ? true : Boolean(existing);
    const row = { name, spell, level, isPrepared };
    const list = grouped.get(level) ?? [];
    list.push(row);
    grouped.set(level, list);
  });

  if (!grouped.size) return "<span class='muted'>No spells selected.</span>";

  return [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([level, rows]) => {
      const title = level === 99 ? "Unknown Level" : getSpellLevelLabel(level);
      const body = rows
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ name, spell, isPrepared }) => {
          const school = spell?.school ? SPELL_SCHOOL_LABELS[spell.school] ?? spell.school : "";
          const source = spell?.sourceLabel ?? spell?.source ?? "";
          const meta = [school, source].filter(Boolean).join(" - ");
          return `
            <div class="spell-row ${isPrepared ? "is-prepared" : ""}">
              <button
                type="button"
                class="spell-prep-btn ${isPrepared ? "is-active" : ""}"
                data-spell-prepared-btn="${esc(name)}"
                aria-pressed="${isPrepared ? "true" : "false"}"
                title="Toggle prepared"
              >
                ${isPrepared ? "P" : "-"}
              </button>
              <button type="button" class="spell-name-btn" data-spell-open="${esc(name)}">${esc(name)}</button>
              <span class="spell-known-tag muted">${isPrepared ? "Prepared" : "Known"}</span>
              <span class="spell-meta muted">${esc(meta || "No metadata")}</span>
            </div>
          `;
        })
        .join("");
      return `
        <section class="spell-level-group">
          <h5 class="spell-level-title">${esc(title)}</h5>
          <div class="spell-level-list">${body}</div>
        </section>
      `;
    })
    .join("");
}

function renderPlayView(state) {
  const { character, derived } = state;
  const play = character.play ?? {};
  const hpTotal = derived.hp;
  const hpCurrent = play.hpCurrent == null ? hpTotal : play.hpCurrent;
  const hpTemp = toNumber(play.hpTemp, 0);
  const speed = toNumber(play.speed, 30);
  const initiativeBonus = toNumber(play.initiativeBonus, 0);
  const conditionText = (play.conditions ?? []).map((c) => `<span class="pill">${esc(c)}</span>`).join(" ");

  const savesHtml = SAVE_ABILITIES.map((ability) => {
    const score = toNumber(character.abilities?.[ability], 10);
    const mod = derived.mods[ability];
    const isProf = Boolean(play.saveProficiencies?.[ability]);
    const total = mod + (isProf ? derived.proficiencyBonus : 0);
    return `
      <div class="ability-save-row">
        <button type="button" class="pill pill-btn" data-ability-roll="${ability}" title="Roll ${ability.toUpperCase()} check">
          ${ability.toUpperCase()} ${score} / ${mod >= 0 ? "+" : ""}${mod}
        </button>
        <div class="save-label">
          <span class="save-left">
            <span class="save-name">Save</span>
            <button
              type="button"
              class="save-prof-btn ${isProf ? "is-active" : ""}"
              data-save-prof-btn="${ability}"
              aria-pressed="${isProf ? "true" : "false"}"
            >
              ${isProf ? "P" : "-"}
            </button>
            <button
              type="button"
              class="save-mod-btn"
              data-save-roll-btn="${ability}"
              title="Roll ${ability.toUpperCase()} save"
            >
              ${total >= 0 ? "+" : ""}${total}
            </button>
          </span>
        </div>
      </div>
    `;
  }).join("");

  const skillsHtml = SKILLS.map((skill) => {
    const isProf = Boolean(play.skillProficiencies?.[skill.key]);
    const total = derived.mods[skill.ability] + (isProf ? derived.proficiencyBonus : 0);
    return `
      <div class="skill-row">
        <div class="skill-btn ${isProf ? "is-active" : ""}">
          <span class="skill-left">
            <button
              type="button"
              class="skill-prof-btn ${isProf ? "is-active" : ""}"
              data-skill-prof-btn="${skill.key}"
              aria-pressed="${isProf ? "true" : "false"}"
              title="Toggle proficiency"
            >
              ${isProf ? "P" : "-"}
            </button>
            <span class="skill-name">${esc(skill.label)} <span class="muted">(${skill.ability.toUpperCase()})</span></span>
          </span>
        </div>
        <button
          type="button"
          class="save-mod-btn skill-roll-btn"
          data-skill-roll-btn="${skill.key}"
          title="Roll ${esc(skill.label)} check"
        >
          ${total >= 0 ? "+" : ""}${total}
        </button>
      </div>
    `;
  }).join("");

  const attacksHtml = (play.attacks ?? []).map((attack, idx) => `
    <div class="play-grid-4">
      <input id="attack-name-${idx}" placeholder="Attack name" value="${esc(attack.name ?? "")}" data-attack-field="${idx}:name">
      <input id="attack-hit-${idx}" placeholder="+To hit" value="${esc(attack.toHit ?? "")}" data-attack-field="${idx}:toHit" title="Double-click to roll to-hit">
      <input id="attack-dmg-${idx}" placeholder="Damage" value="${esc(attack.damage ?? "")}" data-attack-field="${idx}:damage" title="Double-click to roll damage notation">
      <button class="btn secondary" data-remove-attack="${idx}">Remove</button>
    </div>
  `).join("");

  const resourcesHtml = (play.resources ?? []).map((resource, idx) => `
    <div class="play-grid-4">
      <input id="resource-name-${idx}" placeholder="Resource name" value="${esc(resource.name ?? "")}" data-resource-field="${idx}:name">
      <input id="resource-current-${idx}" type="number" min="0" placeholder="Current" value="${esc(resource.current ?? 0)}" data-resource-field="${idx}:current">
      <input id="resource-max-${idx}" type="number" min="0" placeholder="Max" value="${esc(resource.max ?? 0)}" data-resource-field="${idx}:max">
      <button class="btn secondary" data-remove-resource="${idx}">Remove</button>
    </div>
  `).join("");

  return `
    <section class="card">
      <div class="play-sheet-head">
        <h2 class="title">Play Sheet</h2>
        <div class="play-sheet-head-right">
          <div class="dice-result-wrap" tabindex="0" aria-label="Recent roll history">
            <div id="dice-result-inline" class="dice-result muted">${esc(DEFAULT_DICE_RESULT_MESSAGE)}</div>
            <div id="dice-history-popover" class="dice-history-popover" role="status" aria-live="polite">
              <div class="dice-history-title">Recent Rolls</div>
              <div id="dice-history-list" class="dice-history-list">
                <div class="dice-history-empty muted">No rolls yet.</div>
              </div>
            </div>
          </div>
          <div class="dice-style-row">
            <select id="dice-style-select" aria-label="Dice style">${renderDiceStyleOptions()}</select>
          </div>
        </div>
      </div>
      <p class="subtitle">Live session view with quick trackers.</p>
      <div class="play-grid">
        <article class="card">
          <h3 class="title">Core Stats</h3>
          <div class="summary-grid">
            <div class="pill">HP ${hpCurrent}/${hpTotal}</div>
            <div class="pill">AC ${derived.ac}</div>
            <div class="pill">Prof +${derived.proficiencyBonus}</div>
            <div class="pill">Passive Perception ${derived.passivePerception}</div>
            <button type="button" class="pill pill-btn" data-roll-initiative title="Roll initiative">
              Initiative ${initiativeBonus >= 0 ? "+" : ""}${initiativeBonus}
            </button>
          </div>
          <div class="play-inline-row">
            <label class="inline-field hp-control">HP <span class="muted hp-meta">(Current / Total ${hpTotal})</span>
              <div class="num-input-wrap">
                <input id="play-hp-current" type="number" min="0" value="${esc(hpCurrent)}">
                <div class="num-stepper">
                  <button type="button" class="num-step-btn" data-step-target="hp-current" data-step-delta="1">+</button>
                  <button type="button" class="num-step-btn" data-step-target="hp-current" data-step-delta="-1">-</button>
                </div>
              </div>
              <div class="hp-quick-row">
                <button type="button" class="btn secondary hp-quick-btn" data-hp-delta="-5" data-hp-delta-target="current">-5</button>
                <button type="button" class="btn secondary hp-quick-btn" data-hp-delta="-1" data-hp-delta-target="current">-1</button>
                <button type="button" class="btn secondary hp-quick-btn" data-hp-delta="1" data-hp-delta-target="current">1</button>
                <button type="button" class="btn secondary hp-quick-btn" data-hp-delta="5" data-hp-delta-target="current">5</button>
              </div>
            </label>
            <label class="inline-field hp-control">Temp HP
              <div class="num-input-wrap">
                <input id="play-hp-temp" type="number" min="0" value="${esc(hpTemp)}">
                <div class="num-stepper">
                  <button type="button" class="num-step-btn" data-step-target="hp-temp" data-step-delta="1">+</button>
                  <button type="button" class="num-step-btn" data-step-target="hp-temp" data-step-delta="-1">-</button>
                </div>
              </div>
              <div class="hp-quick-row">
                <button type="button" class="btn secondary hp-quick-btn" data-hp-delta="-5" data-hp-delta-target="temp">-5</button>
                <button type="button" class="btn secondary hp-quick-btn" data-hp-delta="-1" data-hp-delta-target="temp">-1</button>
                <button type="button" class="btn secondary hp-quick-btn" data-hp-delta="1" data-hp-delta-target="temp">1</button>
                <button type="button" class="btn secondary hp-quick-btn" data-hp-delta="5" data-hp-delta-target="temp">5</button>
              </div>
            </label>
          </div>
          <div class="play-inline-row">
            <label class="inline-field">Speed
              <div class="num-input-wrap">
                <input id="play-speed" type="number" min="0" value="${esc(speed)}">
                <div class="num-stepper">
                  <button type="button" class="num-step-btn" data-step-target="speed" data-step-delta="1">+</button>
                  <button type="button" class="num-step-btn" data-step-target="speed" data-step-delta="-1">-</button>
                </div>
              </div>
            </label>
            <label class="inline-field">Initiative Bonus
              <div class="num-input-wrap">
                <input id="play-initiative-bonus" type="number" value="${esc(initiativeBonus)}">
                <div class="num-stepper">
                  <button type="button" class="num-step-btn" data-step-target="initiative-bonus" data-step-delta="1">+</button>
                  <button type="button" class="num-step-btn" data-step-target="initiative-bonus" data-step-delta="-1">-</button>
                </div>
              </div>
            </label>
          </div>
          <div class="play-inline-row">
            <span>Death Saves</span>
            <button type="button" class="btn secondary" data-roll-death-save>Roll</button>
            <label class="inline-field">Success
              <div class="num-input-wrap">
                <input id="play-ds-success" type="number" min="0" max="3" value="${esc(toNumber(play.deathSavesSuccess, 0))}">
                <div class="num-stepper">
                  <button type="button" class="num-step-btn" data-step-target="ds-success" data-step-delta="1">+</button>
                  <button type="button" class="num-step-btn" data-step-target="ds-success" data-step-delta="-1">-</button>
                </div>
              </div>
            </label>
            <label class="inline-field">Fail
              <div class="num-input-wrap">
                <input id="play-ds-fail" type="number" min="0" max="3" value="${esc(toNumber(play.deathSavesFail, 0))}">
                <div class="num-stepper">
                  <button type="button" class="num-step-btn" data-step-target="ds-fail" data-step-delta="1">+</button>
                  <button type="button" class="num-step-btn" data-step-target="ds-fail" data-step-delta="-1">-</button>
                </div>
              </div>
            </label>
          </div>
        </article>

        <article class="card">
          <h3 class="title">Abilities & Saves</h3>
          <div class="play-list ability-save-grid">${savesHtml}</div>
        </article>

        <article class="card">
          <h3 class="title">Skills</h3>
          <div class="play-list skill-grid">${skillsHtml}</div>
        </article>

        <article class="card">
          <h3 class="title">Attacks & Actions</h3>
          <div class="play-list">
            ${attacksHtml || "<p class='muted'>No attack entries yet.</p>"}
          </div>
          <div class="toolbar">
            <button class="btn secondary" id="add-attack">Add Attack</button>
          </div>
        </article>

        <article class="card">
          <h3 class="title">Spells & Slots</h3>
          <div class="play-list">
            ${SPELL_SLOT_LEVELS.map((level) => getSpellSlotRow(play, level)).join("")}
          </div>
          <h4>Prepared/Known Spells</h4>
          <p class="muted spell-prep-help">Toggle P to mark prepared. Click a spell name to view details and roll from its description.</p>
          <div class="spell-level-groups">${renderSpellGroupsByLevel(state)}</div>
        </article>

        <article class="card">
          <h3 class="title">Inventory & Conditions</h3>
          <h4>Inventory</h4>
          <div>${character.inventory.map((it) => `<span class="pill">${esc(it)}</span>`).join(" ") || "<span class='muted'>No items selected.</span>"}</div>
          <div class="play-inline-row">
            <input id="play-condition-input" placeholder="Add condition (e.g. Poisoned)">
            <button class="btn secondary" id="add-condition">Add</button>
          </div>
          <div>${conditionText || "<span class='muted'>No conditions tracked.</span>"}</div>
          <div class="play-inline-row">
            ${(play.conditions ?? [])
              .map((condition, idx) => `<button class="btn secondary" data-remove-condition="${idx}">Remove ${esc(condition)}</button>`)
              .join("")}
          </div>
          <label>Combat Notes
            <textarea id="play-notes" rows="4" style="width:100%; background:#0b1220; color:#e5e7eb; border:1px solid rgba(255,255,255,0.2); border-radius:10px; padding:0.6rem;">${esc(play.notes ?? "")}</textarea>
          </label>
        </article>

        <article class="card">
          <h3 class="title">Resources & Rest</h3>
          <div class="play-list">
            ${resourcesHtml || "<p class='muted'>No resource trackers yet.</p>"}
          </div>
          <div class="toolbar">
            <button class="btn secondary" id="add-resource">Add Resource</button>
            <button class="btn secondary" id="short-rest">Short Rest</button>
            <button class="btn" id="long-rest">Long Rest</button>
          </div>
        </article>
      </div>
    </section>
  `;
}

function bindModeEvents() {
  app.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => store.setMode(button.dataset.mode));
  });
}

function bindBuildEvents(state) {
  app.querySelectorAll("[data-step]").forEach((btn) => {
    btn.addEventListener("click", () => store.setStep(Number(btn.dataset.step)));
  });
  app.querySelector("#prev-step")?.addEventListener("click", () => store.setStep(state.stepIndex - 1));
  app.querySelector("#next-step")?.addEventListener("click", () => store.setStep(state.stepIndex + 1));

  const sourcePreset = app.querySelector("#source-preset");
  if (sourcePreset) {
    sourcePreset.addEventListener("change", async (evt) => {
      const preset = evt.target.value || DEFAULT_SOURCE_PRESET;
      store.updateCharacter({ sourcePreset: preset });
      const catalogs = await loadCatalogs(getAllowedSources(preset));
      store.setCatalogs(catalogs);
    });
  }

  [["#name", "name"], ["#level", "level"], ["#notes", "notes"], ["#race", "race"], ["#background", "background"], ["#class", "class"], ["#subclass", "subclass"]].forEach(([sel, field]) => {
    const el = app.querySelector(sel);
    if (!el) return;
    const handler = () => store.updateCharacter({ [field]: sel === "#level" ? Number(el.value || 1) : el.value });
    el.addEventListener("input", handler);
    el.addEventListener("change", handler);
  });

  app.querySelectorAll("[data-ability]").forEach((input) => {
    input.addEventListener("input", () => store.updateAbility(input.dataset.ability, input.value));
  });

  app.querySelector("#open-spells")?.addEventListener("click", () => openSpellModal(state));
  app.querySelector("#open-items")?.addEventListener("click", () => openItemModal(state));
  app.querySelector("#open-multiclass")?.addEventListener("click", () => openMulticlassModal(state));
  app.querySelector("#import-json")?.addEventListener("click", () => {
    const input = app.querySelector("#export-json");
    try {
      const parsed = JSON.parse(input.value);
      store.hydrate(parsed);
    } catch {
      alert("Invalid JSON payload");
    }
  });
}

function withUpdatedPlay(state, updater) {
  const nextPlay = structuredClone(state.character.play ?? {});
  updater(nextPlay);
  store.updateCharacter({ play: nextPlay });
}

function bindPlayEvents(state) {
  const diceStyleEl = app.querySelector("#dice-style-select");
  if (diceStyleEl) {
    diceStyleEl.addEventListener("change", () => {
      selectedDiceStyle = diceStyleEl.value in DICE_STYLE_PRESETS ? diceStyleEl.value : "arcane";
      applyDiceStyle();
    });
  }

  const hpCurrentEl = app.querySelector("#play-hp-current");
  const hpTempEl = app.querySelector("#play-hp-temp");
  const speedEl = app.querySelector("#play-speed");
  const initiativeEl = app.querySelector("#play-initiative-bonus");
  const dsSuccessEl = app.querySelector("#play-ds-success");
  const dsFailEl = app.querySelector("#play-ds-fail");

  const bindNumberInput = (el, updater) => {
    if (!el) return;
    el.addEventListener("input", () => {
      withUpdatedPlay(state, (play) => updater(play, toNumber(el.value, 0)));
    });
  };

  const clampCurrentHp = (value) => Math.max(0, Math.min(state.derived.hp, value));

  bindNumberInput(hpCurrentEl, (play, value) => {
    play.hpCurrent = clampCurrentHp(value);
  });
  bindNumberInput(hpTempEl, (play, value) => {
    play.hpTemp = Math.max(0, value);
  });
  bindNumberInput(speedEl, (play, value) => {
    play.speed = Math.max(0, value);
  });
  bindNumberInput(initiativeEl, (play, value) => {
    play.initiativeBonus = value;
  });
  bindNumberInput(dsSuccessEl, (play, value) => {
    play.deathSavesSuccess = Math.max(0, Math.min(3, value));
  });
  bindNumberInput(dsFailEl, (play, value) => {
    play.deathSavesFail = Math.max(0, Math.min(3, value));
  });

  app.querySelectorAll("[data-hp-delta]").forEach((button) => {
    button.addEventListener("click", () => {
      const delta = toNumber(button.dataset.hpDelta, 0);
      const target = button.dataset.hpDeltaTarget || "current";
      withUpdatedPlay(state, (play) => {
        if (target === "temp") {
          play.hpTemp = Math.max(0, toNumber(play.hpTemp, 0) + delta);
          return;
        }

        const current = play.hpCurrent == null ? state.derived.hp : toNumber(play.hpCurrent, state.derived.hp);
        play.hpCurrent = clampCurrentHp(current + delta);
      });
    });
  });

  app.querySelectorAll("[data-step-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.stepTarget;
      const delta = toNumber(button.dataset.stepDelta, 0);
      if (!delta) return;

      withUpdatedPlay(state, (play) => {
        if (target === "hp-current") {
          const current = play.hpCurrent == null ? state.derived.hp : toNumber(play.hpCurrent, state.derived.hp);
          play.hpCurrent = clampCurrentHp(current + delta);
          return;
        }

        if (target === "hp-temp") {
          play.hpTemp = Math.max(0, toNumber(play.hpTemp, 0) + delta);
          return;
        }

        if (target === "speed") {
          play.speed = Math.max(0, toNumber(play.speed, 30) + delta);
          return;
        }

        if (target === "initiative-bonus") {
          play.initiativeBonus = toNumber(play.initiativeBonus, 0) + delta;
          return;
        }

        if (target === "ds-success") {
          play.deathSavesSuccess = Math.max(0, Math.min(3, toNumber(play.deathSavesSuccess, 0) + delta));
          return;
        }

        if (target === "ds-fail") {
          play.deathSavesFail = Math.max(0, Math.min(3, toNumber(play.deathSavesFail, 0) + delta));
        }
      });
    });
  });

  app.querySelectorAll("[data-save-prof-btn]").forEach((button) => {
    button.addEventListener("click", () => {
      const ability = button.dataset.saveProfBtn;
      withUpdatedPlay(state, (play) => {
        const current = Boolean(play.saveProficiencies?.[ability]);
        play.saveProficiencies = { ...(play.saveProficiencies ?? {}), [ability]: !current };
      });
    });
  });

  app.querySelectorAll("[data-save-roll-btn]").forEach((button) => {
    button.addEventListener("click", () => {
      const ability = button.dataset.saveRollBtn;
      const mod = toNumber(state.derived.mods?.[ability], 0);
      const isProf = Boolean(state.character.play?.saveProficiencies?.[ability]);
      const bonus = mod + (isProf ? state.derived.proficiencyBonus : 0);
      rollVisualD20(`${ability.toUpperCase()} save`, bonus);
    });
  });

  app.querySelectorAll("[data-skill-prof-btn]").forEach((button) => {
    button.addEventListener("mousedown", (evt) => {
      // Prevent focus-jump/reflow while preserving click toggle behavior.
      evt.preventDefault();
    });
    button.addEventListener("click", () => {
      const key = button.dataset.skillProfBtn;
      withUpdatedPlay(state, (play) => {
        const current = Boolean(play.skillProficiencies?.[key]);
        play.skillProficiencies = { ...(play.skillProficiencies ?? {}), [key]: !current };
      });
    });
  });

  app.querySelectorAll("[data-skill-roll-btn]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.skillRollBtn;
      const skill = SKILLS.find((entry) => entry.key === key);
      if (!skill) return;
      const mod = toNumber(state.derived.mods?.[skill.ability], 0);
      const isProf = Boolean(state.character.play?.skillProficiencies?.[key]);
      const bonus = mod + (isProf ? state.derived.proficiencyBonus : 0);
      rollVisualD20(skill.label, bonus);
    });
  });

  app.querySelectorAll("[data-spell-prepared-btn]").forEach((button) => {
    button.addEventListener("click", () => {
      const spellName = button.dataset.spellPreparedBtn;
      if (!spellName) return;
      withUpdatedPlay(state, (play) => {
        const current = play.preparedSpells?.[spellName];
        const isPrepared = current == null ? true : Boolean(current);
        play.preparedSpells = { ...(play.preparedSpells ?? {}), [spellName]: !isPrepared };
      });
    });
  });

  app.querySelectorAll("[data-spell-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const spellName = button.dataset.spellOpen;
      if (!spellName) return;
      openSpellDetailsModal(state, spellName);
    });
  });

  app.querySelectorAll("[data-ability-roll]").forEach((button) => {
    button.addEventListener("click", () => {
      const ability = button.dataset.abilityRoll;
      const mod = toNumber(state.derived.mods?.[ability], 0);
      rollVisualD20(`${ability.toUpperCase()} check`, mod);
    });
  });

  app.querySelector("[data-roll-initiative]")?.addEventListener("click", () => {
    const bonus = toNumber(state.character.play?.initiativeBonus, 0);
    rollVisualD20("Initiative", bonus);
  });

  app.querySelector("[data-roll-death-save]")?.addEventListener("click", async () => {
    const result = await rollVisualD20("Death save", 0);
    if (!result || result.dieValue == null) return;

    withUpdatedPlay(state, (play) => {
      let success = Math.max(0, Math.min(3, toNumber(play.deathSavesSuccess, 0)));
      let fail = Math.max(0, Math.min(3, toNumber(play.deathSavesFail, 0)));
      const currentHp = play.hpCurrent == null ? state.derived.hp : toNumber(play.hpCurrent, state.derived.hp);
      const maxHp = Math.max(0, state.derived.hp);

      if (result.dieValue === 20) {
        play.hpCurrent = Math.min(maxHp, Math.max(1, currentHp));
        success = 0;
        fail = 0;
      } else if (result.dieValue === 1) {
        fail = Math.min(3, fail + 2);
      } else if (result.dieValue >= 10) {
        success = Math.min(3, success + 1);
      } else {
        fail = Math.min(3, fail + 1);
      }

      play.deathSavesSuccess = success;
      play.deathSavesFail = fail;
    });
  });

  app.querySelectorAll("[data-slot-max]").forEach((input) => {
    input.addEventListener("input", () => {
      const level = input.dataset.slotMax;
      withUpdatedPlay(state, (play) => {
        const previous = play.spellSlots?.[level] ?? { max: 0, used: 0 };
        const max = Math.max(0, toNumber(input.value, 0));
        play.spellSlots = {
          ...(play.spellSlots ?? {}),
          [level]: { max, used: Math.min(previous.used, max) },
        };
      });
    });
  });

  app.querySelectorAll("[data-slot-delta]").forEach((button) => {
    button.addEventListener("click", () => {
      const level = button.dataset.slotDelta;
      const delta = toNumber(button.dataset.delta, 0);
      withUpdatedPlay(state, (play) => {
        const previous = play.spellSlots?.[level] ?? { max: 0, used: 0 };
        const used = Math.max(0, Math.min(previous.max, previous.used + delta));
        play.spellSlots = {
          ...(play.spellSlots ?? {}),
          [level]: { ...previous, used },
        };
      });
    });
  });

  app.querySelector("#add-attack")?.addEventListener("click", () => {
    withUpdatedPlay(state, (play) => {
      play.attacks = [...(play.attacks ?? []), { name: "", toHit: "", damage: "" }];
    });
  });

  app.querySelectorAll("[data-attack-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const [idxStr, field] = input.dataset.attackField.split(":");
      const idx = toNumber(idxStr, 0);
      withUpdatedPlay(state, (play) => {
        const next = [...(play.attacks ?? [])];
        next[idx] = { ...(next[idx] ?? {}), [field]: input.value };
        play.attacks = next;
      });
    });
  });

  app.querySelectorAll("[data-attack-field]").forEach((input) => {
    input.addEventListener("dblclick", () => {
      const [idxStr, field] = input.dataset.attackField.split(":");
      const idx = toNumber(idxStr, 0);
      const attack = state.character.play?.attacks?.[idx] ?? {};
      const attackName = attack.name?.trim() || `Attack ${idx + 1}`;
      const value = String(input.value || "").trim();
      if (!value) {
        setDiceResult(`${attackName}: no roll value entered.`, true);
        return;
      }

      if (field === "toHit") {
        if (/[dD]/.test(value)) {
          rollVisualNotation(`${attackName} to-hit`, value);
          return;
        }
        const modifier = toNumber(value, NaN);
        if (!Number.isFinite(modifier)) {
          setDiceResult(`${attackName}: invalid to-hit value.`, true);
          return;
        }
        rollVisualD20(`${attackName} to-hit`, modifier);
        return;
      }

      if (field === "damage") {
        rollVisualNotation(`${attackName} damage`, value);
      }
    });
  });

  app.querySelectorAll("[data-remove-attack]").forEach((button) => {
    button.addEventListener("click", () => {
      const idx = toNumber(button.dataset.removeAttack, -1);
      withUpdatedPlay(state, (play) => {
        const next = [...(play.attacks ?? [])];
        if (idx >= 0) next.splice(idx, 1);
        play.attacks = next;
      });
    });
  });

  app.querySelector("#add-condition")?.addEventListener("click", () => {
    const input = app.querySelector("#play-condition-input");
    const value = input.value.trim();
    if (!value) return;
    withUpdatedPlay(state, (play) => {
      play.conditions = [...(play.conditions ?? []), value];
    });
  });

  app.querySelectorAll("[data-remove-condition]").forEach((button) => {
    button.addEventListener("click", () => {
      const idx = toNumber(button.dataset.removeCondition, -1);
      withUpdatedPlay(state, (play) => {
        const next = [...(play.conditions ?? [])];
        if (idx >= 0) next.splice(idx, 1);
        play.conditions = next;
      });
    });
  });

  app.querySelector("#play-notes")?.addEventListener("input", (evt) => {
    const value = evt.target.value;
    withUpdatedPlay(state, (play) => {
      play.notes = value;
    });
  });

  app.querySelector("#add-resource")?.addEventListener("click", () => {
    withUpdatedPlay(state, (play) => {
      play.resources = [...(play.resources ?? []), { name: "", current: 0, max: 0 }];
    });
  });

  app.querySelectorAll("[data-resource-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const [idxStr, field] = input.dataset.resourceField.split(":");
      const idx = toNumber(idxStr, 0);
      withUpdatedPlay(state, (play) => {
        const next = [...(play.resources ?? [])];
        const prev = next[idx] ?? { name: "", current: 0, max: 0 };
        const value = field === "name" ? input.value : Math.max(0, toNumber(input.value, 0));
        next[idx] = { ...prev, [field]: value };
        play.resources = next;
      });
    });
  });

  app.querySelectorAll("[data-remove-resource]").forEach((button) => {
    button.addEventListener("click", () => {
      const idx = toNumber(button.dataset.removeResource, -1);
      withUpdatedPlay(state, (play) => {
        const next = [...(play.resources ?? [])];
        if (idx >= 0) next.splice(idx, 1);
        play.resources = next;
      });
    });
  });

  app.querySelector("#short-rest")?.addEventListener("click", () => {
    withUpdatedPlay(state, (play) => {
      play.deathSavesSuccess = 0;
      play.deathSavesFail = 0;
    });
  });

  app.querySelector("#long-rest")?.addEventListener("click", () => {
    withUpdatedPlay(state, (play) => {
      play.hpCurrent = state.derived.hp;
      play.hpTemp = 0;
      play.deathSavesSuccess = 0;
      play.deathSavesFail = 0;
      play.spellSlots = Object.fromEntries(
        Object.entries(play.spellSlots ?? {}).map(([level, slot]) => [level, { ...slot, used: 0 }])
      );
      play.resources = (play.resources ?? []).map((resource) => ({
        ...resource,
        current: Math.max(0, toNumber(resource.max, 0)),
      }));
    });
  });
}

function openSpellDetailsModal(state, spellName) {
  const spell = getSpellByName(state, spellName);
  if (!spell) {
    setDiceResult(`Spell details unavailable: ${spellName}`, true);
    return;
  }

  const metaRows = [
    { label: "Level", value: getSpellLevelLabel(spell.level) },
    { label: "School", value: SPELL_SCHOOL_LABELS[spell.school] ?? spell.school ?? "" },
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
    : "<p class='muted'>No description text available for this spell.</p>";

  const close = openModal({
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
  const allSpells = state.catalogs.spells;
  const sourceOptions = [...new Set(allSpells.map((it) => it.source).filter(Boolean))].sort();
  const close = openModal({
    title: "Spell Picker",
    bodyHtml: `
      <div class="row">
        <label>Search
          <input id="spell-search" placeholder="Type spell name...">
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
      <div class="option-list" id="spell-list"></div>
    `,
    actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
  });

  const searchEl = document.getElementById("spell-search");
  const levelEl = document.getElementById("spell-level");
  const sourceEl = document.getElementById("spell-source");
  const listEl = document.getElementById("spell-list");

  function renderSpellRows() {
    const searchValue = searchEl.value.trim().toLowerCase();
    const levelValue = levelEl.value;
    const sourceValue = sourceEl.value;
    const filtered = allSpells
      .filter((spell) => !searchValue || spell.name.toLowerCase().includes(searchValue))
      .filter((spell) => !levelValue || String(spell.level ?? 0) === levelValue)
      .filter((spell) => !sourceValue || spell.source === sourceValue)
      .slice(0, 200);

    listEl.innerHTML = filtered.length
      ? filtered
          .map(
            (spell) => `
            <div class="option-row">
              <div>
                <strong>${esc(spell.name)}</strong>
                <div class="muted">Level ${esc(spell.level ?? 0)} - ${esc(spell.sourceLabel ?? spell.source)}</div>
              </div>
              <button class="btn secondary" data-pick="${esc(spell.name)}">${state.character.spells.includes(spell.name) ? "Added" : "Add"}</button>
            </div>
          `
          )
          .join("")
      : "<p class='muted'>No spells match these filters.</p>";

    listEl.querySelectorAll("[data-pick]").forEach((button) => {
      button.addEventListener("click", () => {
        store.addSpell(button.dataset.pick);
        close();
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
  const close = openModal({
    title: "Inventory Picker",
    bodyHtml: `
      <div class="row">
        <label>Search
          <input id="item-search" placeholder="Type item name...">
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

  function renderItemRows() {
    const searchValue = searchEl.value.trim().toLowerCase();
    const sourceValue = sourceEl.value;
    const filtered = allItems
      .filter((item) => !searchValue || item.name.toLowerCase().includes(searchValue))
      .filter((item) => !sourceValue || item.source === sourceValue)
      .slice(0, 250);

    listEl.innerHTML = filtered.length
      ? filtered
          .map(
            (item) => `
            <div class="option-row">
              <div>
                <strong>${esc(item.name)}</strong>
                <div class="muted">${esc(item.sourceLabel ?? item.source)}</div>
              </div>
              <button class="btn secondary" data-item-pick="${esc(item.name)}">Add</button>
            </div>
          `
          )
          .join("")
      : "<p class='muted'>No items match these filters.</p>";

    listEl.querySelectorAll("[data-item-pick]").forEach((button) => {
      button.addEventListener("click", () => {
        store.addItem(button.dataset.itemPick);
        close();
      });
    });
  }

  [searchEl, sourceEl].forEach((el) => {
    el.addEventListener("input", renderItemRows);
    el.addEventListener("change", renderItemRows);
  });
  renderItemRows();
}

function openMulticlassModal(state) {
  const existing = state.character.multiclass;
  const close = openModal({
    title: "Multiclass Editor",
    bodyHtml: `
      <p class="subtitle">Add one secondary class at a time.</p>
      <div class="row">
        <label>Class
          <select id="mc-class">
            <option value="">Select class</option>
            ${optionList(state.catalogs.classes, "")}
          </select>
        </label>
        <label>Level
          <input id="mc-level" type="number" min="1" max="20" value="1">
        </label>
      </div>
      <h4>Current</h4>
      <div>${existing.length ? existing.map((m) => `<span class="pill">${esc(m.class)} ${esc(m.level)}</span>`).join(" ") : "<span class='muted'>No multiclass entries yet.</span>"}</div>
    `,
    actions: [
      {
        label: "Save",
        onClick: (done) => {
          const classEl = document.getElementById("mc-class");
          const levelEl = document.getElementById("mc-level");
          if (!classEl.value) return;
          const multiclass = [...existing, { class: classEl.value, level: Number(levelEl.value || 1) }];
          store.updateCharacter({ multiclass });
          done();
        },
      },
      { label: "Close", secondary: true, onClick: (done) => done() },
    ],
  });
  return close;
}

function renderBuildMode(state) {
  return `
    <main class="layout">
      <section class="card">
        <h1 class="title">Character Builder</h1>
        <p class="subtitle">Build Mode: guide character setup and content selection.</p>
        ${getModeToggle(state.mode)}
        ${renderStepper(state.stepIndex)}
        <div id="editor">${renderBuildEditor(state)}</div>
        <div class="toolbar">
          <button class="btn secondary" id="prev-step" ${state.stepIndex === 0 ? "disabled" : ""}>Previous</button>
          <button class="btn" id="next-step" ${state.stepIndex === STEPS.length - 1 ? "disabled" : ""}>Next</button>
        </div>
      </section>
      <aside class="card sticky">
        ${renderSummary(state)}
      </aside>
    </main>
  `;
}

function dockDiceOverlay(isPlayMode) {
  const overlay = document.getElementById("dice-overlay");
  if (!overlay) return;

  const playSlot = app.querySelector("#play-header-dice-slot");
  if (isPlayMode && playSlot) {
    playSlot.appendChild(overlay);
    overlay.classList.add("in-header");
    return;
  }

  if (overlay.parentElement !== document.body) {
    document.body.appendChild(overlay);
  }
  overlay.classList.remove("in-header");
}

function renderPlayMode(state) {
  return `
    <main class="layout layout-play">
      <section>
        <div class="card">
          <div class="play-header">
            <div class="play-header-main">
              <h1 class="title">Character Builder</h1>
              <p class="subtitle">Play Mode: one-page session sheet.</p>
              ${getModeToggle(state.mode)}
              <p class="muted">${esc(state.character.name || "Unnamed Hero")} - Level ${esc(state.character.level)} ${esc(state.character.class || "Adventurer")}</p>
            </div>
            <div id="play-header-dice-slot" class="play-header-dice-slot"></div>
          </div>
        </div>
        ${renderPlayView(state)}
      </section>
    </main>
  `;
}

function render(state) {
  const activeInputSnapshot = getActiveInputSnapshot();
  const isPlayMode = state.mode === "play";
  document.body.classList.toggle("play-mode", isPlayMode);

  const overlay = document.getElementById("dice-overlay");
  if (overlay && overlay.parentElement !== document.body) {
    document.body.appendChild(overlay);
  }

  app.innerHTML = state.mode === "play" ? renderPlayMode(state) : renderBuildMode(state);
  dockDiceOverlay(isPlayMode);
  applyDiceStyle();
  syncDiceResultElements();
  renderRollHistory();
  bindModeEvents();
  if (isPlayMode) bindPlayEvents(state);
  else bindBuildEvents(state);
  restoreActiveInput(activeInputSnapshot);
}

store.subscribe((state) => {
  render(state);
  saveAppState(state);
});

if (persistedState?.mode === "play") store.setMode("play");
if (Number.isFinite(persistedState?.stepIndex)) store.setStep(persistedState.stepIndex);

const sourcePreset = persistedState?.character?.sourcePreset ?? DEFAULT_SOURCE_PRESET;
loadCatalogs(getAllowedSources(sourcePreset)).then((catalogs) => {
  store.setCatalogs(catalogs);
});

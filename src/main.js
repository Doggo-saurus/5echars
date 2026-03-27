import { DEFAULT_SOURCE_PRESET, SOURCE_PRESETS, getAllowedSources } from "./config/sources.js";
import { loadCatalogs } from "./data-loader.js";
import { STEPS, createInitialCharacter, createStore } from "./state/character-store.js";
import { loadCharacter, saveCharacter } from "./state/persistence.js";
import { openModal } from "./ui/modals/modal.js";

const app = document.getElementById("app");
const persisted = loadCharacter();
const store = createStore(persisted ?? createInitialCharacter());

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
    .map((opt) => `<option value="${esc(opt.name)}" ${selected === opt.name ? "selected" : ""}>${esc(opt.name)} (${esc(opt.sourceLabel ?? opt.source ?? "UNK")})</option>`)
    .join("");
}

function getActiveInputSnapshot() {
  const active = document.activeElement;
  if (!active || !app.contains(active)) return null;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement)) {
    return null;
  }

  const id = active.id;
  const ability = active.getAttribute("data-ability");
  if (!id && !ability) return null;

  return {
    id: id || null,
    ability: ability || null,
    selectionStart: typeof active.selectionStart === "number" ? active.selectionStart : null,
    selectionEnd: typeof active.selectionEnd === "number" ? active.selectionEnd : null,
  };
}

function restoreActiveInput(snapshot) {
  if (!snapshot) return;

  let next = null;
  if (snapshot.id) next = app.querySelector(`#${snapshot.id}`);
  if (!next && snapshot.ability) next = app.querySelector(`[data-ability="${snapshot.ability}"]`);
  if (!next) return;

  next.focus();
  if (typeof snapshot.selectionStart === "number" && typeof snapshot.selectionEnd === "number" && typeof next.setSelectionRange === "function") {
    next.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }
}

function renderEditor(state) {
  const { character, stepIndex, catalogs } = state;
  if (stepIndex === 0) {
    return `
      <h2 class="title">Source Preset</h2>
      <p class="subtitle">Choose what books are legal in this builder run.</p>
      <label>Preset
        <select id="source-preset">
          ${Object.keys(SOURCE_PRESETS)
            .map((key) => `<option value="${key}" ${key === character.sourcePreset ? "selected" : ""}>${esc(key)}</option>`)
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
            <input type="number" min="1" max="30" data-ability="${esc(key)}" value="${esc(val)}">
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

function bindEditorEvents(state) {
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
    el.addEventListener("input", () => store.updateCharacter({ [field]: sel === "#level" ? Number(el.value || 1) : el.value }));
    el.addEventListener("change", () => store.updateCharacter({ [field]: sel === "#level" ? Number(el.value || 1) : el.value }));
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
          .map((spell) => `
            <div class="option-row">
              <div>
                <strong>${esc(spell.name)}</strong>
                <div class="muted">Level ${esc(spell.level ?? 0)} - ${esc(spell.sourceLabel ?? spell.source)}</div>
              </div>
              <button class="btn secondary" data-pick="${esc(spell.name)}">${state.character.spells.includes(spell.name) ? "Added" : "Add"}</button>
            </div>
          `)
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
          .map((item) => `
            <div class="option-row">
              <div>
                <strong>${esc(item.name)}</strong>
                <div class="muted">${esc(item.sourceLabel ?? item.source)}</div>
              </div>
              <button class="btn secondary" data-item-pick="${esc(item.name)}">Add</button>
            </div>
          `)
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

function render(state) {
  const activeInputSnapshot = getActiveInputSnapshot();
  app.innerHTML = `
    <main class="layout">
      <section class="card">
        <h1 class="title">Character Builder</h1>
        <p class="subtitle">Single-page workflow with modal pickers and curated sources.</p>
        ${renderStepper(state.stepIndex)}
        <div id="editor">${renderEditor(state)}</div>
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
  bindEditorEvents(state);
  restoreActiveInput(activeInputSnapshot);
}

store.subscribe((state) => {
  render(state);
  saveCharacter(state.character);
});

const sourcePreset = persisted?.sourcePreset ?? DEFAULT_SOURCE_PRESET;
loadCatalogs(getAllowedSources(sourcePreset)).then((catalogs) => {
  store.setCatalogs(catalogs);
});

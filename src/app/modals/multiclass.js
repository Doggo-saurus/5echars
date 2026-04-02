export function createMulticlassModal({
  openModal,
  esc,
  optionList,
  updateCharacterWithRequiredSettings,
}) {
  function openMulticlassModal(state) {
    const existing = state.character.multiclass;
    const close = openModal({
      title: "Multiclass Editor",
      bodyHtml: `
        <p class="subtitle">Add one secondary class at a time to build your multiclass.</p>
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
        <div>${existing.length ? existing.map((m) => `<span class="pill">${esc(m.class)} ${esc(m.level)}</span>`).join(" ") : "<span class='muted'>No secondary classes added yet.</span>"}</div>
      `,
      actions: [
        {
          label: "Save",
          onClick: (done) => {
            const classEl = document.getElementById("mc-class");
            const levelEl = document.getElementById("mc-level");
            if (!classEl.value) return;
            const multiclass = [...existing, { class: classEl.value, level: Number(levelEl.value || 1) }];
            updateCharacterWithRequiredSettings(state, { multiclass }, { preserveUserOverrides: true });
            done();
          },
        },
        { label: "Close", secondary: true, onClick: (done) => done() },
      ],
    });
    return close;
  }

  return {
    openMulticlassModal,
  };
}

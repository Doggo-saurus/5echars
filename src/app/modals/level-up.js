export function createLevelUpModal({
  openModal,
  toNumber,
  rollDie,
  progressionRules,
  renderLevelUpBody,
  updateCharacterWithRequiredSettings,
}) {
  function openLevelUpModal(state) {
    const draft = progressionRules.createLevelUpDraft(state.character);
    const close = openModal({
      title: "Level Up",
      bodyHtml: `<div id="levelup-editor"></div>`,
      actions: [
        {
          label: "Apply",
          onClick: (done) => {
            const sanitized = progressionRules.sanitizeLevelUpDraft(draft);
            if (!sanitized.primaryClass) {
              alert("Choose a primary class.");
              return;
            }
            const multiclassTotal = sanitized.multiclass.reduce((sum, entry) => sum + entry.level, 0);
            if (multiclassTotal >= sanitized.totalLevel) {
              alert("Secondary class levels must be lower than total level.");
              return;
            }
            updateCharacterWithRequiredSettings(
              state,
              {
                class: sanitized.primaryClass,
                level: sanitized.totalLevel,
                multiclass: sanitized.multiclass,
                hitPointRollOverrides: progressionRules.getLevelUpPreview(state, sanitized).hitPointPlan.nextRollOverrides,
              },
              { preserveUserOverrides: true }
            );
            done();
          },
        },
        { label: "Cancel", secondary: true, onClick: (done) => done() },
      ],
    });

    const root = document.getElementById("levelup-editor");
    if (!root) return close;
    let levelInputRenderTimer = null;
    const clampLevelValue = (value) => Math.max(1, Math.min(20, toNumber(value, 1)));
    const renderEditorSoon = () => {
      if (levelInputRenderTimer != null) clearTimeout(levelInputRenderTimer);
      levelInputRenderTimer = window.setTimeout(() => {
        levelInputRenderTimer = null;
        renderEditor();
      }, 250);
    };
    const renderEditorNow = () => {
      if (levelInputRenderTimer != null) {
        clearTimeout(levelInputRenderTimer);
        levelInputRenderTimer = null;
      }
      renderEditor();
    };

    const renderEditor = () => {
      root.innerHTML = renderLevelUpBody(state, draft);
      const primaryClassEl = document.getElementById("levelup-primary-class");
      if (primaryClassEl) primaryClassEl.value = draft.primaryClass;

      document.getElementById("levelup-total-level")?.addEventListener("input", (evt) => {
        draft.totalLevel = clampLevelValue(evt.target.value);
        renderEditorSoon();
      });
      document.getElementById("levelup-total-level")?.addEventListener("change", (evt) => {
        draft.totalLevel = clampLevelValue(evt.target.value);
        renderEditorNow();
      });
      primaryClassEl?.addEventListener("change", (evt) => {
        draft.primaryClass = evt.target.value;
        renderEditorNow();
      });
      root.querySelector("[data-levelup-add-mc]")?.addEventListener("click", () => {
        draft.multiclass.push({ class: "", level: 1 });
        renderEditorNow();
      });
      root.querySelectorAll("[data-levelup-mc-remove]").forEach((button) => {
        button.addEventListener("click", () => {
          const idx = toNumber(button.dataset.levelupMcRemove, -1);
          if (idx < 0) return;
          draft.multiclass.splice(idx, 1);
          renderEditorNow();
        });
      });
      root.querySelectorAll("[data-levelup-mc-class]").forEach((select) => {
        select.addEventListener("change", () => {
          const idx = toNumber(select.dataset.levelupMcClass, -1);
          if (idx < 0 || !draft.multiclass[idx]) return;
          draft.multiclass[idx].class = select.value;
          renderEditorNow();
        });
      });
      root.querySelectorAll("[data-levelup-mc-level]").forEach((input) => {
        input.addEventListener("input", () => {
          const idx = toNumber(input.dataset.levelupMcLevel, -1);
          if (idx < 0 || !draft.multiclass[idx]) return;
          draft.multiclass[idx].level = clampLevelValue(input.value);
          renderEditorSoon();
        });
        input.addEventListener("change", () => {
          const idx = toNumber(input.dataset.levelupMcLevel, -1);
          if (idx < 0 || !draft.multiclass[idx]) return;
          draft.multiclass[idx].level = clampLevelValue(input.value);
          renderEditorNow();
        });
      });
      root.querySelectorAll("[data-levelup-step-target]").forEach((button) => {
        button.addEventListener("click", () => {
          const target = String(button.dataset.levelupStepTarget ?? "");
          const delta = toNumber(button.dataset.stepDelta, 0);
          if (!delta) return;
          if (target === "total-level") {
            draft.totalLevel = clampLevelValue(toNumber(draft.totalLevel, 1) + delta);
            renderEditorNow();
            return;
          }
          if (target === "mc-level") {
            const idx = toNumber(button.dataset.levelupStepIndex, -1);
            if (idx < 0 || !draft.multiclass[idx]) return;
            draft.multiclass[idx].level = clampLevelValue(toNumber(draft.multiclass[idx].level, 1) + delta);
            renderEditorNow();
          }
        });
      });
      root.querySelectorAll("[data-levelup-hp-method]").forEach((input) => {
        input.addEventListener("change", () => {
          const key = String(input.dataset.levelupHpKey ?? "").trim();
          if (!key) return;
          const method = input.value === "roll" ? "roll" : "fixed";
          const faces = Math.max(1, toNumber(input.dataset.levelupHpFaces, 8));
          const existing = draft.hitPointChoices[key] ?? { method: "fixed", rollValue: null };
          draft.hitPointChoices[key] = {
            ...existing,
            method,
            rollValue: method === "roll" ? existing.rollValue ?? rollDie(faces) : null,
          };
          renderEditorNow();
        });
      });
      root.querySelectorAll("[data-levelup-hp-reroll]").forEach((button) => {
        button.addEventListener("click", () => {
          const key = String(button.dataset.levelupHpReroll ?? "").trim();
          if (!key) return;
          const faces = Math.max(1, toNumber(button.dataset.levelupHpFaces, 8));
          draft.hitPointChoices[key] = {
            method: "roll",
            rollValue: rollDie(faces),
          };
          renderEditorNow();
        });
      });
    };

    renderEditor();
    return () => {
      if (levelInputRenderTimer != null) {
        clearTimeout(levelInputRenderTimer);
        levelInputRenderTimer = null;
      }
      close();
    };
  }

  return {
    openLevelUpModal,
  };
}

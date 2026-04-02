export function createEditPasswordController({
  openModal,
  esc,
  store,
  validateCharacterEditPassword,
  getCharacterEditPassword,
  isUuid,
}) {
  const EDIT_PASSWORD_PROMPT_INPUT_ID = "build-mode-edit-password-input";
  const EDIT_PASSWORD_PROMPT_STATUS_ID = "build-mode-edit-password-status";

  function isInvalidEditPasswordError(error) {
    return Number(error?.status) === 403 && String(error?.payload?.code ?? "") === "INVALID_EDIT_PASSWORD";
  }

  function getEditPasswordValidationErrorMessage(error) {
    if (isInvalidEditPasswordError(error)) return "Invalid password.";
    const status = Number(error?.status);
    if (!Number.isFinite(status) || status <= 0) {
      return "Could not reach the server to validate the password. Check your connection and try again.";
    }
    if (status >= 500) {
      return "The server could not validate the password right now. Try again in a moment.";
    }
    return error instanceof Error ? error.message : "Could not validate password.";
  }

  function openInfoModal(title, message) {
    openModal({
      title,
      bodyHtml: `<p class="subtitle">${esc(message)}</p>`,
      actions: [{ label: "Close", secondary: true, onClick: (done) => done() }],
    });
  }

  function openEditPasswordPromptModal(characterId) {
    if (document.getElementById(EDIT_PASSWORD_PROMPT_INPUT_ID)) return;
    let isSubmitting = false;
    let closeModal = () => {};

    const setStatusMessage = (message) => {
      const statusEl = document.getElementById(EDIT_PASSWORD_PROMPT_STATUS_ID);
      if (!statusEl) return;
      statusEl.textContent = String(message ?? "");
    };

    const submitPassword = async () => {
      if (isSubmitting) return;
      const inputEl = document.getElementById(EDIT_PASSWORD_PROMPT_INPUT_ID);
      if (!inputEl) return;
      const enteredPassword = String(inputEl.value ?? "");
      isSubmitting = true;
      inputEl.disabled = true;
      setStatusMessage("");
      try {
        await validateCharacterEditPassword(characterId, enteredPassword);
        store.updateCharacter({ editPassword: enteredPassword });
        closeModal();
        store.setMode("build");
      } catch (error) {
        setStatusMessage(getEditPasswordValidationErrorMessage(error));
      } finally {
        isSubmitting = false;
        inputEl.disabled = false;
        inputEl.focus();
        inputEl.select();
      }
    };

    closeModal = openModal({
      title: "Enter Password",
      bodyHtml: `
        <p class="subtitle">This character is protected. Enter the password to continue.</p>
        <label>Password
          <input id="${EDIT_PASSWORD_PROMPT_INPUT_ID}" type="password" autocomplete="current-password">
        </label>
        <p id="${EDIT_PASSWORD_PROMPT_STATUS_ID}" class="muted" aria-live="polite"></p>
      `,
      actions: [
        { label: "Unlock", onClick: () => void submitPassword() },
        { label: "Cancel", secondary: true, onClick: (done) => done() },
      ],
    });

    const inputEl = document.getElementById(EDIT_PASSWORD_PROMPT_INPUT_ID);
    inputEl?.focus();
    inputEl?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      void submitPassword();
    });
  }

  function bindModeEvents(app) {
    app.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", async () => {
        const targetMode = button.dataset.mode === "play" ? "play" : "build";
        if (targetMode !== "build") {
          store.setMode(targetMode);
          return;
        }

        const currentState = store.getState();
        const characterId = String(currentState.character?.id ?? "").trim();
        const localEditPassword = getCharacterEditPassword(currentState.character);
        if (localEditPassword || !isUuid(characterId)) {
          store.setMode("build");
          return;
        }

        try {
          await validateCharacterEditPassword(characterId, "");
          store.updateCharacter({ editPassword: "" });
          store.setMode("build");
        } catch (error) {
          if (isInvalidEditPasswordError(error)) {
            openEditPasswordPromptModal(characterId);
            return;
          }
          openInfoModal("Password Check Failed", getEditPasswordValidationErrorMessage(error));
        }
      });
    });
  }

  return {
    isInvalidEditPasswordError,
    getEditPasswordValidationErrorMessage,
    openInfoModal,
    openEditPasswordPromptModal,
    bindModeEvents,
  };
}

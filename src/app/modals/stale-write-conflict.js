export function createStaleWriteConflictModal({ openModal, esc }) {
  function formatConflictTimestamp(value) {
    const parsed = Date.parse(String(value ?? ""));
    if (!Number.isFinite(parsed)) return "Unknown";
    return new Date(parsed).toLocaleString();
  }

  function openStaleWriteConflictModal({ characterId, conflict, localCharacter }) {
    const serverUpdatedAt = formatConflictTimestamp(conflict?.serverUpdatedAt);
    const clientLastSavedServerUpdatedAt = formatConflictTimestamp(conflict?.clientUpdatedAt);
    const serverVersion = Number.isFinite(Number(conflict?.serverVersion)) ? Math.floor(Number(conflict.serverVersion)) : 0;
    const clientLastSavedServerVersion = Number.isFinite(Number(conflict?.clientVersion)) ? Math.floor(Number(conflict.clientVersion)) : 0;
    const localName = String(localCharacter?.name ?? "").trim();
    const titleName = localName ? ` (${localName})` : "";
    const modalMarkerId = `stale-write-conflict-marker-${String(characterId ?? "").replace(/[^a-zA-Z0-9_-]/g, "")}`;
    return new Promise((resolve) => {
      let resolved = false;
      const finish = (value) => {
        if (resolved) return;
        resolved = true;
        resolve(value);
      };
      const closeModal = openModal({
        title: `Different Version Detected${titleName}`,
        bodyHtml: `
          <div id="${modalMarkerId}">
            <p class="subtitle">The server has a different version of this character. Saving now would overwrite different data.</p>
            <p><strong>Server version:</strong> ${esc(serverVersion)} (${esc(serverUpdatedAt)})</p>
            <p><strong>Local version:</strong> ${esc(clientLastSavedServerVersion)} (${esc(clientLastSavedServerUpdatedAt)})</p>
            <p class="muted">Choose <strong>Reload from server (recommended)</strong> to keep the server copy, or <strong>Overwrite using local copy</strong> to explicitly replace it with your local changes.</p>
          </div>
        `,
        actions: [
          {
            label: "Reload from server (recommended)",
            onClick: (done) => {
              done();
              finish("reload");
            },
          },
          {
            label: "Overwrite using local copy",
            className: "btn-blue",
            onClick: (done) => {
              done();
              finish("overwrite");
            },
          },
          {
            label: "Cancel",
            secondary: true,
            onClick: (done) => {
              done();
              finish("cancel");
            },
          },
        ],
      });
      const modalWatcher = window.setInterval(() => {
        if (resolved) {
          clearInterval(modalWatcher);
          return;
        }
        if (document.getElementById(modalMarkerId)) return;
        clearInterval(modalWatcher);
        closeModal();
        finish("cancel");
      }, 200);
    });
  }

  return { openStaleWriteConflictModal };
}

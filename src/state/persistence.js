const STORAGE_KEY = "fivee-char-builder-v2";
const LEGACY_STORAGE_KEY = "fivee-char-builder-v1";

export function saveAppState(state) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      character: state.character ?? null,
      mode: state.mode ?? "build",
      stepIndex: Number.isFinite(state.stepIndex) ? state.stepIndex : 0,
    })
  );
}

export function loadAppState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacyRaw) return null;
    try {
      const legacyCharacter = JSON.parse(legacyRaw);
      return {
        character: legacyCharacter,
        mode: "build",
        stepIndex: 0,
      };
    } catch {
      return null;
    }
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.character) return parsed;
    return {
      character: parsed ?? null,
      mode: "build",
      stepIndex: 0,
    };
  } catch {
    return null;
  }
}

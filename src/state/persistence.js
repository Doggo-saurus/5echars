const STORAGE_KEY = "fivee-char-builder-v1";

export function saveCharacter(character) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(character));
}

export function loadCharacter() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

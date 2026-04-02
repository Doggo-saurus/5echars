const NUMBER_WORDS = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

export function cleanSpellInlineTags(value) {
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

export function toTitleCase(value) {
  return String(value ?? "")
    .replace(/[_-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function parseCountToken(value, fallback = 0) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (NUMBER_WORDS[normalized] != null) return NUMBER_WORDS[normalized];
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

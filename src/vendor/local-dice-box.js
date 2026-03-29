function parseNotation(notation) {
  const tokens = String(notation ?? "")
    .replace(/\s+/g, "")
    .match(/[+\-]?[^+\-]+/g);
  if (!tokens?.length) return [];
  const parts = [];
  for (const token of tokens) {
    const sign = token.startsWith("-") ? -1 : 1;
    const unsigned = token.replace(/^[+\-]/, "");
    const diceMatch = unsigned.match(/^(\d+)d(\d+)$/i);
    if (diceMatch) {
      parts.push({
        type: "dice",
        sign,
        count: Math.max(1, Number(diceMatch[1])),
        faces: Math.max(1, Number(diceMatch[2])),
      });
      continue;
    }
    if (/^\d+$/.test(unsigned)) {
      parts.push({ type: "flat", sign, value: Number(unsigned) });
    }
  }
  return parts;
}

function rollDie(faces) {
  return Math.floor(Math.random() * faces) + 1;
}

export default class LocalDiceBox {
  constructor() {}

  async init() {
    return true;
  }

  async roll(notation) {
    const parts = parseNotation(notation);
    const groups = [];
    for (const part of parts) {
      if (part.type === "flat") {
        groups.push({
          value: part.sign * part.value,
          rolls: [],
        });
        continue;
      }
      const rolls = Array.from({ length: part.count }, () => ({ value: rollDie(part.faces) }));
      const value = rolls.reduce((sum, roll) => sum + roll.value, 0) * part.sign;
      groups.push({ value, rolls });
    }
    return groups;
  }
}

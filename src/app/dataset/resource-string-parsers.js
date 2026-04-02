import { toNumber } from "../../ui/formatters.js";
import { cleanSpellInlineTags, parseCountToken, toTitleCase } from "./text-utils.js";

export function normalizeResourceLabel(value) {
  return cleanSpellInlineTags(String(value ?? ""))
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\bpoints\b/g, "point")
    .replace(/\bdice\b/g, "die")
    .replace(/\brages\b/g, "rage")
    .trim();
}

function getLabelTokenSet(value) {
  return new Set(
    normalizeResourceLabel(value)
      .split(" ")
      .map((token) => token.trim())
      .filter(Boolean)
  );
}

export function scoreResourceLabelMatch(left, right) {
  const normalizedLeft = normalizeResourceLabel(left);
  const normalizedRight = normalizeResourceLabel(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 100;
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return 60;
  const leftTokens = getLabelTokenSet(normalizedLeft);
  const rightTokens = getLabelTokenSet(normalizedRight);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) overlap += 1;
  });
  return overlap;
}

function getResourceWordMultiplier(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return 1;
  if (normalized === "twice" || normalized === "double") return 2;
  if (normalized === "thrice" || normalized === "triple") return 3;
  const timesMatch = normalized.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+times?/i);
  if (timesMatch?.[1]) return Math.max(1, parseCountToken(timesMatch[1], 1));
  return Math.max(1, parseCountToken(normalized, 1));
}

export function flattenTableCellToText(cell) {
  if (cell == null) return "";
  if (typeof cell === "string" || typeof cell === "number") return cleanSpellInlineTags(String(cell));
  if (Array.isArray(cell)) return cell.map((item) => flattenTableCellToText(item)).filter(Boolean).join(" / ");
  if (typeof cell !== "object") return "";
  if (typeof cell.entry === "string") return cleanSpellInlineTags(cell.entry);
  if (typeof cell.text === "string") return cleanSpellInlineTags(cell.text);
  if (typeof cell.value === "string" || typeof cell.value === "number") return cleanSpellInlineTags(String(cell.value));
  if (typeof cell.roll?.exact === "number") return String(cell.roll.exact);
  if (typeof cell.roll?.min === "number" && typeof cell.roll?.max === "number") return `${cell.roll.min}-${cell.roll.max}`;
  if (typeof cell.roll?.min === "number") return String(cell.roll.min);
  if (typeof cell.name === "string") return cleanSpellInlineTags(cell.name);
  return "";
}

function extractTableRowsFromEntries(entry) {
  if (entry == null) return [];
  if (Array.isArray(entry)) return entry.flatMap((it) => extractTableRowsFromEntries(it));
  if (typeof entry !== "object") return [];
  const tables = [];
  if (entry.type === "table" && Array.isArray(entry.rows)) tables.push(entry);
  if (Array.isArray(entry.entries)) tables.push(...extractTableRowsFromEntries(entry.entries));
  if (Array.isArray(entry.items)) tables.push(...extractTableRowsFromEntries(entry.items));
  if (entry.entry && typeof entry.entry === "object") tables.push(...extractTableRowsFromEntries(entry.entry));
  return tables;
}

export function parseResourceCountFromTable(detail, classLevel) {
  const tables = extractTableRowsFromEntries(detail?.entries ?? []);
  const normalizedClassLevel = Math.max(1, Math.floor(toNumber(classLevel, 1)));
  const quantityColumnRegex = /\b(number|uses?|dice?|die|points?|charges?|pool|tokens?)\b/i;
  const levelColumnRegex = /\blevel\b/i;
  let bestMatch = null;
  tables.forEach((table) => {
    const colLabels = Array.isArray(table?.colLabels) ? table.colLabels.map((label) => cleanSpellInlineTags(String(label ?? ""))) : [];
    if (!colLabels.length) return;
    const levelIndex = colLabels.findIndex((label) => levelColumnRegex.test(label));
    const quantityIndex = colLabels.findIndex((label, idx) => idx !== levelIndex && quantityColumnRegex.test(label));
    if (levelIndex < 0 || quantityIndex < 0) return;
    const rows = Array.isArray(table?.rows) ? table.rows : [];
    rows.forEach((row) => {
      const cells = Array.isArray(row) ? row : [];
      const levelCell = flattenTableCellToText(cells[levelIndex]);
      const quantityCell = flattenTableCellToText(cells[quantityIndex]);
      const levelValue = toNumber(String(levelCell).match(/\d+/)?.[0], Number.NaN);
      const quantityValue = toNumber(String(quantityCell).match(/\d+/)?.[0], Number.NaN);
      if (!Number.isFinite(levelValue) || levelValue > normalizedClassLevel) return;
      if (!Number.isFinite(quantityValue) || quantityValue <= 0) return;
      if (!bestMatch || levelValue > bestMatch.level) {
        bestMatch = {
          level: levelValue,
          count: Math.floor(quantityValue),
          label: colLabels[quantityIndex],
        };
      }
    });
  });
  if (!bestMatch) return null;
  return {
    max: Math.max(0, bestMatch.count),
    resourceName: cleanSpellInlineTags(String(bestMatch.label ?? "")).trim(),
  };
}

export function parseResourceCountFromProficiencyBonus(lines, proficiencyBonus) {
  const pb = Math.max(0, toNumber(proficiencyBonus, 0));
  if (pb <= 0) return null;
  const resourceContextRegex = /\b(dice?|die|charges?|points?|pool|uses?|tokens?|trinkets?)\b/i;
  const resourceNounRegex = /\b(dice?|die|charges?|points?|pool|uses?|tokens?|trinkets?|times?)\b/i;
  const proficiencyRegex = /equal to\s+(?:(twice|double|thrice|triple|\d+\s+times?|one\s+time|two\s+times?|three\s+times?|four\s+times?|five\s+times?|six\s+times?|seven\s+times?|eight\s+times?|nine\s+times?|ten\s+times?)[\s-]+)?your proficiency bonus/i;
  for (const line of lines) {
    if (!resourceContextRegex.test(line)) continue;
    const match = line.match(proficiencyRegex);
    if (!match) continue;
    const nounMatch = line.match(/(?:number|times?|maximum number)\s+of\s+(?:these\s+)?([a-z][a-z\s'-]{1,48}?)(?:\s+equal to|\bthat\b|\bwhich\b|[,.])/i);
    if (nounMatch?.[1] && !resourceNounRegex.test(String(nounMatch[1] ?? ""))) continue;
    if (!nounMatch && !/\b(times?|uses?)\b/i.test(line)) continue;
    const multiplier = getResourceWordMultiplier(match[1] ?? "one");
    const max = Math.max(0, pb * multiplier);
    return {
      max,
      resourceName: nounMatch?.[1] ? toTitleCase(nounMatch[1]) : "Uses",
    };
  }
  return null;
}

export function inferResourceLabelFromLines(lines, fallback = "") {
  const patterns = [
    /represented by your\s+([a-z][a-z\s'-]{1,64}?(?:dice?|die|charges?|points?|tokens?|uses?))/i,
    /called\s+([a-z][a-z\s'-]{1,64}?(?:dice?|die|charges?|points?|tokens?|uses?))/i,
    /your\s+([a-z][a-z\s'-]{1,64}?(?:dice?|die|charges?|points?|tokens?|uses?))/i,
  ];
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match?.[1]) continue;
      const candidate = toTitleCase(match[1]).trim();
      if (candidate) return candidate;
    }
  }
  return String(fallback ?? "").trim();
}

export function parseExplicitResourceCostFromLines(lines) {
  const joined = lines.join(" ");
  const explicitRegex =
    /(?:expend|spend)(?:ing|ed)?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+([a-z][a-z\s'-]{1,64}?(?:dice?|die|charges?|points?|tokens?|uses?))/i;
  const explicitMatch = joined.match(explicitRegex);
  if (explicitMatch) {
    return {
      amount: Math.max(1, parseCountToken(explicitMatch[1], 1)),
      resourceLabel: toTitleCase(explicitMatch[2]),
    };
  }
  const passiveRegex = /([a-z][a-z\s'-]{1,64}?(?:dice?|die|charges?|points?|tokens?|uses?))\s+is expended when you use/i;
  const passiveMatch = joined.match(passiveRegex);
  if (passiveMatch) {
    return {
      amount: 1,
      resourceLabel: toTitleCase(passiveMatch[1]),
    };
  }
  const passiveGenericRegex = /([a-z][a-z\s'-]{1,64}?(?:dice?|die|charges?|points?|tokens?|uses?))\s+is expended\b/i;
  const passiveGenericMatch = joined.match(passiveGenericRegex);
  if (passiveGenericMatch) {
    return {
      amount: 1,
      resourceLabel: toTitleCase(passiveGenericMatch[1]),
    };
  }
  const rollThenExpendRegex =
    /roll\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+([a-z][a-z\s'-]{1,64}?(?:dice?|die|charges?|points?|tokens?|uses?)).{0,800}?expend\s+the\s+(?:same\s+)?(?:die|dice|charge|charges|point|points|token|tokens|use|uses)\b/i;
  const rollThenExpendMatch = joined.match(rollThenExpendRegex);
  if (rollThenExpendMatch) {
    return {
      amount: Math.max(1, parseCountToken(rollThenExpendMatch[1], 1)),
      resourceLabel: toTitleCase(rollThenExpendMatch[2]),
    };
  }
  const rollThenPassiveRegex =
    /roll\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+([a-z][a-z\s'-]{1,64}?(?:dice?|die|charges?|points?|tokens?|uses?)).{0,800}?the\s+(?:same\s+)?(?:die|dice|charge|charges|point|points|token|tokens|use|uses)\s+is expended\b/i;
  const rollThenPassiveMatch = joined.match(rollThenPassiveRegex);
  if (rollThenPassiveMatch) {
    return {
      amount: Math.max(1, parseCountToken(rollThenPassiveMatch[1], 1)),
      resourceLabel: toTitleCase(rollThenPassiveMatch[2]),
    };
  }
  return null;
}

export function parseDieFacesByClassLevel(lines, classLevel) {
  const normalizedLevel = Math.max(1, Math.floor(toNumber(classLevel, 1)));
  let baseFaces = 0;
  for (const line of lines) {
    const baseMatch = line.match(/(?:each(?:\s+is)?|are|is)\s+(?:a|an)?\s*d(\d+)/i);
    if (baseMatch?.[1]) {
      baseFaces = Math.max(baseFaces, toNumber(baseMatch[1], 0));
      if (baseFaces > 0) break;
    }
  }
  const thresholds = [];
  lines.forEach((line) => {
    const matches = [...line.matchAll(/at\s+(\d{1,2})(?:st|nd|rd|th)?\s+level(?:\s*\([^)]*\))?\s*\(?\s*d(\d+)\s*\)?/gi)];
    matches.forEach((match) => {
      const level = toNumber(match[1], 0);
      const faces = toNumber(match[2], 0);
      if (level > 0 && faces > 0) thresholds.push({ level, faces });
    });
  });
  thresholds.sort((a, b) => a.level - b.level);
  let bestFaces = baseFaces;
  thresholds.forEach((entry) => {
    if (normalizedLevel >= entry.level) bestFaces = Math.max(bestFaces, entry.faces);
  });
  return bestFaces > 0 ? bestFaces : 0;
}

export function hasFirstUseFreeAfterLongRestRule(lines) {
  const text = lines.join(" ").toLowerCase();
  return /first time you use this power after each long rest[, ]+you (?:do not|don't) expend/i.test(text);
}

export function getResourceRechargeHint(lines) {
  const text = lines.join(" ").toLowerCase();
  if (/once per day|once a day/.test(text)) return "day";
  if (/short or long rest/.test(text)) return "shortOrLong";
  if (/long rest/.test(text) && /short rest/.test(text)) return "shortOrLong";
  if (/long rest/.test(text)) return "long";
  if (/short rest/.test(text)) return "short";
  return "";
}

export function getAdditionalThresholdsForCombatSuperiority(lines) {
  const thresholds = new Set();
  lines.forEach((line) => {
    if (!/superiority die/i.test(line)) return;
    if (!/(gain|additional|another|one more)/i.test(line)) return;

    const atLevelMatches = [...line.matchAll(/at\s+(\d{1,2})(?:st|nd|rd|th)?\s+level/gi)];
    atLevelMatches.forEach((match) => {
      const level = toNumber(match[1], 0);
      if (level > 0) thresholds.add(level);
    });

    const levelListMatch = line.match(/levels?\s+(\d{1,2})(?:\s*\([^)]+\))?(?:\s+and\s+(\d{1,2}))?/i);
    if (levelListMatch) {
      const first = toNumber(levelListMatch[1], 0);
      const second = toNumber(levelListMatch[2], 0);
      if (first > 0) thresholds.add(first);
      if (second > 0) thresholds.add(second);
    }
  });
  return [...thresholds.values()];
}

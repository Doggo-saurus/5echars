#!/usr/bin/env node
import { promises as fs } from "node:fs";

const DATASET_PATH = "/home/pvandijk/5echars/data/catalog-src/data/items.json";
const SOURCES = new Set(["DMG", "TCE", "XGE"]);
const KEYS = [
  "senses",
  "bonusSenses",
  "resist",
  "immune",
  "conditionImmune",
  "vulnerable",
  "additionalSpells",
  "skillProficiencies",
  "languageProficiencies",
  "weaponProficiencies",
  "armorProficiencies",
  "toolProficiencies",
  "skillToolLanguageProficiencies",
  "expertise",
  "ability",
  "savingThrowProficiencies",
  "saveProficiencies",
];

function hasStructuredValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return value;
  return false;
}

function getItemLabel(item) {
  const name = String(item?.name ?? "").trim();
  const source = String(item?.source ?? "").trim();
  return `${name} [${source}]`;
}

async function main() {
  const raw = await fs.readFile(DATASET_PATH, "utf8");
  const payload = JSON.parse(raw);
  const items = Array.isArray(payload?.item) ? payload.item : [];
  const sourceItems = items.filter((item) => SOURCES.has(String(item?.source ?? "").trim().toUpperCase()));
  const summary = KEYS.reduce((acc, key) => {
    acc[key] = [];
    return acc;
  }, {});

  sourceItems.forEach((item) => {
    KEYS.forEach((key) => {
      if (!hasStructuredValue(item?.[key])) return;
      summary[key].push(getItemLabel(item));
    });
  });

  const lines = [];
  lines.push(`Scanned ${sourceItems.length} items from sources: ${[...SOURCES].join(", ")}`);
  KEYS.forEach((key) => {
    const names = [...new Set(summary[key])].sort((a, b) => a.localeCompare(b));
    lines.push(`${key}: ${names.length}`);
    names.forEach((name) => lines.push(`  - ${name}`));
  });

  const output = `${lines.join("\n")}\n`;
  const outputPath = "/home/pvandijk/5echars/tools/item-bonus-audit.txt";
  await fs.writeFile(outputPath, output, "utf8");
  process.stdout.write(output);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

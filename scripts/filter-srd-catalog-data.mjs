#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";

const dataRoot = process.argv[2];

if (!dataRoot) {
  console.error("Usage: node ./scripts/filter-srd-catalog-data.mjs <catalog-data-dir>");
  process.exit(1);
}

function isSrdEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  return entry.srd === true || entry.srd52 === true || entry.basicRules === true;
}

function filterArray(entries) {
  if (!Array.isArray(entries)) return entries;
  return entries.filter((entry) => isSrdEntry(entry));
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function filterJsonFile(filePath, arrayKeys) {
  const payload = await readJson(filePath);
  let changed = false;

  for (const key of arrayKeys) {
    if (!Array.isArray(payload?.[key])) continue;
    const next = filterArray(payload[key]);
    if (next.length !== payload[key].length) {
      payload[key] = next;
      changed = true;
    }
  }

  if (changed) await writeJson(filePath, payload);
}

async function filterIndexedDirectory(dirName, arrayKeys) {
  const dirPath = path.join(dataRoot, dirName);
  const indexPath = path.join(dirPath, "index.json");
  const indexPayload = await readJson(indexPath);
  const filenames = Object.values(indexPayload);

  await Promise.all(
    filenames.map((filename) => filterJsonFile(path.join(dirPath, filename), arrayKeys))
  );
}

async function main() {
  await filterIndexedDirectory("class", ["class", "subclass", "classFeature", "subclassFeature"]);
  await filterIndexedDirectory("spells", ["spell"]);

  await Promise.all([
    filterJsonFile(path.join(dataRoot, "races.json"), ["race"]),
    filterJsonFile(path.join(dataRoot, "backgrounds.json"), ["background"]),
    filterJsonFile(path.join(dataRoot, "feats.json"), ["feat"]),
    filterJsonFile(path.join(dataRoot, "optionalfeatures.json"), ["optionalfeature"]),
    filterJsonFile(path.join(dataRoot, "items.json"), ["item"]),
    filterJsonFile(path.join(dataRoot, "items-base.json"), ["baseitem"]),
    filterJsonFile(path.join(dataRoot, "magicvariants.json"), ["magicvariant"]),
    filterJsonFile(path.join(dataRoot, "conditionsdiseases.json"), ["condition"]),
  ]);

  console.log(`Filtered catalog data to SRD content in: ${dataRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

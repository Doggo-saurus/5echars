import { SOURCE_LABELS } from "./config/sources.js";

const DATA_ROOT = "./data/5etools-src/data";

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

async function loadFromIndex(dir, key) {
  const index = await fetchJson(`${DATA_ROOT}/${dir}/index.json`);
  const filenames = Object.values(index);
  const chunks = await Promise.all(
    filenames.map((file) => fetchJson(`${DATA_ROOT}/${dir}/${file}`))
  );
  return chunks.flatMap((chunk) => chunk[key] ?? []);
}

async function loadClassDataFromIndex() {
  const index = await fetchJson(`${DATA_ROOT}/class/index.json`);
  const filenames = Object.values(index);
  const chunks = await Promise.all(
    filenames.map((file) => fetchJson(`${DATA_ROOT}/class/${file}`))
  );
  return {
    classes: chunks.flatMap((chunk) => chunk.class ?? []),
    subclasses: chunks.flatMap((chunk) => chunk.subclass ?? []),
    classFeatures: chunks.flatMap((chunk) => chunk.classFeature ?? []),
    subclassFeatures: chunks.flatMap((chunk) => chunk.subclassFeature ?? []),
  };
}

async function loadSingleFile(file, key) {
  const data = await fetchJson(`${DATA_ROOT}/${file}`);
  return data[key] ?? [];
}

function filterBySources(items, allowedSources) {
  const allowed = new Set(allowedSources);
  return items.filter((it) => it.source && allowed.has(it.source));
}

function mapNamed(items) {
  return items
    .filter((it) => it.name)
    .map((it) => ({
      ...it,
      sourceLabel: SOURCE_LABELS[it.source] ?? it.source,
    }));
}

function dedupeByNameAndSource(items) {
  const seen = new Set();
  return items.filter((it) => {
    const key = `${it.name ?? ""}__${it.source ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getFallbackCatalogs(allowedSources) {
  const source = allowedSources[0] ?? "PHB";
  return {
    classes: [{ name: "Fighter", source }, { name: "Wizard", source }],
    subclasses: [],
    classFeatures: [],
    subclassFeatures: [],
    races: [{ name: "Human", source }, { name: "Elf", source }],
    backgrounds: [{ name: "Acolyte", source }, { name: "Criminal", source }],
    feats: [],
    optionalFeatures: [],
    spells: [{ name: "Magic Missile", level: 1, source }, { name: "Shield", level: 1, source }],
    items: [{ name: "Longsword", source }, { name: "Leather Armor", source }],
  };
}

export async function loadCatalogs(allowedSources) {
  try {
    const [classData, races, backgrounds, feats, optionalFeatures, spells, items, baseItems] = await Promise.all([
      loadClassDataFromIndex(),
      loadSingleFile("races.json", "race"),
      loadSingleFile("backgrounds.json", "background"),
      loadSingleFile("feats.json", "feat"),
      loadSingleFile("optionalfeatures.json", "optionalfeature"),
      loadFromIndex("spells", "spell"),
      loadSingleFile("items.json", "item"),
      loadSingleFile("items-base.json", "baseitem"),
    ]);
    const allItems = dedupeByNameAndSource([...items, ...baseItems]);

    return {
      classes: mapNamed(filterBySources(classData.classes, allowedSources)),
      subclasses: mapNamed(filterBySources(classData.subclasses, allowedSources)),
      classFeatures: mapNamed(filterBySources(classData.classFeatures, allowedSources)),
      subclassFeatures: mapNamed(filterBySources(classData.subclassFeatures, allowedSources)),
      races: mapNamed(filterBySources(races, allowedSources)),
      backgrounds: mapNamed(filterBySources(backgrounds, allowedSources)),
      feats: mapNamed(filterBySources(feats, allowedSources)),
      optionalFeatures: mapNamed(filterBySources(optionalFeatures, allowedSources)),
      spells: mapNamed(filterBySources(spells, allowedSources)),
      items: mapNamed(filterBySources(allItems, allowedSources)),
    };
  } catch {
    return getFallbackCatalogs(allowedSources);
  }
}

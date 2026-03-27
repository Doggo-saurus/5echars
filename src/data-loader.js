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
    races: [{ name: "Human", source }, { name: "Elf", source }],
    backgrounds: [{ name: "Acolyte", source }, { name: "Criminal", source }],
    spells: [{ name: "Magic Missile", level: 1, source }, { name: "Shield", level: 1, source }],
    items: [{ name: "Longsword", source }, { name: "Leather Armor", source }],
  };
}

export async function loadCatalogs(allowedSources) {
  try {
    const [classes, races, backgrounds, spells, items, baseItems] = await Promise.all([
      loadFromIndex("class", "class"),
      loadSingleFile("races.json", "race"),
      loadSingleFile("backgrounds.json", "background"),
      loadFromIndex("spells", "spell"),
      loadSingleFile("items.json", "item"),
      loadSingleFile("items-base.json", "baseitem"),
    ]);
    const allItems = dedupeByNameAndSource([...items, ...baseItems]);

    return {
      classes: mapNamed(filterBySources(classes, allowedSources)),
      races: mapNamed(filterBySources(races, allowedSources)),
      backgrounds: mapNamed(filterBySources(backgrounds, allowedSources)),
      spells: mapNamed(filterBySources(spells, allowedSources)),
      items: mapNamed(filterBySources(allItems, allowedSources)),
    };
  } catch {
    return getFallbackCatalogs(allowedSources);
  }
}

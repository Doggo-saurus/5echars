import { SOURCE_LABELS } from "./config/sources.js";

const DATA_ROOT = "./data/catalog-src/data";

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

function mapMagicVariantsToItems(variants) {
  if (!Array.isArray(variants)) return [];
  return variants
    .map((variant) => {
      const source = variant?.source ?? variant?.inherits?.source ?? "";
      const name = variant?.name ?? "";
      if (!name || !source) return null;
      return {
        ...variant,
        source,
        name,
      };
    })
    .filter(Boolean);
}

function getDefaultConditionsCatalog() {
  return [
    { name: "Blinded", source: "PHB" },
    { name: "Charmed", source: "PHB" },
    { name: "Deafened", source: "PHB" },
    { name: "Exhaustion", source: "PHB" },
    { name: "Frightened", source: "PHB" },
    { name: "Grappled", source: "PHB" },
    { name: "Incapacitated", source: "PHB" },
    { name: "Invisible", source: "PHB" },
    { name: "Paralyzed", source: "PHB" },
    { name: "Petrified", source: "PHB" },
    { name: "Poisoned", source: "PHB" },
    { name: "Prone", source: "PHB" },
    { name: "Restrained", source: "PHB" },
    { name: "Stunned", source: "PHB" },
    { name: "Unconscious", source: "PHB" },
  ].map((entry) => ({
    ...entry,
    sourceLabel: SOURCE_LABELS[entry.source] ?? entry.source,
  }));
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
    conditions: getDefaultConditionsCatalog(),
  };
}

export async function loadCatalogs(allowedSources) {
  try {
    const [classData, races, backgrounds, feats, optionalFeatures, spells, items, baseItems, magicVariants, spellSourceLookup, conditions] = await Promise.all([
      loadClassDataFromIndex(),
      loadSingleFile("races.json", "race"),
      loadSingleFile("backgrounds.json", "background"),
      loadSingleFile("feats.json", "feat"),
      loadSingleFile("optionalfeatures.json", "optionalfeature"),
      loadFromIndex("spells", "spell"),
      loadSingleFile("items.json", "item"),
      loadSingleFile("items-base.json", "baseitem"),
      loadSingleFile("magicvariants.json", "magicvariant"),
      fetchJson(`${DATA_ROOT}/generated/gendata-spell-source-lookup.json`).catch(() => ({})),
      loadSingleFile("conditionsdiseases.json", "condition"),
    ]);
    const variantItems = mapMagicVariantsToItems(magicVariants);
    const allItems = dedupeByNameAndSource([...items, ...baseItems, ...variantItems]);
    const mappedSpells = mapNamed(filterBySources(spells, allowedSources)).map((spell) => {
      const sourceKey = String(spell?.source ?? "").trim().toLowerCase();
      const spellKey = String(spell?.name ?? "").trim().toLowerCase();
      const spellSourceEntry = spellSourceLookup?.[sourceKey]?.[spellKey] ?? null;
      return {
        ...spell,
        spellSourceEntry,
      };
    });
    const mappedConditions = mapNamed(filterBySources(conditions, allowedSources));

    return {
      classes: mapNamed(filterBySources(classData.classes, allowedSources)),
      subclasses: mapNamed(filterBySources(classData.subclasses, allowedSources)),
      classFeatures: mapNamed(filterBySources(classData.classFeatures, allowedSources)),
      subclassFeatures: mapNamed(filterBySources(classData.subclassFeatures, allowedSources)),
      races: mapNamed(filterBySources(races, allowedSources)),
      backgrounds: mapNamed(filterBySources(backgrounds, allowedSources)),
      feats: mapNamed(filterBySources(feats, allowedSources)),
      optionalFeatures: mapNamed(filterBySources(optionalFeatures, allowedSources)),
      spells: mappedSpells,
      items: mapNamed(filterBySources(allItems, allowedSources)),
      conditions: mappedConditions.length ? mappedConditions : getDefaultConditionsCatalog(),
    };
  } catch {
    return getFallbackCatalogs(allowedSources);
  }
}

import { SOURCE_LABELS } from "./config/sources.js";
import { getHomebrewItems } from "./homebrew/items.js";

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

function mapSubraces(items) {
  return (Array.isArray(items) ? items : [])
    .filter((it) => it && it.source && it.raceName)
    .map((it) => ({
      ...it,
      sourceLabel: SOURCE_LABELS[it.source] ?? it.source,
    }));
}

function sortCatalogItemsByNameAndSourcePriority(items, allowedSources) {
  const sourceOrder = new Map(
    (Array.isArray(allowedSources) ? allowedSources : [])
      .map((source, index) => [String(source ?? "").trim().toUpperCase(), index])
      .filter(([source]) => source)
  );
  const unknownSourceOrder = sourceOrder.size + 1000;
  return [...items].sort((a, b) => {
    const nameDelta = String(a?.name ?? "").localeCompare(String(b?.name ?? ""));
    if (nameDelta !== 0) return nameDelta;
    const aSource = String(a?.source ?? "").trim().toUpperCase();
    const bSource = String(b?.source ?? "").trim().toUpperCase();
    const aOrder = sourceOrder.get(aSource) ?? unknownSourceOrder;
    const bOrder = sourceOrder.get(bSource) ?? unknownSourceOrder;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return aSource.localeCompare(bSource);
  });
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

function dedupeByName(items) {
  const seen = new Set();
  return items.filter((it) => {
    const key = String(it?.name ?? "").trim().toLowerCase();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isNpcRace(item) {
  const traitTags = Array.isArray(item?.traitTags) ? item.traitTags : [];
  return traitTags.some((tag) => String(tag ?? "").trim().toLowerCase() === "npc race");
}

function filterNpcRaces(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => !isNpcRace(item));
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

function isSrdTagged(item) {
  if (!item || typeof item !== "object") return false;
  if (item.srd === true || item.srd52 === true || item.basicRules === true) return true;
  const inherits = item.inherits;
  if (!inherits || typeof inherits !== "object") return false;
  return inherits.srd === true || inherits.srd52 === true || inherits.basicRules === true;
}

function isSrdOnlyCatalogContent(groups) {
  const entries = (Array.isArray(groups) ? groups : [])
    .flatMap((group) => (Array.isArray(group) ? group : []))
    .filter((entry) => entry && typeof entry === "object");
  if (!entries.length) return false;
  return entries.every((entry) => isSrdTagged(entry));
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
    subraces: [],
    backgrounds: [{ name: "Acolyte", source }, { name: "Criminal", source }],
    feats: [],
    optionalFeatures: [],
    spells: [{ name: "Magic Missile", level: 1, source }, { name: "Shield", level: 1, source }],
    items: [{ name: "Longsword", source }, { name: "Leather Armor", source }],
    conditions: getDefaultConditionsCatalog(),
  };
}

function collectSourceKeys(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => String(item?.source ?? "").trim())
    .filter(Boolean);
}

function getBookSourceLabelMap(books) {
  const map = new Map();
  (Array.isArray(books) ? books : []).forEach((book) => {
    const sourceKey = String(book?.id ?? book?.source ?? "").trim();
    const label = String(book?.name ?? "").trim();
    if (!sourceKey || !label || map.has(sourceKey)) return;
    map.set(sourceKey, label);
  });
  return map;
}

function buildSourceEntries(sourceSet, bookLabels) {
  return [...sourceSet]
    .map((sourceKey) => {
      const label = bookLabels.get(sourceKey) ?? SOURCE_LABELS[sourceKey] ?? "";
      if (!label) return null;
      return {
        key: sourceKey,
        label,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

export async function loadAvailableSourceEntries() {
  try {
    const homebrewItems = getHomebrewItems();
    const [classData, races, subraces, backgrounds, feats, optionalFeatures, spells, items, baseItems, magicVariants, conditions, books] = await Promise.all([
      loadClassDataFromIndex(),
      loadSingleFile("races.json", "race"),
      loadSingleFile("races.json", "subrace"),
      loadSingleFile("backgrounds.json", "background"),
      loadSingleFile("feats.json", "feat"),
      loadSingleFile("optionalfeatures.json", "optionalfeature"),
      loadFromIndex("spells", "spell"),
      loadSingleFile("items.json", "item"),
      loadSingleFile("items-base.json", "baseitem"),
      loadSingleFile("magicvariants.json", "magicvariant"),
      loadSingleFile("conditionsdiseases.json", "condition"),
      loadSingleFile("books.json", "book").catch(() => []),
    ]);
    const playableRaces = filterNpcRaces(races);
    const variantItems = mapMagicVariantsToItems(magicVariants);
    const allItems = dedupeByNameAndSource([...items, ...baseItems, ...variantItems, ...homebrewItems]);
    const sourceSet = new Set([
      ...collectSourceKeys(classData.classes),
      ...collectSourceKeys(classData.subclasses),
      ...collectSourceKeys(classData.classFeatures),
      ...collectSourceKeys(classData.subclassFeatures),
      ...collectSourceKeys(playableRaces),
      ...collectSourceKeys(subraces),
      ...collectSourceKeys(backgrounds),
      ...collectSourceKeys(feats),
      ...collectSourceKeys(optionalFeatures),
      ...collectSourceKeys(spells),
      ...collectSourceKeys(allItems),
      ...collectSourceKeys(conditions),
      ...Object.keys(SOURCE_LABELS),
    ]);
    const bookLabels = getBookSourceLabelMap(books);
    return buildSourceEntries(sourceSet, bookLabels);
  } catch {
    const sourceSet = new Set(Object.keys(SOURCE_LABELS));
    return buildSourceEntries(sourceSet, new Map());
  }
}

export async function isCatalogDataSrdOnly() {
  try {
    const homebrewItems = getHomebrewItems();
    const [classData, races, subraces, backgrounds, feats, optionalFeatures, spells, items, baseItems, magicVariants, conditions] = await Promise.all([
      loadClassDataFromIndex(),
      loadSingleFile("races.json", "race"),
      loadSingleFile("races.json", "subrace"),
      loadSingleFile("backgrounds.json", "background"),
      loadSingleFile("feats.json", "feat"),
      loadSingleFile("optionalfeatures.json", "optionalfeature"),
      loadFromIndex("spells", "spell"),
      loadSingleFile("items.json", "item"),
      loadSingleFile("items-base.json", "baseitem"),
      loadSingleFile("magicvariants.json", "magicvariant"),
      loadSingleFile("conditionsdiseases.json", "condition"),
    ]);
    const playableRaces = filterNpcRaces(races);
    const variantItems = mapMagicVariantsToItems(magicVariants);
    const allItems = dedupeByNameAndSource([...items, ...baseItems, ...variantItems, ...homebrewItems]);
    return isSrdOnlyCatalogContent([
      classData.classes,
      classData.subclasses,
      classData.classFeatures,
      classData.subclassFeatures,
      playableRaces,
      subraces,
      backgrounds,
      feats,
      optionalFeatures,
      spells,
      allItems,
      conditions,
    ]);
  } catch {
    return false;
  }
}

export async function loadAvailableSources() {
  const entries = await loadAvailableSourceEntries();
  return entries.map((entry) => entry.key);
}

export async function loadCatalogs(allowedSources) {
  try {
    const homebrewItems = getHomebrewItems();
    const [classData, races, subraces, backgrounds, feats, optionalFeatures, spells, items, baseItems, magicVariants, spellSourceLookup, conditions] = await Promise.all([
      loadClassDataFromIndex(),
      loadSingleFile("races.json", "race"),
      loadSingleFile("races.json", "subrace"),
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
    const playableRaces = filterNpcRaces(races);
    const variantItems = mapMagicVariantsToItems(magicVariants);
    const allItems = dedupeByNameAndSource([...items, ...baseItems, ...variantItems, ...homebrewItems]);
    const mappedSpells = mapNamed(filterBySources(spells, allowedSources)).map((spell) => {
      const sourceKey = String(spell?.source ?? "").trim().toLowerCase();
      const spellKey = String(spell?.name ?? "").trim().toLowerCase();
      const spellSourceEntry = spellSourceLookup?.[sourceKey]?.[spellKey] ?? null;
      return {
        ...spell,
        spellSourceEntry,
      };
    });
    const mappedConditions = dedupeByName(
      sortCatalogItemsByNameAndSourcePriority(mapNamed(filterBySources(conditions, allowedSources)), allowedSources)
    );

    return {
      classes: sortCatalogItemsByNameAndSourcePriority(
        mapNamed(filterBySources(classData.classes, allowedSources)),
        allowedSources
      ),
      subclasses: sortCatalogItemsByNameAndSourcePriority(
        mapNamed(filterBySources(classData.subclasses, allowedSources)),
        allowedSources
      ),
      classFeatures: mapNamed(filterBySources(classData.classFeatures, allowedSources)),
      subclassFeatures: mapNamed(filterBySources(classData.subclassFeatures, allowedSources)),
      races: sortCatalogItemsByNameAndSourcePriority(mapNamed(filterBySources(playableRaces, allowedSources)), allowedSources),
      subraces: sortCatalogItemsByNameAndSourcePriority(mapSubraces(filterBySources(subraces, allowedSources)), allowedSources),
      backgrounds: sortCatalogItemsByNameAndSourcePriority(mapNamed(filterBySources(backgrounds, allowedSources)), allowedSources),
      feats: sortCatalogItemsByNameAndSourcePriority(mapNamed(filterBySources(feats, allowedSources)), allowedSources),
      optionalFeatures: sortCatalogItemsByNameAndSourcePriority(
        mapNamed(filterBySources(optionalFeatures, allowedSources)),
        allowedSources
      ),
      spells: mappedSpells,
      items: sortCatalogItemsByNameAndSourcePriority(
        dedupeByNameAndSource([
          ...mapNamed(filterBySources(allItems, allowedSources)),
          ...homebrewItems,
        ]),
        allowedSources
      ),
      conditions: mappedConditions.length ? mappedConditions : getDefaultConditionsCatalog(),
    };
  } catch {
    return getFallbackCatalogs(allowedSources);
  }
}

export function createPartyModalCatalogCache({
  normalizeSourceTag,
  getCharacterAllowedSources,
  loadCatalogs,
}) {
  const cache = new Map();

  function getPartyModalCatalogCacheKey(character) {
    return getCharacterAllowedSources(character)
      .map((source) => normalizeSourceTag(source))
      .filter(Boolean)
      .sort()
      .join("|");
  }

  async function getCachedPartyModalCatalogs(character) {
    const allowedSources = getCharacterAllowedSources(character);
    const cacheKey = getPartyModalCatalogCacheKey(character);
    if (!cacheKey) return loadCatalogs(allowedSources);
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const pending = loadCatalogs(allowedSources)
      .then((catalogs) => {
        cache.set(cacheKey, catalogs);
        return catalogs;
      })
      .catch((error) => {
        cache.delete(cacheKey);
        throw error;
      });
    cache.set(cacheKey, pending);
    return pending;
  }

  return {
    getCachedPartyModalCatalogs,
    getPartyModalCatalogCacheKey,
  };
}

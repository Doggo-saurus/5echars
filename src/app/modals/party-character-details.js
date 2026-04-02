export function createPartyCharacterDetailsModals({
  store,
  setDiceResult,
  getCachedPartyModalCatalogs,
  characterDetailsModals,
}) {
  async function openClassDetailsModalForCharacter(character) {
    const candidate = character && typeof character === "object" && !Array.isArray(character) ? character : null;
    if (!candidate) {
      setDiceResult("Class details unavailable: character not found.", true);
      return;
    }
    const catalogs = await getCachedPartyModalCatalogs(candidate);
    characterDetailsModals.openClassDetailsModal({
      ...store.getState(),
      catalogs,
      character: candidate,
    });
  }

  async function openSubclassDetailsModalForCharacter(character) {
    const candidate = character && typeof character === "object" && !Array.isArray(character) ? character : null;
    if (!candidate) {
      setDiceResult("Subclass details unavailable: character not found.", true);
      return;
    }
    const catalogs = await getCachedPartyModalCatalogs(candidate);
    characterDetailsModals.openSubclassDetailsModal({
      ...store.getState(),
      catalogs,
      character: candidate,
    });
  }

  return {
    openClassDetailsModalForCharacter,
    openSubclassDetailsModalForCharacter,
  };
}

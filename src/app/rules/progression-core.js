export function createProgressionCore({
  toNumber,
  abilityLabels,
  isRecordObject,
  getCharacterClassLevels,
}) {
  function getClassLevelTracks(character) {
    const classLevels = getCharacterClassLevels(character);
    const tracks = [];
    const primaryClass = String(character?.class ?? "").trim();
    if (primaryClass) {
      tracks.push({ className: primaryClass, level: classLevels.primaryLevel, isPrimary: true });
    }
    classLevels.multiclass.forEach((entry) => {
      tracks.push({ className: String(entry.class ?? "").trim(), level: entry.level, isPrimary: false });
    });
    return tracks.filter((entry) => entry.className && entry.level > 0);
  }

  function getCharacterHighestClassLevel(character) {
    const tracks = getClassLevelTracks(character);
    return tracks.reduce((highest, track) => Math.max(highest, toNumber(track.level, 0)), 0);
  }

  function doesCharacterMeetFeatPrerequisites(character, feat) {
    const prerequisites = Array.isArray(feat?.prerequisite) ? feat.prerequisite : [];
    if (!prerequisites.length) return true;
    const highestClassLevel = getCharacterHighestClassLevel(character);
    return prerequisites.some((entry) => {
      if (!entry || typeof entry !== "object") return true;
      const abilityRequirements = Object.entries(entry).filter(([key, value]) => abilityLabels[key] && Number.isFinite(toNumber(value, Number.NaN)));
      const hasAbilityFailure = abilityRequirements.some(([ability, value]) => toNumber(character?.abilities?.[ability], 0) < toNumber(value, 0));
      if (hasAbilityFailure) return false;
      if (entry.level && typeof entry.level === "object") {
        const minLevel = toNumber(entry.level.level, 0);
        if (minLevel > 0 && highestClassLevel < minLevel) return false;
      }
      return true;
    });
  }

  function doesCharacterMeetOptionalFeaturePrerequisites(character, optionalFeature) {
    const prerequisites = Array.isArray(optionalFeature?.prerequisite) ? optionalFeature.prerequisite : [];
    if (!prerequisites.length) return true;
    const highestClassLevel = getCharacterHighestClassLevel(character);
    return prerequisites.some((entry) => {
      if (!isRecordObject(entry)) return true;
      const levelRequirement = toNumber(entry.level, Number.NaN);
      if (Number.isFinite(levelRequirement) && highestClassLevel < levelRequirement) return false;
      return true;
    });
  }

  return {
    getClassLevelTracks,
    getCharacterHighestClassLevel,
    doesCharacterMeetFeatPrerequisites,
    doesCharacterMeetOptionalFeaturePrerequisites,
  };
}

// Item support policy table.
// Keep this list aligned with items.json mechanical keys and the runtime
// handlers that own each capability.
export const ITEM_KEY_SUPPORT_POLICY = {
  ability: { status: "supported", owner: "proficiencies.getAutomaticAbilityBonuses" },
  savingThrowProficiencies: { status: "supported", owner: "proficiencies.getAutomaticSaveProficiencies" },
  saveProficiencies: { status: "supported", owner: "proficiencies.getAutomaticSaveProficiencies" },
  skillProficiencies: { status: "supported", owner: "proficiencies.getAutomaticSkillProficiencies" },
  toolProficiencies: { status: "supported", owner: "proficiencySummary.getCharacterToolAndDefenseSummary" },
  skillToolLanguageProficiencies: { status: "supported", owner: "proficiencySummary + proficiencies" },
  expertise: { status: "supported", owner: "proficiencies.getAutomaticSkillProficiencyModes" },
  additionalSpells: { status: "supported", owner: "spells.getAutoGrantedSpellData" },
  weaponProficiencies: { status: "supported", owner: "proficiencySummary.getCharacterToolAndDefenseSummary" },
  armorProficiencies: { status: "supported", owner: "proficiencySummary.getCharacterToolAndDefenseSummary" },
  languageProficiencies: { status: "supported", owner: "proficiencySummary.getCharacterToolAndDefenseSummary" },
  resist: { status: "supported", owner: "proficiencySummary.getCharacterToolAndDefenseSummary" },
  immune: { status: "supported", owner: "proficiencySummary.getCharacterToolAndDefenseSummary" },
  conditionImmune: { status: "supported", owner: "proficiencySummary.getCharacterToolAndDefenseSummary" },
  vulnerable: { status: "supported", owner: "proficiencySummary.getCharacterToolAndDefenseSummary" },
  senses: { status: "supported", owner: "engine.computeDerivedStats + summary" },
  bonusSenses: { status: "supported", owner: "engine.computeDerivedStats + summary" },
  bonusAc: { status: "supported", owner: "engine.getArmorClassBreakdown" },
  bonusSavingThrow: { status: "supported", owner: "engine.computeDerivedStats + save render/roll" },
};

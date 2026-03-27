import { CharacterRepository } from "./character-repository.js";

export class InMemoryCharacterRepository extends CharacterRepository {
  constructor(seed = null) {
    super();
    this.store = seed instanceof Map ? seed : new Map();
  }

  async create(id, character) {
    this.store.set(id, structuredClone(character));
    return structuredClone(character);
  }

  async getById(id) {
    if (!this.store.has(id)) return null;
    return structuredClone(this.store.get(id));
  }

  async save(id, character) {
    this.store.set(id, structuredClone(character));
    return structuredClone(character);
  }
}

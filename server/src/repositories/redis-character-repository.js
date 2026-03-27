import { CharacterRepository } from "./character-repository.js";

function keyForCharacter(id) {
  return `char:${id}`;
}

export class RedisCharacterRepository extends CharacterRepository {
  constructor(client) {
    super();
    this.client = client;
  }

  async create(id, character) {
    const payload = JSON.stringify(character);
    await this.client.set(keyForCharacter(id), payload);
    return structuredClone(character);
  }

  async getById(id) {
    const payload = await this.client.get(keyForCharacter(id));
    if (!payload) return null;
    try {
      const parsed = JSON.parse(payload);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  async save(id, character) {
    const payload = JSON.stringify(character);
    await this.client.set(keyForCharacter(id), payload);
    return structuredClone(character);
  }
}

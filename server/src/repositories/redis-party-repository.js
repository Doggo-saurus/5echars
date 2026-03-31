import { PartyRepository } from "./party-repository.js";

function keyForParty(id) {
  return `party:${id}`;
}

export class RedisPartyRepository extends PartyRepository {
  constructor(client) {
    super();
    this.client = client;
  }

  async create(id, party) {
    const payload = JSON.stringify(party);
    await this.client.set(keyForParty(id), payload);
    return structuredClone(party);
  }

  async getById(id) {
    const payload = await this.client.get(keyForParty(id));
    if (!payload) return null;
    try {
      const parsed = JSON.parse(payload);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  async save(id, party) {
    const payload = JSON.stringify(party);
    await this.client.set(keyForParty(id), payload);
    return structuredClone(party);
  }
}

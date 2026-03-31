import { PartyRepository } from "./party-repository.js";

export class InMemoryPartyRepository extends PartyRepository {
  constructor(seed = null) {
    super();
    this.store = seed instanceof Map ? seed : new Map();
  }

  async create(id, party) {
    this.store.set(id, structuredClone(party));
    return structuredClone(party);
  }

  async getById(id) {
    if (!this.store.has(id)) return null;
    return structuredClone(this.store.get(id));
  }

  async save(id, party) {
    this.store.set(id, structuredClone(party));
    return structuredClone(party);
  }
}

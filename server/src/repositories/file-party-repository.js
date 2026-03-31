import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PartyRepository } from "./party-repository.js";

function filePathForParty(directory, id) {
  return path.join(directory, `${id}.txt`);
}

export class FilePartyRepository extends PartyRepository {
  constructor(directory) {
    super();
    this.directory = directory;
    this.ensureDirectoryPromise = null;
  }

  async ensureDirectory() {
    if (!this.ensureDirectoryPromise) {
      this.ensureDirectoryPromise = mkdir(this.directory, { recursive: true });
    }
    await this.ensureDirectoryPromise;
  }

  async create(id, party) {
    await this.ensureDirectory();
    const payload = JSON.stringify(party, null, 2);
    await writeFile(filePathForParty(this.directory, id), payload, "utf8");
    return structuredClone(party);
  }

  async getById(id) {
    await this.ensureDirectory();
    try {
      const payload = await readFile(filePathForParty(this.directory, id), "utf8");
      const parsed = JSON.parse(payload);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async save(id, party) {
    await this.ensureDirectory();
    const payload = JSON.stringify(party, null, 2);
    await writeFile(filePathForParty(this.directory, id), payload, "utf8");
    return structuredClone(party);
  }
}

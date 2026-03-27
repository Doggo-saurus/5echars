import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CharacterRepository } from "./character-repository.js";

function filePathForCharacter(directory, id) {
  return path.join(directory, `${id}.txt`);
}

export class FileCharacterRepository extends CharacterRepository {
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

  async create(id, character) {
    await this.ensureDirectory();
    const payload = JSON.stringify(character, null, 2);
    await writeFile(filePathForCharacter(this.directory, id), payload, "utf8");
    return structuredClone(character);
  }

  async getById(id) {
    await this.ensureDirectory();
    try {
      const payload = await readFile(filePathForCharacter(this.directory, id), "utf8");
      const parsed = JSON.parse(payload);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async save(id, character) {
    await this.ensureDirectory();
    const payload = JSON.stringify(character, null, 2);
    await writeFile(filePathForCharacter(this.directory, id), payload, "utf8");
    return structuredClone(character);
  }
}

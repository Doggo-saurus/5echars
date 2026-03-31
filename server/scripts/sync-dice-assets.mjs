import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const serverDir = path.dirname(path.dirname(thisFile));
const rootDir = path.dirname(serverDir);

const paths = {
  diceBoxDist: path.join(serverDir, "node_modules", "@3d-dice", "dice-box", "dist"),
  diceThemesDir: path.join(serverDir, "node_modules", "@3d-dice", "dice-themes", "themes"),
  publicVendorDir: path.join(rootDir, "public", "vendor", "dice-box"),
  publicVendorThemesDir: path.join(rootDir, "public", "vendor", "dice-box", "assets", "themes"),
};

async function ensureExists(targetPath, label) {
  try {
    const details = await stat(targetPath);
    if (!details.isDirectory()) {
      throw new Error(`${label} exists but is not a directory: ${targetPath}`);
    }
  } catch {
    throw new Error(`${label} is missing. Run npm install in server/ first. (${targetPath})`);
  }
}

async function syncDir(fromDir, toDir) {
  await rm(toDir, { recursive: true, force: true });
  await mkdir(path.dirname(toDir), { recursive: true });
  await cp(fromDir, toDir, { recursive: true });
}

async function run() {
  await ensureExists(paths.diceBoxDist, "Dice Box dist");
  await ensureExists(paths.diceThemesDir, "Dice themes");

  await syncDir(paths.diceBoxDist, paths.publicVendorDir);
  await mkdir(paths.publicVendorThemesDir, { recursive: true });
  await cp(paths.diceThemesDir, paths.publicVendorThemesDir, { recursive: true, force: true });

  console.log("Dice assets synced:");
  console.log(`- ${paths.publicVendorDir}`);
  console.log(`- ${paths.publicVendorThemesDir}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

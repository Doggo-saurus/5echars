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
};

const RUNTIME_FILES = ["dice-box.es.min.js", "Dice.min.js", "world.onscreen.min.js", "world.offscreen.min.js", "world.none.min.js"];
const REQUIRED_THEMES = ["default", "blueGreenMetal", "rust", "wooden", "rock", "smooth"];

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

async function ensureDirectory(pathname) {
  await mkdir(pathname, { recursive: true });
}

async function copyDirectory(sourceDir, targetDir) {
  await cp(sourceDir, targetDir, { recursive: true, force: true });
}

async function run() {
  await ensureExists(paths.diceBoxDist, "Dice Box dist");
  await ensureExists(paths.diceThemesDir, "Dice themes");

  await rm(paths.publicVendorDir, { recursive: true, force: true });
  await ensureDirectory(paths.publicVendorDir);

  for (const filename of RUNTIME_FILES) {
    const source = path.join(paths.diceBoxDist, filename);
    const target = path.join(paths.publicVendorDir, filename);
    await cp(source, target, { force: true });
  }

  const targetAmmoDir = path.join(paths.publicVendorDir, "assets", "ammo");
  await ensureDirectory(targetAmmoDir);
  await copyDirectory(path.join(paths.diceBoxDist, "assets", "ammo"), targetAmmoDir);

  const targetThemesDir = path.join(paths.publicVendorDir, "assets", "themes");
  await ensureDirectory(targetThemesDir);
  await copyDirectory(path.join(paths.diceBoxDist, "assets", "themes", "default"), path.join(targetThemesDir, "default"));

  for (const themeName of REQUIRED_THEMES) {
    if (themeName === "default") continue;
    const sourceThemeDir = path.join(paths.diceThemesDir, themeName);
    const targetThemeDir = path.join(targetThemesDir, themeName);
    await copyDirectory(sourceThemeDir, targetThemeDir);
  }

  console.log("Dice assets synced:");
  console.log(`- ${paths.publicVendorDir}`);
  console.log(`- themes: ${["default", ...REQUIRED_THEMES.filter((it) => it !== "default")].join(", ")}`);
  console.log(`- runtime files: ${RUNTIME_FILES.join(", ")}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

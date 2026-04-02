import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const entryFile = path.join(repoRoot, "src/main.js");
const outdir = path.join(repoRoot, "public/dist");

const args = new Set(process.argv.slice(2));
const isWatch = args.has("--watch");
const shouldMinify = args.has("--minify") || process.env.NODE_ENV === "production";

async function run() {
  await rm(outdir, { recursive: true, force: true });

  const buildContext = {
    entryPoints: [entryFile],
    outdir,
    bundle: true,
    splitting: true,
    format: "esm",
    target: ["es2022"],
    sourcemap: true,
    minify: shouldMinify,
    logLevel: "info",
    chunkNames: "chunks/[name]-[hash]",
    entryNames: "[name]",
  };

  if (isWatch) {
    const buildContextWatcher = await context({
      ...buildContext,
      metafile: false,
    });
    await buildContextWatcher.watch();
    console.log("esbuild watch mode active for src/main.js -> public/dist");
    return;
  }

  await build({
    ...buildContext,
    metafile: false,
  });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

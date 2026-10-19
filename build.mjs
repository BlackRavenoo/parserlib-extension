import * as esbuild from "esbuild";
import { cpSync, mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const watch = process.argv.includes("--watch");
const zipRequested = process.argv.includes("--zip");
if (watch && zipRequested) throw new Error("--watch и --zip нельзя использовать вместе.");
const outdir = "dist";
if (!existsSync(outdir)) mkdirSync(outdir);

const common = {
  outdir,
  bundle: true,
  target: "es2022",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
};

const pagesBuild = {
  ...common,
  format: "esm",
  entryPoints: { "popup/popup": "src/popup/popup.ts", "job/job": "src/job/job.ts" },
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
};

function copyStaticFiles() {
  cpSync("manifest.json", `${outdir}/manifest.json`);
  mkdirSync(`${outdir}/popup`, { recursive: true });
  mkdirSync(`${outdir}/job`, { recursive: true });
  cpSync("src/popup/index.html", `${outdir}/popup/index.html`);
  cpSync("src/job/index.html", `${outdir}/job/index.html`);
  if (existsSync("icons")) cpSync("icons", `${outdir}/icons`, { recursive: true });
}

function* filesUnder(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) yield* filesUnder(filePath);
    else if (entry.isFile()) yield filePath;
  }
}

function builtFiles() {
  const pending = [join(outdir, "popup/popup.js"), join(outdir, "job/job.js")];
  const files = new Set();
  const imports = /\b(?:from\s*|import\s*(?:\(\s*)?)["'](\.{1,2}\/[^"']+\.js)["']/g;

  while (pending.length > 0) {
    const filePath = resolve(pending.pop());
    const name = relative(resolve(outdir), filePath).split(sep).join("/");
    if (name === ".." || name.startsWith("../")) throw new Error(`Файл вне каталога сборки: ${filePath}`);
    if (files.has(filePath)) continue;
    files.add(filePath);

    for (const match of readFileSync(filePath, "utf8").matchAll(imports)) {
      pending.push(resolve(dirname(filePath), match[1]));
    }
  }
  return files;
}

async function writeZip() {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const staticFiles = [
    `${outdir}/manifest.json`,
    `${outdir}/popup/index.html`,
    `${outdir}/job/index.html`,
    ...(existsSync("icons") ? [...filesUnder("icons")].map((filePath) => join(outdir, filePath)) : []),
  ];

  for (const filePath of builtFiles()) {
    const name = relative(resolve(outdir), resolve(filePath)).split(sep).join("/");
    zip.file(name, readFileSync(filePath));
  }
  for (const filePath of staticFiles) {
    const name = relative(resolve(outdir), resolve(filePath)).split(sep).join("/");
    zip.file(name, readFileSync(filePath));
  }

  const { version } = JSON.parse(readFileSync("manifest.json", "utf8"));
  const archivePath = `parserlib-extension-${version}.zip`;
  writeFileSync(archivePath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  console.log(`Archive complete -> ${archivePath}`);
}

if (watch) {
  const ctx = await esbuild.context(pagesBuild);
  await ctx.watch();
  copyStaticFiles();
  console.log("Watching for changes...");
} else {
  await esbuild.build(pagesBuild);
  copyStaticFiles();
  console.log("Build complete -> dist/");
  if (zipRequested) await writeZip();
}

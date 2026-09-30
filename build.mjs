import * as esbuild from "esbuild";
import { cpSync, mkdirSync, existsSync } from "node:fs";

const watch = process.argv.includes("--watch");
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

const isolatedBuild = {
  ...common,
  format: "iife",
  entryPoints: {
    background: "src/background/index.ts",
  },
  splitting: false,
};

function copyStaticFiles() {
  cpSync("manifest.json", `${outdir}/manifest.json`);
  mkdirSync(`${outdir}/popup`, { recursive: true });
  mkdirSync(`${outdir}/job`, { recursive: true });
  cpSync("src/popup/index.html", `${outdir}/popup/index.html`);
  cpSync("src/job/index.html", `${outdir}/job/index.html`);
  if (existsSync("icons")) cpSync("icons", `${outdir}/icons`, { recursive: true });
}

if (watch) {
  const ctxs = await Promise.all([esbuild.context(pagesBuild), esbuild.context(isolatedBuild)]);
  await Promise.all(ctxs.map((c) => c.watch()));
  copyStaticFiles();
  console.log("Watching for changes...");
} else {
  await Promise.all([esbuild.build(pagesBuild), esbuild.build(isolatedBuild)]);
  copyStaticFiles();
  console.log("Build complete -> dist/");
}

import * as esbuild from "esbuild";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const testDirectory = resolve(projectRoot, "tests");
const testFiles = readdirSync(testDirectory)
  .filter((file) => file.endsWith(".test.ts"))
  .map((file) => join(testDirectory, file));

if (testFiles.length === 0) {
  console.error("No test files found in tests/");
  process.exitCode = 1;
} else {
  const outputDirectory = mkdtempSync(join(tmpdir(), "parserlib-extension-tests-"));
  const absoluteTempRoot = resolve(tmpdir()) + sep;

  try {
    await esbuild.build({
      absWorkingDir: projectRoot,
      entryPoints: testFiles,
      outdir: outputDirectory,
      outExtension: { ".js": ".mjs" },
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node18",
      logLevel: "silent",
    });

    const bundledTests = testFiles.map((file) =>
      join(outputDirectory, file.replace(testDirectory + sep, "").replace(/\.ts$/, ".mjs"))
    );
    const result = spawnSync(process.execPath, ["--test", ...bundledTests], {
      cwd: projectRoot,
      stdio: "inherit",
    });

    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    if (!outputDirectory.startsWith(absoluteTempRoot)) {
      throw new Error(`Refusing to remove test output outside the OS temp directory: ${outputDirectory}`);
    }
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

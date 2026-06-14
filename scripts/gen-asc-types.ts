/**
 * `npm run gen:asc` — vendor Apple's App Store Connect OpenAPI spec and regenerate the committed
 * TypeScript types at src/core/asc/schema.ts.
 *
 * Flow: download the spec zip → unzip via the repo's shell-safe `capture` → pick the real `*.oas.json`
 * (skipping the __MACOSX fork) → strip Apple's trailing-slash server URL → run openapi-typescript →
 * prepend a deterministic header → write schema.ts.
 *
 * The generated file is committed (no network/codegen at build time); CI re-runs this and fails if it
 * drifts from Apple's current spec — see .github/workflows/schema-drift.yml. The pure, tested logic
 * lives in src/core/asc/specPatch.ts; this file is just I/O orchestration (not built or linted).
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString, type OpenAPI3 } from "openapi-typescript";
import { capture } from "../src/core/exec.js";
import { ASC_SPEC_URL, generatedHeader, normalizeAscSpec, pickSpecEntry } from "../src/core/asc/specPatch.js";

const OUTPUT = fileURLToPath(new URL("../src/core/asc/schema.ts", import.meta.url));

async function main(): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), "asc-spec-"));
  try {
    process.stdout.write(`Downloading ${ASC_SPEC_URL}\n`);
    const response = await fetch(ASC_SPEC_URL);
    if (!response.ok) throw new Error(`spec download failed: ${response.status} ${response.statusText}`);
    const zipPath = join(work, "spec.zip");
    await writeFile(zipPath, Buffer.from(await response.arrayBuffer()));

    const outDir = join(work, "out");
    await capture("unzip", ["-o", "-q", zipPath, "-d", outDir]);
    const specEntry = pickSpecEntry(await readdir(outDir, { recursive: true }));
    if (!specEntry) throw new Error(`no spec file found in the archive at ${ASC_SPEC_URL}`);

    const spec = normalizeAscSpec(JSON.parse(await readFile(join(outDir, specEntry), "utf8")) as OpenAPI3);
    process.stdout.write(`Generating types from OpenAPI ${spec.openapi}, spec version ${spec.info.version}\n`);
    const types = astToString(await openapiTS(spec));
    await writeFile(OUTPUT, generatedHeader(spec) + types);
    process.stdout.write(`Wrote ${OUTPUT}\n`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

await main();

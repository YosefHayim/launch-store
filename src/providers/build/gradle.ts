/**
 * The `gradle` build engine — Launch's Android compile/sign/export path, twin of `build/fastlane.ts`.
 *
 * Drives the project's Gradle wrapper to assemble a signed Android App Bundle (`.aab`), injecting the
 * resolved upload keystore through AGP's `android.injected.signing.*` properties so the release is
 * signed with exactly the key Launch owns — no edit to the generated `build.gradle`, and no dependence
 * on whatever signingConfig prebuild scaffolded. It then estimates the real download with `bundletool`
 * (the `.aab` file size is NOT what users download), surfacing one worst-case row so the shared size
 * gate stays meaningful. Implements {@link BuildEngine}; a raw-AGP engine could replace it behind the
 * same call.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BuildCredentials,
  BuildEngine,
  KeystoreAssets,
  ResolvedBuildContext,
  SizeReport,
  SizeReportEntry,
} from "../../core/types.js";
import { capture, run } from "../../core/exec.js";
import { runWithProgress, gradleProgressStep } from "../../core/progress.js";

/** Locate the Gradle wrapper for the platform; absolute path so `spawn` needs no shell to resolve it. */
function gradleWrapper(androidDir: string): string {
  const wrapper = join(androidDir, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  if (!existsSync(wrapper)) throw new Error(`No Gradle wrapper at ${wrapper} — did prebuild run?`);
  return wrapper;
}

/** Find the single release `.aab` Gradle emitted under `app/build/outputs/bundle/release/`. */
function findBundle(androidDir: string): string {
  const releaseDir = join(androidDir, "app", "build", "outputs", "bundle", "release");
  if (!existsSync(releaseDir)) throw new Error(`Gradle produced no release bundle dir (${releaseDir}).`);
  const aab = readdirSync(releaseDir).find((entry) => entry.endsWith(".aab"));
  if (!aab) throw new Error(`No .aab found in ${releaseDir} after bundleRelease.`);
  return join(releaseDir, aab);
}

/** Find the single release `.apk` Gradle emitted under `app/build/outputs/apk/release/` (internal distribution). */
function findApk(androidDir: string): string {
  const releaseDir = join(androidDir, "app", "build", "outputs", "apk", "release");
  if (!existsSync(releaseDir)) throw new Error(`Gradle produced no release apk dir (${releaseDir}).`);
  const apk = readdirSync(releaseDir).find((entry) => entry.endsWith(".apk"));
  if (!apk) throw new Error(`No .apk found in ${releaseDir} after assembleRelease.`);
  return join(releaseDir, apk);
}

/**
 * Parse `bundletool get-size total --dimensions=ALL` CSV into the min/max download in bytes.
 *
 * The output is a header row (whose last two columns are `MIN`,`MAX`) followed by one row per device
 * configuration. The honest worst-case download is the largest `MAX` across configurations; `MIN` is
 * the smallest. Unrecognized output degrades to zeros rather than throwing, so a bundletool format
 * drift surfaces as a 0-byte estimate (caught by the caller), not a crash.
 */
export function parseBundletoolSize(csv: string): { minBytes: number; maxBytes: number } {
  const lines = csv
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const header = (lines[0] ?? "").split(",").map((cell) => cell.trim().toUpperCase());
  const minCol = header.indexOf("MIN");
  const maxCol = header.indexOf("MAX");
  if (lines.length < 2 || minCol === -1 || maxCol === -1) return { minBytes: 0, maxBytes: 0 };

  let minBytes = Number.POSITIVE_INFINITY;
  let maxBytes = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const min = Number.parseInt(cells[minCol] ?? "", 10);
    const max = Number.parseInt(cells[maxCol] ?? "", 10);
    if (!Number.isNaN(min)) minBytes = Math.min(minBytes, min);
    if (!Number.isNaN(max)) maxBytes = Math.max(maxBytes, max);
  }
  return { minBytes: Number.isFinite(minBytes) ? minBytes : 0, maxBytes };
}

/**
 * Estimate the worst-case store download for an `.aab` with bundletool: build the device APK splits
 * (signed with the same upload keystore, so the estimate is representative), then read the size table.
 * Returns one {@link SizeReportEntry} (`installBytes` 0 — Play exposes no honest install figure), or an
 * empty array if the estimate couldn't be produced, so the build still completes with the `.aab` size.
 */
async function estimateDownload(aabPath: string, keystore: KeystoreAssets): Promise<SizeReportEntry[]> {
  const work = mkdtempSync(join(tmpdir(), "launch-aab-"));
  const apksPath = join(work, "app.apks");
  try {
    await run("bundletool", [
      "build-apks",
      `--bundle=${aabPath}`,
      `--output=${apksPath}`,
      "--mode=default",
      `--ks=${keystore.path}`,
      `--ks-pass=pass:${keystore.storePassword}`,
      `--ks-key-alias=${keystore.alias}`,
      `--key-pass=pass:${keystore.keyPassword}`,
    ]);
    const csv = await capture("bundletool", ["get-size", "total", `--apks=${apksPath}`, "--dimensions=ALL"]);
    const { maxBytes } = parseBundletoolSize(csv);
    return maxBytes > 0 ? [{ device: "worst-case device", downloadBytes: maxBytes, installBytes: 0 }] : [];
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export const gradleBuildEngine: BuildEngine = {
  name: "gradle",

  async build(
    ctx: ResolvedBuildContext,
    creds: BuildCredentials,
  ): Promise<{ artifactPath: string; sizeReport: SizeReport; cleanBuilt: boolean }> {
    if (ctx.dryRun) {
      return { artifactPath: "(dry-run, not built)", sizeReport: { artifactBytes: 0, entries: [] }, cleanBuilt: false };
    }
    if (creds.platform !== "android") throw new Error("The gradle build engine builds Android only.");
    const keystore = creds.keystore;
    if (!keystore) throw new Error("No upload keystore resolved — run `launch creds setup --platform android` first.");

    const androidDir = join(ctx.app.dir, "android");
    const wrapper = gradleWrapper(androidDir);

    // Gradle is incrementally correct by default; `--clean` prepends the clean task for a from-scratch build.
    // (iOS-style native fingerprinting isn't needed here — Gradle tracks task inputs/outputs itself.)
    const cleanBuilt = ctx.forceClean;

    // Internal distribution needs a directly-installable .apk; the store path produces an .aab.
    const internal = ctx.distribution === "internal";
    const assembleTask = internal ? ":app:assembleRelease" : ":app:bundleRelease";

    // Sign the artifact with the resolved upload key via AGP's injected-signing properties (no build.gradle edit).
    await runWithProgress(
      wrapper,
      [
        ...(cleanBuilt ? [":app:clean"] : []),
        assembleTask,
        `-Pandroid.injected.signing.store.file=${keystore.path}`,
        `-Pandroid.injected.signing.store.password=${keystore.storePassword}`,
        `-Pandroid.injected.signing.key.alias=${keystore.alias}`,
        `-Pandroid.injected.signing.key.password=${keystore.keyPassword}`,
      ],
      { label: `Building Android · ${ctx.app.name}`, parseStep: gradleProgressStep, cwd: androidDir, env: ctx.env },
    );

    // An .apk's on-disk size is essentially the download (no Play splits), so report it directly;
    // an .aab gets the bundletool worst-case estimate (the .aab file size is NOT the download).
    if (internal) {
      const apkPath = findApk(androidDir);
      const apkBytes = statSync(apkPath).size;
      return {
        artifactPath: apkPath,
        sizeReport: { artifactBytes: apkBytes, entries: [{ device: "apk", downloadBytes: apkBytes, installBytes: 0 }] },
        cleanBuilt,
      };
    }

    const artifactPath = findBundle(androidDir);
    const artifactBytes = statSync(artifactPath).size;
    const entries = await estimateDownload(artifactPath, keystore);
    return { artifactPath, sizeReport: { artifactBytes, entries }, cleanBuilt };
  },
};

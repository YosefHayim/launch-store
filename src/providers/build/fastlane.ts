/**
 * The `fastlane` build engine — v1's iOS compile/sign/export path.
 *
 * Drives fastlane `gym` to archive and export a signed `.ipa` using MANUAL signing with the exact
 * distribution certificate + provisioning profile Launch resolved (so there's no surprise about
 * which identity signs the build). It exports with app thinning so Xcode emits the App Thinning
 * Size Report — the source of the per-device download/install numbers Launch shows before any upload.
 * Implements {@link BuildEngine}; a raw-`xcodebuild` engine could replace it behind the same call.
 */

import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  BuildCredentials,
  BuildEngine,
  ResolvedBuildContext,
  SigningAssets,
  SizeReport,
  SizeReportEntry,
} from "../../core/types.js";
import { runWithProgress, xcodeProgressStep } from "../../core/progress.js";
import { exists } from "../../core/exec.js";
import { hostResources } from "../../core/os.js";
import { buildXcargs, ccacheEnv, computeBuildJobs } from "../../core/buildFlags.js";
import {
  estimateFor,
  gatherIosFingerprint,
  readBuildState,
  resolveClean,
  updateEstimate,
  writeBuildState,
} from "../../core/buildFingerprint.js";

/**
 * Resolve an app's iOS project directory to an ABSOLUTE path.
 *
 * `ctx.app.dir` is relative whenever `launch.config.ts` uses a relative `appRoots` — the monorepo
 * case, e.g. `apps/pomedero`. gym is run with its `cwd` at the app dir, and it re-resolves a
 * *relative* `--workspace` against that cwd, doubling the subpath to
 * `apps/pomedero/apps/pomedero/ios/…` and failing with "Workspace file not found". Resolving the
 * dir to absolute here means the workspace path gym receives (and the `pod install` cwd) is one no
 * cwd can double, in both single-app and monorepo layouts.
 */
export function resolveIosDir(appDir: string): string {
  return resolve(appDir, "ios");
}

/** Locate the generated Xcode workspace and derive its scheme from the `ios/` directory. */
function findWorkspace(iosDir: string): { workspace: string; scheme: string } {
  if (!existsSync(iosDir)) throw new Error(`No ios/ directory at ${iosDir} — did prebuild run?`);
  const workspace = readdirSync(iosDir).find((entry) => entry.endsWith(".xcworkspace"));
  if (!workspace) throw new Error(`No .xcworkspace found in ${iosDir}.`);
  return { workspace: join(iosDir, workspace), scheme: workspace.replace(/\.xcworkspace$/, "") };
}

/** Convert a size like `46.1` + `MB` into bytes. */
function toBytes(value: number, unit: string): number {
  const scale: Record<string, number> = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
  return Math.round(value * (scale[unit.toUpperCase()] ?? 1));
}

/**
 * Parse Xcode's "App Thinning Size Report.txt" into per-device entries. The report lists each
 * device variant followed by a size line giving compressed (≈ download) and uncompressed (≈ install)
 * sizes. Unrecognized lines are ignored, so a format drift degrades to fewer entries, not a crash.
 */
export function parseThinningReport(text: string): SizeReportEntry[] {
  const entries: SizeReportEntry[] = [];
  const blocks = text.split(/Variant:/).slice(1);
  for (const block of blocks) {
    const device = /(iPhone[\d,]+|iPad[\d,]+|Universal)/.exec(block)?.[1] ?? "Universal";
    const size = /App size:\s*([\d.]+)\s*(KB|MB|GB)\s*compressed,\s*([\d.]+)\s*(KB|MB|GB)\s*uncompressed/i.exec(block);
    if (!size) continue;
    const [, downloadValue, downloadUnit, installValue, installUnit] = size;
    if (!downloadValue || !downloadUnit || !installValue || !installUnit) continue;
    entries.push({
      device,
      downloadBytes: toBytes(Number.parseFloat(downloadValue), downloadUnit),
      installBytes: toBytes(Number.parseFloat(installValue), installUnit),
    });
  }
  return entries;
}

/**
 * Guard that the build produced a real device App Store archive before we try to submit it.
 *
 * A simulator build yields a `.app` under a `*-iphonesimulator` directory whose binary is built for
 * the simulator — it can never reach TestFlight, and the failure otherwise surfaces late and cryptic
 * (the reported symptom was an `xcrun simctl install …` error). Catching it the moment gym finishes
 * fails loud and actionable instead of wasting an upload round-trip on a dead artifact.
 *
 * @param artifactPath absolute path gym reported for the exported artifact
 * @param sizeBytes the artifact's size on disk (a 0-byte file means the export failed silently)
 */
export function assertDeviceArtifact(artifactPath: string, sizeBytes: number): void {
  if (/-iphonesimulator/i.test(artifactPath)) {
    throw new Error(
      `Build produced a simulator artifact (${artifactPath}). TestFlight needs a device archive — ` +
        `build for "Any iOS Device", not a simulator, then re-run \`launch build ios\`.`,
    );
  }
  if (!artifactPath.toLowerCase().endsWith(".ipa")) {
    throw new Error(
      `Expected a signed .ipa but got ${artifactPath} — a .app bundle is a simulator/unpackaged build and can't be submitted.`,
    );
  }
  if (sizeBytes <= 0) {
    throw new Error(`Build artifact ${artifactPath} is empty (0 bytes) — the export failed silently.`);
  }
}

/**
 * Build the export-options plist for manual signing with the resolved profile + cert. `method` is
 * `app-store` for a store/TestFlight build or `ad-hoc` for an internal install-link build — the only
 * difference between the two export paths, since both use the same manual signing inputs.
 */
export function exportOptionsPlist(signing: SigningAssets, method: "app-store" | "ad-hoc" = "app-store"): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    `<key>method</key><string>${method}</string>`,
    "<key>signingStyle</key><string>manual</string>",
    `<key>teamID</key><string>${signing.teamId}</string>`,
    `<key>signingCertificate</key><string>${signing.certName}</string>`,
    "<key>provisioningProfiles</key><dict>",
    `<key>${signing.bundleId}</key><string>${signing.profileName}</string>`,
    "</dict>",
    "<key>thinning</key><string>&lt;thin-for-all-variants&gt;</string>",
    "</dict></plist>",
  ].join("\n");
}

/**
 * Assemble the environment for the `gym` subprocess, layered by precedence (later spreads win).
 *
 * `ctx.env` goes in FIRST — it's Launch's resolved build env (the `--env` › secrets › `profile env:`
 * › `.env.<profile>` › `.env` ladder), and it's what `xcodebuild`'s "Bundle React Native code"
 * phase reads to inline `EXPO_PUBLIC_*` into the shipped bundle. The ccache compiler wrappers and the
 * App Store Connect API key are layered over it so those build-critical/auth vars still win over any
 * same-named user var. Gradle/EAS/submit already forward `ctx.env`; local iOS was the lone gap that
 * silently dropped every layer above the app's own `.env` (issue #109).
 */
export function gymEnv(
  ctxEnv: Record<string, string>,
  ccacheVars: Record<string, string>,
  ascKey: { keyId: string; issuerId: string },
): Record<string, string> {
  return {
    ...ctxEnv,
    ...ccacheVars,
    APP_STORE_CONNECT_API_KEY_KEY_ID: ascKey.keyId,
    APP_STORE_CONNECT_API_KEY_ISSUER_ID: ascKey.issuerId,
  };
}

export const fastlaneBuildEngine: BuildEngine = {
  name: "fastlane",

  async build(
    ctx: ResolvedBuildContext,
    creds: BuildCredentials,
  ): Promise<{ artifactPath: string; sizeReport: SizeReport; cleanBuilt: boolean }> {
    if (ctx.dryRun) {
      return { artifactPath: "(dry-run, not built)", sizeReport: { artifactBytes: 0, entries: [] }, cleanBuilt: false };
    }
    if (creds.platform !== "ios") throw new Error("The fastlane build engine builds iOS only.");
    const signing = creds.signing;
    if (!signing) throw new Error("No signing assets resolved — run `launch creds setup` first.");

    const iosDir = resolveIosDir(ctx.app.dir);
    const { workspace, scheme } = findWorkspace(iosDir);

    // Decide clean-vs-incremental from the native-graph fingerprint (or a forced `--clean`).
    const fingerprint = await gatherIosFingerprint(iosDir, ctx.app.configPath);
    const stored = readBuildState(ctx.app.name, "ios");
    const decision = resolveClean(ctx.forceClean, stored, fingerprint);
    // A clean and an incremental build take wildly different times, so the ETA is keyed on the verdict.
    const kind = decision.clean ? "clean" : "incremental";
    const estimate = estimateFor(stored, kind);

    // ccache wires in only when it's installed; otherwise the build runs uncached (doctor recommends it).
    const ccacheVars = (await exists("ccache")) ? ccacheEnv() : {};

    // Re-resolve Pods only when the native graph changed (or they're absent) — baking ccache in then.
    // Under a spinner (clean `◇ Pods · 12s`), with the CocoaPods output tee'd to the build log like gym.
    // RCT_IGNORE_PODS_DEPRECATION silences React Native's "calling `pod install` directly is deprecated"
    // banner: Launch drives CocoaPods itself to archive an exportable, store-bound `.ipa` via gym, so the
    // banner's suggested `expo run:ios` / `yarn ios` (which build-to-run on a device, not an exportable
    // artifact) don't apply here. See react-native's react_native_pods.rb for the env-var contract.
    if (decision.nativeChanged || !existsSync(join(iosDir, "Pods"))) {
      await runWithProgress("pod", ["install"], {
        label: "Pods",
        cwd: iosDir,
        env: { ...ctx.env, ...ccacheVars, RCT_IGNORE_PODS_DEPRECATION: "1" },
      });
    }

    const { cores, memBytes } = hostResources();
    const jobs = computeBuildJobs(cores, memBytes);

    const outputDir = mkdtempSync(join(tmpdir(), "launch-build-"));
    const plistPath = join(outputDir, "ExportOptions.plist");
    // Internal distribution exports an ad-hoc archive (installs on the profile's registered devices);
    // everything else exports for the store. Same manual-signing inputs either way.
    const exportMethod = ctx.distribution === "internal" ? "ad-hoc" : "app-store";
    writeFileSync(plistPath, exportOptionsPlist(signing, exportMethod));

    const buildRun = await runWithProgress(
      "fastlane",
      [
        "gym",
        "--workspace",
        workspace,
        "--scheme",
        scheme,
        "--output_directory",
        outputDir,
        "--output_name",
        `${ctx.app.name}.ipa`,
        "--export_options",
        plistPath,
        "--codesigning_identity",
        signing.certName,
        // Manual signing with the resolved team/profile, plus the shared headless tuning (index store + jobs).
        "--xcargs",
        buildXcargs(signing, jobs),
        // Clean only when the fingerprint changed or `--clean` was passed; otherwise reuse warm DerivedData.
        ...(decision.clean ? ["--clean"] : []),
      ],
      // gym env = Launch's resolved env (EXPO_PUBLIC_* for the bundle) + ccache tuning + the ASC API
      // key (so gym's signing/upload helpers reach Apple without a 2FA prompt). See {@link gymEnv}.
      {
        label: `Building iOS · ${ctx.app.name}`,
        parseStep: xcodeProgressStep,
        ...(estimate ? { estimate } : {}),
        cwd: ctx.app.dir,
        env: gymEnv(ctx.env, ccacheVars, creds.ascKey),
      },
    );

    const ipa = readdirSync(outputDir).find((entry) => entry.endsWith(".ipa"));
    if (!ipa) throw new Error(`gym finished but produced no .ipa in ${outputDir}.`);
    const artifactPath = join(outputDir, ipa);
    const ipaBytes = statSync(artifactPath).size;
    assertDeviceArtifact(artifactPath, ipaBytes);

    // Record the fingerprint so the next build can validate (or invalidate) these now-warm caches, plus
    // this build's duration/step-count folded into the kind's EMA so the next build's ETA learns. In
    // stream mode steps come back 0 (output unparsed), so carry the prior step total forward.
    const prior = stored?.estimates?.[kind];
    const sample = { ms: buildRun.elapsedMs, steps: buildRun.steps > 0 ? buildRun.steps : (prior?.steps ?? 0) };
    writeBuildState(ctx.app.name, "ios", {
      fingerprint,
      builtAt: new Date().toISOString(),
      cleanBuilt: decision.clean,
      estimates: { ...(stored?.estimates ?? {}), [kind]: updateEstimate(prior, sample) },
    });

    const reportPath = join(outputDir, "App Thinning Size Report.txt");
    const entries = existsSync(reportPath) ? parseThinningReport(readFileSync(reportPath, "utf8")) : [];
    return { artifactPath, sizeReport: { artifactBytes: ipaBytes, entries }, cleanBuilt: decision.clean };
  },
};

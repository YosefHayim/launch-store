/**
 * The EAS handoff pipeline — build (and submit) for no-Mac, no-AWS developers via Expo's cloud.
 *
 * Selected by `buildEngine: "eas"` (or the wizard's "Expo EAS" branch). It reuses the shared front
 * half from `core/pipeline.ts` (app selection, `.env` validation, size gate, local artifact storage)
 * and delegates everything macOS to the contained EAS adapter (`providers/build/eas.ts`). No Apple
 * credentials are resolved locally — Expo manages them — which is the whole point of this path.
 */

import type { BuildArtifact } from "./types.js";
import { type BuildRunOptions, type PreparedBuild, reportSizeAndGate } from "./pipeline.js";
import { getStorageProvider } from "./registry.js";
import { detectEasCli, easBuildToIpa, easSubmit, ensureExpoSession } from "../providers/build/eas.js";

/** Build via EAS, store the downloaded `.ipa`, and optionally submit through `eas submit`. */
export async function runEasBuild(prepared: PreparedBuild, options: BuildRunOptions): Promise<void> {
  const { config, app, profile, ctx, log } = prepared;

  if (options.dryRun) {
    log.step("eas", "would run `eas build --platform ios --profile <p> --json --wait`");
    if (options.submit) {
      log.step(
        "submit",
        `would run \`eas submit --platform ios\` → ${options.target === "testflight" ? "TestFlight" : "App Store review"}`,
        "testflight",
      );
    }
    log.gap();
    log.info(`Done. ${app.name} ${app.version ?? "0.0.0"} · dry-run (EAS handoff), nothing changed`);
    return;
  }

  log.step("eas-cli", await detectEasCli(), "eas-handoff");
  log.step("expo session", await ensureExpoSession());

  log.info("Building in Expo's cloud (eas build)…");
  const { ipaPath, sizeReport, buildNumber } = await easBuildToIpa(ctx, profile.name);
  log.step("build", ipaPath);

  await reportSizeAndGate(sizeReport, profile.sizeBudgetMB ?? 200, log);

  const artifact: BuildArtifact = {
    path: ipaPath,
    platform: "ios",
    appName: app.name,
    profile: profile.name,
    version: app.version ?? "0.0.0",
    buildNumber,
    sizeReport,
    createdAt: new Date().toISOString(),
  };
  const stored = await getStorageProvider(config.storage).put(artifact);
  log.step("store", stored.location);

  if (options.submit) {
    log.info("Submitting via eas submit…");
    await easSubmit(ctx, ipaPath, profile.name);
    log.step(
      "submit",
      options.target === "testflight" ? "submitted to TestFlight via EAS" : "submitted for App Store review via EAS",
      "testflight",
    );
  }

  log.gap();
  log.info(`Done. ${app.name} ${app.version ?? "0.0.0"} (${buildNumber}) via EAS`);
}

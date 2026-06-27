/**
 * The EAS handoff pipeline — build (and submit) for no-Mac, no-AWS developers via Expo's cloud.
 *
 * Selected by `buildEngine: "eas"` (or the wizard's "Expo EAS" branch). It reuses the shared front
 * half from `core/pipeline.ts` (app selection, `.env` validation, size gate, local artifact storage)
 * and delegates everything macOS to the contained EAS adapter (`providers/build/eas.ts`). No Apple
 * credentials are resolved locally — Expo manages them — which is the whole point of this path.
 */

import type { BuildArtifact } from './types.js';
import { type BuildTransport, confirmUpload, reportSize, renderReceipt } from './pipeline.js';
import { resolveStorageProvider } from './storage.js';
import {
  detectEasCli,
  easBuildToIpa,
  easSubmit,
  ensureExpoSession,
} from '../providers/build/eas.js';

/** Build via EAS, store the downloaded `.ipa`, and optionally submit through `eas submit`. */
export const runEasBuild: BuildTransport = async (prepared, options) => {
  const { config, app, profile, ctx, log } = prepared;

  if (options.dryRun) {
    log.step('eas', 'would run `eas build --platform ios --profile <p> --json --wait`');
    if (options.submit) {
      log.step(
        'submit',
        `would run \`eas submit --platform ios\` → ${options.target === 'testing' ? 'TestFlight' : 'App Store review'}`,
        'testflight',
      );
    }
    log.gap();
    log.info(
      `Done. ${app.name} ${app.version ?? '0.0.0'} · dry-run (EAS handoff), nothing changed`,
    );
    return;
  }

  log.step('eas-cli', await detectEasCli(), 'eas-handoff');
  log.step('expo session', await ensureExpoSession());

  log.info("Building in Expo's cloud (eas build)…");
  const { ipaPath, sizeReport, buildNumber } = await easBuildToIpa(ctx, profile.name);
  log.step('build', ipaPath);

  reportSize(sizeReport, log);

  const artifact: BuildArtifact = {
    path: ipaPath,
    platform: 'ios',
    appName: app.name,
    profile: profile.name,
    version: app.version ?? '0.0.0',
    buildNumber,
    sizeReport,
    // EAS always clean-builds in Expo's cloud, so its artifacts are reproducible — no release nudge.
    clean: true,
    createdAt: new Date().toISOString(),
  };
  const stored = await resolveStorageProvider(config).put(artifact);
  log.step('store', stored.location);

  if (options.submit) {
    await confirmUpload({
      report: sizeReport,
      budgetMB: profile.sizeBudgetMB ?? 200,
      destination:
        options.target === 'testing' ? 'TestFlight (via EAS)' : 'App Store review (via EAS)',
      app,
      version: app.version ?? '0.0.0',
      buildNumber,
      yes: options.yes ?? false,
      log,
    });
    log.info('Submitting via eas submit…');
    await easSubmit(ctx, ipaPath, profile.name);
    log.step(
      'submit',
      options.target === 'testing'
        ? 'submitted to TestFlight via EAS'
        : 'submitted for App Store review via EAS',
      'testflight',
    );
  }

  await renderReceipt({
    app,
    version: app.version ?? '0.0.0',
    buildNumber,
    report: sizeReport,
    destination: options.submit
      ? options.target === 'testing'
        ? 'TestFlight · via EAS'
        : 'App Store · in review (via EAS)'
      : 'built · not uploaded',
    log,
  });
};

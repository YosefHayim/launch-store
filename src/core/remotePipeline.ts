/**
 * The remote-Mac build pipeline — the host lifecycle (C1–C7) wrapped around the SAME build spine.
 *
 * Selected by `--remote` (or the wizard on a non-Mac). It reuses the shared front half from
 * `core/pipeline.ts` (app selection, `.env` validation, build-number bump, size readout, the
 * end-of-run receipt) and the host-agnostic build operations from `core/remoteBuild.ts`, adding only
 * what's specific to building off-Mac: acquire/reuse a {@link ComputeHost}, upload a transient copy of
 * the signing material, run gym + submit on the host, pull the `.ipa` home, shred the host, and keep
 * it alive for the paid window.
 *
 * `--dry-run` rehearses C1–C7 with NO AWS calls, NO SSH, and NO account changes — the same guarantee
 * the local dry-run gives — so it's safe to preview on a machine with no AWS access.
 */

import type {
  AccountRecord,
  AllocateRequest,
  AscKey,
  BuildArtifact,
  ComputeHost,
  HostHandle,
  LaunchConfig,
  RemoteTarget,
  SizeReport,
} from "./types.js";
import {
  type BuildRunOptions,
  DRY_RUN_KEY,
  type PreparedBuild,
  interactiveConfirm,
  nextBuildNumber,
  receiptDestination,
  renderReceipt,
  reportProcessing,
  reportSize,
  resolveAscBuildLink,
  resolveIosAccount,
} from "./pipeline.js";
import { loadAscKeyById, refreshIdentityIfStale } from "./accounts.js";
import { withSpinner } from "./progress.js";
import { getComputeHost, getStorageProvider } from "./registry.js";
import { type Logger } from "./logger.js";
import { ARTIFACTS_DIR } from "./paths.js";
import { autoReleaseAt, costBanner } from "./cost.js";
import { clearLiveHost, getLiveHost, setLiveHost } from "./cloudState.js";
import { ensureRemoteSigningAssets } from "../apple/credentials.js";
import {
  type RemoteBuildInputs,
  openRemoteSession,
  pullArtifact,
  runBuildOnHost,
  runDoctorOnHost,
  shredHost,
  syncProject,
  uploadSigningMaterial,
} from "./remoteBuild.js";

/** Resolve the compute host backend for a remote target. */
function hostFor(remote: RemoteTarget): ComputeHost {
  return getComputeHost(remote.kind === "aws" ? "aws-ec2-mac" : "byo-ssh");
}

/** Reuse the live paid-window host (if one of this provider is still up) or allocate a fresh one. */
async function acquireHost(
  host: ComputeHost,
  remote: RemoteTarget,
  config: LaunchConfig,
  log: Logger,
): Promise<HostHandle> {
  const live = getLiveHost();
  if (live?.provider === host.name) {
    const status = await host.status(live);
    if (status) {
      log.step("acquire host", `reusing live host — ${costBanner(live)}`);
      return live;
    }
    clearLiveHost(); // recorded host is gone; allocate a new one
  }

  if (remote.kind === "aws" && !config.aws) {
    throw new Error(
      "AWS remote builds need an `aws: { region: ... }` block in launch.config.ts. Run `launch cloud setup`.",
    );
  }
  const request: AllocateRequest = {
    confirm: interactiveConfirm,
    onProgress: (message) => {
      log.info(message);
    },
    ...(remote.kind === "aws" ? (config.aws ? { aws: config.aws } : {}) : { sshTarget: remote.target }),
  };
  const handle = await host.allocate(request);
  setLiveHost(handle);
  log.step(
    "acquire host",
    host.name === "aws-ec2-mac" ? `allocated ${handle.instanceId ?? "instance"}` : "connected",
    "ec2-mac",
  );
  return handle;
}

/** Rehearse the remote flow without touching AWS, SSH, or the account (mirrors the local dry-run). */
function rehearse(prepared: PreparedBuild, options: BuildRunOptions, buildNumber: number): void {
  const { app, log } = prepared;
  log.step("acquire host", "would reuse the live paid-window host, or allocate one (typed cost consent first)");
  log.step("sync", "would sync the project into the host's persistent work tree (warm node_modules/ios/Pods)");
  log.step("upload creds", "would upload .p8/.p12/profile into a per-run ephemeral keychain on the host");
  log.step(
    "build",
    "would run fastlane gym on the host (incremental unless native deps changed or --clean)",
    undefined,
  );
  if (options.submit) {
    log.step(
      "submit",
      `would upload to ${options.target === "testing" ? "TestFlight" : "App Store review"} from the host`,
      "testflight",
    );
  }
  log.step("pull", "would pull the .ipa home to ~/.launch/artifacts");
  log.step("shred", "would shred the secrets (keychain + creds), keeping the warm work tree for next time");
  log.step("host", "would keep the host for the paid window; auto-release scheduled near 23.5h");
  log.gap();
  log.info(`Done. ${app.name} ${app.version ?? "0.0.0"} (${buildNumber}) · dry-run, nothing changed`);
}

/**
 * Build (and optionally submit) on a remote Mac. Reuses {@link PreparedBuild} from the front half.
 * Shred always runs (success or failure); the AWS host is kept alive for the already-paid window.
 */
export async function runRemoteBuild(prepared: PreparedBuild, options: BuildRunOptions): Promise<void> {
  const { config, app, profile, env, log } = prepared;
  const remote = options.remote;
  if (!remote) throw new Error("runRemoteBuild called without a remote target.");
  const bundleId = app.bundleId;
  if (!bundleId) throw new Error(`No iOS bundle identifier for ${app.name}. Set ios.bundleIdentifier in app.json.`);
  const { dryRun } = options;

  // C1. Resolve the Apple account + signing material locally (cross-platform), and the build number via ASC.
  log.step("remote", remote.kind === "aws" ? "AWS EC2 Mac (your account)" : `SSH ${remote.target}`, "remote-build");
  let ascKey: AscKey = DRY_RUN_KEY;
  let account: AccountRecord | undefined;
  if (!dryRun) {
    account = await resolveIosAccount(options, log);
    const loaded = await loadAscKeyById(account.keyId);
    if (!loaded) throw new Error(`Apple account "${account.label}" has no stored key. Re-import: launch creds set-key`);
    ascKey = loaded;
  }
  log.step("credentials", dryRun ? "dry-run (no key needed)" : `key ${ascKey.keyId}`, "asc-api-key");
  const signing = await ensureRemoteSigningAssets({
    bundleId,
    appName: app.name,
    ascKey,
    log,
    dryRun,
    confirmCreate: interactiveConfirm,
  });
  const buildNumber = dryRun
    ? await nextBuildNumber(ascKey, bundleId, dryRun)
    : await withSpinner("Checking last build number on App Store Connect", () =>
        nextBuildNumber(ascKey, bundleId, dryRun),
      );
  log.step(
    "build number",
    dryRun ? `would set next build number (≈${buildNumber})` : String(buildNumber),
    "build-number",
  );

  if (dryRun) {
    rehearse(prepared, options, buildNumber);
    return;
  }

  // C2. Acquire (reuse or allocate) the host.
  const host = hostFor(remote);
  const handle = await acquireHost(host, remote, config, log);
  log.info(costBanner(handle));

  const inputs: RemoteBuildInputs = {
    appName: app.name,
    bundleId,
    signing,
    ascKey,
    buildNumber,
    submit: options.submit,
    submitTarget: options.target,
    forceClean: options.forceClean ?? false,
    env,
  };

  const session = await openRemoteSession(handle.ssh, app.name);
  let sizeReport: SizeReport | null = null;
  try {
    // C4 + spine. Sync source into the persistent tree, upload transient creds, build (+submit) on the host.
    log.info("Syncing the project to the host…");
    await syncProject(session, app.dir);
    log.step("sync", "project synced to the host's warm work tree");
    // The remote twin of `launch doctor`: install gaps on our AWS host, assert (never mutate) a BYO host.
    log.info("Checking the host toolchain…");
    await runDoctorOnHost(session, remote.kind === "aws" ? "install" : "assert");
    log.step("doctor", remote.kind === "aws" ? "host toolchain verified (gaps installed)" : "host toolchain verified");
    await uploadSigningMaterial(session, inputs);
    log.step("upload creds", "uploaded into an ephemeral keychain on the host");
    log.info("Building on the host (archive + sign + export; this can take a while)…");
    const { cleanBuilt } = await runBuildOnHost(session, inputs);
    log.step(
      "build",
      `${cleanBuilt ? "clean (from scratch)" : "incremental (cache warm)"} · ${options.submit ? "built and submitted" : "built"} on the host`,
      "incremental-build",
    );

    // C5. Pull the artifact home and store it for `launch release`. The upload already happened on the
    // host (bundled with the build), so this is a display-only size readout, not a pre-upload gate.
    const pulled = await pullArtifact(session, app.name, ARTIFACTS_DIR);
    sizeReport = pulled.sizeReport;
    reportSize(pulled.sizeReport, log);
    const artifact: BuildArtifact = {
      path: pulled.ipaPath,
      platform: "ios",
      appName: app.name,
      profile: profile.name,
      version: app.version ?? "0.0.0",
      buildNumber,
      sizeReport: pulled.sizeReport,
      // The host decides clean-vs-incremental from its own warm tree and reports it back.
      clean: cleanBuilt,
      createdAt: new Date().toISOString(),
    };
    const stored = await getStorageProvider(config.storage).put(artifact);
    log.step("store", stored.location);
    if (options.submit && options.target === "testing") {
      log.step("submit", "uploaded to TestFlight from the host", "testflight");
    }
  } finally {
    // C6. Shred the host session on every exit path (success or build failure).
    try {
      await shredHost(session);
      log.step("shred", "secrets shredded (keychain + creds); warm work tree kept for the next build");
    } catch {
      log.warn("Could not fully shred the host session — check the host manually.");
    }
  }

  // C7. Surface Apple-side processing for a TestFlight upload (the build uploaded from the host; we
  // poll ASC locally for parity with the local spine), then the host disposition, then the receipt.
  if (options.submit && options.target === "testing") {
    await reportProcessing(ascKey, bundleId, buildNumber, log);
  }

  // Keep AWS hosts alive for the already-paid window; auto-release is scheduled near 23.5h.
  if (handle.provider === "aws-ec2-mac") {
    log.info(
      `Host kept alive for the paid window (run \`launch cloud teardown\` when done; ` +
        `it auto-releases near ${new Date(autoReleaseAt(handle.allocatedAt)).toLocaleTimeString()}).`,
    );
  }

  // Backfill the account's Team ID + app names from Apple now that we have a live key in hand.
  if (account) await refreshIdentityIfStale(account, ascKey);

  // Reaching here means the try block completed, so the size report is set.
  const link = options.submit ? await resolveAscBuildLink(ascKey, bundleId, options.target) : undefined;
  renderReceipt({
    app,
    version: app.version ?? "0.0.0",
    buildNumber,
    report: sizeReport,
    destination: receiptDestination("ios", options),
    link,
    log,
  });
}

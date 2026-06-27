/**
 * RemoteMac build operations — running the SAME fastlane spine on a Mac you reach over SSH.
 *
 * Host-agnostic on purpose: given an {@link SshTarget} from any {@link ComputeHost} (AWS EC2 Mac, or
 * a Mac you already have), these functions archive + sync the project, upload a *transient* copy of
 * the signing material into a throwaway keychain, run `fastlane gym` (+ optional submit) on the host,
 * pull the `.ipa` home, and shred everything on the host. The host lifecycle around them (allocate,
 * reuse, auto-release) lives in `core/remotePipeline.ts`; the AWS/SSH split keeps this layer reusable.
 *
 * Security (decisions 1 & 9; build-cache decision 7): the `.env` and `node_modules`/`.git` never ride
 * along in the archive; `.env` *values* are injected as build env vars instead. The uploaded
 * `.p8`/`.p12`/profile + the keychain live in a per-run EPHEMERAL dir that {@link shredHost} deletes on
 * every exit path. For build speed the app source + caches now persist in a stable per-app tree
 * (`~/.launch-remote/<app>`) between builds — source isn't secret, and secrets are still shredded every
 * run — until `launch cloud teardown` releases the host. See `docs/plan-build-cache.md` (decision 7).
 */

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AscKey, SigningAssets, SizeReport, SubmitTarget, SshTarget } from './types.js';
import type { RemoteSigningBundle } from '../apple/credentials.js';
import { ensureDir } from './paths.js';
import { rsyncUp, scpDown, scpUp, sshCapture, sshRun } from './ssh.js';
import { remoteToolchainPreflight } from './toolchain.js';
import {
  assertDeviceArtifact,
  exportOptionsPlist,
  parseThinningReport,
} from '../providers/build/fastlane.js';

/**
 * What never leaves your machine in the source archive (decision 9): dependencies and native build
 * dirs are reinstalled/regenerated on the host, history is irrelevant, and `.env` is a secret-bearing
 * file whose *values* are injected separately as build env vars.
 */
export const SOURCE_EXCLUDES = [
  'node_modules',
  '.git',
  'ios',
  'android',
  'dist',
  '.expo',
  '.launch',
  '.env',
  '.env.*',
];

/** A live remote-build session: the persistent per-app work tree plus a per-run ephemeral secrets dir. */
export interface RemoteSession {
  target: SshTarget;
  /**
   * Stable per-app work tree on the host (`~/.launch-remote/<app>`), holding `app/` (synced source +
   * warm `node_modules`/`ios`/`Pods`) and `out/` (artifacts). PERSISTS across builds for speed; not secret.
   */
  workDir: string;
  /**
   * Per-run ephemeral dir (`/tmp/launch-creds.XXXX`) holding the uploaded `.p8`/`.p12`/profile and the
   * throwaway keychain. {@link shredHost} deletes ONLY this every run — secrets never persist on the host.
   */
  credsDir: string;
  /** Random password protecting the per-run ephemeral keychain. */
  keychainPassword: string;
}

/** Everything the on-host build script needs, gathered locally first. */
export interface RemoteBuildInputs {
  appName: string;
  bundleId: string;
  signing: RemoteSigningBundle;
  ascKey: AscKey;
  buildNumber: number;
  /** Submit from the host after building (decision 10). */
  submit: boolean;
  submitTarget: SubmitTarget;
  /** Force a from-scratch build on the host (`--clean`); otherwise the host's own fingerprint decides. */
  forceClean: boolean;
  /** Client-facing build-time env vars (the profile's `.env` values), injected on the host. */
  env: Record<string, string>;
}

/** Adapt a {@link RemoteSigningBundle} to the {@link SigningAssets} shape {@link exportOptionsPlist} reads. */
function toSigningAssets(bundle: RemoteSigningBundle): SigningAssets {
  return {
    bundleId: bundle.bundleId,
    teamId: bundle.teamId,
    certName: bundle.certName,
    certSerial: bundle.certSerial,
    profileName: bundle.profileName,
    profileUuid: '',
    profilePath: bundle.profilePath,
  };
}

/** Single-quote a value for the remote shell, escaping embedded single quotes the POSIX way. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Build a `KEY='val' KEY2='val2' ` prefix passed to the remote build command (no secrets in argv beyond the keychain pw). */
function remoteEnvPrefix(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(' ');
}

/**
 * Resolve the stable per-app work tree (persists across builds) and a fresh per-run ephemeral secrets
 * dir, then create both. The work tree's `$HOME` is resolved on the host so every later path is absolute.
 */
export async function openRemoteSession(
  target: SshTarget,
  appName: string,
): Promise<RemoteSession> {
  const home = await sshCapture(target, 'echo $HOME');
  const workDir = `${home}/.launch-remote/${appName}`;
  const credsDir = await sshCapture(target, 'mktemp -d /tmp/launch-creds.XXXXXXXX');
  await sshRun(
    target,
    `mkdir -p ${shellQuote(`${workDir}/app`)} ${shellQuote(`${workDir}/out`)} ${shellQuote(credsDir)}`,
  );
  return { target, workDir, credsDir, keychainPassword: randomBytes(18).toString('hex') };
}

/**
 * Mirror the project to the host's persistent `app/` tree, honoring {@link SOURCE_EXCLUDES}. Because
 * `node_modules`/`ios`/`android` are excluded, rsync's `--delete` PROTECTS the host's warm copies of them
 * from removal — so source stays in exact sync while the expensive build caches survive between runs.
 */
export async function syncProject(session: RemoteSession, appDir: string): Promise<void> {
  await rsyncUp(session.target, appDir, `${session.workDir}/app`, SOURCE_EXCLUDES);
}

/** Upload the transient `.p8`/`.p12`/profile + the export-options plist into the per-run ephemeral creds dir (chmod 600). */
export async function uploadSigningMaterial(
  session: RemoteSession,
  inputs: RemoteBuildInputs,
): Promise<void> {
  const credsDir = session.credsDir;
  const staging = mkdtempSync(join(tmpdir(), 'launch-remote-'));
  const p8Local = join(staging, 'asc.p8');
  const plistLocal = join(staging, 'ExportOptions.plist');
  writeFileSync(p8Local, inputs.ascKey.p8);
  writeFileSync(plistLocal, exportOptionsPlist(toSigningAssets(inputs.signing)));
  try {
    await scpUp(session.target, inputs.signing.p12Path, `${credsDir}/dist.p12`);
    await scpUp(session.target, inputs.signing.profilePath, `${credsDir}/profile.mobileprovision`);
    await scpUp(session.target, p8Local, `${credsDir}/asc.p8`);
    await scpUp(session.target, plistLocal, `${credsDir}/ExportOptions.plist`);
    await sshRun(
      session.target,
      `chmod 600 ${shellQuote(`${credsDir}/dist.p12`)} ${shellQuote(`${credsDir}/asc.p8`)}`,
    );
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Run the toolchain doctor ON the remote Mac before building — the remote twin of `launch doctor`.
 * Uploads {@link remoteToolchainPreflight} and executes it: `"install"` for an AWS host we own (brew-
 * installs any gaps) or `"assert"` for a BYO-SSH host (checks + fails with hints, never mutates the
 * user's machine). A missing required tool exits the preflight non-zero, so `sshRun` rejects and the
 * build fails fast with the gaps listed instead of a cryptic error deep inside fastlane.
 */
export async function runDoctorOnHost(
  session: RemoteSession,
  mode: 'install' | 'assert',
): Promise<void> {
  const staging = mkdtempSync(join(tmpdir(), 'launch-remote-'));
  const scriptLocal = join(staging, 'doctor.sh');
  writeFileSync(scriptLocal, remoteToolchainPreflight(mode));
  const scriptRemote = `${session.credsDir}/doctor.sh`;
  try {
    await scpUp(session.target, scriptLocal, scriptRemote);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  await sshRun(session.target, `bash ${shellQuote(scriptRemote)}`);
}

/**
 * Upload the build script and run it on the host (ephemeral keychain → incremental deps/prebuild →
 * host-gated pod install + gym → optional submit). The clean-vs-incremental and ccache flags ride in as
 * env (`FORCE_CLEAN`, `USE_CCACHE`); the host owns its own staleness check, so this returns whether it
 * actually clean-built (read from a marker the script writes) for the pipeline to stamp on the artifact.
 */
export async function runBuildOnHost(
  session: RemoteSession,
  inputs: RemoteBuildInputs,
): Promise<{ cleanBuilt: boolean }> {
  const staging = mkdtempSync(join(tmpdir(), 'launch-remote-'));
  const scriptLocal = join(staging, 'build.sh');
  writeFileSync(scriptLocal, REMOTE_BUILD_SCRIPT);
  const scriptRemote = `${session.credsDir}/build.sh`;
  try {
    await scpUp(session.target, scriptLocal, scriptRemote);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  const env: Record<string, string> = {
    ...inputs.env,
    APP_NAME: inputs.appName,
    BUNDLE_ID: inputs.bundleId,
    TEAM_ID: inputs.signing.teamId,
    CERT_NAME: inputs.signing.certName,
    PROFILE_NAME: inputs.signing.profileName,
    BUILD_NUMBER: String(inputs.buildNumber),
    KEYCHAIN_PASSWORD: session.keychainPassword,
    P12_PASSWORD: inputs.signing.p12Password,
    ASC_KEY_ID: inputs.ascKey.keyId,
    ASC_ISSUER_ID: inputs.ascKey.issuerId,
    SUBMIT: inputs.submit ? '1' : '0',
    SUBMIT_TARGET: inputs.submitTarget,
    FORCE_CLEAN: inputs.forceClean ? '1' : '0',
    USE_CCACHE: '1',
  };
  const command = `${remoteEnvPrefix(env)} bash ${shellQuote(scriptRemote)} ${shellQuote(session.workDir)} ${shellQuote(session.credsDir)}`;
  await sshRun(session.target, command);
  const marker = await sshCapture(
    session.target,
    `cat ${shellQuote(`${session.workDir}/.launch-clean`)} 2>/dev/null || echo 0`,
  );
  return { cleanBuilt: marker.trim() === '1' };
}

/** Pull the built `.ipa` (and the thinning report, if any) home; returns the local path + size report. */
export async function pullArtifact(
  session: RemoteSession,
  appName: string,
  destDir: string,
): Promise<{ ipaPath: string; sizeReport: SizeReport }> {
  ensureDir(destDir);
  const ipaPath = join(destDir, `${appName}.ipa`);
  await scpDown(session.target, shellQuote(`${session.workDir}/out/${appName}.ipa`), ipaPath);

  let entries: SizeReport['entries'] = [];
  try {
    const reportPath = join(destDir, 'App Thinning Size Report.txt');
    await scpDown(
      session.target,
      shellQuote(`${session.workDir}/out/App Thinning Size Report.txt`),
      reportPath,
    );
    entries = parseThinningReport(readFileSync(reportPath, 'utf8'));
  } catch {
    /* no thinning report produced — degrade to ipa size only */
  }
  const artifactBytes = statSync(ipaPath).size;
  // The authoritative device-archive guard, shared with the local build: reject a simulator/.app/empty
  // artifact with the same actionable error rather than storing or submitting a dead one (issue #6).
  // Remote builds are iOS-only (the host bootstrap is iOS-shaped), so the platform is always iOS here.
  assertDeviceArtifact(ipaPath, artifactBytes, 'ios');
  return { ipaPath, sizeReport: { artifactBytes, entries } };
}

/**
 * Shred ONLY the secrets: delete the ephemeral keychain and the per-run creds dir (which holds the
 * `.p8`/`.p12`/profile + the uploaded script). The persistent work tree (source + caches) is left intact
 * for the next build's warmth — it isn't secret. Best-effort; runs on every exit path. `launch cloud
 * teardown` (releasing the host) is what ultimately removes the work tree.
 */
export async function shredHost(session: RemoteSession): Promise<void> {
  const keychain = `${session.credsDir}/launch.keychain-db`;
  await sshRun(
    session.target,
    `security delete-keychain ${shellQuote(keychain)} 2>/dev/null || true; rm -rf ${shellQuote(session.credsDir)}`,
  );
}

/**
 * The bash script Launch uploads and runs on the remote Mac — the on-host mirror of the local fastlane
 * spine, now stateful for speed. `$1` is the PERSISTENT per-app work tree (source + warm
 * `node_modules`/`ios`/`Pods` survive between builds); `$2` is the per-run EPHEMERAL creds dir (cert,
 * profile, keychain — shredded every run). It installs deps incrementally, keeps the committed/generated
 * `ios/`, and owns its own staleness check: it re-pods + clean-builds only when `Podfile.lock`/Xcode
 * changed (or `FORCE_CLEAN=1`), otherwise reusing the warm DerivedData/ccache for a fast incremental
 * build. ccache wires in via `USE_CCACHE` when the host has it. The clean decision is written to
 * `$WORK/.launch-clean` for the orchestrator to stamp on the artifact. Inputs arrive as env vars.
 */
const REMOTE_BUILD_SCRIPT = String.raw`#!/usr/bin/env bash
set -euo pipefail

WORK="$1"
CREDS="$2"
APP="$WORK/app"
OUT="$WORK/out"
KEYCHAIN="$CREDS/launch.keychain-db"
mkdir -p "$OUT"

# ccache only if the host actually has the binary; otherwise drop the wiring so the build still runs uncached.
if ! command -v ccache >/dev/null 2>&1; then unset USE_CCACHE; fi

# 1. Ephemeral, per-run keychain holding only the uploaded distribution cert (lives under $CREDS → shredded).
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security list-keychains -d user -s "$KEYCHAIN" $(security list-keychains -d user | sed 's/"//g')
security import "$CREDS/dist.p12" -k "$KEYCHAIN" -P "$P12_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security -f pkcs12
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null

# 2. Install the provisioning profile where Xcode looks (keyed by its UUID).
PROFILES_DIR="$HOME/Library/MobileDevice/Provisioning Profiles"
mkdir -p "$PROFILES_DIR"
UUID="$(security cms -D -i "$CREDS/profile.mobileprovision" | plutil -extract UUID raw -)"
cp "$CREDS/profile.mobileprovision" "$PROFILES_DIR/$UUID.mobileprovision"

# 3. Incremental dependency install + native project — node_modules/ios persist in the work tree.
cd "$APP"
if [ -f yarn.lock ]; then yarn install
elif [ -f pnpm-lock.yaml ]; then corepack pnpm install
else npm install
fi
if [ ! -d ios ]; then npx expo prebuild --platform ios --clean; fi

WORKSPACE="$(ls -d ios/*.xcworkspace | head -1)"
SCHEME="$(basename "$WORKSPACE" .xcworkspace)"

# 4. Host-owned staleness check: re-pod + clean only when the native graph changed (or forced / first build).
FP_FILE="$WORK/.launch-podfile.sha"
NEW_FP="$( { shasum -a 256 ios/Podfile.lock 2>/dev/null || true; xcodebuild -version 2>/dev/null || true; } | shasum -a 256 | awk '{print $1}')"
OLD_FP="$(cat "$FP_FILE" 2>/dev/null || true)"
NATIVE_CHANGED=0
if [ "$NEW_FP" != "$OLD_FP" ] || [ ! -d ios/Pods ]; then NATIVE_CHANGED=1; fi
CLEAN=0
if [ "$FORCE_CLEAN" = "1" ] || [ "$NATIVE_CHANGED" = "1" ]; then CLEAN=1; fi
if [ "$NATIVE_CHANGED" = "1" ]; then ( cd ios && pod install ); fi

# 5. Stamp the bumped build number into the generated Info.plist.
PLIST="$(ls ios/*/Info.plist | head -1)"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "$PLIST" || true

# 6. Archive + export a signed .ipa; clean only when stale/forced, reusing warm DerivedData otherwise.
CLEAN_FLAG=""
if [ "$CLEAN" = "1" ]; then CLEAN_FLAG="--clean"; fi
fastlane gym \
  --workspace "$WORKSPACE" \
  --scheme "$SCHEME" \
  --output_directory "$OUT" \
  --output_name "$APP_NAME.ipa" \
  --export_options "$CREDS/ExportOptions.plist" \
  --codesigning_identity "$CERT_NAME" \
  --xcargs "OTHER_CODE_SIGN_FLAGS=--keychain=$KEYCHAIN DEVELOPMENT_TEAM=$TEAM_ID CODE_SIGN_STYLE=Manual PROVISIONING_PROFILE_SPECIFIER=$PROFILE_NAME COMPILER_INDEX_STORE_ENABLE=NO" \
  $CLEAN_FLAG

# Record the fingerprint (next run) + the clean decision (the orchestrator stamps BuildArtifact.clean).
printf '%s' "$NEW_FP" > "$FP_FILE"
printf '%s' "$CLEAN" > "$WORK/.launch-clean"

# Fail fast on the host if gym produced no non-empty .ipa, so we don't waste a transfer on a dead
# export — the authoritative device-archive guard runs locally after pull.
IPA="$(ls "$OUT"/*.ipa 2>/dev/null | head -1)"
if [ -z "$IPA" ] || [ ! -s "$IPA" ]; then
  echo "LAUNCH_NO_ARTIFACT: gym produced no non-empty .ipa in $OUT" >&2
  exit 1
fi
echo "LAUNCH_IPA=$IPA"

# 7. Submit from the host (decision 10), using the same API key, then remove the temp key json.
if [ "$SUBMIT" = "1" ]; then
  KEYJSON="$CREDS/asc_key.json"
  P8_ESCAPED="$(python3 -c 'import json,sys; print(json.dumps(open(sys.argv[1]).read()))' "$CREDS/asc.p8")"
  printf '{"key_id":"%s","issuer_id":"%s","key":%s,"in_house":false}' "$ASC_KEY_ID" "$ASC_ISSUER_ID" "$P8_ESCAPED" > "$KEYJSON"
  if [ "$SUBMIT_TARGET" = "production" ]; then
    fastlane deliver --ipa "$IPA" --api_key_path "$KEYJSON" --submit_for_review true --force true
  else
    fastlane pilot upload --ipa "$IPA" --api_key_path "$KEYJSON" --skip_waiting_for_build_processing true
  fi
  rm -f "$KEYJSON"
fi
`;

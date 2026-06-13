/**
 * RemoteMac build operations — running the SAME fastlane spine on a Mac you reach over SSH.
 *
 * Host-agnostic on purpose: given an {@link SshTarget} from any {@link ComputeHost} (AWS EC2 Mac, or
 * a Mac you already have), these functions archive + sync the project, upload a *transient* copy of
 * the signing material into a throwaway keychain, run `fastlane gym` (+ optional submit) on the host,
 * pull the `.ipa` home, and shred everything on the host. The host lifecycle around them (allocate,
 * reuse, auto-release) lives in `core/remotePipeline.ts`; the AWS/SSH split keeps this layer reusable.
 *
 * Security (decisions 1 & 9): the `.env` and `node_modules`/`.git` never ride along in the archive;
 * `.env` *values* are injected as build env vars instead. The uploaded `.p8`/`.p12`/profile live only
 * in a per-session temp dir + ephemeral keychain that {@link shredHost} deletes on every exit path.
 */

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { AscKey, SigningAssets, SizeReport, SubmitTarget, SshTarget } from "./types.js";
import type { RemoteSigningBundle } from "../apple/credentials.js";
import { ensureDir } from "./paths.js";
import { rsyncUp, scpDown, scpUp, sshCapture, sshRun } from "./ssh.js";
import { exportOptionsPlist, parseThinningReport } from "../providers/build/fastlane.js";

/**
 * What never leaves your machine in the source archive (decision 9): dependencies and native build
 * dirs are reinstalled/regenerated on the host, history is irrelevant, and `.env` is a secret-bearing
 * file whose *values* are injected separately as build env vars.
 */
export const SOURCE_EXCLUDES = ["node_modules", ".git", "ios", "android", "dist", ".expo", ".launch", ".env", ".env.*"];

/** A live remote-build session: where work + the ephemeral keychain live on the host. */
export interface RemoteSession {
  target: SshTarget;
  /** Per-session temp dir on the host (`/tmp/launch.XXXX`); everything under it is shredded on teardown. */
  workDir: string;
  /** Random password protecting the per-session ephemeral keychain. */
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
    profileUuid: "",
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
    .join(" ");
}

/** Create the per-session work tree on the host and a random keychain password. */
export async function openRemoteSession(target: SshTarget): Promise<RemoteSession> {
  const workDir = await sshCapture(target, "mktemp -d /tmp/launch.XXXXXXXX");
  await sshRun(
    target,
    `mkdir -p ${shellQuote(`${workDir}/app`)} ${shellQuote(`${workDir}/creds`)} ${shellQuote(`${workDir}/out`)}`,
  );
  return { target, workDir, keychainPassword: randomBytes(18).toString("hex") };
}

/** Mirror the project to the host, honoring {@link SOURCE_EXCLUDES}. */
export async function syncProject(session: RemoteSession, appDir: string): Promise<void> {
  await rsyncUp(session.target, appDir, `${session.workDir}/app`, SOURCE_EXCLUDES);
}

/** Upload the transient `.p8`/`.p12`/profile + the export-options plist into the session's creds dir (chmod 600). */
export async function uploadSigningMaterial(session: RemoteSession, inputs: RemoteBuildInputs): Promise<void> {
  const credsDir = `${session.workDir}/creds`;
  const staging = mkdtempSync(join(tmpdir(), "launch-remote-"));
  const p8Local = join(staging, "asc.p8");
  const plistLocal = join(staging, "ExportOptions.plist");
  writeFileSync(p8Local, inputs.ascKey.p8);
  writeFileSync(plistLocal, exportOptionsPlist(toSigningAssets(inputs.signing)));
  try {
    await scpUp(session.target, inputs.signing.p12Path, `${credsDir}/dist.p12`);
    await scpUp(session.target, inputs.signing.profilePath, `${credsDir}/profile.mobileprovision`);
    await scpUp(session.target, p8Local, `${credsDir}/asc.p8`);
    await scpUp(session.target, plistLocal, `${credsDir}/ExportOptions.plist`);
    await sshRun(session.target, `chmod 600 ${shellQuote(`${credsDir}/dist.p12`)} ${shellQuote(`${credsDir}/asc.p8`)}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Upload the build script and run it on the host (ephemeral keychain → prebuild → gym → optional submit). */
export async function runBuildOnHost(session: RemoteSession, inputs: RemoteBuildInputs): Promise<void> {
  const staging = mkdtempSync(join(tmpdir(), "launch-remote-"));
  const scriptLocal = join(staging, "build.sh");
  writeFileSync(scriptLocal, REMOTE_BUILD_SCRIPT);
  try {
    await scpUp(session.target, scriptLocal, `${session.workDir}/build.sh`);
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
    SUBMIT: inputs.submit ? "1" : "0",
    SUBMIT_TARGET: inputs.submitTarget,
  };
  const command = `${remoteEnvPrefix(env)} bash ${shellQuote(`${session.workDir}/build.sh`)} ${shellQuote(session.workDir)}`;
  await sshRun(session.target, command);
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

  let entries: SizeReport["entries"] = [];
  try {
    const reportPath = join(destDir, "App Thinning Size Report.txt");
    await scpDown(session.target, shellQuote(`${session.workDir}/out/App Thinning Size Report.txt`), reportPath);
    entries = parseThinningReport(readFileSync(reportPath, "utf8"));
  } catch {
    /* no thinning report produced — degrade to ipa size only */
  }
  return { ipaPath, sizeReport: { ipaBytes: statSync(ipaPath).size, entries } };
}

/** Delete the ephemeral keychain and the per-session work tree on the host. Best-effort, runs on every exit path. */
export async function shredHost(session: RemoteSession): Promise<void> {
  const keychain = `${session.workDir}/launch.keychain-db`;
  await sshRun(
    session.target,
    `security delete-keychain ${shellQuote(keychain)} 2>/dev/null || true; rm -rf ${shellQuote(session.workDir)}`,
  );
}

/**
 * The bash script Launch uploads and runs on the remote Mac. It is the on-host mirror of the local
 * fastlane spine: a throwaway keychain holds the uploaded cert only for this build, the profile is
 * installed where Xcode looks, dependencies are reinstalled fresh, `gym` archives + exports with the
 * same manual-signing settings as `providers/build/fastlane.ts`, and `pilot`/`deliver` uploads with
 * the same API key. Inputs arrive as env vars; files live under the `$1` work dir uploaded above.
 */
const REMOTE_BUILD_SCRIPT = String.raw`#!/usr/bin/env bash
set -euo pipefail

WORK="$1"
APP="$WORK/app"
CREDS="$WORK/creds"
OUT="$WORK/out"
KEYCHAIN="$WORK/launch.keychain-db"
mkdir -p "$OUT"

# 1. Ephemeral, per-session keychain holding only the uploaded distribution cert.
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

# 3. Fresh dependency install + native project (we never upload node_modules or ios/).
cd "$APP"
if [ -f yarn.lock ]; then yarn install --frozen-lockfile || yarn install
elif [ -f pnpm-lock.yaml ]; then corepack pnpm install --frozen-lockfile || corepack pnpm install
else npm ci || npm install
fi
if [ ! -d ios ]; then npx expo prebuild --platform ios --clean; fi

WORKSPACE="$(ls -d ios/*.xcworkspace | head -1)"
SCHEME="$(basename "$WORKSPACE" .xcworkspace)"

# 4. Stamp the bumped build number into the generated Info.plist.
PLIST="$(ls ios/*/Info.plist | head -1)"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $BUILD_NUMBER" "$PLIST" || true

# 5. Archive + export a signed .ipa with the resolved cert/profile (manual signing, app thinning).
fastlane gym \
  --workspace "$WORKSPACE" \
  --scheme "$SCHEME" \
  --output_directory "$OUT" \
  --output_name "$APP_NAME.ipa" \
  --export_options "$CREDS/ExportOptions.plist" \
  --codesigning_identity "$CERT_NAME" \
  --xcargs "OTHER_CODE_SIGN_FLAGS=--keychain=$KEYCHAIN DEVELOPMENT_TEAM=$TEAM_ID CODE_SIGN_STYLE=Manual PROVISIONING_PROFILE_SPECIFIER=$PROFILE_NAME" \
  --clean

IPA="$(ls "$OUT"/*.ipa | head -1)"
echo "LAUNCH_IPA=$IPA"

# 6. Submit from the host (decision 10), using the same API key, then remove the temp key json.
if [ "$SUBMIT" = "1" ]; then
  KEYJSON="$WORK/asc_key.json"
  P8_ESCAPED="$(python3 -c 'import json,sys; print(json.dumps(open(sys.argv[1]).read()))' "$CREDS/asc.p8")"
  printf '{"key_id":"%s","issuer_id":"%s","key":%s,"in_house":false}' "$ASC_KEY_ID" "$ASC_ISSUER_ID" "$P8_ESCAPED" > "$KEYJSON"
  if [ "$SUBMIT_TARGET" = "appstore" ]; then
    fastlane deliver --ipa "$IPA" --api_key_path "$KEYJSON" --submit_for_review true --force true
  else
    fastlane pilot upload --ipa "$IPA" --api_key_path "$KEYJSON" --skip_waiting_for_build_processing true
  fi
  rm -f "$KEYJSON"
fi
`;

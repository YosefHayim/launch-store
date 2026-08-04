import { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import type { SubmitTarget } from '../types/app.js';
import type { SizeReport } from '../types/artifacts.js';
import type { AscKey, SigningAssets } from '../types/credentials.js';
import type { SshTarget } from '../types/remote.js';
import type { RemoteSigningBundle } from '../credentials/appleSigning.js';
import { randomHexSecret } from '../credentials/randomSecret.js';
import { rsyncUp, scpDown, scpUp, sshCapture, sshRun } from '../services/ssh.js';
import { remoteToolchainPreflight } from '../config/toolchain.js';
import {
  assertDeviceArtifact,
  exportOptionsPlist,
  parseThinningReport,
} from '../services/appleArtifact.js';
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
export type RemoteSession = {
  target: SshTarget;
  workDirectory: string;
  credentialsDirectory: string;
  keychainPassword: string;
};
/** Everything the on-host build script needs, gathered locally first. */
export type RemoteBuildInputs = {
  appName: string;
  bundleId: string;
  signing: RemoteSigningBundle;
  ascKey: AscKey;
  buildNumber: number;
  submit: boolean;
  submitTarget: SubmitTarget;
  forceClean: boolean;
  ccacheEnabled: boolean;
  env: Record<string, string>;
};
/**
 * Adapt a {@link RemoteSigningBundle} to the {@link SigningAssets} shape {@link exportOptionsPlist} reads.
 *
 * `extensionProfiles` is intentionally absent: the remote path uploads and installs exactly one profile
 * (see {@link uploadSigningMaterial} and the build script's step 2), so it is single-target-only by
 * construction. The per-target archive-signing fixes (issues #262 / #301) landed on the LOCAL engine - see
 * {@link import("./buildFlags.js").buildSigningXcargs} and
 * {@link import("./appleTargets.js").writeManualSigningToProject} - which moved the app's profile out of
 * the global `gym --xcargs` and into the app target's pbxproj. The remote build script below still pins the
 * profile in its own global `--xcargs`, so it shares the Xcode 26 "does not support provisioning profiles"
 * exposure on the Pods library targets; porting the pbxproj-stamping fix onto the host (the stamper has to
 * run on the remote Mac, not just in the local CLI) is a larger, separately-verified follow-up.
 */
const toSigningAssets = (bundle: RemoteSigningBundle): SigningAssets => {
  return {
    bundleId: bundle.bundleId,
    teamId: bundle.teamId,
    certName: bundle.certName,
    certSerial: bundle.certSerial,
    profileName: bundle.profileName,
    profileUuid: '',
    profilePath: bundle.profilePath,
  };
};
/** Single-quote a value for the remote shell, escaping embedded single quotes the POSIX way. */
const shellQuote = (shellText: string): string => {
  return `'${shellText.replace(/'/g, "'\\''")}'`;
};
/** Build a `KEY='val' KEY2='val2' ` prefix passed to the remote build command (no secrets in argv beyond the keychain pw). */
const remoteEnvPrefix = (vars: Record<string, string>): string => {
  return Object.entries(vars)
    .map(([variableName, variableValue]) => `${variableName}=${shellQuote(variableValue)}`)
    .join(' ');
};
/**
 * Resolve the stable per-app work tree (persists across builds) and a fresh per-run ephemeral secrets
 * dir, then create both. The work tree's `$HOME` is resolved on the host so every later path is absolute.
 */
export const openRemoteSession = (target: SshTarget, appName: string) =>
  Effect.gen(function* () {
    const home = yield* sshCapture(target, 'echo $HOME');
    const workDirectory = `${home}/.launch-remote/${appName}`;
    const credentialsDirectory = yield* sshCapture(target, 'mktemp -d /tmp/launch-creds.XXXXXXXX');
    yield* sshRun(
      target,
      `mkdir -p ${shellQuote(`${workDirectory}/app`)} ${shellQuote(`${workDirectory}/out`)} ${shellQuote(credentialsDirectory)}`,
    );
    return {
      target,
      workDirectory,
      credentialsDirectory,
      keychainPassword: yield* randomHexSecret(18),
    };
  });
/**
 * Mirror the project to the host's persistent `app/` tree, honoring {@link SOURCE_EXCLUDES}. Because
 * `node_modules`/`ios`/`android` are excluded, rsync's `--delete` PROTECTS the host's warm copies of them
 * from removal - so source stays in exact sync while the expensive build caches survive between runs.
 */
export const syncProject = (session: RemoteSession, appDir: string) =>
  rsyncUp(session.target, appDir, `${session.workDirectory}/app`, SOURCE_EXCLUDES);
/** Upload the transient `.p8`/`.p12`/profile + the export-options plist into the per-run ephemeral creds dir (chmod 600). */
export const uploadSigningMaterial = (session: RemoteSession, inputs: RemoteBuildInputs) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const credentialsDirectory = session.credentialsDirectory;
      const staging = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'launch-remote-' });
      const p8Local = pathService.join(staging, 'asc.p8');
      const plistLocal = pathService.join(staging, 'ExportOptions.plist');
      yield* fileSystem.writeFileString(p8Local, inputs.ascKey.p8);
      yield* fileSystem.writeFileString(
        plistLocal,
        exportOptionsPlist(toSigningAssets(inputs.signing)),
      );
      yield* scpUp(session.target, inputs.signing.p12Path, `${credentialsDirectory}/dist.p12`);
      yield* scpUp(
        session.target,
        inputs.signing.profilePath,
        `${credentialsDirectory}/profile.mobileprovision`,
      );
      yield* scpUp(session.target, p8Local, `${credentialsDirectory}/asc.p8`);
      yield* scpUp(session.target, plistLocal, `${credentialsDirectory}/ExportOptions.plist`);
      yield* sshRun(
        session.target,
        `chmod 600 ${shellQuote(`${credentialsDirectory}/dist.p12`)} ${shellQuote(`${credentialsDirectory}/asc.p8`)}`,
      );
    }),
  );
/**
 * Run the toolchain doctor ON the remote Mac before building - the remote twin of `launch doctor`.
 * Uploads {@link remoteToolchainPreflight} and executes it: `"install"` for an AWS host we own (brew-
 * installs any gaps) or `"assert"` for a BYO-SSH host (checks + fails with hints, never mutates the
 * user's machine). A missing required tool exits the preflight non-zero, so `sshRun` rejects and the
 * build fails fast with the gaps listed instead of a cryptic error deep inside fastlane.
 */
export const runDoctorOnHost = (session: RemoteSession, mode: 'install' | 'assert') =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const staging = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'launch-remote-' });
      const scriptLocal = pathService.join(staging, 'doctor.sh');
      yield* fileSystem.writeFileString(scriptLocal, remoteToolchainPreflight(mode));
      const scriptRemote = `${session.credentialsDirectory}/doctor.sh`;
      yield* scpUp(session.target, scriptLocal, scriptRemote);
      yield* sshRun(session.target, `bash ${shellQuote(scriptRemote)}`);
    }),
  );
/**
 * Upload the build script and run it on the host (ephemeral keychain -> incremental deps/prebuild ->
 * host-gated pod install + gym -> optional submit). The clean-vs-incremental and ccache flags ride in as
 * env (`FORCE_CLEAN`, `USE_CCACHE`); the host owns its own staleness check, so this returns whether it
 * actually clean-built (read from a marker the script writes) for the pipeline to stamp on the artifact.
 */
export const runBuildOnHost = (session: RemoteSession, inputs: RemoteBuildInputs) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const staging = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'launch-remote-' });
      const scriptLocal = pathService.join(staging, 'build.sh');
      yield* fileSystem.writeFileString(scriptLocal, REMOTE_BUILD_SCRIPT);
      const scriptRemote = `${session.credentialsDirectory}/build.sh`;
      yield* scpUp(session.target, scriptLocal, scriptRemote);
      const environmentVariables: Record<string, string> = {
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
        SUBMIT: '0',
        SUBMIT_TARGET: inputs.submitTarget,
        FORCE_CLEAN: '0',
      };
      if (inputs.submit) environmentVariables['SUBMIT'] = '1';
      if (inputs.forceClean) environmentVariables['FORCE_CLEAN'] = '1';
      if (inputs.ccacheEnabled) environmentVariables['USE_CCACHE'] = '1';
      const command = `${remoteEnvPrefix(environmentVariables)} bash ${shellQuote(scriptRemote)} ${shellQuote(session.workDirectory)} ${shellQuote(session.credentialsDirectory)}`;
      yield* sshRun(session.target, command);
      const marker = yield* sshCapture(
        session.target,
        `cat ${shellQuote(`${session.workDirectory}/.launch-clean`)} 2>/dev/null || echo 0`,
      );
      return { cleanBuilt: marker.trim() === '1' };
    }),
  );
/** Pull the built `.ipa` (and the thinning report, if any) home; returns the local path + size report. */
export const pullArtifact = (session: RemoteSession, appName: string, destDir: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    yield* fileSystem.makeDirectory(destDir, { recursive: true });
    const ipaPath = pathService.join(destDir, `${appName}.ipa`);
    yield* scpDown(
      session.target,
      shellQuote(`${session.workDirectory}/out/${appName}.ipa`),
      ipaPath,
    );
    let entries: SizeReport['entries'] = [];
    const reportPath = pathService.join(destDir, 'App Thinning Size Report.txt');
    entries = yield* scpDown(
      session.target,
      shellQuote(`${session.workDirectory}/out/App Thinning Size Report.txt`),
      reportPath,
    ).pipe(
      Effect.flatMap(() => fileSystem.readFileString(reportPath)),
      Effect.map(parseThinningReport),
      Effect.catchAll(() => Effect.succeed([])),
    );
    const artifactBytes = Number((yield* fileSystem.stat(ipaPath)).size);
    // The authoritative device-archive guard, shared with the local build: reject a simulator/.app/empty
    // artifact with the same actionable error rather than storing or submitting a dead one (issue #6).
    // Remote builds are iOS-only (the host bootstrap is iOS-shaped), so the platform is always iOS here.
    yield* assertDeviceArtifact(ipaPath, artifactBytes, 'ios');
    return { ipaPath, sizeReport: { artifactBytes, entries } };
  });
/**
 * Shred ONLY the secrets: delete the ephemeral keychain and the per-run creds dir (which holds the
 * `.p8`/`.p12`/profile + the uploaded script). The persistent work tree (source + caches) is left intact
 * for the next build's warmth - it isn't secret. Best-effort; runs on every exit path. `launch cloud
 * teardown` (releasing the host) is what ultimately removes the work tree.
 */
export const shredHost = (session: RemoteSession) => {
  const keychain = `${session.credentialsDirectory}/launch.keychain-db`;
  return sshRun(
    session.target,
    `security delete-keychain ${shellQuote(keychain)} 2>/dev/null || true; rm -rf ${shellQuote(session.credentialsDirectory)}`,
  );
};
/**
 * The bash script Launch uploads and runs on the remote Mac - the on-host mirror of the local fastlane
 * spine, now stateful for speed. `$1` is the PERSISTENT per-app work tree (source + warm
 * `node_modules`/`ios`/`Pods` survive between builds); `$2` is the per-run EPHEMERAL creds dir (cert,
 * profile, keychain - shredded every run). It installs deps incrementally, keeps the committed/generated
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

# 1. Ephemeral, per-run keychain holding only the uploaded distribution cert (lives under $CREDS -> shredded).
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

# 3. Incremental dependency install + native project - node_modules/ios persist in the work tree.
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
# export - the authoritative device-archive guard runs locally after pull.
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

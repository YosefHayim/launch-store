import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SizeReport } from '../types/artifacts.ts';
import type { SigningAssets } from '../types/credentials.ts';
import type { SshTarget } from '../types/remote.ts';
import type { RemoteSigningBundle } from '../credentials/apple-signing-assets.ts';
import { randomHexSecret } from '../credentials/random-secret.ts';
import { rsyncUp, scpDown, scpUp, sshCapture, sshRun } from '../services/platform/ssh.ts';
import { remoteToolchainPreflight } from '../config/toolchain.ts';
import {
  assertDeviceArtifact,
  exportOptionsPlist,
  parseThinningReport,
} from '../services/provider-support/apple-artifact.ts';

/**
 * What never leaves your machine in the source archive: dependencies and native build dirs are
 * regenerated on the host, and `.env` values are injected separately.
 */
const SOURCE_EXCLUDES = [
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

/** A live remote-build session: the persistent per-app work tree plus a per-run secrets dir. */
type RemoteSession = {
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
  buildNumber: number;
  forceClean: boolean;
  prebuildAlways: boolean;
  ccacheEnabled: boolean;
  env: Record<string, string>;
};

/**
 * `extensionProfiles` is absent: the remote path uploads one profile, so it is single-target-only.
 * The local engine stamps profiles into the pbxproj; the remote script still pins one global profile.
 */
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
function shellQuote(shellText: string): string {
  return `'${shellText.replace(/'/g, "'\\''")}'`;
}

async function withRemoteStaging<Staged>(
  useStaging: (stagingDirectory: string) => Promise<Staged>,
): Promise<Staged> {
  const stagingDirectory = await mkdtemp(join(tmpdir(), 'launch-remote-'));

  try {
    const staged = await useStaging(stagingDirectory);

    return staged;
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

/** Resolve the stable work tree and a fresh secrets dir, then create both. */
export async function openRemoteSession(
  target: SshTarget,
  appName: string,
): Promise<RemoteSession> {
  const home = await sshCapture(target, 'echo $HOME');
  const workDirectory = `${home}/.launch-remote/${appName}`;
  const credentialsDirectory = await sshCapture(target, 'mktemp -d /tmp/launch-creds.XXXXXXXX');
  const appDirectory = `${workDirectory}/app`;
  const outDirectory = `${workDirectory}/out`;

  await sshRun(
    target,
    `mkdir -p ${shellQuote(appDirectory)} ${shellQuote(outDirectory)} ${shellQuote(credentialsDirectory)}`,
  );

  const keychainPassword = randomHexSecret(18);

  return { target, workDirectory, credentialsDirectory, keychainPassword };
}

/** Mirror the project into the host's persistent `app/` tree, honoring SOURCE_EXCLUDES. */
export function syncProject(session: RemoteSession, appDir: string): Promise<void> {
  return rsyncUp(session.target, appDir, `${session.workDirectory}/app`, SOURCE_EXCLUDES);
}

/** Upload the transient p12, profile, and export-options plist into the per-run creds dir. */
export async function uploadSigningMaterial(
  session: RemoteSession,
  inputs: RemoteBuildInputs,
): Promise<void> {
  await withRemoteStaging(async function stageSigning(stagingDirectory: string): Promise<void> {
    const credentialsDirectory = session.credentialsDirectory;
    const plistLocal = join(stagingDirectory, 'ExportOptions.plist');

    await writeFile(plistLocal, exportOptionsPlist(toSigningAssets(inputs.signing)));
    await scpUp(session.target, inputs.signing.p12Path, `${credentialsDirectory}/dist.p12`);
    await scpUp(
      session.target,
      inputs.signing.profilePath,
      `${credentialsDirectory}/profile.mobileprovision`,
    );
    await scpUp(session.target, plistLocal, `${credentialsDirectory}/ExportOptions.plist`);
    await sshRun(session.target, `chmod 600 ${shellQuote(`${credentialsDirectory}/dist.p12`)}`);
  });
}

/**
 * Run the toolchain doctor on the remote Mac. `install` fills gaps on an AWS host we own.
 * `assert` checks a BYO host and never mutates it.
 */
export async function runDoctorOnHost(
  session: RemoteSession,
  mode: 'install' | 'assert',
): Promise<void> {
  await withRemoteStaging(async function stageDoctor(stagingDirectory: string): Promise<void> {
    const scriptLocal = join(stagingDirectory, 'doctor.sh');

    await writeFile(scriptLocal, remoteToolchainPreflight(mode));

    const scriptRemote = `${session.credentialsDirectory}/doctor.sh`;

    await scpUp(session.target, scriptLocal, scriptRemote);
    await sshRun(session.target, `bash ${shellQuote(scriptRemote)}`);
  });
}

/** The env the host build script reads: app identity, signing, and the build switches. */
export function remoteBuildEnvironment(
  inputs: RemoteBuildInputs,
  keychainPassword: string,
): Record<string, string> {
  const environmentVariables: Record<string, string> = {
    ...inputs.env,
    APP_NAME: inputs.appName,
    BUNDLE_ID: inputs.bundleId,
    TEAM_ID: inputs.signing.teamId,
    CERT_NAME: inputs.signing.certName,
    PROFILE_NAME: inputs.signing.profileName,
    BUILD_NUMBER: String(inputs.buildNumber),
    KEYCHAIN_PASSWORD: keychainPassword,
    P12_PASSWORD: inputs.signing.p12Password,
    FORCE_CLEAN: '0',
    PREBUILD_ALWAYS: '0',
  };
  const shouldForceClean = inputs.forceClean == true;

  if (shouldForceClean) {
    environmentVariables['FORCE_CLEAN'] = '1';
  }

  const shouldAlwaysPrebuild = inputs.prebuildAlways == true;

  if (shouldAlwaysPrebuild) {
    environmentVariables['PREBUILD_ALWAYS'] = '1';
  }

  const shouldUseCcache = inputs.ccacheEnabled == true;

  if (shouldUseCcache) {
    environmentVariables['USE_CCACHE'] = '1';
  }

  return environmentVariables;
}

function isShellIdentifier(variableName: string): boolean {
  // A shell identifier: a letter or underscore, then letters, digits, or underscores.
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(variableName);
}

/**
 * Upload the build script and run it on the host. Returns whether the host actually clean-built.
 */
export async function runBuildOnHost(
  session: RemoteSession,
  inputs: RemoteBuildInputs,
): Promise<{ cleanBuilt: boolean }> {
  const cleanBuilt = await withRemoteStaging(async function stageBuild(stagingDirectory: string) {
    const scriptLocal = join(stagingDirectory, 'build.sh');

    await writeFile(scriptLocal, REMOTE_BUILD_SCRIPT);

    const scriptRemote = `${session.credentialsDirectory}/build.sh`;

    await scpUp(session.target, scriptLocal, scriptRemote);

    const environmentVariables = remoteBuildEnvironment(inputs, session.keychainPassword);
    const environmentLines: string[] = [];

    for (const [variableName, variableValue] of Object.entries(environmentVariables)) {
      const nameIsSafe = isShellIdentifier(variableName);

      if (nameIsSafe == false) {
        throw {
          _tag: 'InvalidRemoteEnvironmentName',
          message: 'Remote environment names must be shell identifiers.',
        };
      }

      environmentLines.push(`export ${variableName}=${shellQuote(variableValue)}`);
    }

    const environmentLocal = join(stagingDirectory, 'environment.sh');
    const secretFileMode = 0o600;

    await writeFile(environmentLocal, environmentLines.join('\n'), { mode: secretFileMode });

    const environmentRemote = `${session.credentialsDirectory}/environment.sh`;

    await scpUp(session.target, environmentLocal, environmentRemote);
    await sshRun(session.target, `chmod 600 ${shellQuote(environmentRemote)}`);

    const command = `. ${shellQuote(environmentRemote)}; bash ${shellQuote(scriptRemote)} ${shellQuote(session.workDirectory)} ${shellQuote(session.credentialsDirectory)}`;

    await sshRun(session.target, command);

    const marker = await sshCapture(
      session.target,
      `cat ${shellQuote(`${session.workDirectory}/.launch-clean`)} 2>/dev/null || echo 0`,
    );

    return { cleanBuilt: marker.trim() == '1' };
  });

  return cleanBuilt;
}

/** Pull the built ipa and the thinning report home. A missing report becomes an empty device list. */
export async function pullArtifact(
  session: RemoteSession,
  appName: string,
  destDir: string,
): Promise<{ ipaPath: string; sizeReport: SizeReport }> {
  await mkdir(destDir, { recursive: true });

  const ipaPath = join(destDir, `${appName}.ipa`);

  await scpDown(session.target, shellQuote(`${session.workDirectory}/out/${appName}.ipa`), ipaPath);

  let entries: SizeReport['entries'] = [];
  const reportPath = join(destDir, 'App Thinning Size Report.txt');

  try {
    await scpDown(
      session.target,
      shellQuote(`${session.workDirectory}/out/App Thinning Size Report.txt`),
      reportPath,
    );
    const reportText = await readFile(reportPath, 'utf8');

    entries = parseThinningReport(reportText);
  } catch (error) {
    const reportMissing = error != null;

    if (reportMissing) {
      entries = [];
    }
  }

  const artifactStat = await stat(ipaPath);
  const artifactBytes = Number(artifactStat.size);

  assertDeviceArtifact(ipaPath, artifactBytes, 'ios');

  return { ipaPath, sizeReport: { artifactBytes, entries } };
}

/**
 * Delete the ephemeral keychain and the per-run creds dir. The persistent work tree stays.
 */
export function shredHost(session: RemoteSession): Promise<void> {
  const keychain = `${session.credentialsDirectory}/launch.keychain-db`;

  return sshRun(
    session.target,
    `security delete-keychain ${shellQuote(keychain)} 2>/dev/null || true; rm -rf ${shellQuote(session.credentialsDirectory)}`,
  );
}

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
# prebuild: 'always' (PREBUILD_ALWAYS=1) regenerates the persisted ios/ so app.json changes always ship.
if [ "$PREBUILD_ALWAYS" = "1" ] || [ ! -d ios ]; then npx expo prebuild --platform ios --clean; fi

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
CLEAN_ACTION=""
if [ "$CLEAN" = "1" ]; then CLEAN_ACTION="clean"; fi
ARCHIVE="$OUT/$APP_NAME.xcarchive"
EXPORT_DIR="$OUT/export"
rm -rf "$ARCHIVE" "$EXPORT_DIR" "$OUT/$APP_NAME.ipa" "$OUT/App Thinning Size Report.txt"
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE" \
  "OTHER_CODE_SIGN_FLAGS=--keychain=$KEYCHAIN" \
  "DEVELOPMENT_TEAM=$TEAM_ID" \
  CODE_SIGN_STYLE=Manual \
  "CODE_SIGN_IDENTITY=$CERT_NAME" \
  "PROVISIONING_PROFILE_SPECIFIER=$PROFILE_NAME" \
  COMPILER_INDEX_STORE_ENABLE=NO \
  $CLEAN_ACTION archive
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$CREDS/ExportOptions.plist" \
  -exportPath "$EXPORT_DIR"
EXPORTED_IPA="$(ls "$EXPORT_DIR"/*.ipa 2>/dev/null | head -1)"
if [ -n "$EXPORTED_IPA" ]; then mv "$EXPORTED_IPA" "$OUT/$APP_NAME.ipa"; fi
if [ -f "$EXPORT_DIR/App Thinning Size Report.txt" ]; then mv "$EXPORT_DIR/App Thinning Size Report.txt" "$OUT/"; fi

# Record the fingerprint (next run) + the clean decision (the orchestrator stamps BuildArtifact.clean).
printf '%s' "$NEW_FP" > "$FP_FILE"
printf '%s' "$CLEAN" > "$WORK/.launch-clean"

# Fail fast on the host if the export produced no non-empty .ipa, so we don't waste a transfer on a dead
# export - the authoritative device-archive guard runs locally after pull.
IPA="$(ls "$OUT"/*.ipa 2>/dev/null | head -1)"
if [ -z "$IPA" ] || [ ! -s "$IPA" ]; then
  echo "LAUNCH_NO_ARTIFACT: xcodebuild export produced no non-empty .ipa in $OUT" >&2
  exit 1
fi
echo "LAUNCH_IPA=$IPA"
`;

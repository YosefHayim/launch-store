/**
 * `launch build:resign` — re-sign an already-built, stored artifact with different credentials, without
 * a rebuild (EAS `build:resign` parity).
 *
 * Promote a build across signing identities — a different distribution cert/profile, or another Apple
 * account during a migration — without burning the minutes a full rebuild costs. It pulls a build from
 * the local history (`builds list`), re-signs it with the resolved cached credentials, and writes the
 * result to an explicit output file. iOS: unzip the `.ipa`, swap the embedded provisioning profile,
 * extract the profile's entitlements, `codesign -f` the app bundle with the new identity, re-zip.
 * Android: re-sign the `.aab`/`.apk` with the upload keystore (`jarsigner`/`apksigner`).
 *
 * It deliberately does NOT touch the artifact index: the local store keys an entry by app-version-build,
 * so re-storing the same build would overwrite the original's bytes. The resigned file is written beside
 * the request (or to `--output`) and reported, leaving the build history intact. `--dry-run` prints the
 * exact command plan and changes nothing — the safe way to see what a resign would do.
 *
 * The signing tools themselves (`codesign`, `jarsigner`, `apksigner`) need a real identity/keystore on
 * the host, so the on-device result can't be exercised in CI; the command logic and every argument
 * vector are unit-tested, the execution is a thin, auditable shell over `core/exec.ts`.
 */

import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import type { Command } from 'commander';
import type { BuildArtifact, KeystoreAssets, Platform, SigningAssets } from '../../core/types.js';
import { isApplePlatform, platformLabel } from '../../core/platform.js';
import { loadConfig } from '../../core/config.js';
import { resolveStorageProvider } from '../../core/storage.js';
import { capture, run } from '../../core/exec.js';
import { getActiveKeyId, listAccounts } from '../../core/accounts.js';
import { loadCachedSigningAssets } from '../../apple/credentials.js';
import { loadCachedKeystore } from '../../google/credentials.js';
import { findBuild } from './builds.js';

/** Env var names the keystore passwords are passed through, so they never appear in a process's argv. */
const KS_STOREPASS_ENV = 'LAUNCH_KS_STOREPASS';
const KS_KEYPASS_ENV = 'LAUNCH_KS_KEYPASS';

/**
 * Guard `build:resign` against a platform it can't re-sign. The iOS resign flow rewrites an `.ipa`
 * (`Payload/*.app`) — iOS, tvOS, and visionOS all archive to `.ipa`, and Android `.aab`/`.apk` re-sign
 * through their own path. A macOS build is a `.pkg` installer with no `Payload`, so it has no path here
 * yet; reject it with an actionable message instead of feeding a `.pkg` to the iOS resign flow.
 */
export function assertResignablePlatform(platform: Platform): void {
  if (platform === 'macos') {
    throw new Error(
      `${platformLabel(platform)} builds are \`.pkg\` installers — \`launch build:resign\` re-signs ` +
        `\`.ipa\` (iOS/tvOS/visionOS) and \`.aab\`/\`.apk\` (Android) artifacts only.`,
    );
  }
}

/** Where the resigned artifact is written: `<app>-<version>-<build>-resigned<ext>` in the given dir. */
export function resignOutputPath(artifact: BuildArtifact, dir: string): string {
  const ext = extname(artifact.path);
  return join(
    dir,
    `${artifact.appName}-${artifact.version}-${artifact.buildNumber}-resigned${ext}`,
  );
}

/** `unzip` args to expand an `.ipa` into a work dir (overwrite, quiet). */
export function unzipArgs(ipaPath: string, dest: string): string[] {
  return ['-oq', ipaPath, '-d', dest];
}

/** `zip` args (run with cwd = work dir) to repackage `Payload/` into the output `.ipa`. */
export function zipArgs(outputIpa: string): string[] {
  return ['-qr', outputIpa, 'Payload'];
}

/** `security cms` args to decode a `.mobileprovision` to its plist (stdout). */
export function securityCmsArgs(profilePath: string): string[] {
  return ['cms', '-D', '-i', profilePath];
}

/** `PlistBuddy` args to print just the `Entitlements` dict of a decoded profile plist as XML. */
export function plistBuddyEntitlementsArgs(profilePlistPath: string): string[] {
  return ['-x', '-c', 'Print :Entitlements', profilePlistPath];
}

/** `codesign` args to force-re-sign an app bundle with a new identity + entitlements. */
export function iosCodesignArgs(
  appBundlePath: string,
  identity: string,
  entitlementsPath: string,
): string[] {
  return ['-f', '-s', identity, '--entitlements', entitlementsPath, appBundlePath];
}

/** A ready-to-run Android re-sign: the tool, its argument vector, and the secret env it reads passwords from. */
export interface AndroidResignSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * The Android re-sign invocation for an artifact: `apksigner` for a `.apk`, `jarsigner` for an `.aab`.
 * Passwords are read from the environment (`env:`/`:env`) so they never land in the process argv. Pure.
 */
export function androidResignSpec(
  artifactPath: string,
  keystore: KeystoreAssets,
): AndroidResignSpec {
  const env = {
    [KS_STOREPASS_ENV]: keystore.storePassword,
    [KS_KEYPASS_ENV]: keystore.keyPassword,
  };
  if (artifactPath.endsWith('.apk')) {
    return {
      command: 'apksigner',
      args: [
        'sign',
        '--ks',
        keystore.path,
        '--ks-pass',
        `env:${KS_STOREPASS_ENV}`,
        '--ks-key-alias',
        keystore.alias,
        '--key-pass',
        `env:${KS_KEYPASS_ENV}`,
        artifactPath,
      ],
      env,
    };
  }
  return {
    command: 'jarsigner',
    args: [
      '-keystore',
      keystore.path,
      '-storepass:env',
      KS_STOREPASS_ENV,
      '-keypass:env',
      KS_KEYPASS_ENV,
      '-sigalg',
      'SHA256withRSA',
      '-digestalg',
      'SHA-256',
      artifactPath,
      keystore.alias,
    ],
    env,
  };
}

/** Resolve the Apple account Key ID to re-sign under: an explicit `--account` (label or id), else active. */
function resolveAccountKeyId(selector: string | undefined): string {
  if (!selector) {
    const active = getActiveKeyId();
    if (!active)
      throw new Error('No active Apple account. Run `launch creds set-key`, or pass --account.');
    return active;
  }
  const match = listAccounts().find(
    (account) => account.keyId === selector || account.label === selector,
  );
  if (!match)
    throw new Error(`No Apple account matching "${selector}". See \`launch creds status\`.`);
  return match.keyId;
}

/** Re-sign an iOS `.ipa` into `outputPath`: swap the profile, re-codesign the app bundle, re-zip. */
async function resignIos(
  artifact: BuildArtifact,
  signing: SigningAssets,
  outputPath: string,
): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), 'launch-resign-'));
  try {
    await run('unzip', unzipArgs(artifact.path, work));
    const payload = join(work, 'Payload');
    const appBundle = existsSync(payload)
      ? readdirSync(payload).find((entry) => entry.endsWith('.app'))
      : undefined;
    if (!appBundle)
      throw new Error(`No .app inside ${artifact.path} (expected Payload/<App>.app).`);
    const appPath = join(payload, appBundle);

    copyFileSync(signing.profilePath, join(appPath, 'embedded.mobileprovision'));

    const profilePlist = join(work, 'profile.plist');
    writeFileSync(profilePlist, await capture('security', securityCmsArgs(signing.profilePath)));
    const entitlements = join(work, 'entitlements.plist');
    writeFileSync(
      entitlements,
      await capture('/usr/libexec/PlistBuddy', plistBuddyEntitlementsArgs(profilePlist)),
    );

    await run('codesign', iosCodesignArgs(appPath, signing.certName, entitlements));
    if (existsSync(outputPath)) rmSync(outputPath);
    await run('zip', zipArgs(outputPath), { cwd: work });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Re-sign an Android `.aab`/`.apk` into `outputPath` with the upload keystore. */
async function resignAndroid(
  artifact: BuildArtifact,
  keystore: KeystoreAssets,
  outputPath: string,
): Promise<void> {
  copyFileSync(artifact.path, outputPath);
  const spec = androidResignSpec(outputPath, keystore);
  await run(spec.command, spec.args, { env: spec.env });
}

/** Print the resign plan (no codesign, no writes) — the body of `--dry-run`. */
function printIosPlan(artifact: BuildArtifact, signing: SigningAssets, outputPath: string): void {
  console.log(`Would re-sign ${basename(artifact.path)} (iOS) with:`);
  console.log(`  identity: ${signing.certName} (team ${signing.teamId})`);
  console.log(`  profile:  ${signing.profileName} → embedded.mobileprovision`);
  console.log(`  steps:    unzip → swap profile → extract entitlements → codesign -f → zip`);
  console.log(`  output:   ${outputPath}`);
}

/** Print the Android resign plan (no signing, no writes) — the body of `--dry-run`. */
function printAndroidPlan(
  artifact: BuildArtifact,
  keystore: KeystoreAssets,
  outputPath: string,
): void {
  const spec = androidResignSpec(resignOutputPath(artifact, '.'), keystore);
  console.log(`Would re-sign ${basename(artifact.path)} (Android) with:`);
  console.log(`  keystore: ${keystore.path} (alias ${keystore.alias})`);
  console.log(
    `  tool:     ${spec.command} (passwords via ${KS_STOREPASS_ENV}/${KS_KEYPASS_ENV}, never argv)`,
  );
  console.log(`  output:   ${outputPath}`);
}

/** Attach the `build:resign` command to the program. */
export function registerResignCommand(program: Command): void {
  program
    .command('build:resign')
    .description('re-sign a stored build with different credentials, without rebuilding')
    .option('--id <id>', 'a build id from `launch builds list` (defaults to the latest)')
    .option('--latest', 're-sign the most recent build (the default)')
    .option('-a, --app <name>', 'only consider builds for this app')
    .option(
      '--account <keyId|label>',
      'iOS: the Apple account whose signing assets to use (defaults to active)',
    )
    .option(
      '-o, --output <path>',
      'where to write the resigned artifact (defaults to the current directory)',
    )
    .option('--dry-run', 'print the resign plan and change nothing', false)
    .action(
      async (options: {
        id?: string;
        latest?: boolean;
        app?: string;
        account?: string;
        output?: string;
        dryRun: boolean;
      }) => {
        const { config, apps } = await loadConfig();
        const history = await resolveStorageProvider(config).list();
        const scoped = options.app
          ? history.filter((build) => build.appName === options.app)
          : history;
        const artifact = findBuild(scoped, options.id ?? 'latest');
        if (!artifact) {
          throw new Error(
            options.id
              ? `No build matches "${options.id}". Run \`launch builds list\` to see what's available.`
              : 'No builds yet to re-sign. Run `launch build` first.',
          );
        }
        if (!existsSync(artifact.path)) {
          throw new Error(
            `The artifact for ${artifact.appName} is gone from ${artifact.path}. Rebuild it first.`,
          );
        }

        const outputDir = options.output ?? process.cwd();
        const outputPath =
          options.output && extname(options.output)
            ? options.output
            : resignOutputPath(artifact, outputDir);

        assertResignablePlatform(artifact.platform);
        if (isApplePlatform(artifact.platform)) {
          const bundleId = apps.find((app) => app.name === artifact.appName)?.bundleId;
          if (!bundleId)
            throw new Error(
              `No bundle id for ${artifact.appName} in app config — can't resolve signing.`,
            );
          const keyId = resolveAccountKeyId(options.account);
          const signing = loadCachedSigningAssets(keyId, bundleId);
          if (!signing) {
            throw new Error(
              `No cached signing for ${bundleId} under account ${keyId}. Run \`launch creds setup\` first.`,
            );
          }
          if (options.dryRun) {
            printIosPlan(artifact, signing, outputPath);
            return;
          }
          await resignIos(artifact, signing, outputPath);
        } else {
          const keystore = await loadCachedKeystore();
          if (!keystore)
            throw new Error(
              'No cached upload keystore. Run `launch creds setup --platform android` first.',
            );
          if (options.dryRun) {
            printAndroidPlan(artifact, keystore, outputPath);
            return;
          }
          await resignAndroid(artifact, keystore, outputPath);
        }

        console.log(`✓ Re-signed → ${outputPath}`);
      },
    );
}

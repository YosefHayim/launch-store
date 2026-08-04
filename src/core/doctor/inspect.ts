import type { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import { checkApp, formatFinding } from '../config/configCheck.js';
import { inspectPackageSetup, packageManagerWarnings } from '../config/packageManager.js';
import { ANDROID_TOOLS, fixHint, REQUIRED_TOOLS } from '../config/toolchain.js';
import {
  appGroupPreflightNotice,
  gatherTargetSigningReadiness,
  resolveExtensionBundleIdsForApp,
  signingPreflightDoctorChecks,
} from '../credentials/signingPreflight.js';
import { appPrivacyChecklist } from '../privacy/privacyNutritionLabel.js';
import { errorMessage } from '../services/errorMessage.js';
import { formatPermissionLine, probeKeyPermissions } from '../store/ascPermissions.js';
import { describeExportComplianceConfig } from '../store/exportCompliance.js';
import { buildConsoleUrl } from '../terminal/consoleLinks.js';
import { shellLocaleDoctorCheck, type ShellLocaleEnv } from '../terminal/locale.js';
import type { DoctorCheck, DoctorContext, DoctorPlatform, DoctorReport } from '../types/doctor.js';

const APP_STORE_CONNECT_APPS_URL = buildConsoleUrl('app-record', 'ios', undefined);
const PLAY_CONSOLE_URL = buildConsoleUrl('play', 'android', undefined);

/** Report package-manager selection and known lockfile or Corepack footguns. */
const packageManagerChecks = <Requirements>(doctorContext: DoctorContext<Requirements>) =>
  Effect.gen(function* () {
    const packageSetup = yield* inspectPackageSetup(doctorContext.cwd);
    let versionText = '';
    if (packageSetup.pm.version !== undefined) versionText = `@${packageSetup.pm.version}`;
    const doctorChecks: DoctorCheck[] = [
      {
        status: 'ok',
        title: `Package manager: ${packageSetup.pm.name}${versionText} (via ${packageSetup.pm.source})`,
      },
    ];
    if (packageSetup.workspace !== null) {
      doctorChecks.push({
        status: 'ok',
        title: `Monorepo workspace root: ${packageSetup.workspace.root} (${packageSetup.workspace.kind})`,
      });
    }
    const corepackAvailable = yield* doctorContext.corepackAvailable();
    const warnings = packageManagerWarnings({
      info: packageSetup.pm,
      lockfile: packageSetup.lockfile,
      corepackAvailable,
    });
    for (const warning of warnings) doctorChecks.push({ status: 'info', title: warning });
    return doctorChecks;
  });

/** Inspect the iOS command-line toolchain. */
const iosToolchainChecks = <Requirements>(
  doctorContext: DoctorContext<Requirements>,
): Effect.Effect<DoctorCheck[], unknown, Requirements> =>
  Effect.gen(function* () {
    let shellLocale: ShellLocaleEnv = {};
    if (doctorContext.shellLocale !== undefined) shellLocale = doctorContext.shellLocale;
    const doctorChecks: DoctorCheck[] = [shellLocaleDoctorCheck(shellLocale)];
    for (const tool of REQUIRED_TOOLS) {
      const toolPresent = yield* doctorContext.exists(tool.command);
      if (toolPresent) {
        doctorChecks.push({ status: 'ok', title: tool.label });
        continue;
      }
      if (tool.tier === 'recommended') {
        doctorChecks.push({
          status: 'info',
          title: `${tool.label} (recommended)`,
          hint: fixHint(tool),
        });
        continue;
      }
      doctorChecks.push({ status: 'fail', title: tool.label, hint: fixHint(tool) });
    }
    return doctorChecks;
  });

/** Inspect Android tools, the SDK, and app-local Gradle wrappers. */
const androidToolchainChecks = <Requirements>(
  doctorContext: DoctorContext<Requirements>,
): Effect.Effect<DoctorCheck[], unknown, Requirements> =>
  Effect.gen(function* () {
    const doctorChecks: DoctorCheck[] = [];
    for (const tool of ANDROID_TOOLS) {
      const toolPresent = yield* doctorContext.exists(tool.command);
      if (toolPresent) {
        doctorChecks.push({ status: 'ok', title: tool.label });
        continue;
      }
      doctorChecks.push({ status: 'fail', title: tool.label, hint: fixHint(tool) });
    }
    if (doctorContext.androidSdk === undefined) {
      doctorChecks.push({
        status: 'fail',
        title: 'Android SDK',
        hint: 'set ANDROID_HOME (install via Android Studio or the command-line tools)',
      });
    } else {
      doctorChecks.push({ status: 'ok', title: `Android SDK (${doctorContext.androidSdk})` });
    }
    for (const app of doctorContext.apps) {
      if (app.packageName === undefined) continue;
      const wrapperPresent = yield* doctorContext.gradleWrapperExists(app.dir);
      if (wrapperPresent) {
        doctorChecks.push({ status: 'ok', title: `Gradle wrapper for ${app.name}` });
        continue;
      }
      doctorChecks.push({
        status: 'info',
        title: `No android/gradlew for ${app.name} yet`,
        detail: '`launch build android` will run `expo prebuild` to generate it',
      });
    }
    return doctorChecks;
  });

/** Surface the credential provider's platform summary. */
const credentialsCheck = <Requirements>(
  doctorContext: DoctorContext<Requirements>,
): Effect.Effect<DoctorCheck[], unknown, Requirements> =>
  doctorContext.credentialsStatus().pipe(
    Effect.map((credentialSummary): DoctorCheck[] => [
      {
        status: 'info',
        title: 'Credentials',
        detail: credentialSummary,
      },
    ]),
  );

/** Confirm a macOS distribution identity is visible to codesign. */
const codesignCheck = <Requirements>(
  doctorContext: DoctorContext<Requirements>,
): Effect.Effect<DoctorCheck[], unknown, Requirements> =>
  Effect.gen(function* () {
    if (doctorContext.os !== 'macos') return [];
    const identityText = yield* doctorContext.codesignIdentities();
    if (identityText === null) {
      return [
        {
          status: 'info',
          title: 'Could not query codesign identities (security CLI unavailable)',
        },
      ];
    }
    if (/Apple Distribution|iPhone Distribution/.test(identityText)) {
      return [
        {
          status: 'ok',
          title: 'Distribution identity visible to codesign (login keychain - Tahoe-safe)',
        },
      ];
    }
    return [
      {
        status: 'info',
        title: 'No distribution identity in the login keychain yet',
        hint: '`launch creds setup` imports one',
      },
    ];
  });

/** Probe Apple agreements and app-record availability. */
const appleAccountChecks = <Requirements>(
  doctorContext: DoctorContext<Requirements>,
): Effect.Effect<DoctorCheck[], unknown, Requirements> =>
  Effect.gen(function* () {
    const appleClient = yield* doctorContext.resolveAsc();
    if (appleClient === null) {
      return [
        {
          status: 'info',
          title: 'No active Apple account - skipping Apple checks',
          hint: '`launch creds set-key`',
        },
      ];
    }
    const doctorChecks: DoctorCheck[] = [];
    const agreementCheck = yield* appleClient.assertReady().pipe(Effect.either);
    if (agreementCheck._tag === 'Left') {
      doctorChecks.push({
        status: 'fail',
        title: 'Apple account check failed',
        detail: errorMessage(agreementCheck.left),
      });
      return doctorChecks;
    }
    doctorChecks.push({
      status: 'ok',
      title: 'Apple agreements accepted',
      detail: 'via App Store Connect API key - no password or two-factor prompt',
    });
    for (const app of doctorContext.apps) {
      if (app.bundleId === undefined) continue;
      const appId = yield* appleClient.getAppId(app.bundleId);
      if (appId !== null) {
        doctorChecks.push({ status: 'ok', title: `App record for ${app.bundleId}` });
        continue;
      }
      doctorChecks.push({
        status: 'fail',
        title: `No App Store Connect record for ${app.bundleId}`,
        hint: `create it at ${APP_STORE_CONNECT_APPS_URL}`,
      });
    }
    return doctorChecks;
  });

/** Probe Google Play access for every configured Android app. */
const playAccountChecks = <Requirements>(
  doctorContext: DoctorContext<Requirements>,
): Effect.Effect<DoctorCheck[], unknown, Requirements> =>
  Effect.gen(function* () {
    const googleClient = yield* doctorContext.resolvePlay();
    if (googleClient === null) {
      return [
        {
          status: 'info',
          title: 'No service account imported - skipping Play checks',
          hint: '`launch creds set-key --platform android`',
        },
      ];
    }
    const doctorChecks: DoctorCheck[] = [];
    for (const app of doctorContext.apps) {
      if (app.packageName === undefined) continue;
      const accessCheck = yield* googleClient.assertAppExists(app.packageName).pipe(Effect.either);
      if (accessCheck._tag === 'Right') {
        doctorChecks.push({ status: 'ok', title: `Play app reachable for ${app.packageName}` });
        continue;
      }
      doctorChecks.push({
        status: 'fail',
        title: errorMessage(accessCheck.left),
        hint: `Create the app and enroll in Play App Signing at ${PLAY_CONSOLE_URL}`,
      });
    }
    doctorChecks.push({
      status: 'info',
      title:
        'A new personal Play account needs about 20 testers for 14 days before production unlocks.',
    });
    doctorChecks.push({
      status: 'info',
      title: 'Sensitive permissions may require a Play Console declaration before release.',
    });
    return doctorChecks;
  });

/** Validate each discovered app's Expo configuration. */
const configChecks = <Requirements>(
  doctorContext: DoctorContext<Requirements>,
  platform: DoctorPlatform,
) =>
  Effect.gen(function* () {
    const doctorChecks: DoctorCheck[] = [];
    for (const app of doctorContext.apps) {
      const configFindings = yield* checkApp(app, platform);
      if (configFindings.length === 0) {
        doctorChecks.push({ status: 'ok', title: `${app.name}: app config clean` });
        continue;
      }
      for (const finding of configFindings) {
        let checkStatus: DoctorCheck['status'] = 'info';
        if (finding.severity === 'error') checkStatus = 'fail';
        doctorChecks.push({
          status: checkStatus,
          title: `${app.name}: ${formatFinding(finding)}`,
        });
      }
    }
    return doctorChecks;
  });

/** Report each iOS app's export-compliance posture. */
const exportComplianceChecks = <Requirements>(
  doctorContext: DoctorContext<Requirements>,
): Effect.Effect<DoctorCheck[]> =>
  Effect.sync(() => {
    const iosApps = doctorContext.apps.filter((app) => app.bundleId !== undefined);
    return iosApps.map((app) => {
      const exportCompliance = describeExportComplianceConfig(app.usesNonExemptEncryption);
      let checkStatus: DoctorCheck['status'] = 'info';
      if (exportCompliance.ok) checkStatus = 'ok';
      return { status: checkStatus, title: `${app.name}: ${exportCompliance.message}` };
    });
  });

/** Inspect App ID and capability readiness for every iOS target. */
const signingPreflightChecks = <Requirements>(
  doctorContext: DoctorContext<Requirements>,
): Effect.Effect<DoctorCheck[], unknown, FileSystem.FileSystem | Path.Path | Requirements> =>
  Effect.gen(function* () {
    const appleClient = yield* doctorContext.resolveAsc();
    if (appleClient === null) return [];
    const doctorChecks: DoctorCheck[] = [];
    for (const app of doctorContext.apps) {
      if (app.bundleId === undefined) continue;
      const appGroupNotice = appGroupPreflightNotice(app.iosEntitlements);
      const extensionBundleIds = yield* resolveExtensionBundleIdsForApp(app);
      const readinessCheck = yield* gatherTargetSigningReadiness(
        appleClient,
        app.bundleId,
        extensionBundleIds,
        app.iosEntitlements,
      ).pipe(Effect.either);
      if (readinessCheck._tag === 'Left') {
        doctorChecks.push({
          status: 'info',
          title: `${app.name}: signing preflight skipped`,
          detail: errorMessage(readinessCheck.left),
        });
        continue;
      }
      doctorChecks.push(...signingPreflightDoctorChecks(readinessCheck.right, appGroupNotice));
    }
    return doctorChecks;
  });

/** Remind iOS developers about the manual App Privacy form. */
const appPrivacyChecks = <Requirements>(
  doctorContext: DoctorContext<Requirements>,
): Effect.Effect<DoctorCheck[]> =>
  Effect.sync(() => {
    if (!doctorContext.apps.some((app) => app.bundleId !== undefined)) return [];
    const [headline, ...checklistItems] = appPrivacyChecklist();
    let title = 'App Privacy';
    if (headline !== undefined) title = headline;
    return [{ status: 'info', title, detail: checklistItems.join('\n') }];
  });

/** Probe the active Apple key against every role-gated feature. */
const keyPermissionChecks = <Requirements>(
  doctorContext: DoctorContext<Requirements>,
): Effect.Effect<DoctorCheck[], unknown, Requirements> =>
  Effect.gen(function* () {
    const appleClient = yield* doctorContext.resolveAsc();
    if (appleClient === null) return [];
    const appWithBundleId = doctorContext.apps.find((app) => app.bundleId !== undefined);
    let appId: string | null = null;
    if (appWithBundleId?.bundleId !== undefined) {
      appId = yield* appleClient
        .getAppId(appWithBundleId.bundleId)
        .pipe(Effect.catchAll(() => Effect.succeed(null)));
    }
    const permissionChecks = yield* probeKeyPermissions(appleClient, appId);
    return [
      {
        status: 'info',
        title: 'API-key role access (per feature):',
        detail: permissionChecks
          .map((permissionCheck) => `  ${formatPermissionLine(permissionCheck)}`)
          .join('\n'),
      },
    ];
  });

/** Collect one section, converting its failure into one visible doctor check. */
const collectSection = <Requirements>(
  doctorChecks: DoctorCheck[],
  sectionLabel: string,
  section: Effect.Effect<DoctorCheck[], unknown, Requirements>,
): Effect.Effect<void, never, Requirements> =>
  section.pipe(
    Effect.catchAll(
      (failure): Effect.Effect<DoctorCheck[]> =>
        Effect.succeed([
          {
            status: 'fail',
            title: `${sectionLabel} check failed`,
            detail: errorMessage(failure),
          },
        ]),
    ),
    Effect.map((sectionChecks) => {
      doctorChecks.push(...sectionChecks);
      return undefined;
    }),
  );

/** Run the read-only doctor preflight and return its structured report. */
export const inspectDoctor = <Requirements>(
  doctorContext: DoctorContext<Requirements>,
): Effect.Effect<DoctorReport, never, FileSystem.FileSystem | Path.Path | Requirements> =>
  Effect.gen(function* () {
    const doctorChecks: DoctorCheck[] = [];
    yield* collectSection(doctorChecks, 'Package manager', packageManagerChecks(doctorContext));
    if (doctorContext.platform === 'android') {
      yield* collectSection(
        doctorChecks,
        'Android toolchain',
        androidToolchainChecks(doctorContext),
      );
      yield* collectSection(doctorChecks, 'Credentials', credentialsCheck(doctorContext));
      yield* collectSection(doctorChecks, 'Play account', playAccountChecks(doctorContext));
      yield* collectSection(doctorChecks, 'App config', configChecks(doctorContext, 'android'));
    } else {
      yield* collectSection(doctorChecks, 'iOS toolchain', iosToolchainChecks(doctorContext));
      yield* collectSection(doctorChecks, 'Credentials', credentialsCheck(doctorContext));
      yield* collectSection(doctorChecks, 'Codesign identity', codesignCheck(doctorContext));
      yield* collectSection(doctorChecks, 'Apple account', appleAccountChecks(doctorContext));
      yield* collectSection(
        doctorChecks,
        'Signing preflight',
        signingPreflightChecks(doctorContext),
      );
      yield* collectSection(doctorChecks, 'App config', configChecks(doctorContext, 'ios'));
      yield* collectSection(
        doctorChecks,
        'Export compliance',
        exportComplianceChecks(doctorContext),
      );
      yield* collectSection(doctorChecks, 'App privacy', appPrivacyChecks(doctorContext));
      yield* collectSection(
        doctorChecks,
        'API-key permissions',
        keyPermissionChecks(doctorContext),
      );
    }
    return {
      platform: doctorContext.platform,
      checks: doctorChecks,
      ok: doctorChecks.every((doctorCheck) => doctorCheck.status !== 'fail'),
    };
  });

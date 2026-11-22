import { checkApp, formatFinding } from '../config/configCheck.ts';
import { inspectPackageSetup, packageManagerWarnings } from '../config/packageManager.ts';
import { ANDROID_TOOLS, fixHint, REQUIRED_TOOLS, type Tool } from '../config/toolchain.ts';
import {
  appGroupPreflightNotice,
  gatherTargetSigningReadiness,
  resolveExtensionBundleIdsForApp,
  signingPreflightDoctorChecks,
} from '../credentials/signingPreflight.ts';
import { appPrivacyChecklist } from '../privacy/privacyNutritionLabel.ts';
import { errorMessage } from '../services/platform/errorMessage.ts';
import { formatPermissionLine, probeKeyPermissions } from '../store/apple/ascPermissions.ts';
import { describeExportComplianceConfig } from '../store/apple/exportCompliance.ts';
import { buildConsoleUrl } from '../terminal/consoleLinks.ts';
import { shellLocaleDoctorCheck, type ShellLocaleEnv } from '../terminal/locale.ts';
import type { AppDescriptor } from '../types/app.ts';
import type {
  DoctorAscApi,
  DoctorCheck,
  DoctorContext,
  DoctorPlatform,
  DoctorReport,
} from '../types/doctor.ts';

function hasBundleId(app: AppDescriptor): boolean {
  return app.bundleId != null;
}

async function readSectionChecks(
  sectionLabel: string,
  sectionChecks: Promise<readonly DoctorCheck[]>,
): Promise<DoctorCheck[]> {
  try {
    const finishedChecks = await sectionChecks;

    return [...finishedChecks];
  } catch (error) {
    return [
      {
        status: 'fail',
        title: `${sectionLabel} check failed`,
        detail: errorMessage(error),
      },
    ];
  }
}

async function packageManagerChecks(doctorContext: DoctorContext): Promise<DoctorCheck[]> {
  const packageSetup = await inspectPackageSetup(doctorContext.cwd);
  let versionText = '';

  if (packageSetup.pm.version != null) {
    versionText = `@${packageSetup.pm.version}`;
  }

  const packageManagerTitle = `Package manager: ${packageSetup.pm.name}${versionText} (via ${packageSetup.pm.source})`;
  const doctorChecks: DoctorCheck[] = [
    {
      status: 'ok',
      title: packageManagerTitle,
    },
  ];

  if (packageSetup.workspace != null) {
    const workspaceTitle = `Monorepo workspace root: ${packageSetup.workspace.root} (${packageSetup.workspace.kind})`;
    doctorChecks.push({
      status: 'ok',
      title: workspaceTitle,
    });
  }

  const corepackAvailable = await doctorContext.corepackAvailable();
  const warnings = packageManagerWarnings({
    info: packageSetup.pm,
    lockfile: packageSetup.lockfile,
    corepackAvailable,
  });

  function warningCheck(warning: string): DoctorCheck {
    return { status: 'info', title: warning };
  }

  return [...doctorChecks, ...warnings.map(warningCheck)];
}

async function readIosToolCheck(doctorContext: DoctorContext, tool: Tool): Promise<DoctorCheck> {
  const toolPresent = await doctorContext.exists(tool.command);

  if (toolPresent) {
    return { status: 'ok', title: tool.label };
  }

  const isRecommended = tool.tier == 'recommended';

  if (isRecommended) {
    return {
      status: 'info',
      title: `${tool.label} (recommended)`,
      hint: fixHint(tool),
    };
  }

  return { status: 'fail', title: tool.label, hint: fixHint(tool) };
}

async function iosToolchainChecks(doctorContext: DoctorContext): Promise<DoctorCheck[]> {
  let shellLocale: ShellLocaleEnv = {};

  if (doctorContext.shellLocale != null) {
    shellLocale = doctorContext.shellLocale;
  }

  const doctorChecks: DoctorCheck[] = [shellLocaleDoctorCheck(shellLocale)];

  for (const tool of REQUIRED_TOOLS) {
    const toolCheck = await readIosToolCheck(doctorContext, tool);
    doctorChecks.push(toolCheck);
  }

  return doctorChecks;
}

async function readAndroidToolCheck(
  doctorContext: DoctorContext,
  tool: Tool,
): Promise<DoctorCheck> {
  const toolPresent = await doctorContext.exists(tool.command);

  if (toolPresent) {
    return { status: 'ok', title: tool.label };
  }

  return { status: 'fail', title: tool.label, hint: fixHint(tool) };
}

function readAndroidSdkCheck(androidSdk: string | undefined): DoctorCheck {
  if (androidSdk == null) {
    return {
      status: 'fail',
      title: 'Android SDK',
      hint: 'set ANDROID_HOME (install via Android Studio or the command-line tools)',
    };
  }

  return { status: 'ok', title: `Android SDK (${androidSdk})` };
}

async function readGradleWrapperCheck(
  doctorContext: DoctorContext,
  app: AppDescriptor,
): Promise<DoctorCheck | null> {
  if (app.packageName == null) {
    return null;
  }

  const wrapperPresent = await doctorContext.gradleWrapperExists(app.dir);

  if (wrapperPresent) {
    return { status: 'ok', title: `Gradle wrapper for ${app.name}` };
  }

  return {
    status: 'info',
    title: `No android/gradlew for ${app.name} yet`,
    detail: '`launch build android` will run `expo prebuild` to generate it',
  };
}

async function androidToolchainChecks(doctorContext: DoctorContext): Promise<DoctorCheck[]> {
  const doctorChecks: DoctorCheck[] = [];

  for (const tool of ANDROID_TOOLS) {
    const toolCheck = await readAndroidToolCheck(doctorContext, tool);
    doctorChecks.push(toolCheck);
  }

  doctorChecks.push(readAndroidSdkCheck(doctorContext.androidSdk));

  for (const app of doctorContext.apps) {
    const wrapperCheck = await readGradleWrapperCheck(doctorContext, app);

    if (wrapperCheck == null) {
      continue;
    }

    doctorChecks.push(wrapperCheck);
  }

  return doctorChecks;
}

async function credentialsCheck(doctorContext: DoctorContext): Promise<DoctorCheck[]> {
  const credentialSummary = await doctorContext.credentialsStatus();

  return [
    {
      status: 'info',
      title: 'Credentials',
      detail: credentialSummary,
    },
  ];
}

async function codesignCheck(doctorContext: DoctorContext): Promise<DoctorCheck[]> {
  const isMac = doctorContext.os == 'macos';

  if (isMac == false) {
    return [];
  }

  const identityText = await doctorContext.codesignIdentities();

  if (identityText == null) {
    return [
      {
        status: 'info',
        title: 'Could not query codesign identities (security CLI unavailable)',
      },
    ];
  }

  // Matches an Apple or iPhone distribution certificate in `security find-identity` output.
  const hasDistributionIdentity = /Apple Distribution|iPhone Distribution/.test(identityText);

  if (hasDistributionIdentity) {
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
}

async function readAgreementFailure(appleClient: DoctorAscApi): Promise<string | null> {
  try {
    await appleClient.assertReady();
  } catch (error) {
    return errorMessage(error);
  }

  return null;
}

async function readAppRecordCheck(
  appleClient: DoctorAscApi,
  app: AppDescriptor,
): Promise<DoctorCheck | null> {
  if (app.bundleId == null) {
    return null;
  }

  const appId = await appleClient.getAppId(app.bundleId);

  if (appId != null) {
    return { status: 'ok', title: `App record for ${app.bundleId}` };
  }

  const appRecordUrl = buildConsoleUrl('app-record', 'ios', undefined);

  return {
    status: 'fail',
    title: `No App Store Connect record for ${app.bundleId}`,
    hint: `create it at ${appRecordUrl}`,
  };
}

async function appleAccountChecks(doctorContext: DoctorContext): Promise<DoctorCheck[]> {
  const appleClient = await doctorContext.resolveAsc();

  if (appleClient == null) {
    return [
      {
        status: 'info',
        title: 'No active Apple account - skipping Apple checks',
        hint: '`launch creds set-key`',
      },
    ];
  }

  const agreementFailure = await readAgreementFailure(appleClient);

  if (agreementFailure != null) {
    return [
      {
        status: 'fail',
        title: 'Apple account check failed',
        detail: agreementFailure,
      },
    ];
  }

  const doctorChecks: DoctorCheck[] = [
    {
      status: 'ok',
      title: 'Apple agreements accepted',
      detail: 'via App Store Connect API key - no password or two-factor prompt',
    },
  ];

  for (const app of doctorContext.apps) {
    const appRecordCheck = await readAppRecordCheck(appleClient, app);

    if (appRecordCheck == null) {
      continue;
    }

    doctorChecks.push(appRecordCheck);
  }

  return doctorChecks;
}

async function readPlayAppCheck(
  doctorContext: DoctorContext,
  app: AppDescriptor,
): Promise<DoctorCheck | null> {
  if (app.packageName == null) {
    return null;
  }

  const googleClient = await doctorContext.resolvePlay(app.packageName);

  if (googleClient == null) {
    return {
      status: 'info',
      title: `No service account imported for ${app.packageName} - skipping Play checks`,
      hint: 'launch creds set-key --platform android --app <name>',
    };
  }

  try {
    await googleClient.assertAppExists(app.packageName);
  } catch (error) {
    const playConsoleUrl = buildConsoleUrl('play', 'android', undefined);

    return {
      status: 'fail',
      title: errorMessage(error),
      hint: `Create the app and enroll in Play App Signing at ${playConsoleUrl}`,
    };
  }

  return { status: 'ok', title: `Play app reachable for ${app.packageName}` };
}

async function playAccountChecks(doctorContext: DoctorContext): Promise<DoctorCheck[]> {
  const doctorChecks: DoctorCheck[] = [];

  for (const app of doctorContext.apps) {
    const playCheck = await readPlayAppCheck(doctorContext, app);

    if (playCheck == null) {
      continue;
    }

    doctorChecks.push(playCheck);
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
}

function readFindingStatus(severity: string): DoctorCheck['status'] {
  const isError = severity == 'error';

  if (isError) {
    return 'fail';
  }

  return 'info';
}

async function readAppConfigChecks(
  app: AppDescriptor,
  platform: DoctorPlatform,
): Promise<DoctorCheck[]> {
  const configFindings = await checkApp(app, platform);
  const isClean = configFindings.length == 0;

  if (isClean) {
    return [{ status: 'ok', title: `${app.name}: app config clean` }];
  }

  const doctorChecks: DoctorCheck[] = [];

  for (const finding of configFindings) {
    doctorChecks.push({
      status: readFindingStatus(finding.severity),
      title: `${app.name}: ${formatFinding(finding)}`,
    });
  }

  return doctorChecks;
}

async function configChecks(
  doctorContext: DoctorContext,
  platform: DoctorPlatform,
): Promise<DoctorCheck[]> {
  const doctorChecks: DoctorCheck[] = [];

  for (const app of doctorContext.apps) {
    const appChecks = await readAppConfigChecks(app, platform);
    doctorChecks.push(...appChecks);
  }

  return doctorChecks;
}

function complianceCheck(app: AppDescriptor): DoctorCheck {
  const exportCompliance = describeExportComplianceConfig(app.usesNonExemptEncryption);
  const isClean = exportCompliance.ok;

  if (isClean) {
    return { status: 'ok', title: `${app.name}: ${exportCompliance.message}` };
  }

  return { status: 'info', title: `${app.name}: ${exportCompliance.message}` };
}

async function exportComplianceChecks(doctorContext: DoctorContext): Promise<DoctorCheck[]> {
  const iosApps = doctorContext.apps.filter(hasBundleId);

  return iosApps.map(complianceCheck);
}

async function readSigningChecks(
  appleClient: DoctorAscApi,
  app: AppDescriptor,
): Promise<DoctorCheck[]> {
  if (app.bundleId == null) {
    return [];
  }

  const appGroupNotice = appGroupPreflightNotice(app.iosEntitlements);
  const extensionBundleIds = await resolveExtensionBundleIdsForApp(app);

  try {
    const readiness = await gatherTargetSigningReadiness(
      appleClient,
      app.bundleId,
      extensionBundleIds,
      app.iosEntitlements,
    );

    return signingPreflightDoctorChecks(readiness, appGroupNotice);
  } catch (error) {
    return [
      {
        status: 'info',
        title: `${app.name}: signing preflight skipped`,
        detail: errorMessage(error),
      },
    ];
  }
}

async function signingPreflightChecks(doctorContext: DoctorContext): Promise<DoctorCheck[]> {
  const appleClient = await doctorContext.resolveAsc();

  if (appleClient == null) {
    return [];
  }

  const doctorChecks: DoctorCheck[] = [];

  for (const app of doctorContext.apps) {
    const appChecks = await readSigningChecks(appleClient, app);
    doctorChecks.push(...appChecks);
  }

  return doctorChecks;
}

async function appPrivacyChecks(doctorContext: DoctorContext): Promise<DoctorCheck[]> {
  const hasIosApp = doctorContext.apps.some(hasBundleId);

  if (hasIosApp == false) {
    return [];
  }

  const checklist = appPrivacyChecklist();
  const headline = checklist[0];
  const checklistItems = checklist.slice(1);
  let title = 'App Privacy';

  if (headline != null) {
    title = headline;
  }

  return [{ status: 'info', title, detail: checklistItems.join('\n') }];
}

async function readPermissionAppId(
  appleClient: DoctorAscApi,
  apps: readonly AppDescriptor[],
): Promise<string | null> {
  const appWithBundleId = apps.find(hasBundleId);

  if (appWithBundleId == null) {
    return null;
  }

  const bundleId = appWithBundleId.bundleId;

  if (bundleId == null) {
    return null;
  }

  try {
    return await appleClient.getAppId(bundleId);
  } catch {
    // The permission probe still runs when the app id cannot be read.
    return null;
  }
}

async function keyPermissionChecks(doctorContext: DoctorContext): Promise<DoctorCheck[]> {
  const appleClient = await doctorContext.resolveAsc();

  if (appleClient == null) {
    return [];
  }

  const appId = await readPermissionAppId(appleClient, doctorContext.apps);
  const permissionChecks = await probeKeyPermissions(appleClient, appId);
  const permissionLines: string[] = [];

  for (const permissionCheck of permissionChecks) {
    permissionLines.push(`  ${formatPermissionLine(permissionCheck)}`);
  }

  return [
    {
      status: 'info',
      title: 'API-key role access (per feature):',
      detail: permissionLines.join('\n'),
    },
  ];
}

async function readAndroidChecks(doctorContext: DoctorContext): Promise<DoctorCheck[]> {
  const toolchainChecks = await readSectionChecks(
    'Android toolchain',
    androidToolchainChecks(doctorContext),
  );
  const credentialChecks = await readSectionChecks('Credentials', credentialsCheck(doctorContext));
  const playChecks = await readSectionChecks('Play account', playAccountChecks(doctorContext));
  const appConfigChecks = await readSectionChecks(
    'App config',
    configChecks(doctorContext, 'android'),
  );

  return [...toolchainChecks, ...credentialChecks, ...playChecks, ...appConfigChecks];
}

async function readIosChecks(doctorContext: DoctorContext): Promise<DoctorCheck[]> {
  const toolchainChecks = await readSectionChecks(
    'iOS toolchain',
    iosToolchainChecks(doctorContext),
  );
  const credentialChecks = await readSectionChecks('Credentials', credentialsCheck(doctorContext));
  const identityChecks = await readSectionChecks('Codesign identity', codesignCheck(doctorContext));
  const accountChecks = await readSectionChecks('Apple account', appleAccountChecks(doctorContext));
  const signingChecks = await readSectionChecks(
    'Signing preflight',
    signingPreflightChecks(doctorContext),
  );
  const appConfigChecks = await readSectionChecks('App config', configChecks(doctorContext, 'ios'));
  const complianceChecks = await readSectionChecks(
    'Export compliance',
    exportComplianceChecks(doctorContext),
  );
  const privacyChecks = await readSectionChecks('App privacy', appPrivacyChecks(doctorContext));
  const permissionChecks = await readSectionChecks(
    'API-key permissions',
    keyPermissionChecks(doctorContext),
  );

  return [
    ...toolchainChecks,
    ...credentialChecks,
    ...identityChecks,
    ...accountChecks,
    ...signingChecks,
    ...appConfigChecks,
    ...complianceChecks,
    ...privacyChecks,
    ...permissionChecks,
  ];
}

async function readPlatformChecks(doctorContext: DoctorContext): Promise<DoctorCheck[]> {
  const isAndroid = doctorContext.platform == 'android';

  if (isAndroid) {
    return readAndroidChecks(doctorContext);
  }

  return readIosChecks(doctorContext);
}

function isPassingCheck(doctorCheck: DoctorCheck): boolean {
  return doctorCheck.status != 'fail';
}

/** Run the read-only doctor preflight and return its structured report. */
export async function inspectDoctor(doctorContext: DoctorContext): Promise<DoctorReport> {
  const packageChecks = await readSectionChecks(
    'Package manager',
    packageManagerChecks(doctorContext),
  );
  const platformChecks = await readPlatformChecks(doctorContext);
  const doctorChecks = [...packageChecks, ...platformChecks];

  return {
    platform: doctorContext.platform,
    checks: doctorChecks,
    ok: doctorChecks.every(isPassingCheck),
  };
}

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LaunchConfig } from '@/types/config.js';
import type { DoctorAscApi, DoctorCheck, DoctorContext, DoctorPlatform } from '@/types/doctor.js';
import { inspectDoctor } from './inspect.js';

const launchConfig: LaunchConfig = {
  profiles: {},
  credentials: 'local',
  storage: 'local',
  buildEngine: 'xcode',
  submit: 'app-store-connect',
};

const DOCTOR_PLATFORMS: readonly DoctorPlatform[] = ['ios', 'android'];

async function commandExists(): Promise<boolean> {
  return true;
}

async function commandMissing(): Promise<boolean> {
  return false;
}

async function gradleWrapperMissing(): Promise<boolean> {
  return false;
}

async function noAppleClient(): Promise<null> {
  return null;
}

async function noPlayClient(): Promise<null> {
  return null;
}

async function noCredentials(): Promise<string> {
  return 'no credentials';
}

async function lockedKeychain(): Promise<string> {
  throw new Error('keychain locked');
}

async function noCodesignIdentities(): Promise<null> {
  return null;
}

async function corepackIsAvailable(): Promise<boolean> {
  return true;
}

async function assertReady(): Promise<void> {
  return;
}

async function readAppId(): Promise<string> {
  return 'app-1';
}

async function listEmpty(): Promise<unknown> {
  return [];
}

async function listAppGroups(): Promise<{ capabilityType: string }[]> {
  return [{ capabilityType: 'APP_GROUPS' }];
}

async function findMainBundleOnly(bundleId: string): Promise<{ id: string } | null> {
  const isMainApp = bundleId == 'com.example.sampleapp';

  if (isMainApp) {
    return { id: 'bid-main' };
  }

  return null;
}

async function findAnyBundle(): Promise<{ id: string }> {
  return { id: 'bid-main' };
}

function appleClient(findBundle: DoctorAscApi['findBundleId']): DoctorAscApi {
  return {
    listDistributionCertificates: listEmpty,
    listBetaGroups: listEmpty,
    listAppStoreVersions: listEmpty,
    listSubscriptionGroups: listEmpty,
    listCustomerReviews: listEmpty,
    listAnalyticsReportRequests: listEmpty,
    assertReady,
    getAppId: readAppId,
    findBundleId: findBundle,
    listBundleIdCapabilities: listAppGroups,
  };
}

async function resolveUnregisteredExtension(): Promise<DoctorAscApi> {
  return appleClient(findMainBundleOnly);
}

async function resolveRegisteredApp(): Promise<DoctorAscApi> {
  return appleClient(findAnyBundle);
}

function sampleDoctorContext(overrides: Partial<DoctorContext> = {}): DoctorContext {
  return {
    config: launchConfig,
    apps: [],
    platform: 'ios',
    os: 'linux',
    cwd: process.cwd(),
    exists: commandExists,
    gradleWrapperExists: gradleWrapperMissing,
    resolveAsc: noAppleClient,
    resolvePlay: noPlayClient,
    credentialsStatus: noCredentials,
    codesignIdentities: noCodesignIdentities,
    corepackAvailable: corepackIsAvailable,
    ...overrides,
  };
}

function isPackageManagerCheck(doctorCheck: DoctorCheck): boolean {
  return doctorCheck.title.startsWith('Package manager:');
}

function isSkippedAppleCheck(doctorCheck: DoctorCheck): boolean {
  return doctorCheck.title.includes('skipping Apple checks');
}

function isFailure(doctorCheck: DoctorCheck): boolean {
  return doctorCheck.status == 'fail';
}

function isAndroidSdkFailure(doctorCheck: DoctorCheck): boolean {
  const isFailed = doctorCheck.status == 'fail';

  if (isFailed == false) {
    return false;
  }

  return doctorCheck.title == 'Android SDK';
}

function isSdkPath(doctorCheck: DoctorCheck): boolean {
  const isOk = doctorCheck.status == 'ok';

  if (isOk == false) {
    return false;
  }

  return doctorCheck.title.includes('/opt/android-sdk');
}

function isPnpmCheck(doctorCheck: DoctorCheck): boolean {
  return doctorCheck.title.includes('pnpm');
}

function isShellLocale(doctorCheck: DoctorCheck): boolean {
  return doctorCheck.title.startsWith('Shell locale');
}

function isUtf8Locale(doctorCheck: DoctorCheck): boolean {
  return doctorCheck.title == 'Shell locale (en_US.UTF-8)';
}

function isUnregisteredWidget(doctorCheck: DoctorCheck): boolean {
  const isFailed = doctorCheck.status == 'fail';

  if (isFailed == false) {
    return false;
  }

  if (doctorCheck.detail == null) {
    return false;
  }

  const mentionsWidget = doctorCheck.detail.includes('com.example.sampleapp.widget');

  if (mentionsWidget == false) {
    return false;
  }

  return doctorCheck.detail.includes('not registered');
}

function isAppGroupNotice(doctorCheck: DoctorCheck): boolean {
  const isInfo = doctorCheck.status == 'info';

  if (isInfo == false) {
    return false;
  }

  const isAppGroupTitle = doctorCheck.title == 'App Groups require portal setup';

  if (isAppGroupTitle == false) {
    return false;
  }

  if (doctorCheck.detail == null) {
    return false;
  }

  return doctorCheck.detail.includes('group.com.example.sampleapp');
}

describe('inspectDoctor', function describeInspectDoctor() {
  it('passes a clean iOS preflight (no fails) with no accounts configured', async function passesCleanIos() {
    const report = await inspectDoctor(sampleDoctorContext({ platform: 'ios' }));

    expect(report.platform).toBe('ios');
    expect(report.ok).toBe(true);
    expect(report.checks.some(isPackageManagerCheck)).toBe(true);
    expect(report.checks.some(isSkippedAppleCheck)).toBe(true);
  });

  it('fails the Android run when the SDK and toolchain are missing', async function failsMissingAndroidSdk() {
    const report = await inspectDoctor(
      sampleDoctorContext({
        platform: 'android',
        exists: commandMissing,
      }),
    );

    expect(report.platform).toBe('android');
    expect(report.ok).toBe(false);
    expect(report.checks.some(isAndroidSdkFailure)).toBe(true);
  });

  it('reports the Android SDK as ok when ANDROID_HOME is set', async function reportsAndroidSdk() {
    const report = await inspectDoctor(
      sampleDoctorContext({
        platform: 'android',
        androidSdk: '/opt/android-sdk',
      }),
    );

    expect(report.checks.some(isSdkPath)).toBe(true);
  });

  it('isolates a throwing section as a single fail without sinking the rest', async function isolatesSectionFailure() {
    const report = await inspectDoctor(
      sampleDoctorContext({
        credentialsStatus: lockedKeychain,
      }),
    );
    const failedChecks = report.checks.filter(isFailure);

    expect(failedChecks).toEqual([
      { status: 'fail', title: 'Credentials check failed', detail: 'keychain locked' },
    ]);
    expect(report.ok).toBe(false);
    expect(report.checks.some(isPackageManagerCheck)).toBe(true);
  });

  for (const platform of DOCTOR_PLATFORMS) {
    it(`always reports the package manager first for ${platform}`, async function reportsPackageManagerFirst() {
      const report = await inspectDoctor(sampleDoctorContext({ platform }));
      const firstCheck = report.checks[0];
      let titleStartsWithPackageManager = false;

      if (firstCheck != null) {
        titleStartsWithPackageManager = firstCheck.title.startsWith('Package manager:');
      }

      expect(titleStartsWithPackageManager).toBe(true);
    });
  }

  it('inspects the package setup of the given cwd', async function inspectsPackageSetup() {
    const directory = mkdtempSync(join(tmpdir(), 'launch-doctor-pm-'));

    try {
      const packageJson = JSON.stringify({ packageManager: 'pnpm@9.0.0' });
      writeFileSync(join(directory, 'package.json'), packageJson);
      writeFileSync(join(directory, 'pnpm-lock.yaml'), '');
      const report = await inspectDoctor(sampleDoctorContext({ cwd: directory }));

      expect(report.checks.some(isPnpmCheck)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports shell locale in the iOS toolchain section', async function reportsShellLocale() {
    const report = await inspectDoctor(
      sampleDoctorContext({
        platform: 'ios',
        shellLocale: { LANG: 'en_US.UTF-8' },
      }),
    );

    expect(report.checks.some(isUtf8Locale)).toBe(true);
  });

  it('advises when the shell locale is not UTF-8', async function advisesPlainLocale() {
    const report = await inspectDoctor(
      sampleDoctorContext({ platform: 'ios', shellLocale: { LANG: 'C' } }),
    );
    const locale = report.checks.find(isShellLocale);

    expect(locale?.status).toBe('info');
    expect(locale?.hint).toContain('Launch sets UTF-8');
  });

  it('fails the iOS run when an extension App ID is unregistered (#261 doctor preflight)', async function failsUnregisteredExtension() {
    const report = await inspectDoctor(
      sampleDoctorContext({
        apps: [
          {
            name: 'sampleapp',
            dir: '/apps/sampleapp',
            configPath: '/apps/sampleapp/app.json',
            bundleId: 'com.example.sampleapp',
            iosExtensions: ['com.example.sampleapp.widget'],
          },
        ],
        resolveAsc: resolveUnregisteredExtension,
      }),
    );

    expect(report.ok).toBe(false);
    expect(report.checks.some(isUnregisteredWidget)).toBe(true);
  });

  it('surfaces App Groups portal setup as advisory info in doctor', async function reportsAppGroupNotice() {
    const report = await inspectDoctor(
      sampleDoctorContext({
        apps: [
          {
            name: 'sampleapp',
            dir: '/apps/sampleapp',
            configPath: '/apps/sampleapp/app.json',
            bundleId: 'com.example.sampleapp',
            iosEntitlements: {
              'com.apple.security.application-groups': ['group.com.example.sampleapp'],
            },
          },
        ],
        resolveAsc: resolveRegisteredApp,
      }),
    );

    expect(report.ok).toBe(true);
    expect(report.checks.some(isAppGroupNotice)).toBe(true);
  });
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { LaunchConfig } from '../types/config.js';
import type { DoctorAscApi, DoctorContext, DoctorPlatform } from '../types/doctor.js';
import { inspectDoctor } from './inspect.js';
const launchConfig: LaunchConfig = {
  profiles: {},
  credentials: 'local',
  storage: 'local',
  buildEngine: 'fastlane',
  submit: 'app-store-connect',
};

const DOCTOR_PLATFORMS: readonly DoctorPlatform[] = ['ios', 'android'];

/** Build a doctor context with no network or keychain access. */
const context = (overrides: Partial<DoctorContext> = {}): DoctorContext => {
  return {
    config: launchConfig,
    apps: [],
    platform: 'ios',
    os: 'linux',
    cwd: process.cwd(),
    exists: () => Effect.succeed(true),
    gradleWrapperExists: () => Effect.succeed(false),
    resolveAsc: () => Effect.succeed(null),
    resolvePlay: () => Effect.succeed(null),
    credentialsStatus: () => Effect.succeed('no credentials'),
    codesignIdentities: () => Effect.succeed(null),
    corepackAvailable: () => Effect.succeed(true),
    ...overrides,
  };
};
/** Run the Effect-native doctor inspection for a test context. */
const runInspect = (doctorContext: DoctorContext) =>
  Effect.runPromise(inspectDoctor(doctorContext).pipe(Effect.provide(NodeContext.layer)));

/** Complete permission-probe methods shared by focused Apple doctor fakes. */
const availablePermissionReads = {
  listDistributionCertificates: () => Effect.succeed([]),
  listBetaGroups: () => Effect.succeed([]),
  listAppStoreVersions: () => Effect.succeed([]),
  listSubscriptionGroups: () => Effect.succeed([]),
  listCustomerReviews: () => Effect.succeed([]),
  listAnalyticsReportRequests: () => Effect.succeed([]),
};
describe('inspectDoctor', () => {
  it('passes a clean iOS preflight (no fails) with no accounts configured', async () => {
    const report = await runInspect(context({ platform: 'ios' }));
    expect(report.platform).toBe('ios');
    expect(report.ok).toBe(true);
    expect(
      report.checks.some((doctorCheck) => doctorCheck.title.startsWith('Package manager:')),
    ).toBe(true);
    expect(
      report.checks.some((doctorCheck) => doctorCheck.title.includes('skipping Apple checks')),
    ).toBe(true);
  });
  it('fails the Android run when the SDK and toolchain are missing', async () => {
    const report = await runInspect(
      context({
        platform: 'android',
        exists: () => Effect.succeed(false),
      }),
    );
    expect(report.platform).toBe('android');
    expect(report.ok).toBe(false);
    expect(
      report.checks.some(
        (doctorCheck) => doctorCheck.status === 'fail' && doctorCheck.title === 'Android SDK',
      ),
    ).toBe(true);
  });
  it('reports the Android SDK as ok when ANDROID_HOME is set', async () => {
    const report = await runInspect(
      context({
        platform: 'android',
        androidSdk: '/opt/android-sdk',
      }),
    );
    expect(
      report.checks.some(
        (doctorCheck) =>
          doctorCheck.status === 'ok' && doctorCheck.title.includes('/opt/android-sdk'),
      ),
    ).toBe(true);
  });
  it('isolates a throwing section as a single fail without sinking the rest', async () => {
    const report = await runInspect(
      context({
        credentialsStatus: () => Effect.fail(new Error('keychain locked')),
      }),
    );
    const failedChecks = report.checks.filter((doctorCheck) => doctorCheck.status === 'fail');
    expect(failedChecks).toEqual([
      { status: 'fail', title: 'Credentials check failed', detail: 'keychain locked' },
    ]);
    expect(report.ok).toBe(false);
    expect(
      report.checks.some((doctorCheck) => doctorCheck.title.startsWith('Package manager:')),
    ).toBe(true);
  });
  for (const platform of DOCTOR_PLATFORMS) {
    it(`always reports the package manager first for ${platform}`, async () => {
      const report = await runInspect(context({ platform }));
      expect(report.checks[0]?.title.startsWith('Package manager:')).toBe(true);
    });
  }
  it('inspects the package setup of the given cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'launch-doctor-pm-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@9.0.0' }));
      writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
      const report = await runInspect(context({ cwd: dir }));
      expect(report.checks.some((doctorCheck) => doctorCheck.title.includes('pnpm'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('reports shell locale in the iOS toolchain section', async () => {
    const report = await runInspect(
      context({
        platform: 'ios',
        shellLocale: { LANG: 'en_US.UTF-8' },
      }),
    );
    expect(
      report.checks.some((doctorCheck) => doctorCheck.title === 'Shell locale (en_US.UTF-8)'),
    ).toBe(true);
  });
  it('advises when the shell locale is not UTF-8', async () => {
    const report = await runInspect(context({ platform: 'ios', shellLocale: { LANG: 'C' } }));
    const locale = report.checks.find((c) => c.title.startsWith('Shell locale'));
    expect(locale?.status).toBe('info');
    expect(locale?.hint).toContain('Launch sets UTF-8');
  });
  it('fails the iOS run when an extension App ID is unregistered (#261 doctor preflight)', async () => {
    const report = await runInspect(
      context({
        apps: [
          {
            name: 'sampleapp',
            dir: '/apps/sampleapp',
            configPath: '/apps/sampleapp/app.json',
            bundleId: 'com.example.sampleapp',
            iosExtensions: ['com.example.sampleapp.widget'],
          },
        ],
        resolveAsc: () =>
          Effect.succeed({
            ...availablePermissionReads,
            assertReady: () => Effect.void,
            getAppId: () => Effect.succeed('app-1'),
            findBundleId: (bundleId: string) => {
              if (bundleId === 'com.example.sampleapp') {
                return Effect.succeed({ id: 'bid-main' });
              }
              return Effect.succeed(null);
            },
            listBundleIdCapabilities: () => Effect.succeed([{ capabilityType: 'APP_GROUPS' }]),
          } satisfies DoctorAscApi),
      }),
    );
    expect(report.ok).toBe(false);
    expect(
      report.checks.some(
        (check) =>
          check.status === 'fail' &&
          check.detail?.includes('com.example.sampleapp.widget') &&
          check.detail?.includes('not registered'),
      ),
    ).toBe(true);
  });
  it('surfaces App Groups portal setup as advisory info in doctor', async () => {
    const report = await runInspect(
      context({
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
        resolveAsc: () =>
          Effect.succeed({
            ...availablePermissionReads,
            assertReady: () => Effect.void,
            getAppId: () => Effect.succeed('app-1'),
            findBundleId: () => Effect.succeed({ id: 'bid-main' }),
            listBundleIdCapabilities: () => Effect.succeed([{ capabilityType: 'APP_GROUPS' }]),
          } satisfies DoctorAscApi),
      }),
    );
    expect(report.ok).toBe(true);
    expect(
      report.checks.some(
        (check) =>
          check.status === 'info' &&
          check.title === 'App Groups require portal setup' &&
          check.detail?.includes('group.com.example.sampleapp'),
      ),
    ).toBe(true);
  });
});

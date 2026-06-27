import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LaunchConfig } from '../types.js';
import { inspectDoctor } from './inspect.js';
import type { DoctorContext, DoctorPlatform } from './types.js';

/**
 * A fully-faked {@link DoctorContext} — no network, no keychain. Defaults to a healthy macOS-free machine
 * with every PATH tool present and no store accounts configured (resolvers return `null`, so the Apple and
 * Play sections record advisory skips rather than reaching out).
 */
function context(overrides: Partial<DoctorContext> = {}): DoctorContext {
  return {
    config: {} as unknown as LaunchConfig,
    apps: [],
    platform: 'ios',
    os: 'linux',
    cwd: overrides.cwd ?? process.cwd(),
    exists: async () => true,
    resolveAsc: async () => null,
    resolvePlay: async () => null,
    credentialsStatus: async () => 'no credentials',
    codesignIdentities: async () => null,
    corepackAvailable: async () => true,
    ...overrides,
  };
}

describe('inspectDoctor', () => {
  it('passes a clean iOS preflight (no fails) with no accounts configured', async () => {
    const report = await inspectDoctor(context({ platform: 'ios' }));
    expect(report.platform).toBe('ios');
    expect(report.ok).toBe(true);
    expect(report.checks.some((c) => c.title.startsWith('Package manager:'))).toBe(true);
    expect(report.checks.some((c) => c.title.includes('skipping Apple checks'))).toBe(true);
  });

  it('fails the Android run when the SDK and toolchain are missing', async () => {
    const report = await inspectDoctor(context({ platform: 'android', exists: async () => false }));
    expect(report.platform).toBe('android');
    expect(report.ok).toBe(false);
    expect(report.checks.some((c) => c.status === 'fail' && c.title === 'Android SDK')).toBe(true);
  });

  it('reports the Android SDK as ok when ANDROID_HOME is set', async () => {
    const report = await inspectDoctor(
      context({ platform: 'android', androidSdk: '/opt/android-sdk' }),
    );
    expect(
      report.checks.some((c) => c.status === 'ok' && c.title.includes('/opt/android-sdk')),
    ).toBe(true);
  });

  it('isolates a throwing section as a single fail without sinking the rest', async () => {
    const report = await inspectDoctor(
      context({
        credentialsStatus: () => {
          throw new Error('keychain locked');
        },
      }),
    );
    const failed = report.checks.filter((c) => c.status === 'fail');
    expect(failed).toEqual([
      { status: 'fail', title: 'Credentials check failed', detail: 'keychain locked' },
    ]);
    expect(report.ok).toBe(false);
    expect(report.checks.some((c) => c.title.startsWith('Package manager:'))).toBe(true);
  });

  for (const platform of ['ios', 'android'] as DoctorPlatform[]) {
    it(`always reports the package manager first for ${platform}`, async () => {
      const report = await inspectDoctor(context({ platform }));
      expect(report.checks[0]?.title.startsWith('Package manager:')).toBe(true);
    });
  }

  it('inspects the package setup of the given cwd', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'launch-doctor-pm-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@9.0.0' }));
      writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
      const report = await inspectDoctor(context({ cwd: dir }));
      expect(report.checks.some((c) => c.title.includes('pnpm'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

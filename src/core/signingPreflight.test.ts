/**
 * Tests for the shared iOS signing preflight (#261) — readiness gathering, extension resolution,
 * and the doctor/build message surfaces.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AppDescriptor } from './types.js';
import {
  appGroupPreflightNotice,
  gatherTargetSigningReadiness,
  resolveExtensionBundleIdsForApp,
  signingPreflightDoctorChecks,
  signingPreflightWarnings,
} from './signingPreflight.js';

/** Minimal realistic pbxproj fixture — same shape as {@link appleTargets.test.ts}. */
const APP_WITH_WIDGET_PBXPROJ = `// !$*UTF8*$!
{
	objects = {
		13B07F861A680F5B00A75B9A /* Looopi */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = 13B07F931A680F5B00A75B9A /* Build configuration list for PBXNativeTarget "Looopi" */;
			name = Looopi;
			productType = "com.apple.product-type.application";
		};
		A1B2C3D4E5F6A1B2C3D4E5F6 /* widget */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = E5F6A1B2C3D4E5F6A1B2C3D4 /* Build configuration list for PBXNativeTarget "widget" */;
			name = widget;
			productType = "com.apple.product-type.app-extension";
		};
		13B07F941A680F5B00A75B9A /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = com.loopi.pomedero;
			};
			name = Debug;
		};
		13B07F951A680F5B00A75B9A /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = com.loopi.pomedero;
			};
			name = Release;
		};
		AAAA1111 /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = com.loopi.pomedero.widget;
			};
			name = Debug;
		};
		BBBB2222 /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = com.loopi.pomedero.widget;
			};
			name = Release;
		};
		13B07F931A680F5B00A75B9A /* Build configuration list for PBXNativeTarget "Looopi" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				13B07F941A680F5B00A75B9A /* Debug */,
				13B07F951A680F5B00A75B9A /* Release */,
			);
		};
		E5F6A1B2C3D4E5F6A1B2C3D4 /* Build configuration list for PBXNativeTarget "widget" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				AAAA1111 /* Debug */,
				BBBB2222 /* Release */,
			);
		};
	};
}
`;

function app(overrides: Partial<AppDescriptor> = {}): AppDescriptor {
  return {
    name: 'pomedero',
    dir: '/apps/pomedero',
    configPath: '/apps/pomedero/app.json',
    bundleId: 'com.loopi.pomedero',
    ...overrides,
  };
}

describe('resolveExtensionBundleIdsForApp', () => {
  it('returns configured extensions when ios/ has not been generated yet', () => {
    const root = mkdtempSync(join(tmpdir(), 'launch-preflight-'));
    try {
      expect(
        resolveExtensionBundleIdsForApp(
          app({ dir: join(root, 'app'), iosExtensions: ['com.loopi.pomedero.widget'] }),
        ),
      ).toEqual(['com.loopi.pomedero.widget']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('discovers widget extensions from a generated ios/ project', () => {
    const root = mkdtempSync(join(tmpdir(), 'launch-preflight-'));
    try {
      const appDir = join(root, 'app');
      const projectDir = join(appDir, 'ios', 'Looopi.xcodeproj');
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, 'project.pbxproj'), APP_WITH_WIDGET_PBXPROJ);
      expect(resolveExtensionBundleIdsForApp(app({ dir: appDir }))).toEqual([
        'com.loopi.pomedero.widget',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('appGroupPreflightNotice', () => {
  it('returns the portal notice when App Groups are declared', () => {
    const notice = appGroupPreflightNotice({
      'com.apple.security.application-groups': ['group.com.loopi.pomedero'],
    });
    expect(notice).toContain('group.com.loopi.pomedero');
    expect(notice).toContain('portal-only');
    expect(notice).toContain('exit 65');
  });

  it('is null when no App Groups are declared', () => {
    expect(appGroupPreflightNotice(undefined)).toBeNull();
  });
});

describe('gatherTargetSigningReadiness', () => {
  it('marks an unregistered extension and a main app missing APP_GROUPS', async () => {
    const asc = {
      findBundleId: vi.fn(async (id: string) =>
        id === 'com.loopi.pomedero' ? { id: 'bid-main' } : null,
      ),
      listBundleIdCapabilities: vi.fn(async () => [{ capabilityType: 'PUSH_NOTIFICATIONS' }]),
    };
    const readiness = await gatherTargetSigningReadiness(
      asc,
      'com.loopi.pomedero',
      ['com.loopi.pomedero.widget'],
      { 'com.apple.security.application-groups': ['group.com.loopi.pomedero'] },
    );
    expect(readiness).toEqual([
      {
        bundleId: 'com.loopi.pomedero',
        registered: true,
        missingCapabilities: ['APP_GROUPS'],
      },
      { bundleId: 'com.loopi.pomedero.widget', registered: false, missingCapabilities: [] },
    ]);
  });
});

describe('signingPreflightWarnings', () => {
  it('delegates to multiTargetSigningWarnings', () => {
    const [warning] = signingPreflightWarnings([
      { bundleId: 'com.x.widget', registered: false, missingCapabilities: [] },
    ]);
    expect(warning).toContain('not registered');
  });
});

describe('signingPreflightDoctorChecks', () => {
  it('emits an info check for App Groups and fail checks for not-ready targets', () => {
    const checks = signingPreflightDoctorChecks(
      [
        { bundleId: 'com.loopi.pomedero', registered: true, missingCapabilities: ['APP_GROUPS'] },
        { bundleId: 'com.loopi.pomedero.widget', registered: false, missingCapabilities: [] },
      ],
      'Create group.com.loopi.pomedero in the portal.',
    );
    expect(checks).toHaveLength(3);
    expect(checks[0]).toMatchObject({
      status: 'info',
      title: 'App Groups require portal setup',
    });
    expect(checks.filter((check) => check.status === 'fail')).toHaveLength(2);
    expect(checks.some((check) => check.detail?.includes('APP_GROUPS'))).toBe(true);
    expect(checks.some((check) => check.detail?.includes('not registered'))).toBe(true);
  });

  it('is silent when every target is ready and no App Groups are declared', () => {
    expect(
      signingPreflightDoctorChecks([
        { bundleId: 'com.loopi.pomedero', registered: true, missingCapabilities: [] },
      ]),
    ).toEqual([]);
  });
});

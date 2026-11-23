import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AppDescriptor } from '../types/app.ts';
import {
  appGroupPreflightNotice,
  gatherTargetSigningReadiness,
  resolveExtensionBundleIdsForApp,
  signingPreflightDoctorChecks,
  signingPreflightWarnings,
} from './signing-preflight.ts';

function app(overrides: Partial<AppDescriptor> = {}): AppDescriptor {
  return {
    name: 'sampleapp',
    dir: '/apps/sampleapp',
    configPath: '/apps/sampleapp/app.json',
    bundleId: 'com.example.sampleapp',
    ...overrides,
  };
}
function describeResolveExtensionBundleIdsForApp() {
  async function returnsConfiguredExtensionsWhenIosHasNotBeenGeneratedYet() {
    const systemTemporaryDirectory = tmpdir();
    const launchPreflightPath = join(systemTemporaryDirectory, 'launch-preflight-');
    const root = mkdtempSync(launchPreflightPath);

    try {
      const appPath = join(root, 'app');
      const extensionBundleIdsForApp = resolveExtensionBundleIdsForApp(
        app({
          dir: appPath,
          iosExtensions: ['com.example.sampleapp.widget'],
        }),
      );

      await expect(extensionBundleIdsForApp).resolves.toEqual(['com.example.sampleapp.widget']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it(
    'returns configured extensions when ios/ has not been generated yet',
    returnsConfiguredExtensionsWhenIosHasNotBeenGeneratedYet,
  );

  async function discoversWidgetExtensionsFromAGeneratedIosProject() {
    const systemTemporaryDirectory = tmpdir();
    const launchPreflightPath = join(systemTemporaryDirectory, 'launch-preflight-');
    const root = mkdtempSync(launchPreflightPath);

    try {
      const appDir = join(root, 'app');
      const projectDir = join(appDir, 'ios', 'SampleApp.xcodeproj');

      mkdirSync(projectDir, { recursive: true });

      const projectPath = join(projectDir, 'project.pbxproj');

      writeFileSync(
        projectPath,
        `// !$*UTF8*$!
  {
  	objects = {
  		13B07F861A680F5B00A75B9A /* SampleApp */ = {
  			isa = PBXNativeTarget;
  			buildConfigurationList = 13B07F931A680F5B00A75B9A /* Build configuration list for PBXNativeTarget "SampleApp" */;
  			name = SampleApp;
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
  				PRODUCT_BUNDLE_IDENTIFIER = com.example.sampleapp;
  			};
  			name = Debug;
  		};
  		13B07F951A680F5B00A75B9A /* Release */ = {
  			isa = XCBuildConfiguration;
  			buildSettings = {
  				PRODUCT_BUNDLE_IDENTIFIER = com.example.sampleapp;
  			};
  			name = Release;
  		};
  		AAAA1111 /* Debug */ = {
  			isa = XCBuildConfiguration;
  			buildSettings = {
  				PRODUCT_BUNDLE_IDENTIFIER = com.example.sampleapp.widget;
  			};
  			name = Debug;
  		};
  		BBBB2222 /* Release */ = {
  			isa = XCBuildConfiguration;
  			buildSettings = {
  				PRODUCT_BUNDLE_IDENTIFIER = com.example.sampleapp.widget;
  			};
  			name = Release;
  		};
  		13B07F931A680F5B00A75B9A /* Build configuration list for PBXNativeTarget "SampleApp" */ = {
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
  `,
      );

      const extensionBundleIdsForApp = resolveExtensionBundleIdsForApp(app({ dir: appDir }));

      await expect(extensionBundleIdsForApp).resolves.toEqual(['com.example.sampleapp.widget']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it(
    'discovers widget extensions from a generated ios/ project',
    discoversWidgetExtensionsFromAGeneratedIosProject,
  );
}

describe('resolveExtensionBundleIdsForApp', describeResolveExtensionBundleIdsForApp);
function describeAppGroupPreflightNotice() {
  function returnsThePortalNoticeWhenAppGroupsAreDeclared() {
    const notice = appGroupPreflightNotice({
      'com.apple.security.application-groups': ['group.com.example.sampleapp'],
    });

    expect(notice).toContain('group.com.example.sampleapp');
    expect(notice).toContain('portal-only');
    expect(notice).toContain('exit 65');
  }

  it(
    'returns the portal notice when App Groups are declared',
    returnsThePortalNoticeWhenAppGroupsAreDeclared,
  );

  function isNullWhenNoAppGroupsAreDeclared() {
    expect(appGroupPreflightNotice(undefined)).toBeNull();
  }

  it('is null when no App Groups are declared', isNullWhenNoAppGroupsAreDeclared);
}

describe('appGroupPreflightNotice', describeAppGroupPreflightNotice);
function describeGatherTargetSigningReadiness() {
  async function marksAnUnregisteredExtensionAndAMainAppMissingAPPGROUPS() {
    const asc = {
      findBundleId: vi.fn(function findBundleId(identifier: string) {
        if (identifier == 'com.example.sampleapp') {
          return Promise.resolve({ id: 'bid-main' });
        }

        return Promise.resolve(null);
      }),
      listBundleIdCapabilities: vi.fn(function listBundleIdCapabilities() {
        return Promise.resolve([{ capabilityType: 'PUSH_NOTIFICATIONS' }]);
      }),
    };

    const readiness = await gatherTargetSigningReadiness(
      asc,
      'com.example.sampleapp',
      ['com.example.sampleapp.widget'],
      {
        'com.apple.security.application-groups': ['group.com.example.sampleapp'],
      },
    );

    expect(readiness).toEqual([
      {
        bundleId: 'com.example.sampleapp',
        registered: true,
        missingCapabilities: ['APP_GROUPS'],
      },
      { bundleId: 'com.example.sampleapp.widget', registered: false, missingCapabilities: [] },
    ]);
  }

  it(
    'marks an unregistered extension and a main app missing APP_GROUPS',
    marksAnUnregisteredExtensionAndAMainAppMissingAPPGROUPS,
  );
}

describe('gatherTargetSigningReadiness', describeGatherTargetSigningReadiness);
function describeSigningPreflightWarnings() {
  function delegatesToMultiTargetSigningWarnings() {
    const [warning] = signingPreflightWarnings([
      { bundleId: 'com.x.widget', registered: false, missingCapabilities: [] },
    ]);

    expect(warning).toContain('not registered');
  }

  it('delegates to multiTargetSigningWarnings', delegatesToMultiTargetSigningWarnings);
}

describe('signingPreflightWarnings', describeSigningPreflightWarnings);
function describeSigningPreflightDoctorChecks() {
  function emitsAnPieceCheckForAppGroupsAndFailChecksForNotReadyTargets() {
    const checks = signingPreflightDoctorChecks(
      [
        {
          bundleId: 'com.example.sampleapp',
          registered: true,
          missingCapabilities: ['APP_GROUPS'],
        },
        { bundleId: 'com.example.sampleapp.widget', registered: false, missingCapabilities: [] },
      ],
      'Create group.com.example.sampleapp in the portal.',
    );

    expect(checks).toHaveLength(3);
    expect(checks[0]).toMatchObject({
      status: 'info',
      title: 'App Groups require portal setup',
    });

    function filterCheck(check: {
      readonly status: 'ok' | 'info' | 'fail';
      readonly title: string;
      readonly detail?: string;
      readonly hint?: string;
    }) {
      return check.status == 'fail';
    }

    expect(checks.filter(filterCheck)).toHaveLength(2);

    function someCheck(check: {
      readonly status: 'ok' | 'info' | 'fail';
      readonly title: string;
      readonly detail?: string;
      readonly hint?: string;
    }) {
      return check.detail?.includes('APP_GROUPS');
    }

    expect(checks.some(someCheck)).toBe(true);

    function someCheck2(check: {
      readonly status: 'ok' | 'info' | 'fail';
      readonly title: string;
      readonly detail?: string;
      readonly hint?: string;
    }) {
      return check.detail?.includes('not registered');
    }

    expect(checks.some(someCheck2)).toBe(true);
  }

  it(
    'emits an info check for App Groups and fail checks for not-ready targets',
    emitsAnPieceCheckForAppGroupsAndFailChecksForNotReadyTargets,
  );

  function isSilentWhenEveryTargetIsReadyAndNoAppGroupsAreDeclared() {
    expect(
      signingPreflightDoctorChecks([
        { bundleId: 'com.example.sampleapp', registered: true, missingCapabilities: [] },
      ]),
    ).toEqual([]);
  }

  it(
    'is silent when every target is ready and no App Groups are declared',
    isSilentWhenEveryTargetIsReadyAndNoAppGroupsAreDeclared,
  );
}

describe('signingPreflightDoctorChecks', describeSigningPreflightDoctorChecks);

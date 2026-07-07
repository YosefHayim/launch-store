/**
 * Tests for the pbxproj target-discovery parser (#261, sub-problem #2). Pure string parsing, fed inline
 * `project.pbxproj` fixtures shaped like Expo + `@bacons/apple-targets` output. The hard guarantee under
 * test: a single-target app yields exactly the main app and ZERO extensions, so a no-extension build is
 * provisioned identically to before — while a main-app-plus-widget project surfaces both bundle ids and
 * marks the widget as the extension to provision.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverExtensionBundleIds,
  findPbxproj,
  multiTargetSigningWarnings,
  parsePbxprojTargets,
  splitMainAndExtensions,
  stampManualSigningIntoPbxproj,
  writeManualSigningToProject,
} from './appleTargets.js';

/** A minimal but realistic pbxproj for a main app plus one `@bacons/apple-targets` widget extension. */
const APP_WITH_WIDGET = `// !$*UTF8*$!
{
	objects = {
/* Begin PBXNativeTarget section */
		13B07F861A680F5B00A75B9A /* SampleApp */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = 13B07F931A680F5B00A75B9A /* Build configuration list for PBXNativeTarget "SampleApp" */;
			buildPhases = (
			);
			name = SampleApp;
			productName = SampleApp;
			productReference = 13B07F961A680F5B00A75B9A /* SampleApp.app */;
			productType = "com.apple.product-type.application";
		};
		A1B2C3D4E5F6A1B2C3D4E5F6 /* widget */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = E5F6A1B2C3D4E5F6A1B2C3D4 /* Build configuration list for PBXNativeTarget "widget" */;
			buildPhases = (
			);
			name = widget;
			productName = widget;
			productType = "com.apple.product-type.app-extension";
		};
/* End PBXNativeTarget section */

/* Begin XCBuildConfiguration section */
		13B07F941A680F5B00A75B9A /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				PRODUCT_BUNDLE_IDENTIFIER = com.example.sampleapp;
				PRODUCT_NAME = SampleApp;
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
				PRODUCT_NAME = widget;
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
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
		13B07F931A680F5B00A75B9A /* Build configuration list for PBXNativeTarget "SampleApp" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				13B07F941A680F5B00A75B9A /* Debug */,
				13B07F951A680F5B00A75B9A /* Release */,
			);
			defaultConfigurationIsVisible = 0;
		};
		E5F6A1B2C3D4E5F6A1B2C3D4 /* Build configuration list for PBXNativeTarget "widget" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				AAAA1111 /* Debug */,
				BBBB2222 /* Release */,
			);
			defaultConfigurationIsVisible = 0;
		};
/* End XCConfigurationList section */
	};
}
`;

/** The same project shape with only the main app target — a single-target Expo app. */
const SINGLE_TARGET = `// !$*UTF8*$!
{
	objects = {
/* Begin PBXNativeTarget section */
		13B07F861A680F5B00A75B9A /* SampleApp */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = 13B07F931A680F5B00A75B9A /* Build configuration list for PBXNativeTarget "SampleApp" */;
			name = SampleApp;
			productType = "com.apple.product-type.application";
		};
/* End PBXNativeTarget section */

/* Begin XCBuildConfiguration section */
		13B07F941A680F5B00A75B9A /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = com.example.sampleapp;
			};
			name = Debug;
		};
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
		13B07F931A680F5B00A75B9A /* Build configuration list for PBXNativeTarget "SampleApp" */ = {
			isa = XCConfigurationList;
			buildConfigurations = (
				13B07F941A680F5B00A75B9A /* Debug */,
			);
		};
/* End XCConfigurationList section */
	};
}
`;

describe('parsePbxprojTargets — read each target bundle id from the pbxproj', () => {
  it('returns the main app and the widget extension with their authoritative bundle ids', () => {
    const targets = parsePbxprojTargets(APP_WITH_WIDGET);
    expect(targets).toEqual([
      {
        name: 'SampleApp',
        bundleId: 'com.example.sampleapp',
        productType: 'com.apple.product-type.application',
      },
      {
        name: 'widget',
        bundleId: 'com.example.sampleapp.widget',
        productType: 'com.apple.product-type.app-extension',
      },
    ]);
  });

  it('returns exactly the one main target for a single-target app', () => {
    expect(parsePbxprojTargets(SINGLE_TARGET)).toEqual([
      {
        name: 'SampleApp',
        bundleId: 'com.example.sampleapp',
        productType: 'com.apple.product-type.application',
      },
    ]);
  });

  it('omits a target whose bundle id is still an unexpanded $(…) variable', () => {
    const withVariable = APP_WITH_WIDGET.replace(
      /PRODUCT_BUNDLE_IDENTIFIER = com.example.sampleapp.widget;/g,
      'PRODUCT_BUNDLE_IDENTIFIER = "$(PRODUCT_BUNDLE_IDENTIFIER).widget";',
    );
    expect(parsePbxprojTargets(withVariable).map((t) => t.bundleId)).toEqual([
      'com.example.sampleapp',
    ]);
  });

  it('returns nothing for an empty or non-pbxproj string', () => {
    expect(parsePbxprojTargets('')).toEqual([]);
    expect(parsePbxprojTargets('not a project file')).toEqual([]);
  });
});

describe('splitMainAndExtensions — separate the app from its extensions', () => {
  it('picks the application product type as main and the rest as extensions', () => {
    const { main, extensions } = splitMainAndExtensions(parsePbxprojTargets(APP_WITH_WIDGET));
    expect(main).toBe('com.example.sampleapp');
    expect(extensions).toEqual(['com.example.sampleapp.widget']);
  });

  it('yields zero extensions for a single-target app (byte-identical to today)', () => {
    const { main, extensions } = splitMainAndExtensions(parsePbxprojTargets(SINGLE_TARGET));
    expect(main).toBe('com.example.sampleapp');
    expect(extensions).toEqual([]);
  });

  it('treats a known main bundle id as the app even when product types are ambiguous', () => {
    const targets = [
      {
        name: 'widget',
        bundleId: 'com.x.widget',
        productType: 'com.apple.product-type.app-extension',
      },
      { name: 'App', bundleId: 'com.x', productType: 'com.apple.product-type.app-extension' },
    ];
    const { main, extensions } = splitMainAndExtensions(targets, 'com.x');
    expect(main).toBe('com.x');
    expect(extensions).toEqual(['com.x.widget']);
  });
});

describe('discoverExtensionBundleIds — locate and read the generated project', () => {
  /** Write a fixture pbxproj into a throwaway `<dir>/<name>.xcodeproj/project.pbxproj`. */
  function seedProject(nativeDir: string, projectName: string, pbxproj: string): void {
    const projectDir = join(nativeDir, `${projectName}.xcodeproj`);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'project.pbxproj'), pbxproj);
  }

  it('discovers the widget extension from a generated ios/ project', () => {
    const root = mkdtempSync(join(tmpdir(), 'launch-targets-'));
    try {
      const nativeDir = join(root, 'ios');
      seedProject(nativeDir, 'SampleApp', APP_WITH_WIDGET);
      expect(discoverExtensionBundleIds(nativeDir, 'com.example.sampleapp')).toEqual([
        'com.example.sampleapp.widget',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns [] for a single-target project (no extensions to provision)', () => {
    const root = mkdtempSync(join(tmpdir(), 'launch-targets-'));
    try {
      const nativeDir = join(root, 'ios');
      seedProject(nativeDir, 'SampleApp', SINGLE_TARGET);
      expect(discoverExtensionBundleIds(nativeDir, 'com.example.sampleapp')).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns [] when the native project has not been generated yet', () => {
    const root = mkdtempSync(join(tmpdir(), 'launch-targets-'));
    try {
      expect(discoverExtensionBundleIds(join(root, 'ios'), 'com.example.sampleapp')).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('multiTargetSigningWarnings — preflight before the long archive (#261)', () => {
  it('is silent when every target is registered with its capabilities (single-target unchanged)', () => {
    expect(
      multiTargetSigningWarnings([
        { bundleId: 'com.example.sampleapp', registered: true, missingCapabilities: [] },
      ]),
    ).toEqual([]);
  });

  it('warns, by name, about an unregistered extension App ID and points at creds setup', () => {
    const [warning] = multiTargetSigningWarnings([
      { bundleId: 'com.example.sampleapp', registered: true, missingCapabilities: [] },
      { bundleId: 'com.example.sampleapp.widget', registered: false, missingCapabilities: [] },
    ]);
    expect(warning).toContain('com.example.sampleapp.widget');
    expect(warning).toContain('not registered');
    expect(warning).toContain('exit 65');
    expect(warning).toContain('launch creds setup --app');
  });

  it('warns about a target whose App ID is missing a required capability', () => {
    const [warning] = multiTargetSigningWarnings([
      { bundleId: 'com.example.sampleapp', registered: true, missingCapabilities: ['APP_GROUPS'] },
    ]);
    expect(warning).toContain('com.example.sampleapp');
    expect(warning).toContain('APP_GROUPS');
    expect(warning).toContain('exit 65');
  });

  it('emits one warning per not-ready target', () => {
    expect(
      multiTargetSigningWarnings([
        { bundleId: 'com.x', registered: false, missingCapabilities: [] },
        { bundleId: 'com.x.widget', registered: true, missingCapabilities: ['APP_GROUPS'] },
      ]),
    ).toHaveLength(2);
  });
});

describe('findPbxproj — locate the project file in a native dir', () => {
  it('finds the .xcodeproj/project.pbxproj and returns null when absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'launch-targets-'));
    try {
      expect(findPbxproj(join(root, 'ios'))).toBeNull();
      const projectDir = join(root, 'ios', 'SampleApp.xcodeproj');
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, 'project.pbxproj'), SINGLE_TARGET);
      expect(findPbxproj(join(root, 'ios'))).toBe(join(projectDir, 'project.pbxproj'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const TEAM = 'ABCDE12345';
const MAIN_PROFILE = 'Launch_com.example.sampleapp_AppStore';
const WIDGET_PROFILE = 'Launch_com.example.sampleapp.widget_AppStore';
const SIGNING = {
  teamId: TEAM,
  profileByBundleId: {
    'com.example.sampleapp': MAIN_PROFILE,
    'com.example.sampleapp.widget': WIDGET_PROFILE,
  },
};

/** Count non-overlapping occurrences of a literal substring. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('stampManualSigningIntoPbxproj — per-target manual signing for a multi-target archive (#289)', () => {
  it('stamps the main and widget Release configs with Manual signing and their own profiles', () => {
    const stamped = stampManualSigningIntoPbxproj(APP_WITH_WIDGET, SIGNING);
    expect(stamped).toContain(`PROVISIONING_PROFILE_SPECIFIER = "${MAIN_PROFILE}";`);
    expect(stamped).toContain(`PROVISIONING_PROFILE_SPECIFIER = "${WIDGET_PROFILE}";`);
    expect(stamped).toContain(`DEVELOPMENT_TEAM = ${TEAM};`);
    // Exactly the two Release configs are touched — never the two Debug configs.
    expect(occurrences(stamped, 'CODE_SIGN_STYLE = Manual;')).toBe(2);
    expect(occurrences(stamped, 'PROVISIONING_PROFILE_SPECIFIER = ')).toBe(2);
  });

  it('leaves the target structure (bundle ids) intact after rewriting', () => {
    const stamped = stampManualSigningIntoPbxproj(APP_WITH_WIDGET, SIGNING);
    expect(parsePbxprojTargets(stamped)).toEqual(parsePbxprojTargets(APP_WITH_WIDGET));
  });

  it('is idempotent — a second stamp changes nothing (managed keys replaced, not appended)', () => {
    const once = stampManualSigningIntoPbxproj(APP_WITH_WIDGET, SIGNING);
    expect(stampManualSigningIntoPbxproj(once, SIGNING)).toBe(once);
  });

  it('touches only targets it has a profile for (widget left alone when its profile is absent)', () => {
    const mainOnly = stampManualSigningIntoPbxproj(APP_WITH_WIDGET, {
      teamId: TEAM,
      profileByBundleId: { 'com.example.sampleapp': MAIN_PROFILE },
    });
    expect(occurrences(mainOnly, 'CODE_SIGN_STYLE = Manual;')).toBe(1);
    expect(mainOnly).toContain(MAIN_PROFILE);
    expect(mainOnly).not.toContain(WIDGET_PROFILE);
  });

  it('returns the input unchanged when no bundle id matches a profile', () => {
    const untouched = stampManualSigningIntoPbxproj(APP_WITH_WIDGET, {
      teamId: TEAM,
      profileByBundleId: {},
    });
    expect(untouched).toBe(APP_WITH_WIDGET);
  });

  it('inserts the managed keys inside buildSettings, before its close and the config name', () => {
    const stamped = stampManualSigningIntoPbxproj(APP_WITH_WIDGET, SIGNING);
    // In the widget Release config, the specifier sits inside buildSettings (before its `};`), which in
    // turn sits before `name = Release;` — proving we edited the dict, not appended after the object.
    const widgetRelease = stamped.slice(stamped.indexOf('BBBB2222'));
    const specifierAt = widgetRelease.indexOf(
      `PROVISIONING_PROFILE_SPECIFIER = "${WIDGET_PROFILE}";`,
    );
    const buildSettingsCloseAt = widgetRelease.indexOf('};');
    const nameAt = widgetRelease.indexOf('name = Release;');
    expect(specifierAt).toBeGreaterThan(-1);
    expect(specifierAt).toBeLessThan(buildSettingsCloseAt);
    expect(buildSettingsCloseAt).toBeLessThan(nameAt);
  });
});

describe('writeManualSigningToProject — stamp the generated project on disk', () => {
  it('rewrites the pbxproj and reports the change, then no-ops on a second run', () => {
    const root = mkdtempSync(join(tmpdir(), 'launch-targets-'));
    try {
      const nativeDir = join(root, 'ios');
      const projectDir = join(nativeDir, 'SampleApp.xcodeproj');
      mkdirSync(projectDir, { recursive: true });
      const pbxproj = join(projectDir, 'project.pbxproj');
      writeFileSync(pbxproj, APP_WITH_WIDGET);

      expect(writeManualSigningToProject(nativeDir, SIGNING)).toBe(true);
      expect(readFileSync(pbxproj, 'utf8')).toContain(
        `PROVISIONING_PROFILE_SPECIFIER = "${WIDGET_PROFILE}";`,
      );
      // Idempotent on disk: the second run finds nothing to change.
      expect(writeManualSigningToProject(nativeDir, SIGNING)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns false when the native project has not been generated yet', () => {
    const root = mkdtempSync(join(tmpdir(), 'launch-targets-'));
    try {
      expect(writeManualSigningToProject(join(root, 'ios'), SIGNING)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

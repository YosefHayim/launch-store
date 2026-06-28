/**
 * Tests for the pbxproj target-discovery parser (#261, sub-problem #2). Pure string parsing, fed inline
 * `project.pbxproj` fixtures shaped like Expo + `@bacons/apple-targets` output. The hard guarantee under
 * test: a single-target app yields exactly the main app and ZERO extensions, so a no-extension build is
 * provisioned identically to before — while a main-app-plus-widget project surfaces both bundle ids and
 * marks the widget as the extension to provision.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverExtensionBundleIds,
  findPbxproj,
  multiTargetSigningWarnings,
  parsePbxprojTargets,
  splitMainAndExtensions,
} from './appleTargets.js';

/** A minimal but realistic pbxproj for a main app plus one `@bacons/apple-targets` widget extension. */
const APP_WITH_WIDGET = `// !$*UTF8*$!
{
	objects = {
/* Begin PBXNativeTarget section */
		13B07F861A680F5B00A75B9A /* Looopi */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = 13B07F931A680F5B00A75B9A /* Build configuration list for PBXNativeTarget "Looopi" */;
			buildPhases = (
			);
			name = Looopi;
			productName = Looopi;
			productReference = 13B07F961A680F5B00A75B9A /* Looopi.app */;
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
				PRODUCT_BUNDLE_IDENTIFIER = com.loopi.pomedero;
				PRODUCT_NAME = Looopi;
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
				PRODUCT_NAME = widget;
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
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
		13B07F931A680F5B00A75B9A /* Build configuration list for PBXNativeTarget "Looopi" */ = {
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
		13B07F861A680F5B00A75B9A /* Looopi */ = {
			isa = PBXNativeTarget;
			buildConfigurationList = 13B07F931A680F5B00A75B9A /* Build configuration list for PBXNativeTarget "Looopi" */;
			name = Looopi;
			productType = "com.apple.product-type.application";
		};
/* End PBXNativeTarget section */

/* Begin XCBuildConfiguration section */
		13B07F941A680F5B00A75B9A /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				PRODUCT_BUNDLE_IDENTIFIER = com.loopi.pomedero;
			};
			name = Debug;
		};
/* End XCBuildConfiguration section */

/* Begin XCConfigurationList section */
		13B07F931A680F5B00A75B9A /* Build configuration list for PBXNativeTarget "Looopi" */ = {
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
        name: 'Looopi',
        bundleId: 'com.loopi.pomedero',
        productType: 'com.apple.product-type.application',
      },
      {
        name: 'widget',
        bundleId: 'com.loopi.pomedero.widget',
        productType: 'com.apple.product-type.app-extension',
      },
    ]);
  });

  it('returns exactly the one main target for a single-target app', () => {
    expect(parsePbxprojTargets(SINGLE_TARGET)).toEqual([
      {
        name: 'Looopi',
        bundleId: 'com.loopi.pomedero',
        productType: 'com.apple.product-type.application',
      },
    ]);
  });

  it('omits a target whose bundle id is still an unexpanded $(…) variable', () => {
    const withVariable = APP_WITH_WIDGET.replace(
      /PRODUCT_BUNDLE_IDENTIFIER = com.loopi.pomedero.widget;/g,
      'PRODUCT_BUNDLE_IDENTIFIER = "$(PRODUCT_BUNDLE_IDENTIFIER).widget";',
    );
    expect(parsePbxprojTargets(withVariable).map((t) => t.bundleId)).toEqual([
      'com.loopi.pomedero',
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
    expect(main).toBe('com.loopi.pomedero');
    expect(extensions).toEqual(['com.loopi.pomedero.widget']);
  });

  it('yields zero extensions for a single-target app (byte-identical to today)', () => {
    const { main, extensions } = splitMainAndExtensions(parsePbxprojTargets(SINGLE_TARGET));
    expect(main).toBe('com.loopi.pomedero');
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
      seedProject(nativeDir, 'Looopi', APP_WITH_WIDGET);
      expect(discoverExtensionBundleIds(nativeDir, 'com.loopi.pomedero')).toEqual([
        'com.loopi.pomedero.widget',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns [] for a single-target project (no extensions to provision)', () => {
    const root = mkdtempSync(join(tmpdir(), 'launch-targets-'));
    try {
      const nativeDir = join(root, 'ios');
      seedProject(nativeDir, 'Looopi', SINGLE_TARGET);
      expect(discoverExtensionBundleIds(nativeDir, 'com.loopi.pomedero')).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns [] when the native project has not been generated yet', () => {
    const root = mkdtempSync(join(tmpdir(), 'launch-targets-'));
    try {
      expect(discoverExtensionBundleIds(join(root, 'ios'), 'com.loopi.pomedero')).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('multiTargetSigningWarnings — preflight before the long archive (#261)', () => {
  it('is silent when every target is registered with its capabilities (single-target unchanged)', () => {
    expect(
      multiTargetSigningWarnings([
        { bundleId: 'com.loopi.pomedero', registered: true, missingCapabilities: [] },
      ]),
    ).toEqual([]);
  });

  it('warns, by name, about an unregistered extension App ID and points at creds setup', () => {
    const [warning] = multiTargetSigningWarnings([
      { bundleId: 'com.loopi.pomedero', registered: true, missingCapabilities: [] },
      { bundleId: 'com.loopi.pomedero.widget', registered: false, missingCapabilities: [] },
    ]);
    expect(warning).toContain('com.loopi.pomedero.widget');
    expect(warning).toContain('not registered');
    expect(warning).toContain('exit 65');
    expect(warning).toContain('launch creds setup --app');
  });

  it('warns about a target whose App ID is missing a required capability', () => {
    const [warning] = multiTargetSigningWarnings([
      { bundleId: 'com.loopi.pomedero', registered: true, missingCapabilities: ['APP_GROUPS'] },
    ]);
    expect(warning).toContain('com.loopi.pomedero');
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
      const projectDir = join(root, 'ios', 'Looopi.xcodeproj');
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(join(projectDir, 'project.pbxproj'), SINGLE_TARGET);
      expect(findPbxproj(join(root, 'ios'))).toBe(join(projectDir, 'project.pbxproj'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

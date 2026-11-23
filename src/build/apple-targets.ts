import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '../path-exists.ts';

/** One build target discovered in a generated Xcode project's `project.pbxproj` */
type DiscoveredTarget = Readonly<{
  name: string;
  bundleId: string;
  productType: string;
}>;

/** One target's signing readiness, as established by the build preflight before the long archive */
export type TargetSigningReadiness = {
  bundleId: string;
  registered: boolean;
  missingCapabilities: string[];
};

/** A `PBXNativeTarget` object, mid-parse, before its bundle id is resolved through the config list. */
type NativeTargetRef = {
  name: string;
  buildConfigurationListId: string;
  productType: string;
};

/** Read one parser line without leaking undefined into regex operations. */
function lineAt(lines: readonly string[], lineIndex: number): string {
  const sourceLine = lines[lineIndex];

  if (sourceLine == null) return '';

  return sourceLine;
}

/** Pull the object id assigned on a line like `<key> = <id> /* ... */
function assignedId(line: string): string | null {
  const match = /[=]\s*([^\s;]+)/.exec(line);
  const assignedIdentifier = match?.[1];

  if (assignedIdentifier == null) return null;

  return assignedIdentifier;
}

/** Pull a bare `<key> = <value>;` string value (e.g. */
function stringValue(line: string, key: string): string | null {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*"?([^";]+)"?\\s*;`).exec(line);
  const assignedText = match?.[1]?.trim();

  if (assignedText == null) return null;

  return assignedText;
}

/** Parse every `PBXNativeTarget` block */
function parseNativeTargets(lines: string[]): NativeTargetRef[] {
  const targets: NativeTargetRef[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!/isa\s*=\s*PBXNativeTarget;/.test(lineAt(lines, i))) continue;

    let name: string | null = null;
    let buildConfigurationListId: string | null = null;
    let productType: string | null = null;

    // The object's fields sit between its `isa` line and the closing `};` at the same indent.
    for (let j = i + 1; j < lines.length; j++) {
      const line = lineAt(lines, j);

      if (/^\s*};/.test(line)) break;

      if (name == null) name = stringValue(line, 'name');

      if (productType == null) productType = stringValue(line, 'productType');

      if (/^\s*buildConfigurationList\s*=/.test(line) && buildConfigurationListId == null)
        buildConfigurationListId = assignedId(line);
    }

    if (name != null && buildConfigurationListId != null) {
      let resolvedProductType = '';

      if (productType != null) resolvedProductType = productType;

      targets.push({
        name,
        buildConfigurationListId,
        productType: resolvedProductType,
      });
    }
  }

  return targets;
}

/** Map each `XCConfigurationList` object id to the `XCBuildConfiguration` object ids it lists. */
function parseConfigurationLists(lines: string[]): Map<string, string[]> {
  const lists = new Map<string, string[]>();

  for (let i = 0; i < lines.length; i++) {
    const header = /^\s*([0-9A-Fa-f]+)\b.*=\s*\{/.exec(lineAt(lines, i));

    if (!(header && /isa\s*=\s*XCConfigurationList;/.test(lineAt(lines, i + 1)))) continue;

    const configIds: string[] = [];
    let inList = false;

    for (let j = i + 1; j < lines.length; j++) {
      const line = lineAt(lines, j);

      if (/^\s*};/.test(line)) break;

      if (/buildConfigurations\s*=\s*\(/.test(line)) {
        inList = true;
        continue;
      }

      if (inList) {
        if (line.includes(')')) break;

        const id = line.trim().split(/\s/)[0];

        if (id) configIds.push(id);
      }
    }

    if (header[1]) lists.set(header[1], configIds);
  }

  return lists;
}

/** Map each `XCBuildConfiguration` object id to its `PRODUCT_BUNDLE_IDENTIFIER` */
function parseBundleIdsByConfig(lines: string[]): Map<string, string> {
  const bundleIds = new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const header = /^\s*([0-9A-Fa-f]+)\b.*=\s*\{/.exec(lineAt(lines, i));

    if (!(header && /isa\s*=\s*XCBuildConfiguration;/.test(lineAt(lines, i + 1)))) continue;

    for (let j = i + 1; j < lines.length; j++) {
      const line = lineAt(lines, j);

      if (/^\s*};/.test(line)) break;

      const bundleIdentifier = stringValue(line, 'PRODUCT_BUNDLE_IDENTIFIER');

      if (bundleIdentifier && !bundleIdentifier.includes('$(') && header[1]) {
        bundleIds.set(header[1], bundleIdentifier);
        break;
      }
    }
  }

  return bundleIds;
}

export function parsePbxprojTargets(pbxproj: string): DiscoveredTarget[] {
  const lines = pbxproj.split('\n');
  const configLists = parseConfigurationLists(lines);
  const bundleIdsByConfig = parseBundleIdsByConfig(lines);

  function listTargetWithBundle(target: {
    name: string;
    buildConfigurationListId: string;
    productType: string;
  }) {
    let configIds: string[] = [];
    const configuredIds = configLists.get(target.buildConfigurationListId);

    if (configuredIds != null) configIds = configuredIds;

    function readBundleFromSetting(id: string) {
      return bundleIdsByConfig.get(id);
    }

    function isSettingPresent(id: string | undefined) {
      return id != null;
    }

    const bundleId = configIds.map(readBundleFromSetting).find(isSettingPresent);

    if (bundleId == null) return [];

    return [{ name: target.name, bundleId, productType: target.productType }];
  }

  return parseNativeTargets(lines).flatMap(listTargetWithBundle);
}

export function splitMainAndExtensions(
  targets: DiscoveredTarget[],
  mainBundleId?: string,
): {
  main: string | undefined;
  extensions: string[];
} {
  function hasMainBundle(target: {
    readonly name: string;
    readonly bundleId: string;
    readonly productType: string;
  }) {
    return target.bundleId == mainBundleId;
  }

  let main = targets.find(hasMainBundle)?.bundleId;

  if (main == null) {
    function isAppProduct(target: {
      readonly name: string;
      readonly bundleId: string;
      readonly productType: string;
    }) {
      return target.productType == 'com.apple.product-type.application';
    }

    /** The Xcode product type marking the primary app target (everything else is an embedded extension). */
    main = targets.find(isAppProduct)?.bundleId;
  }

  function isNotMainTarget(target: {
    readonly name: string;
    readonly bundleId: string;
    readonly productType: string;
  }) {
    return target.bundleId != main;
  }

  function readBundleId(target: {
    readonly name: string;
    readonly bundleId: string;
    readonly productType: string;
  }) {
    return target.bundleId;
  }

  const extensions = targets.filter(isNotMainTarget).map(readBundleId);

  // De-dupe in case Debug/Release configs surfaced the same extension twice, preserving first-seen order.
  return { main, extensions: [...new Set(extensions)] };
}

/** Locate the `*.xcodeproj/project.pbxproj` inside a generated native project directory (e.g. */
function isXcodeProject(directoryName: string): boolean {
  return directoryName.endsWith('.xcodeproj');
}

export async function findPbxproj(nativeDirectory: string): Promise<string | null> {
  const directoryExists = await pathExists(nativeDirectory);

  if (directoryExists == false) {
    return null;
  }

  const directoryEntries = await readdir(nativeDirectory);
  const projectDirectory = directoryEntries.find(isXcodeProject);

  if (projectDirectory == null) {
    return null;
  }

  const projectFile = join(nativeDirectory, projectDirectory, 'project.pbxproj');
  const projectExists = await pathExists(projectFile);

  if (projectExists == false) {
    return null;
  }

  return projectFile;
}

export async function discoverExtensionBundleIds(
  nativeDirectory: string,
  mainBundleId?: string,
): Promise<string[]> {
  const projectFile = await findPbxproj(nativeDirectory);

  if (projectFile == null) {
    return [];
  }

  const projectText = await readFile(projectFile, 'utf8');
  const targets = parsePbxprojTargets(projectText);

  return splitMainAndExtensions(targets, mainBundleId).extensions;
}

export function multiTargetSigningWarnings(readiness: readonly TargetSigningReadiness[]): string[] {
  const warnings: string[] = [];

  for (const target of readiness) {
    if (!target.registered) {
      warnings.push(
        `Signing preflight: App ID "${target.bundleId}" is not registered yet - the archive will fail ` +
          'to sign this target (exit 65). Run `launch-store creds setup --app <name>` to register and provision it first.',
      );

      continue;
    }

    if (target.missingCapabilities.length > 0) {
      warnings.push(
        `Signing preflight: App ID "${target.bundleId}" is missing the ${target.missingCapabilities.join(', ')} ` +
          `capability its entitlements require - its provisioning profile won't carry the entitlement and the ` +
          'archive will fail (exit 65). Run `launch-store creds setup --app <name>` to enable it and regenerate the profile.',
      );
    }
  }

  return warnings;
}

/** The per-target manual-signing inputs stamped into a multi-target project before archiving */
type ManualSigningTargets = {
  teamId: string;
  profileByBundleId: Record<string, string>;
};

/** Count the net brace balance a line contributes (`{` opens minus `}` closes) - the pbxproj is brace-nested. */
function braceDelta(line: string): number {
  let openingBraces = line.match(/\{/g)?.length;

  if (openingBraces == null) openingBraces = 0;

  let closingBraces = line.match(/\}/g)?.length;

  if (closingBraces == null) closingBraces = 0;

  return openingBraces - closingBraces;
}

/** Map each `XCBuildConfiguration` object id to its `name` (`Debug` / `Release` / ...). */
function parseConfigNames(lines: string[]): Map<string, string> {
  const names = new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const header = /^\s*([0-9A-Fa-f]+)\b.*=\s*\{/.exec(lineAt(lines, i));

    if (!(header?.[1] && /isa\s*=\s*XCBuildConfiguration;/.test(lineAt(lines, i + 1)))) continue;

    let depth = 1;

    for (let j = i + 1; j < lines.length && depth > 0; j++) {
      const line = lineAt(lines, j);
      let name: string | null = null;

      if (depth == 1) name = stringValue(line, 'name');

      if (name) {
        names.set(header[1], name);
        break;
      }

      depth += braceDelta(line);
    }
  }

  return names;
}

/** For every target that has a resolved profile */
function releaseConfigProfiles(
  lines: string[],
  profileByBundleId: Record<string, string>,
): Map<string, string> {
  const configLists = parseConfigurationLists(lines);
  const configNames = parseConfigNames(lines);
  const bundleIdsByConfig = parseBundleIdsByConfig(lines);
  const profilesByReleaseConfiguration = new Map<string, string>();

  for (const target of parseNativeTargets(lines)) {
    let configIds: string[] = [];
    const configuredIds = configLists.get(target.buildConfigurationListId);

    if (configuredIds != null) configIds = configuredIds;

    function isReleaseSetting(id: string) {
      return configNames.get(id) == 'Release';
    }

    const releaseConfigId = configIds.find(isReleaseSetting);

    function readBundleFromSetting(id: string) {
      return bundleIdsByConfig.get(id);
    }

    function isSettingPresent(id: string | undefined) {
      return id != null;
    }

    const bundleId = configIds.map(readBundleFromSetting).find(isSettingPresent);
    let profileName: string | undefined;

    if (bundleId != null) profileName = profileByBundleId[bundleId];

    if (releaseConfigId && profileName)
      profilesByReleaseConfiguration.set(releaseConfigId, profileName);
  }

  return profilesByReleaseConfiguration;
}

/** Stamp per-target manual signing into a project's `project.pbxproj` and return the rewritten */
export function stampManualSigningIntoPbxproj(
  pbxproj: string,
  signing: ManualSigningTargets,
): string {
  const lines = pbxproj.split('\n');
  const releaseProfiles = releaseConfigProfiles(lines, signing.profileByBundleId);

  if (releaseProfiles.size == 0) return pbxproj;

  const out: string[] = [];
  /** Profile of the wanted Release config we're currently inside, or null when outside any. */
  let profile: string | null = null;
  /** Brace depth relative to that config object's opening `{` (1 = object body, 2 = its buildSettings). */
  let depth = 0;
  let inBuildSettings = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lineAt(lines, i);

    if (profile == null) {
      const id = /^\s*([0-9A-Fa-f]+)\b.*=\s*\{\s*$/.exec(line)?.[1];

      if (
        id &&
        releaseProfiles.has(id) &&
        /isa\s*=\s*XCBuildConfiguration;/.test(lineAt(lines, i + 1))
      ) {
        const releaseProfile = releaseProfiles.get(id);

        if (releaseProfile != null) profile = releaseProfile;

        depth = 1;
        inBuildSettings = false;
      }

      out.push(line);

      continue;
    }

    const delta = braceDelta(line);

    if (!inBuildSettings && /^\s*buildSettings\s*=\s*\{\s*$/.test(line)) {
      inBuildSettings = true;
      depth += delta;
      out.push(line);
      continue;
    }

    if (inBuildSettings && depth + delta == 1) {
      // This line closes buildSettings - insert the managed keys just inside it, then emit the `};`.
      let leadingWhitespace = /^(\s*)/.exec(line)?.[1];

      if (leadingWhitespace == null) leadingWhitespace = '';

      const indent = `${leadingWhitespace}\t`;

      out.push(`${indent}CODE_SIGN_STYLE = Manual;`);
      out.push(`${indent}DEVELOPMENT_TEAM = ${signing.teamId};`);
      out.push(`${indent}PROVISIONING_PROFILE_SPECIFIER = "${profile}";`);
      out.push(line);
      inBuildSettings = false;
      depth = 1;

      continue;
    }

    if (inBuildSettings) {
      depth += delta;

      if (!/^\s*(?:CODE_SIGN_STYLE|DEVELOPMENT_TEAM|PROVISIONING_PROFILE_SPECIFIER)\s*=/.test(line))
        out.push(line); // drop the old managed keys; re-added at close

      continue;
    }

    out.push(line);
    depth += delta;

    if (depth == 0) profile = null; // the config object closed
  }

  return out.join('\n');
}

export async function writeManualSigningToProject(
  nativeDirectory: string,
  signing: ManualSigningTargets,
): Promise<boolean> {
  const projectFile = await findPbxproj(nativeDirectory);

  if (projectFile == null) {
    return false;
  }

  const originalProject = await readFile(projectFile, 'utf8');
  const stampedProject = stampManualSigningIntoPbxproj(originalProject, signing);

  if (stampedProject == originalProject) {
    return false;
  }

  await writeFile(projectFile, stampedProject);

  return true;
}

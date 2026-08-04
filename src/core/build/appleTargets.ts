import { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import type { DiscoveredTarget } from '../types/artifacts.js';
/**
 * One target's signing readiness, as established by the build preflight before the long archive: is its
 * App ID registered, and which required capabilities (if any) is that App ID missing. Pure input to
 * {@link multiTargetSigningWarnings} so the messaging is unit-testable without a network call.
 */
export type TargetSigningReadiness = {
  bundleId: string;
  registered: boolean;
  missingCapabilities: string[];
};
/** The Xcode product type marking the primary app target (everything else is an embedded extension). */
const APPLICATION_PRODUCT_TYPE = 'com.apple.product-type.application';
/** A `PBXNativeTarget` object, mid-parse, before its bundle id is resolved through the config list. */
type NativeTargetRef = {
  name: string;
  buildConfigurationListId: string;
  productType: string;
};
/** Read one parser line without leaking undefined into regex operations. */
const lineAt = (lines: readonly string[], lineIndex: number): string => {
  const sourceLine = lines[lineIndex];
  if (sourceLine === undefined) return '';
  return sourceLine;
};
/**
 * Pull the object id assigned on a line like `<key> = <id> /* ... *​/;` - the unquoted hex (or any
 * non-whitespace token) immediately after `=`. Used for `buildConfigurationList` references. Returns
 * null when the line carries no assignment.
 */
const assignedId = (line: string): string | null => {
  const match = /[=]\s*([^\s;]+)/.exec(line);
  const assignedIdentifier = match?.[1];
  if (assignedIdentifier === undefined) return null;
  return assignedIdentifier;
};
/**
 * Pull a bare `<key> = <value>;` string value (e.g. `name = widget;` or `PRODUCT_BUNDLE_IDENTIFIER =
 * com.x.y;`), stripping surrounding quotes Xcode adds around values with special characters. Returns
 * null when the line doesn't assign `key`.
 */
const stringValue = (line: string, key: string): string | null => {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*"?([^";]+)"?\\s*;`).exec(line);
  const assignedText = match?.[1]?.trim();
  if (assignedText === undefined) return null;
  return assignedText;
};
/**
 * Parse every `PBXNativeTarget` block: its `name`, its `buildConfigurationList` id, and its
 * `productType`. One pass over the lines, tracking the brace depth of the target object so a nested
 * `buildSettings` key never leaks into the wrong target. The opening line of each target object is
 * `<id> /* <Name> *​/ = {` followed by `isa = PBXNativeTarget;`.
 */
const parseNativeTargets = (lines: string[]): NativeTargetRef[] => {
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
      if (name === null) name = stringValue(line, 'name');
      if (productType === null) productType = stringValue(line, 'productType');
      if (/^\s*buildConfigurationList\s*=/.test(line) && buildConfigurationListId === null)
        buildConfigurationListId = assignedId(line);
    }
    if (name !== null && buildConfigurationListId !== null) {
      let resolvedProductType = '';
      if (productType !== null) resolvedProductType = productType;
      targets.push({
        name,
        buildConfigurationListId,
        productType: resolvedProductType,
      });
    }
  }
  return targets;
};
/**
 * Map each `XCConfigurationList` object id to the `XCBuildConfiguration` object ids it lists. A target
 * reaches its build settings through this indirection (`PBXNativeTarget.buildConfigurationList` ->
 * `XCConfigurationList.buildConfigurations` -> each `XCBuildConfiguration`).
 */
const parseConfigurationLists = (lines: string[]): Map<string, string[]> => {
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
};
/**
 * Map each `XCBuildConfiguration` object id to its `PRODUCT_BUNDLE_IDENTIFIER`, skipping any value that
 * is still an unexpanded build variable (`$(...)`) - those can't name an App ID, so a target with only
 * variable bundle ids is treated as having none (and is dropped from discovery rather than guessed at).
 */
const parseBundleIdsByConfig = (lines: string[]): Map<string, string> => {
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
};
export const parsePbxprojTargets = (pbxproj: string): DiscoveredTarget[] => {
  const lines = pbxproj.split('\n');
  const configLists = parseConfigurationLists(lines);
  const bundleIdsByConfig = parseBundleIdsByConfig(lines);
  return parseNativeTargets(lines).flatMap((target) => {
    let configIds: string[] = [];
    const configuredIds = configLists.get(target.buildConfigurationListId);
    if (configuredIds !== undefined) configIds = configuredIds;
    const bundleId = configIds
      .map((id) => bundleIdsByConfig.get(id))
      .find((id) => id !== undefined);
    if (bundleId === undefined) return [];
    return [{ name: target.name, bundleId, productType: target.productType }];
  });
};
export const splitMainAndExtensions = (
  targets: DiscoveredTarget[],
  mainBundleId?: string,
): {
  main: string | undefined;
  extensions: string[];
} => {
  let main = targets.find((target) => target.bundleId === mainBundleId)?.bundleId;
  if (main === undefined) {
    main = targets.find((target) => target.productType === APPLICATION_PRODUCT_TYPE)?.bundleId;
  }
  const extensions = targets
    .filter((target) => target.bundleId !== main)
    .map((target) => target.bundleId);
  // De-dupe in case Debug/Release configs surfaced the same extension twice, preserving first-seen order.
  return { main, extensions: [...new Set(extensions)] };
};
/**
 * Locate the `*.xcodeproj/project.pbxproj` inside a generated native project directory (e.g. `ios/`),
 * or null when the project hasn't been generated yet (pre-prebuild). Reads only the directory listing.
 */
export const findPbxproj = (
  nativeDirectory: string,
): Effect.Effect<string | null, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    if (!(yield* fileSystem.exists(nativeDirectory))) return null;
    const directoryEntries = yield* fileSystem.readDirectory(nativeDirectory);
    const projectDirectory = directoryEntries.find((entryName) => entryName.endsWith('.xcodeproj'));
    if (projectDirectory === undefined) return null;
    const projectFile = pathService.join(nativeDirectory, projectDirectory, 'project.pbxproj');
    if (!(yield* fileSystem.exists(projectFile))) return null;
    return projectFile;
  });

export const discoverExtensionBundleIds = (
  nativeDirectory: string,
  mainBundleId?: string,
): Effect.Effect<string[], unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const projectFile = yield* findPbxproj(nativeDirectory);
    if (projectFile === null) return [];
    const projectText = yield* fileSystem.readFileString(projectFile);
    const targets = parsePbxprojTargets(projectText);
    return splitMainAndExtensions(targets, mainBundleId).extensions;
  });
export const multiTargetSigningWarnings = (readiness: TargetSigningReadiness[]): string[] => {
  const warnings: string[] = [];
  for (const target of readiness) {
    if (!target.registered) {
      warnings.push(
        `Signing preflight: App ID "${target.bundleId}" is not registered yet - the archive will fail ` +
          'to sign this target (exit 65). Run `launch creds setup --app <name>` to register and provision it first.',
      );
      continue;
    }
    if (target.missingCapabilities.length > 0) {
      warnings.push(
        `Signing preflight: App ID "${target.bundleId}" is missing the ${target.missingCapabilities.join(', ')} ` +
          `capability its entitlements require - its provisioning profile won't carry the entitlement and the ` +
          'archive will fail (exit 65). Run `launch creds setup --app <name>` to enable it and regenerate the profile.',
      );
    }
  }
  return warnings;
};
/**
 * The per-target manual-signing inputs stamped into a multi-target project before archiving: the one team
 * that signs every target, and each target's `bundleId -> profileName` (the main app plus every embedded
 * extension). Mirrors the {@link import("../services/appleArtifact.js").exportOptionsPlist} profile map so
 * the archive and the export agree on which profile signs which bundle.
 */
export type ManualSigningTargets = {
  teamId: string;
  profileByBundleId: Record<string, string>;
};
/** The three build settings the pbxproj writer owns inside a target's Release `buildSettings`. */
const MANAGED_SIGNING_KEY =
  /^\s*(?:CODE_SIGN_STYLE|DEVELOPMENT_TEAM|PROVISIONING_PROFILE_SPECIFIER)\s*=/;
/** Count the net brace balance a line contributes (`{` opens minus `}` closes) - the pbxproj is brace-nested. */
const braceDelta = (line: string): number => {
  let openingBraces = line.match(/\{/g)?.length;
  if (openingBraces === undefined) openingBraces = 0;
  let closingBraces = line.match(/\}/g)?.length;
  if (closingBraces === undefined) closingBraces = 0;
  return openingBraces - closingBraces;
};
/**
 * Map each `XCBuildConfiguration` object id to its `name` (`Debug` / `Release` / ...). Brace-depth-counted so
 * the name is read at the object's own scope and never confused with a key inside its nested `buildSettings`
 * dict - Expo writes `name = Release;` AFTER that dict, so a naive "stop at the first `};`" scan misses it.
 */
const parseConfigNames = (lines: string[]): Map<string, string> => {
  const names = new Map<string, string>();
  for (let i = 0; i < lines.length; i++) {
    const header = /^\s*([0-9A-Fa-f]+)\b.*=\s*\{/.exec(lineAt(lines, i));
    if (!(header?.[1] && /isa\s*=\s*XCBuildConfiguration;/.test(lineAt(lines, i + 1)))) continue;
    let depth = 1;
    for (let j = i + 1; j < lines.length && depth > 0; j++) {
      const line = lineAt(lines, j);
      let name: string | null = null;
      if (depth === 1) name = stringValue(line, 'name');
      if (name) {
        names.set(header[1], name);
        break;
      }
      depth += braceDelta(line);
    }
  }
  return names;
};
/**
 * For every target that has a resolved profile, map its **Release** `XCBuildConfiguration` object id to that
 * profile name - the exact configs {@link stampManualSigningIntoPbxproj} rewrites. Only Release is touched,
 * so a target's Debug config (used by dev-client runs) stays byte-identical. Pure.
 */
const releaseConfigProfiles = (
  lines: string[],
  profileByBundleId: Record<string, string>,
): Map<string, string> => {
  const configLists = parseConfigurationLists(lines);
  const configNames = parseConfigNames(lines);
  const bundleIdsByConfig = parseBundleIdsByConfig(lines);
  const profilesByReleaseConfiguration = new Map<string, string>();
  for (const target of parseNativeTargets(lines)) {
    let configIds: string[] = [];
    const configuredIds = configLists.get(target.buildConfigurationListId);
    if (configuredIds !== undefined) configIds = configuredIds;
    const releaseConfigId = configIds.find((id) => configNames.get(id) === 'Release');
    const bundleId = configIds
      .map((id) => bundleIdsByConfig.get(id))
      .find((id) => id !== undefined);
    let profileName: string | undefined;
    if (bundleId !== undefined) profileName = profileByBundleId[bundleId];
    if (releaseConfigId && profileName)
      profilesByReleaseConfiguration.set(releaseConfigId, profileName);
  }
  return profilesByReleaseConfiguration;
};
/**
 * Stamp per-target manual signing into a project's `project.pbxproj` and return the rewritten text
 * (the input unchanged when no target matched a profile). Launch drops `PROVISIONING_PROFILE_SPECIFIER`
 * from the global `gym --xcargs` - a workspace-wide specifier leaks onto the Pods library targets and
 * fails the Xcode 26 archive (issue #301), and would clobber an extension's bundle (issue #262); see
 * {@link import("./buildFlags.js").buildSigningXcargs} - so each target's profile has to live in the
 * project, or `xcodebuild` fails the archive at exit 65 with "requires a provisioning profile ... Select a
 * provisioning profile in the Signing & Capabilities editor" for every target (issue #289).
 *
 * Each target's **Release** `buildSettings` gets `CODE_SIGN_STYLE = Manual`, the team, and its own
 * `PROVISIONING_PROFILE_SPECIFIER`; the three managed keys are replaced rather than appended, so re-running
 * across rebuilds is idempotent. Pure - the file I/O is {@link writeManualSigningToProject}.
 */
export const stampManualSigningIntoPbxproj = (
  pbxproj: string,
  signing: ManualSigningTargets,
): string => {
  const lines = pbxproj.split('\n');
  const releaseProfiles = releaseConfigProfiles(lines, signing.profileByBundleId);
  if (releaseProfiles.size === 0) return pbxproj;
  const out: string[] = [];
  /** Profile of the wanted Release config we're currently inside, or null when outside any. */
  let profile: string | null = null;
  /** Brace depth relative to that config object's opening `{` (1 = object body, 2 = its buildSettings). */
  let depth = 0;
  let inBuildSettings = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lineAt(lines, i);
    if (profile === null) {
      const id = /^\s*([0-9A-Fa-f]+)\b.*=\s*\{\s*$/.exec(line)?.[1];
      if (
        id &&
        releaseProfiles.has(id) &&
        /isa\s*=\s*XCBuildConfiguration;/.test(lineAt(lines, i + 1))
      ) {
        const releaseProfile = releaseProfiles.get(id);
        if (releaseProfile !== undefined) profile = releaseProfile;
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
    if (inBuildSettings && depth + delta === 1) {
      // This line closes buildSettings - insert the managed keys just inside it, then emit the `};`.
      let leadingWhitespace = /^(\s*)/.exec(line)?.[1];
      if (leadingWhitespace === undefined) leadingWhitespace = '';
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
      if (!MANAGED_SIGNING_KEY.test(line)) out.push(line); // drop the old managed keys; re-added at close
      continue;
    }
    out.push(line);
    depth += delta;
    if (depth === 0) profile = null; // the config object closed
  }
  return out.join('\n');
};
export const writeManualSigningToProject = (
  nativeDirectory: string,
  signing: ManualSigningTargets,
): Effect.Effect<boolean, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const projectFile = yield* findPbxproj(nativeDirectory);
    if (projectFile === null) return false;
    const originalProject = yield* fileSystem.readFileString(projectFile);
    const stampedProject = stampManualSigningIntoPbxproj(originalProject, signing);
    if (stampedProject === originalProject) return false;
    yield* fileSystem.writeFileString(projectFile, stampedProject);
    return true;
  });

/**
 * Discover an Xcode project's build targets from its generated `project.pbxproj` — the authoritative
 * source of every bundle id a multi-target app signs.
 *
 * Why parse the pbxproj at all: an app with a second target (a WidgetKit / share / notification
 * extension) needs its OWN App ID + provisioning profile, and the export must be told the profile for
 * every signed bundle in the `.ipa`. The extension's bundle id is the one value we cannot reconstruct
 * from elsewhere — `@bacons/apple-targets` derives it from the target FOLDER name (`targets/widget/` ⇒
 * `com.example.sampleapp.widget`), NOT the target's `name:` field — so the `PRODUCT_BUNDLE_IDENTIFIER`
 * Xcode wrote into the project is the only thing we can trust. {@link discoverTargetBundleIds} feeds
 * those ids into the existing extension-provisioning path so they no longer have to be hand-listed in
 * `app.json`.
 *
 * The parser is a pure, line-oriented reader of the small slice of the pbxproj grammar Launch needs
 * (native targets → their build-config list → each config's `PRODUCT_BUNDLE_IDENTIFIER`); it never
 * shells out to `xcodebuild`, so it runs in CI and is exhaustively unit-tested against fixtures. The
 * impure half ({@link findPbxproj}, {@link discoverTargetBundleIds}) only locates and reads the file.
 *
 * BYTE-IDENTICAL GUARANTEE: a single-target app yields exactly one target (the main app) and an empty
 * extension list, so discovery changes nothing about how today's no-extension iOS build is provisioned
 * or signed. Discovery only ever ADDS extension bundle ids; it never alters the main bundle's path.
 *
 * This module also owns the one WRITE back into the project: {@link stampManualSigningIntoPbxproj} /
 * {@link writeManualSigningToProject} stamp per-target manual signing into a multi-target app's Release
 * configs right before the archive. A multi-target build drops the global provisioning-profile specifier
 * (it would clobber an extension's own bundle — see {@link import("./buildFlags.js").buildXcargs}), so each
 * target has to carry its own profile in the project or the archive dies at exit 65 (issue #289). The write
 * touches only the Release config of targets it has a profile for, so a single-target build — which never
 * calls it — stays byte-identical.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DiscoveredTarget } from './types.js';

/**
 * One target's signing readiness, as established by the build preflight before the long archive: is its
 * App ID registered, and which required capabilities (if any) is that App ID missing. Pure input to
 * {@link multiTargetSigningWarnings} so the messaging is unit-testable without a network call.
 */
export interface TargetSigningReadiness {
  /** The target's bundle id (its `PRODUCT_BUNDLE_IDENTIFIER`). */
  bundleId: string;
  /** Whether this bundle id is registered as an App ID in the Apple account. */
  registered: boolean;
  /** Required capabilities the App ID does NOT currently have enabled (empty when it's fully covered). */
  missingCapabilities: string[];
}

/** The Xcode product type marking the primary app target (everything else is an embedded extension). */
const APPLICATION_PRODUCT_TYPE = 'com.apple.product-type.application';

/** A `PBXNativeTarget` object, mid-parse, before its bundle id is resolved through the config list. */
interface NativeTargetRef {
  name: string;
  /** Object id of the target's `XCConfigurationList`, linking it to its build configurations. */
  buildConfigurationListId: string;
  productType: string;
}

/**
 * Pull the object id assigned on a line like `<key> = <id> /* … *​/;` — the unquoted hex (or any
 * non-whitespace token) immediately after `=`. Used for `buildConfigurationList` references. Returns
 * null when the line carries no assignment.
 */
function assignedId(line: string): string | null {
  const match = /[=]\s*([^\s;]+)/.exec(line);
  return match?.[1] ?? null;
}

/**
 * Pull a bare `<key> = <value>;` string value (e.g. `name = widget;` or `PRODUCT_BUNDLE_IDENTIFIER =
 * com.x.y;`), stripping surrounding quotes Xcode adds around values with special characters. Returns
 * null when the line doesn't assign `key`.
 */
function stringValue(line: string, key: string): string | null {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*"?([^";]+)"?\\s*;`).exec(line);
  return match?.[1]?.trim() ?? null;
}

/**
 * Parse every `PBXNativeTarget` block: its `name`, its `buildConfigurationList` id, and its
 * `productType`. One pass over the lines, tracking the brace depth of the target object so a nested
 * `buildSettings` key never leaks into the wrong target. The opening line of each target object is
 * `<id> /* <Name> *​/ = {` followed by `isa = PBXNativeTarget;`.
 */
function parseNativeTargets(lines: string[]): NativeTargetRef[] {
  const targets: NativeTargetRef[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/isa\s*=\s*PBXNativeTarget;/.test(lines[i] ?? '')) continue;
    let name: string | null = null;
    let buildConfigurationListId: string | null = null;
    let productType: string | null = null;
    // The object's fields sit between its `isa` line and the closing `};` at the same indent.
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j] ?? '';
      if (/^\s*};/.test(line)) break;
      name ??= stringValue(line, 'name');
      productType ??= stringValue(line, 'productType');
      if (/^\s*buildConfigurationList\s*=/.test(line))
        buildConfigurationListId ??= assignedId(line);
    }
    if (name && buildConfigurationListId)
      targets.push({ name, buildConfigurationListId, productType: productType ?? '' });
  }
  return targets;
}

/**
 * Map each `XCConfigurationList` object id to the `XCBuildConfiguration` object ids it lists. A target
 * reaches its build settings through this indirection (`PBXNativeTarget.buildConfigurationList` →
 * `XCConfigurationList.buildConfigurations` → each `XCBuildConfiguration`).
 */
function parseConfigurationLists(lines: string[]): Map<string, string[]> {
  const lists = new Map<string, string[]>();
  for (let i = 0; i < lines.length; i++) {
    const header = /^\s*([0-9A-Fa-f]+)\b.*=\s*\{/.exec(lines[i] ?? '');
    if (!(header && /isa\s*=\s*XCConfigurationList;/.test(lines[i + 1] ?? ''))) continue;
    const configIds: string[] = [];
    let inList = false;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j] ?? '';
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

/**
 * Map each `XCBuildConfiguration` object id to its `PRODUCT_BUNDLE_IDENTIFIER`, skipping any value that
 * is still an unexpanded build variable (`$(…)`) — those can't name an App ID, so a target with only
 * variable bundle ids is treated as having none (and is dropped from discovery rather than guessed at).
 */
function parseBundleIdsByConfig(lines: string[]): Map<string, string> {
  const bundleIds = new Map<string, string>();
  for (let i = 0; i < lines.length; i++) {
    const header = /^\s*([0-9A-Fa-f]+)\b.*=\s*\{/.exec(lines[i] ?? '');
    if (!(header && /isa\s*=\s*XCBuildConfiguration;/.test(lines[i + 1] ?? ''))) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j] ?? '';
      if (/^\s*};/.test(line)) break;
      const value = stringValue(line, 'PRODUCT_BUNDLE_IDENTIFIER');
      if (value && !value.includes('$(') && header[1]) {
        bundleIds.set(header[1], value);
        break;
      }
    }
  }
  return bundleIds;
}

/**
 * Parse a `project.pbxproj`'s text into the list of build targets, each with its authoritative
 * `PRODUCT_BUNDLE_IDENTIFIER`. Pure and deterministic — the heart of target discovery, unit-tested
 * against real Expo / `@bacons/apple-targets` fixtures.
 *
 * A target is included only when its build configuration resolves to a literal bundle id; targets whose
 * bundle id is unset or still a `$(…)` variable are omitted (they can't be provisioned by id anyway).
 * Order follows the targets' appearance in the file, so the main app — declared first by Expo — leads.
 *
 * @param pbxproj Raw UTF-8 contents of a `*.xcodeproj/project.pbxproj`.
 * @returns Each resolvable target as a {@link DiscoveredTarget}; empty when none can be resolved.
 */
export function parsePbxprojTargets(pbxproj: string): DiscoveredTarget[] {
  const lines = pbxproj.split('\n');
  const configLists = parseConfigurationLists(lines);
  const bundleIdsByConfig = parseBundleIdsByConfig(lines);

  return parseNativeTargets(lines).flatMap((target) => {
    const configIds = configLists.get(target.buildConfigurationListId) ?? [];
    const bundleId = configIds
      .map((id) => bundleIdsByConfig.get(id))
      .find((id) => id !== undefined);
    return bundleId ? [{ name: target.name, bundleId, productType: target.productType }] : [];
  });
}

/**
 * Split discovered targets into the main app bundle id and its embedded-extension bundle ids. The main
 * app is the `com.apple.product-type.application` target; everything else is an extension. When the
 * known `mainBundleId` is supplied (from `app.json`), any target matching it is treated as the main app
 * even if its product type is unusual — a belt-and-braces guard so the main bundle is never mistakenly
 * provisioned as an extension. Pure.
 *
 * @returns `extensions` is empty for a single-target app, so a no-extension build is unaffected.
 */
export function splitMainAndExtensions(
  targets: DiscoveredTarget[],
  mainBundleId?: string,
): { main: string | undefined; extensions: string[] } {
  const main =
    targets.find((target) => target.bundleId === mainBundleId)?.bundleId ??
    targets.find((target) => target.productType === APPLICATION_PRODUCT_TYPE)?.bundleId;
  const extensions = targets
    .filter((target) => target.bundleId !== main)
    .map((target) => target.bundleId);
  // De-dupe in case Debug/Release configs surfaced the same extension twice, preserving first-seen order.
  return { main, extensions: [...new Set(extensions)] };
}

/**
 * Locate the `*.xcodeproj/project.pbxproj` inside a generated native project directory (e.g. `ios/`),
 * or null when the project hasn't been generated yet (pre-prebuild). Reads only the directory listing.
 */
export function findPbxproj(nativeDir: string): string | null {
  if (!existsSync(nativeDir)) return null;
  const projectDir = readdirSync(nativeDir).find((entry) => entry.endsWith('.xcodeproj'));
  if (!projectDir) return null;
  const pbxproj = join(nativeDir, projectDir, 'project.pbxproj');
  return existsSync(pbxproj) ? pbxproj : null;
}

/**
 * Discover the embedded-extension bundle ids of a generated Apple project, reading the `project.pbxproj`
 * under `nativeDir`. Returns an empty list when the project doesn't exist yet, has no extensions, or
 * can't be parsed — every "no extra targets" case collapses to today's single-target behaviour, so the
 * caller provisions exactly the main bundle and nothing changes for a no-extension app.
 *
 * @param nativeDir The platform's native project dir (`ios/` for iOS & tvOS, `macos/`, `visionos/`).
 * @param mainBundleId The app's known main bundle id, so it's never returned as one of its own extensions.
 * @returns The discovered extension bundle ids (excluding the main app), de-duplicated; `[]` when none.
 */
export function discoverExtensionBundleIds(nativeDir: string, mainBundleId?: string): string[] {
  const pbxproj = findPbxproj(nativeDir);
  if (!pbxproj) return [];
  const targets = parsePbxprojTargets(readFileSync(pbxproj, 'utf8'));
  return splitMainAndExtensions(targets, mainBundleId).extensions;
}

/**
 * Turn each target's signing readiness into an **early, actionable** warning — the preflight that fires
 * BEFORE the ~15-minute archive instead of letting it die at exit 65 (issue #261). A target whose App ID
 * isn't registered, or whose App ID is missing a required capability, gets a named line pointing at the
 * one command that fixes it (`launch creds setup --app …`). Pure: the readiness facts are gathered by the
 * caller (registration + capability reads), so the message wording is unit-tested with no network.
 *
 * @returns One warning per not-ready target, naming the bundle id and the gap; `[]` when every target is
 *   ready (the common single-target case — no extra output, behaviour unchanged).
 */
export function multiTargetSigningWarnings(readiness: TargetSigningReadiness[]): string[] {
  const warnings: string[] = [];
  for (const target of readiness) {
    if (!target.registered) {
      warnings.push(
        `Signing preflight: App ID "${target.bundleId}" is not registered yet — the archive will fail ` +
          'to sign this target (exit 65). Run `launch creds setup --app <name>` to register and provision it first.',
      );
      continue;
    }
    if (target.missingCapabilities.length > 0) {
      warnings.push(
        `Signing preflight: App ID "${target.bundleId}" is missing the ${target.missingCapabilities.join(', ')} ` +
          `capability its entitlements require — its provisioning profile won't carry the entitlement and the ` +
          'archive will fail (exit 65). Run `launch creds setup --app <name>` to enable it and regenerate the profile.',
      );
    }
  }
  return warnings;
}

/**
 * The per-target manual-signing inputs stamped into a multi-target project before archiving: the one team
 * that signs every target, and each target's `bundleId → profileName` (the main app plus every embedded
 * extension). Mirrors the {@link import("../providers/build/fastlane.js").exportOptionsPlist} profile map so
 * the archive and the export agree on which profile signs which bundle.
 */
export interface ManualSigningTargets {
  /** Apple Developer Team ID that signs every target, e.g. `ABCDE12345`. */
  teamId: string;
  /** `bundleId → profileName` for the main app and each embedded extension. */
  profileByBundleId: Record<string, string>;
}

/** The three build settings the pbxproj writer owns inside a target's Release `buildSettings`. */
const MANAGED_SIGNING_KEY =
  /^\s*(?:CODE_SIGN_STYLE|DEVELOPMENT_TEAM|PROVISIONING_PROFILE_SPECIFIER)\s*=/;

/** Count the net brace balance a line contributes (`{` opens minus `}` closes) — the pbxproj is brace-nested. */
function braceDelta(line: string): number {
  return (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
}

/**
 * Map each `XCBuildConfiguration` object id to its `name` (`Debug` / `Release` / …). Brace-depth-counted so
 * the name is read at the object's own scope and never confused with a key inside its nested `buildSettings`
 * dict — Expo writes `name = Release;` AFTER that dict, so a naive "stop at the first `};`" scan misses it.
 */
function parseConfigNames(lines: string[]): Map<string, string> {
  const names = new Map<string, string>();
  for (let i = 0; i < lines.length; i++) {
    const header = /^\s*([0-9A-Fa-f]+)\b.*=\s*\{/.exec(lines[i] ?? '');
    if (!(header?.[1] && /isa\s*=\s*XCBuildConfiguration;/.test(lines[i + 1] ?? ''))) continue;
    let depth = 1;
    for (let j = i + 1; j < lines.length && depth > 0; j++) {
      const line = lines[j] ?? '';
      const name = depth === 1 ? stringValue(line, 'name') : null;
      if (name) {
        names.set(header[1], name);
        break;
      }
      depth += braceDelta(line);
    }
  }
  return names;
}

/**
 * For every target that has a resolved profile, map its **Release** `XCBuildConfiguration` object id to that
 * profile name — the exact configs {@link stampManualSigningIntoPbxproj} rewrites. Only Release is touched,
 * so a target's Debug config (used by dev-client runs) stays byte-identical. Pure.
 */
function releaseConfigProfiles(
  lines: string[],
  profileByBundleId: Record<string, string>,
): Map<string, string> {
  const configLists = parseConfigurationLists(lines);
  const configNames = parseConfigNames(lines);
  const bundleIdsByConfig = parseBundleIdsByConfig(lines);
  const result = new Map<string, string>();
  for (const target of parseNativeTargets(lines)) {
    const configIds = configLists.get(target.buildConfigurationListId) ?? [];
    const releaseConfigId = configIds.find((id) => configNames.get(id) === 'Release');
    const bundleId = configIds
      .map((id) => bundleIdsByConfig.get(id))
      .find((id) => id !== undefined);
    const profileName = bundleId ? profileByBundleId[bundleId] : undefined;
    if (releaseConfigId && profileName) result.set(releaseConfigId, profileName);
  }
  return result;
}

/**
 * Stamp per-target manual signing into a project's `project.pbxproj` and return the rewritten text
 * (the input unchanged when no target matched a profile). For a multi-target app the global
 * `PROVISIONING_PROFILE_SPECIFIER` is deliberately dropped from `--xcargs` — it would clobber an
 * extension's bundle (see {@link import("./buildFlags.js").buildXcargs}) — so each target's profile has to
 * live in the project, or `xcodebuild` fails the archive at exit 65 with "requires a provisioning profile …
 * Select a provisioning profile in the Signing & Capabilities editor" for every target (issue #289).
 *
 * Each target's **Release** `buildSettings` gets `CODE_SIGN_STYLE = Manual`, the team, and its own
 * `PROVISIONING_PROFILE_SPECIFIER`; the three managed keys are replaced rather than appended, so re-running
 * across rebuilds is idempotent. Pure — the file I/O is {@link writeManualSigningToProject}.
 */
export function stampManualSigningIntoPbxproj(
  pbxproj: string,
  signing: ManualSigningTargets,
): string {
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
    const line = lines[i] ?? '';
    if (profile === null) {
      const id = /^\s*([0-9A-Fa-f]+)\b.*=\s*\{\s*$/.exec(line)?.[1];
      if (
        id &&
        releaseProfiles.has(id) &&
        /isa\s*=\s*XCBuildConfiguration;/.test(lines[i + 1] ?? '')
      ) {
        profile = releaseProfiles.get(id) ?? null;
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
      // This line closes buildSettings — insert the managed keys just inside it, then emit the `};`.
      const indent = `${/^(\s*)/.exec(line)?.[1] ?? ''}\t`;
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
}

/**
 * Write per-target manual signing into a generated Apple project's `project.pbxproj` — the multi-target
 * archive path (see {@link stampManualSigningIntoPbxproj}). Returns `false` (a no-op) when the project
 * isn't generated yet or no target matched a profile; `true` when the file was rewritten.
 *
 * @param nativeDir The platform's native project dir (`ios/`).
 * @param signing The team and per-bundle profile map to stamp.
 */
export function writeManualSigningToProject(
  nativeDir: string,
  signing: ManualSigningTargets,
): boolean {
  const pbxproj = findPbxproj(nativeDir);
  if (!pbxproj) return false;
  const original = readFileSync(pbxproj, 'utf8');
  const stamped = stampManualSigningIntoPbxproj(original, signing);
  if (stamped === original) return false;
  writeFileSync(pbxproj, stamped);
  return true;
}

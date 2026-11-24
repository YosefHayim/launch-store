// Compares Apple's published spec and Google's discovery documents with this repo.

import { spawnSync } from 'node:child_process';
import { appendFile, readFile, writeFile } from 'node:fs/promises';

const SHOWN_METHOD_LIMIT = 30;
const ANDROID_PUBLISHER_DISCOVERY_URL =
  'https://androidpublisher.googleapis.com/$discovery/rest?version=v3';
const PLAY_REPORTING_DISCOVERY_URL =
  'https://playdeveloperreporting.googleapis.com/$discovery/rest?version=v1beta1';
const APPLE_SPEC_URL =
  'https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip';

interface AppleSpecCheck {
  hasTypeDiff: boolean;
  committedVersionLine: string;
  workingVersionLine: string;
}

interface GoogleApiCheck {
  apiName: string;
  discoveryUrl: string;
  revision: string;
  packageName: string;
  packageVersion: string;
  publishedCount: number;
  installedCount: number;
  missingMethodPaths: string[];
}

interface GoogleApiRequest {
  apiName: string;
  discoveryUrl: string;
  clientPath: string;
  packageName: string;
  packageJsonPath: string;
}

function readCommandOutput(command: string, commandArguments: string[]): string {
  const commandBufferBytes = 16 * 1024 * 1024;
  const ran = spawnSync(command, commandArguments, {
    encoding: 'utf8',
    maxBuffer: commandBufferBytes,
  });
  const failed = ran.status != 0;

  if (failed) {
    throw new Error(`${command} ${commandArguments.join(' ')} failed`, { cause: ran.stderr });
  }

  return ran.stdout;
}

function readSpecVersionLine(typeSource: string): string {
  const headerLineCount = 20;
  const headerLines = typeSource.split('\n').slice(0, headerLineCount);

  for (const headerLine of headerLines) {
    const isVersionLine = headerLine.startsWith('// App Store Connect API - OpenAPI ');

    if (isVersionLine) {
      const commentMark = '// ';
      return headerLine.slice(commentMark.length);
    }
  }

  return 'App Store Connect spec version line was not found';
}

async function readAppleSpecCheck(): Promise<AppleSpecCheck> {
  const diffStat = readCommandOutput('git', [
    'diff',
    '--numstat',
    '--',
    'src/types/apple-api-types.ts',
  ]);
  const trimmedDiff = diffStat.trim();
  const hasTypeDiff = trimmedDiff != '';
  const committedTypes = readCommandOutput('git', ['show', 'HEAD:src/types/apple-api-types.ts']);

  try {
    var workingTypes = await readFile('src/types/apple-api-types.ts', 'utf8');
  } catch (error) {
    throw new Error('Could not read src/types/apple-api-types.ts', { cause: error });
  }

  return {
    hasTypeDiff,
    committedVersionLine: readSpecVersionLine(committedTypes),
    workingVersionLine: readSpecVersionLine(workingTypes),
  };
}

function listOwnKeys(document: unknown): string[] {
  const isNotObject = typeof document != 'object';

  if (isNotObject) {
    return [];
  }

  const isMissing = document == null;

  if (isMissing) {
    return [];
  }

  return Object.keys(document);
}

function readChild(document: unknown, key: string): unknown {
  const isNotObject = typeof document != 'object';

  if (isNotObject) {
    return null;
  }

  const isMissing = document == null;

  if (isMissing) {
    return null;
  }

  return Reflect.get(document, key);
}

function joinPath(prefix: string | null, name: string): string {
  const isRoot = prefix == null;

  if (isRoot) {
    return name;
  }

  return `${prefix}.${name}`;
}

function collectMethods(methods: unknown, prefix: string | null, paths: string[]): void {
  const methodNames = listOwnKeys(methods);

  for (const methodName of methodNames) {
    const methodPath = joinPath(prefix, methodName);
    paths.push(methodPath);
  }
}

interface ResourceWalk {
  resources: unknown;
  resourceName: string;
  prefix: string | null;
  paths: string[];
}

function collectResource(walk: ResourceWalk): void {
  const resource = readChild(walk.resources, walk.resourceName);
  const resourcePath = joinPath(walk.prefix, walk.resourceName);
  const methods = readChild(resource, 'methods');
  collectMethods(methods, resourcePath, walk.paths);
  const nestedResources = readChild(resource, 'resources');
  collectResources(nestedResources, resourcePath, walk.paths);
}

function collectResources(resources: unknown, prefix: string | null, paths: string[]): void {
  const resourceNames = listOwnKeys(resources);

  for (const resourceName of resourceNames) {
    collectResource({ resources, resourceName, prefix, paths });
  }
}

function listDiscoveryMethodPaths(discoveryDocument: unknown): string[] {
  const paths: string[] = [];
  const rootMethods = readChild(discoveryDocument, 'methods');
  collectMethods(rootMethods, null, paths);
  const resources = readChild(discoveryDocument, 'resources');
  collectResources(resources, null, paths);
  return paths;
}

function readRevision(discoveryDocument: unknown): string {
  const revision = readChild(discoveryDocument, 'revision');
  const isText = typeof revision == 'string';

  if (isText) {
    return revision;
  }

  return 'revision was not published';
}

async function readDiscoveryDocument(discoveryUrl: string): Promise<unknown> {
  try {
    var discoveryReply = await fetch(discoveryUrl);
  } catch (error) {
    throw new Error(`Could not download ${discoveryUrl}`, { cause: error });
  }

  const isFailed = !discoveryReply.ok;

  if (isFailed) {
    throw new Error(`Could not download ${discoveryUrl} (${discoveryReply.status})`);
  }

  try {
    return await discoveryReply.json();
  } catch (error) {
    throw new Error(`Could not read ${discoveryUrl} as JSON`, { cause: error });
  }
}

function isAsciiDigit(character: string): boolean {
  const isBeforeZero = character < '0';

  if (isBeforeZero) {
    return false;
  }

  const isAfterNine = character > '9';

  if (isAfterNine) {
    return false;
  }

  return true;
}

function isAsciiUpper(character: string): boolean {
  const isBeforeA = character < 'A';

  if (isBeforeA) {
    return false;
  }

  const isAfterZ = character > 'Z';

  if (isAfterZ) {
    return false;
  }

  return true;
}

function isAsciiLower(character: string): boolean {
  const isBeforeA = character < 'a';

  if (isBeforeA) {
    return false;
  }

  const isAfterZ = character > 'z';

  if (isAfterZ) {
    return false;
  }

  return true;
}

function isAsciiLetter(character: string): boolean {
  const isUpper = isAsciiUpper(character);

  if (isUpper) {
    return true;
  }

  return isAsciiLower(character);
}

function isResourceClassCharacter(character: string): boolean {
  const isDigit = isAsciiDigit(character);

  if (isDigit) {
    return true;
  }

  const isLetter = isAsciiLetter(character);

  if (isLetter) {
    return true;
  }

  return character == '$';
}

function isResourceClassName(className: string): boolean {
  const isEmpty = className.length == 0;

  if (isEmpty) {
    return false;
  }

  for (const character of className) {
    const isAllowed = isResourceClassCharacter(character);

    if (isAllowed) {
      continue;
    }

    return false;
  }

  return true;
}

function isMethodName(methodName: string): boolean {
  const isEmpty = methodName.length == 0;

  if (isEmpty) {
    return false;
  }

  const firstCharacter = methodName.charAt(0);
  const firstIsLetter = isAsciiLetter(firstCharacter);
  const firstIsNotALetter = !firstIsLetter;

  if (firstIsNotALetter) {
    return false;
  }

  const rest = methodName.slice(1);

  for (const character of rest) {
    const isDigit = isAsciiDigit(character);

    if (isDigit) {
      continue;
    }

    const isLetter = isAsciiLetter(character);

    if (isLetter) {
      continue;
    }

    return false;
  }

  return true;
}

function readResourcePath(line: string): string | null {
  const classPrefix = '  export class Resource$';
  const classSuffix = ' {';
  const isMissingPrefix = !line.startsWith(classPrefix);

  if (isMissingPrefix) {
    return null;
  }

  const isMissingSuffix = !line.endsWith(classSuffix);

  if (isMissingSuffix) {
    return null;
  }

  const className = line.slice(classPrefix.length, line.length - classSuffix.length);
  const isClassName = isResourceClassName(className);

  if (isClassName) {
    return className.toLowerCase().replaceAll('$', '.');
  }

  return null;
}

function readMethodName(line: string): string | null {
  const methodIndent = '    ';
  const isMissingIndent = !line.startsWith(methodIndent);

  if (isMissingIndent) {
    return null;
  }

  const opensOnThisLine = line.endsWith('(');
  const doesNotOpen = !opensOnThisLine;

  if (doesNotOpen) {
    return null;
  }

  const methodName = line.slice(methodIndent.length, line.length - 1);
  const isMethod = isMethodName(methodName);

  if (isMethod) {
    return methodName;
  }

  return null;
}

function pickResourcePath(line: string, previousPath: string | null): string | null {
  const nextPath = readResourcePath(line);
  const isResource = nextPath != null;

  if (isResource) {
    return nextPath;
  }

  return previousPath;
}

function appendInstalledMethod(paths: string[], resourcePath: string | null, line: string): void {
  const methodName = readMethodName(line);
  const isNotAMethod = methodName == null;

  if (isNotAMethod) {
    return;
  }

  const hasNoResource = resourcePath == null;

  if (hasNoResource) {
    return;
  }

  const isConstructor = methodName == 'constructor';

  if (isConstructor) {
    return;
  }

  paths.push(`${resourcePath}.${methodName.toLowerCase()}`);
}

function listInstalledMethodPaths(clientSource: string): string[] {
  const lines = clientSource.split('\n');
  const paths: string[] = [];
  let resourcePath: string | null = null;

  for (const line of lines) {
    resourcePath = pickResourcePath(line, resourcePath);
    appendInstalledMethod(paths, resourcePath, line);
  }

  return [...new Set(paths)];
}

function listMissingMethodPaths(publishedPaths: string[], installedPaths: string[]): string[] {
  const installed = new Set(installedPaths);
  const missing: string[] = [];

  for (const publishedPath of publishedPaths) {
    const comparisonPath = publishedPath.toLowerCase();
    const isInstalled = installed.has(comparisonPath);

    if (isInstalled) {
      continue;
    }

    missing.push(publishedPath);
  }

  missing.sort();
  return missing;
}

async function readPackageVersion(packageJsonPath: string): Promise<string> {
  try {
    var packageSource = await readFile(packageJsonPath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read ${packageJsonPath}`, { cause: error });
  }

  let parsed: unknown = null;

  try {
    parsed = JSON.parse(packageSource);
  } catch (error) {
    throw new Error(`Could not parse ${packageJsonPath}`, { cause: error });
  }

  const version = readChild(parsed, 'version');
  const isText = typeof version == 'string';

  if (isText) {
    return version;
  }

  return 'unknown';
}

async function readGoogleApiCheck(googleApi: GoogleApiRequest): Promise<GoogleApiCheck> {
  const discoveryDocument = await readDiscoveryDocument(googleApi.discoveryUrl);

  try {
    var clientSource = await readFile(googleApi.clientPath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read ${googleApi.clientPath}`, { cause: error });
  }

  const publishedPaths = listDiscoveryMethodPaths(discoveryDocument);
  const installedPaths = listInstalledMethodPaths(clientSource);
  const missingMethodPaths = listMissingMethodPaths(publishedPaths, installedPaths);
  const packageVersion = await readPackageVersion(googleApi.packageJsonPath);

  return {
    apiName: googleApi.apiName,
    discoveryUrl: googleApi.discoveryUrl,
    revision: readRevision(discoveryDocument),
    packageName: googleApi.packageName,
    packageVersion,
    publishedCount: publishedPaths.length,
    installedCount: installedPaths.length,
    missingMethodPaths,
  };
}

function addMissingCount(total: number, googleCheck: GoogleApiCheck): number {
  return total + googleCheck.missingMethodPaths.length;
}

function countMissingMethods(googleChecks: GoogleApiCheck[]): number {
  return googleChecks.reduce(addMissingCount, 0);
}

function createAppleTitle(googleMissingCount: number, day: string): string {
  const googleMoved = googleMissingCount > 0;

  if (googleMoved) {
    return `[API Sync] App Store Connect and Google Play moved - ${day}`;
  }

  return `[API Sync] App Store Connect spec moved - ${day}`;
}

function createTitle(
  appleCheck: AppleSpecCheck,
  googleChecks: GoogleApiCheck[],
  day: string,
): string {
  const googleMissingCount = countMissingMethods(googleChecks);
  const appleMoved = appleCheck.hasTypeDiff;

  if (appleMoved) {
    return createAppleTitle(googleMissingCount, day);
  }

  const googleMoved = googleMissingCount > 0;

  if (googleMoved) {
    return `[API Sync] Google Play discovery moved - ${day}`;
  }

  return `[API Sync] Store APIs match - ${day}`;
}

function describeTypeDiff(hasTypeDiff: boolean): string {
  if (hasTypeDiff) {
    return 'yes';
  }

  return 'no';
}

function createMethodBullet(methodPath: string): string {
  return `- \`${methodPath}\``;
}

function listShownMethods(missingMethodPaths: string[]): string {
  const shown = missingMethodPaths.slice(0, SHOWN_METHOD_LIMIT);
  const lines = shown.map(createMethodBullet);
  const hiddenCount = missingMethodPaths.length - shown.length;
  const hasMore = hiddenCount > 0;

  if (hasMore) {
    lines.push(`- and ${hiddenCount} more`);
  }

  const isEmpty = lines.length == 0;

  if (isEmpty) {
    return 'None.';
  }

  return lines.join('\n');
}

function createAppleLines(appleCheck: AppleSpecCheck): string[] {
  const typeDiff = describeTypeDiff(appleCheck.hasTypeDiff);

  return [
    '### App Store Connect',
    '',
    `Spec: ${APPLE_SPEC_URL}`,
    `Committed: ${appleCheck.committedVersionLine}`,
    `Working tree: ${appleCheck.workingVersionLine}`,
    `Working tree differs from committed types: ${typeDiff}`,
    '',
  ];
}

function createGoogleLines(googleCheck: GoogleApiCheck): string[] {
  const installedPackage = `${googleCheck.packageName}@${googleCheck.packageVersion}`;

  return [
    `### ${googleCheck.apiName}`,
    '',
    `Discovery document: ${googleCheck.discoveryUrl}`,
    `Discovery revision: ${googleCheck.revision}`,
    `Installed package: ${installedPackage}`,
    `Published methods: ${googleCheck.publishedCount}`,
    `Installed methods: ${googleCheck.installedCount}`,
    `Missing methods: ${googleCheck.missingMethodPaths.length}`,
    '',
    listShownMethods(googleCheck.missingMethodPaths),
    '',
  ];
}

function createClosingLines(): string[] {
  const appleStep = [
    '1. When App Store Connect types differ, run `pnpm gen:asc`',
    'and review the diff of `src/types/apple-api-types.ts` before committing it.',
  ].join(' ');
  const googleStep = [
    '2. When Google methods are missing, update `@googleapis/androidpublisher`',
    'or `@googleapis/playdeveloperreporting`.',
  ].join(' ');

  return [
    '### What to do',
    '',
    appleStep,
    googleStep,
    '3. Leave a live app untouched. This check only reads public specs.',
    '',
  ];
}

function createReport(
  appleCheck: AppleSpecCheck,
  googleChecks: GoogleApiCheck[],
  day: string,
): string {
  const title = createTitle(appleCheck, googleChecks, day);
  const appleLines = createAppleLines(appleCheck);
  const googleLines = googleChecks.flatMap(createGoogleLines);
  const closingLines = createClosingLines();
  const lines = [
    title,
    '',
    '## Store API sync',
    '',
    ...appleLines,
    ...googleLines,
    ...closingLines,
  ];

  return `${lines.join('\n')}\n`;
}

async function writeDriftFlag(hasDrift: boolean): Promise<void> {
  const driftFlagFile = process.env.GITHUB_OUTPUT;
  const isLocal = driftFlagFile == null;

  if (isLocal) {
    return;
  }

  const flag = hasDrift ? 'true' : 'false';

  try {
    await appendFile(driftFlagFile, `drift=${flag}\n`);
  } catch (error) {
    throw new Error('Could not write the drift flag', { cause: error });
  }
}

async function writeStepSummary(reportMarkdown: string): Promise<void> {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  const isLocal = summaryFile == null;

  if (isLocal) {
    return;
  }

  try {
    await appendFile(summaryFile, reportMarkdown);
  } catch (error) {
    throw new Error('Could not write the job summary', { cause: error });
  }
}

function hasStoreDrift(appleCheck: AppleSpecCheck, googleChecks: GoogleApiCheck[]): boolean {
  if (appleCheck.hasTypeDiff) {
    return true;
  }

  const googleMissingCount = countMissingMethods(googleChecks);
  const googleMoved = googleMissingCount > 0;

  return googleMoved;
}

async function main(): Promise<void> {
  const appleCheck = await readAppleSpecCheck();
  const publisherCheck = await readGoogleApiCheck({
    apiName: 'Google Play Android Publisher v3',
    discoveryUrl: ANDROID_PUBLISHER_DISCOVERY_URL,
    clientPath: 'node_modules/@googleapis/androidpublisher/v3.ts',
    packageName: '@googleapis/androidpublisher',
    packageJsonPath: 'node_modules/@googleapis/androidpublisher/package.json',
  });
  const reportingCheck = await readGoogleApiCheck({
    apiName: 'Play Developer Reporting v1beta1',
    discoveryUrl: PLAY_REPORTING_DISCOVERY_URL,
    clientPath: 'node_modules/@googleapis/playdeveloperreporting/v1beta1.ts',
    packageName: '@googleapis/playdeveloperreporting',
    packageJsonPath: 'node_modules/@googleapis/playdeveloperreporting/package.json',
  });
  const googleChecks = [publisherCheck, reportingCheck];
  const hasDrift = hasStoreDrift(appleCheck, googleChecks);
  const day = new Date().toISOString().slice(0, 10);
  const reportMarkdown = createReport(appleCheck, googleChecks, day);

  try {
    await writeFile('store-api-sync.md', reportMarkdown);
  } catch (error) {
    throw new Error('Could not write store-api-sync.md', { cause: error });
  }

  await writeDriftFlag(hasDrift);
  await writeStepSummary(reportMarkdown);
  process.stdout.write(reportMarkdown);
}

await main();

// Shows which setup steps are still missing, and installs local build tools when allowed.

import { writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { runBuild } from '../build/pipeline.ts';
import {
  formatAccountSummary,
  getActiveAccount,
  loadActiveAscKey,
} from '../credentials/accounts.ts';
import { loadServiceAccount } from '../credentials/android-keystore-assets.ts';
import { pathExists } from '../path-exists.ts';
import { Prompts } from '../prompts.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { captureCommandOutput, checkCommandExists } from '../services/platform/execute-command.ts';
import { createLogger, type Logger } from '../services/platform/logger.ts';
import {
  checkIsMacOperatingSystem,
  readHostResources,
  resolveHostOperatingSystemLabel,
} from '../services/platform/host-operating-system.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { isApplePlatform, platformLabel } from '../services/stores/platform.ts';
import { SetupStoreReadiness } from '../services/stores/setup-store-readiness.ts';
import type { AppDescriptor, Platform } from '../types/app.ts';
import type { AscKey } from '../types/credentials.ts';
import { checkApp, formatFinding } from './config-check.ts';
import { loadConfig } from './config.ts';
import {
  DEFAULT_IN_REPO_ARTIFACT_DIR,
  ENV_EXAMPLE_TEMPLATE,
  configTemplate,
  detectAppRoot,
} from './config-scaffold.ts';
import { ensureArtifactDirIgnored } from './gitignore.ts';
import { inspectPackageSetup } from './package-manager.ts';
import {
  ANDROID_TOOLS,
  REQUIRED_TOOLS,
  type Tool,
  ensureToolchain,
  fixHint,
  missingRequiredTools,
} from './toolchain.ts';

type ReadinessStatus = 'ok' | 'todo' | 'info';

type ReadinessRow = Readonly<{
  label: string;
  status: ReadinessStatus;
  detail?: string;
}>;

type ReadinessGroup = Readonly<{
  title: string;
  rows: readonly ReadinessRow[];
}>;

export type SetupReadiness = Readonly<{
  groups: readonly ReadinessGroup[];
}>;

type ConfigFinding = Awaited<ReturnType<typeof checkApp>>[number];

type StoreAppProbe<AppId> = Readonly<{
  apps: readonly AppDescriptor[];
  selectAppId: (app: AppDescriptor) => AppId | undefined;
  checkStoreApp: (appId: AppId) => Promise<unknown>;
  requireTruthyPresence: boolean;
  okLabel: (appId: AppId) => string;
  missingDetail: string;
}>;

export type SetupOptions = Readonly<{
  platform: Platform;
  yes: boolean;
  rehearse: boolean;
}>;

type ToolchainInstall = Readonly<{
  platform: Platform;
  yes: boolean;
  terminalIsInteractive: boolean;
  isMacOperatingSystem: boolean;
  missingTools: readonly Tool[];
}>;

/** Return the ASCII marker for one readiness state. */
export function readinessMark(status: ReadinessStatus): string {
  switch (status) {
    case 'ok':
      return 'OK';
    case 'todo':
      return 'x';
    case 'info':
      return '-';
  }
}

function makeReadinessRow(label: string, status: ReadinessStatus, detail?: string): ReadinessRow {
  if (detail == null) {
    return { label, status };
  }

  return { label, status, detail };
}

/** Render one pending todo as a human-readable line. */
export function formatPendingTodoLine(readinessEntry: ReadinessRow): string {
  if (readinessEntry.detail == null) {
    return readinessEntry.label;
  }

  return `${readinessEntry.label} - ${readinessEntry.detail}`;
}

function detailSuffix(detail: string | undefined): string {
  if (detail == null) {
    return '';
  }

  return ` - ${detail}`;
}

/** Render the readiness board as plain terminal lines. */
export function formatSetupBoard(readiness: SetupReadiness): string[] {
  const boardLines: string[] = [];

  for (const readinessGroup of readiness.groups) {
    if (boardLines.length > 0) {
      boardLines.push('');
    }

    boardLines.push(readinessGroup.title);

    for (const readinessEntry of readinessGroup.rows) {
      boardLines.push(
        `  ${readinessMark(readinessEntry.status)} ${readinessEntry.label}${detailSuffix(readinessEntry.detail)}`,
      );
    }
  }

  return boardLines;
}

/** Return every setup gap that still needs user action. */
export function pendingTodos(readiness: SetupReadiness): ReadinessRow[] {
  const todoRows: ReadinessRow[] = [];

  for (const readinessGroup of readiness.groups) {
    for (const readinessEntry of readinessGroup.rows) {
      if (readinessEntry.status == 'todo') {
        todoRows.push(readinessEntry);
      }
    }
  }

  return todoRows;
}

/** Map tool availability into readiness entries. */
export function toolchainReadinessRows(
  tools: Tool[],
  presentCommands: Set<string>,
): ReadinessRow[] {
  return tools.map(readinessRowForTool);

  function readinessRowForTool(tool: Tool): ReadinessRow {
    if (presentCommands.has(tool.command)) {
      return makeReadinessRow(tool.label, 'ok');
    }

    if (tool.tier == 'recommended') {
      return makeReadinessRow(tool.label, 'info', `recommended - ${fixHint(tool)}`);
    }

    return makeReadinessRow(tool.label, 'todo', fixHint(tool));
  }
}

function versionSuffix(version: string | undefined): string {
  if (version == null) {
    return '';
  }

  return `@${version}`;
}

function workspaceSuffix(workspace: { kind: string } | null): string {
  if (workspace == null) {
    return '';
  }

  return ` - ${workspace.kind} workspace`;
}

async function environmentReadinessRows(): Promise<ReadinessRow[]> {
  const hostResources = readHostResources();
  const operatingSystemLabel = resolveHostOperatingSystemLabel();
  const launchDirectories = readLaunchDirectories();
  const packageSetup = await inspectPackageSetup(launchDirectories.workingDirectory);

  return [
    makeReadinessRow('Host', 'info', `${operatingSystemLabel} - ${hostResources.cores} cores`),
    makeReadinessRow(
      'Package manager',
      'info',
      `${packageSetup.pm.name}${versionSuffix(packageSetup.pm.version)}${workspaceSuffix(packageSetup.workspace)}`,
    ),
  ];
}

function configFileRow(configExists: boolean): ReadinessRow {
  if (configExists) {
    return makeReadinessRow('launch.config.ts', 'ok', 'present');
  }

  return makeReadinessRow('launch.config.ts', 'todo', 'run: launch-store init');
}

function appName(app: AppDescriptor): string {
  return app.name;
}

function detectedAppsRow(apps: readonly AppDescriptor[]): ReadinessRow {
  if (apps.length > 0) {
    return makeReadinessRow(`Apps detected: ${apps.length}`, 'ok', apps.map(appName).join(', '));
  }

  return makeReadinessRow('Apps', 'todo', "no app.json found - run Launch from your app's repo");
}

async function configReadinessRows(apps: readonly AppDescriptor[]): Promise<ReadinessRow[]> {
  const projectDirectory = readLaunchDirectories().workingDirectory;
  const launchPath = join(projectDirectory, 'launch.config.ts');
  const configExists = await pathExists(launchPath);

  return [configFileRow(configExists), detectedAppsRow(apps)];
}

function isStoreRecordPresent(storeApp: unknown, requireTruthyPresence: boolean): boolean {
  if (requireTruthyPresence == false) {
    return true;
  }

  return Boolean(storeApp);
}

async function storeAppRow<AppId>(
  storeAppProbe: StoreAppProbe<AppId>,
  app: AppDescriptor,
): Promise<ReadinessRow | null> {
  const appId = storeAppProbe.selectAppId(app);

  if (appId == null) {
    return null;
  }

  try {
    const storeApp = await storeAppProbe.checkStoreApp(appId);
    const isPresent = isStoreRecordPresent(storeApp, storeAppProbe.requireTruthyPresence);

    if (isPresent == false) {
      return makeReadinessRow(storeAppProbe.okLabel(appId), 'todo', storeAppProbe.missingDetail);
    }

    return makeReadinessRow(storeAppProbe.okLabel(appId), 'ok');
  } catch {
    return makeReadinessRow(storeAppProbe.okLabel(appId), 'todo', storeAppProbe.missingDetail);
  }
}

async function collectStoreAppRows<AppId>(
  storeAppProbe: StoreAppProbe<AppId>,
): Promise<ReadinessRow[]> {
  const storeRows: ReadinessRow[] = [];

  for (const app of storeAppProbe.apps) {
    const storeRow = await storeAppRow(storeAppProbe, app);

    if (storeRow != null) {
      storeRows.push(storeRow);
    }
  }

  return storeRows;
}

function appleBundleId(app: AppDescriptor): string | undefined {
  return app.bundleId;
}

function checkAppleBundle(ascKey: AscKey) {
  return function checkBundle(bundleId: string): Promise<boolean> {
    return new SetupStoreReadiness().checkAppleApp(ascKey, bundleId);
  };
}

async function appleAccountReadinessRows(apps: readonly AppDescriptor[]): Promise<ReadinessRow[]> {
  const activeAccount = await getActiveAccount();

  if (activeAccount == null) {
    return [
      makeReadinessRow(
        'Apple account',
        'todo',
        'import your App Store Connect key: launch-store creds set-key',
      ),
    ];
  }

  const accountSummary = formatAccountSummary(activeAccount, { includeLabel: false });
  const readinessEntries: ReadinessRow[] = [
    makeReadinessRow(`Apple account: ${activeAccount.label}`, 'ok', accountSummary),
  ];
  const ascKey = await loadActiveAscKey();

  if (ascKey == null) {
    return readinessEntries;
  }

  try {
    await new SetupStoreReadiness().checkAppleAgreements(ascKey);
  } catch (cause) {
    const failureMessage = errorMessage(cause);
    const makeReadiness = makeReadinessRow('Apple agreements', 'todo', failureMessage);

    readinessEntries.push(makeReadiness);

    return readinessEntries;
  }

  const makeReadiness = makeReadinessRow(
    'Apple agreements',
    'ok',
    'accepted - API-key auth (no password, no 2FA)',
  );

  readinessEntries.push(makeReadiness);

  const appleBundle = checkAppleBundle(ascKey);
  const storeRows = await collectStoreAppRows({
    apps,
    selectAppId: appleBundleId,
    checkStoreApp: appleBundle,
    requireTruthyPresence: true,
    okLabel: appleAppLabel,
    missingDetail: 'create it once at appstoreconnect.apple.com/apps',
  });

  for (const storeRow of storeRows) {
    readinessEntries.push(storeRow);
  }

  return readinessEntries;
}

function appleAppLabel(bundleId: string): string {
  return `App Store record - ${bundleId}`;
}

function hasPlayPackage(app: AppDescriptor): app is AppDescriptor & { packageName: string } {
  if (app.packageName == null) {
    return false;
  }

  if (app.packageName == '') {
    return false;
  }

  return true;
}

function playPackageName(app: AppDescriptor): string | undefined {
  return app.packageName;
}

function playAppLabel(packageName: string): string {
  return `Play app - ${packageName}`;
}

function checkPlayPackage(serviceAccountJson: string) {
  return function checkPackage(packageName: string): Promise<void> {
    return new SetupStoreReadiness().checkPlayApp(serviceAccountJson, packageName);
  };
}

async function playRowsForPackage(
  app: AppDescriptor & { packageName: string },
): Promise<ReadinessRow[]> {
  const serviceAccountJson = await loadServiceAccount(app.packageName);

  if (serviceAccountJson == null) {
    return [
      makeReadinessRow(
        `Play service account - ${app.packageName}`,
        'todo',
        `import it: launch-store creds set-key --platform android --app ${app.name}`,
      ),
    ];
  }

  const playPackage = checkPlayPackage(serviceAccountJson);

  return collectStoreAppRows({
    apps: [app],
    selectAppId: playPackageName,
    checkStoreApp: playPackage,
    requireTruthyPresence: false,
    okLabel: playAppLabel,
    missingDetail: 'create + enroll in Play App Signing at play.google.com/console',
  });
}

async function playRowsForApp(app: AppDescriptor): Promise<ReadinessRow[]> {
  if (hasPlayPackage(app)) {
    return playRowsForPackage(app);
  }

  return [];
}

async function playAccountReadinessRows(apps: readonly AppDescriptor[]): Promise<ReadinessRow[]> {
  const readinessEntries: ReadinessRow[] = [];

  for (const app of apps) {
    const playRows = await playRowsForApp(app);

    for (const playRow of playRows) {
      readinessEntries.push(playRow);
    }
  }

  return readinessEntries;
}

async function signingReadinessRows(): Promise<ReadinessRow[]> {
  if (checkIsMacOperatingSystem() == false) {
    return [];
  }

  try {
    var identityListing = await captureCommandOutput('security', [
      'find-identity',
      '-v',
      '-p',
      'codesigning',
    ]);
  } catch {
    return [
      makeReadinessRow('Distribution identity', 'info', 'could not query codesign identities'),
    ];
  }

  // Matches an Apple distribution certificate in the codesign identity list.
  const hasDistributionIdentity = /Apple Distribution|iPhone Distribution/.test(identityListing);

  if (hasDistributionIdentity) {
    return [
      makeReadinessRow(
        'Distribution identity',
        'ok',
        'visible to codesign (login keychain - Tahoe-safe)',
      ),
    ];
  }

  return [
    makeReadinessRow(
      'Distribution identity',
      'info',
      'none yet - the build provisions one, or run: launch-store creds setup',
    ),
  ];
}

function readinessStatus(severity: ConfigFinding['severity']): ReadinessStatus {
  if (severity == 'error') {
    return 'todo';
  }

  return 'info';
}

async function appConfigRows(app: AppDescriptor, platform: Platform): Promise<ReadinessRow[]> {
  const findings = await checkApp(app, platform);

  if (findings.length == 0) {
    return [makeReadinessRow(app.name, 'ok', 'app config clean')];
  }

  return findings.map(findingRow);

  function findingRow(finding: ConfigFinding): ReadinessRow {
    return makeReadinessRow(app.name, readinessStatus(finding.severity), formatFinding(finding));
  }
}

async function appConfigReadinessRows(
  apps: readonly AppDescriptor[],
  platform: Platform,
): Promise<ReadinessRow[]> {
  const readinessEntries: ReadinessRow[] = [];

  for (const app of apps) {
    const appRows = await appConfigRows(app, platform);

    for (const appRow of appRows) {
      readinessEntries.push(appRow);
    }
  }

  return readinessEntries;
}

function toolsForPlatform(platform: Platform): Tool[] {
  if (platform == 'android') {
    return [...ANDROID_TOOLS];
  }

  return [...REQUIRED_TOOLS];
}

async function presentToolCommands(tools: readonly Tool[]): Promise<Set<string>> {
  const presentCommands = new Set<string>();

  for (const tool of tools) {
    const isPresent = await checkCommandExists(tool.command);

    if (isPresent) {
      presentCommands.add(tool.command);
    }
  }

  return presentCommands;
}

async function appleReadinessGroups(apps: readonly AppDescriptor[]): Promise<ReadinessGroup[]> {
  const groups: ReadinessGroup[] = [
    { title: 'Apple account', rows: await appleAccountReadinessRows(apps) },
  ];
  const signingEntries = await signingReadinessRows();

  if (signingEntries.length > 0) {
    groups.push({ title: 'Signing', rows: signingEntries });
  }

  return groups;
}

async function accountReadinessGroups(
  platform: Platform,
  apps: readonly AppDescriptor[],
): Promise<ReadinessGroup[]> {
  if (isApplePlatform(platform)) {
    return appleReadinessGroups(apps);
  }

  return [{ title: 'Google Play', rows: await playAccountReadinessRows(apps) }];
}

async function collectReadiness(
  platform: Platform,
  apps: readonly AppDescriptor[],
): Promise<SetupReadiness> {
  const tools = toolsForPlatform(platform);
  const presentCommands = await presentToolCommands(tools);
  const readinessGroups: ReadinessGroup[] = [
    { title: 'Environment', rows: await environmentReadinessRows() },
    { title: 'Config', rows: await configReadinessRows(apps) },
    { title: 'Toolchain', rows: toolchainReadinessRows(tools, presentCommands) },
  ];
  const accountGroups = await accountReadinessGroups(platform, apps);

  for (const accountGroup of accountGroups) {
    readinessGroups.push(accountGroup);
  }

  const appReadinessRows = await appConfigReadinessRows(apps, platform);

  readinessGroups.push({
    title: 'App config',
    rows: appReadinessRows,
  });

  return { groups: readinessGroups };
}

function resolveConfiguredArtifactDirectory(artifactDir: string, projectDirectory: string): string {
  const directories = readLaunchDirectories();
  const configuredDirectory = artifactDir.trim();

  const isEmpty = configuredDirectory.length == 0;

  if (isEmpty) {
    throw {
      _tag: 'ArtifactDirectoryFailure',
      message:
        '`artifactDir` in launch.config.ts must not be empty - set a path or omit it for ~/.launch/artifacts.',
    };
  }

  if (configuredDirectory == '~') {
    return directories.homeDirectory;
  }

  const isHomeRelative = configuredDirectory.startsWith('~/');

  if (isHomeRelative) {
    return resolve(directories.homeDirectory, configuredDirectory.slice(2));
  }

  if (isAbsolute(configuredDirectory)) {
    return configuredDirectory;
  }

  return resolve(projectDirectory, configuredDirectory);
}

function resolveSetupArtifactDirectory(
  artifactDir: string | undefined,
  projectDirectory: string,
): string {
  if (artifactDir == null) {
    const launchDirectories = readLaunchDirectories();
    return join(launchDirectories.homeDirectory, '.launch', 'artifacts');
  }

  return resolveConfiguredArtifactDirectory(artifactDir, projectDirectory);
}

async function scaffoldConfig(apps: readonly AppDescriptor[]): Promise<void> {
  const projectDirectory = readLaunchDirectories().workingDirectory;
  const appRoot = detectAppRoot([...apps], projectDirectory);

  const launchPath = join(projectDirectory, 'launch.config.ts');
  const template = configTemplate(appRoot, undefined, undefined, DEFAULT_IN_REPO_ARTIFACT_DIR);

  await writeFile(launchPath, template);

  const environmentExamplePath = join(projectDirectory, '.env.example');
  const exampleExists = await pathExists(environmentExamplePath);

  if (exampleExists == false) {
    await writeFile(environmentExamplePath, ENV_EXAMPLE_TEMPLATE);
  }

  const setupArtifactDirectory = resolveSetupArtifactDirectory(
    DEFAULT_IN_REPO_ARTIFACT_DIR,
    projectDirectory,
  );

  await ensureArtifactDirIgnored(setupArtifactDirectory, projectDirectory);
}

/** Whether setup may attempt toolchain installs under the current TTY/`--yes` policy. */
export function mayInstallToolchain(terminalIsInteractive: boolean, yes: boolean): boolean {
  if (yes) {
    return true;
  }

  return terminalIsInteractive;
}

async function installToolchainWhenAllowed(installRequest: ToolchainInstall): Promise<void> {
  if (isApplePlatform(installRequest.platform) == false) {
    return;
  }

  if (installRequest.isMacOperatingSystem == false) {
    return;
  }

  if (mayInstallToolchain(installRequest.terminalIsInteractive, installRequest.yes) == false) {
    return;
  }

  if (installRequest.missingTools.length == 0) {
    return;
  }

  await ensureToolchain({ assumeYes: installRequest.yes });
}

async function ensureLaunchConfig(
  projectDirectory: string,
  logger: Logger,
): Promise<readonly AppDescriptor[]> {
  let loadedConfiguration = await loadConfig(projectDirectory);
  const launchPath = join(projectDirectory, 'launch.config.ts');

  const configExists = await pathExists(launchPath);

  if (configExists) {
    logger.step('config', 'launch.config.ts present');

    return loadedConfiguration.apps;
  }

  await scaffoldConfig(loadedConfiguration.apps);
  logger.step('config', 'scaffolded launch.config.ts + .env.example');
  loadedConfiguration = await loadConfig(projectDirectory);

  return loadedConfiguration.apps;
}

async function rehearsePipeline(
  options: SetupOptions,
  apps: readonly AppDescriptor[],
  logger: Logger,
): Promise<void> {
  if (options.rehearse == false) {
    return;
  }

  const firstApp = apps[0];

  if (firstApp == null) {
    return;
  }

  logger.gap();
  logger.notice('Rehearsing the pipeline', 'Dry-run - no build, no network, no account changes.');

  try {
    await runBuild({
      platform: options.platform,
      appName: firstApp.name,
      profileName: 'production',
      explain: false,
      submit: true,
      dryRun: true,
    });
  } catch (cause) {
    const failureMessage = errorMessage(cause);
    logger.warn(`Rehearsal stopped early: ${failureMessage}`);
  }
}

function stepSuffix(todoCount: number): string {
  if (todoCount == 1) {
    return '';
  }

  return 's';
}

function reportRemainingTodos(report: {
  readiness: SetupReadiness;
  platform: Platform;
  terminalIsInteractive: boolean;
  logger: Logger;
}): void {
  const remainingTodos = pendingTodos(report.readiness);

  report.logger.gap();

  if (remainingTodos.length == 0) {
    report.logger.box("You're ready", [`Ship it now:  launch-store build ${report.platform}`]);

    return;
  }

  report.logger.notice(
    `Almost there - ${remainingTodos.length} step${stepSuffix(remainingTodos.length)} left:`,
    ...remainingTodos.map(formatPendingTodoLine),
  );

  if (report.terminalIsInteractive == false) {
    report.logger.note(
      'Re-run `launch-store setup` once those are done to confirm everything is green.',
    );
  }
}

/** Configure safe defaults, report remaining gaps, and optionally rehearse the pipeline. */
export async function runSetup(options: SetupOptions): Promise<void> {
  const logger = createLogger(false);

  logger.notice(
    'Launch setup',
    `Getting your ${platformLabel(options.platform)} app ready to ship - hands-off where it is safe.`,
  );

  const projectDirectory = readLaunchDirectories().workingDirectory;
  const apps = await ensureLaunchConfig(projectDirectory, logger);
  const terminalIsInteractive = new Prompts().isInteractive();

  const isMacOperatingSystem = checkIsMacOperatingSystem();

  await installToolchainWhenAllowed({
    platform: options.platform,
    yes: options.yes,
    terminalIsInteractive,
    isMacOperatingSystem: isMacOperatingSystem,
    missingTools: await missingRequiredTools(),
  });

  const readiness = await collectReadiness(options.platform, apps);

  logger.gap();

  const setupBoard = formatSetupBoard(readiness);

  logger.box('Launch setup', setupBoard);
  await rehearsePipeline(options, apps, logger);
  reportRemainingTodos({
    readiness,
    platform: options.platform,
    terminalIsInteractive,
    logger,
  });
}

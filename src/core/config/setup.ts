import { FileSystem, Path } from '@effect/platform';
import { Effect } from 'effect';
import {
  formatAccountSummary,
  getActiveAccount,
  loadActiveAscKey,
} from '../credentials/accounts.js';
import { loadServiceAccount } from '../credentials/androidKeystore.js';
import { runBuild } from '../build/pipeline.js';
import { resolveArtifactDir } from '../distribution/storage.js';
import { errorMessage } from '../services/errorMessage.js';
import {
  captureCommandOutput,
  checkCommandExists,
  provideNodeCommandServices,
} from '../services/exec.js';
import { createLogger } from '../services/logger.js';
import {
  checkIsMacOperatingSystem,
  readHostResources,
  resolveHostOperatingSystemLabel,
} from '../services/os.js';
import { isApplePlatform, platformLabel } from '../services/platform.js';
import { checkTerminalIsInteractive } from '../services/progress.js';
import { SetupStoreReadiness } from '../services/setupStoreReadiness.js';
import { LaunchPaths } from '../services/paths.js';
import type { AppDescriptor, Platform } from '../types/app.js';
import { checkApp, formatFinding } from './configCheck.js';
import {
  DEFAULT_IN_REPO_ARTIFACT_DIR,
  ENV_EXAMPLE_TEMPLATE,
  configTemplate,
  detectAppRoot,
} from './configScaffold.js';
import { loadConfig } from './config.js';
import { ensureArtifactDirIgnored } from './gitignore.js';
import { inspectPackageSetup } from './packageManager.js';
import {
  ANDROID_TOOLS,
  REQUIRED_TOOLS,
  type Tool,
  ensureToolchain,
  fixHint,
  missingRequiredTools,
} from './toolchain.js';

export type ReadinessStatus = 'ok' | 'todo' | 'info';
export type ReadinessRow = {
  label: string;
  status: ReadinessStatus;
  detail?: string;
};
export type ReadinessGroup = {
  title: string;
  rows: ReadinessRow[];
};
export type SetupReadiness = {
  groups: ReadinessGroup[];
};

/** Return the ASCII marker for one readiness state. */
const readinessMark = (status: ReadinessStatus): string => {
  switch (status) {
    case 'ok':
      return 'OK';
    case 'todo':
      return 'x';
    case 'info':
      return '-';
  }
};

/** Construct one readiness entry without an explicit undefined detail. */
const makeReadinessRow = (
  label: string,
  status: ReadinessStatus,
  detail?: string,
): ReadinessRow => {
  if (detail === undefined) return { label, status };
  return { label, status, detail };
};

/** Render the readiness board as plain terminal lines. */
export const formatSetupBoard = (readiness: SetupReadiness): string[] => {
  const boardLines: string[] = [];
  for (const readinessGroup of readiness.groups) {
    if (boardLines.length > 0) boardLines.push('');
    boardLines.push(readinessGroup.title);
    for (const readinessEntry of readinessGroup.rows) {
      let detailText = '';
      if (readinessEntry.detail !== undefined) detailText = ` - ${readinessEntry.detail}`;
      boardLines.push(
        `  ${readinessMark(readinessEntry.status)} ${readinessEntry.label}${detailText}`,
      );
    }
  }
  return boardLines;
};

/** Return every setup gap that still needs user action. */
export const pendingTodos = (readiness: SetupReadiness): ReadinessRow[] => {
  return readiness.groups.flatMap((readinessGroup) => {
    return readinessGroup.rows.filter((readinessEntry) => readinessEntry.status === 'todo');
  });
};

/** Map tool availability into readiness entries. */
export const toolchainReadinessRows = (
  tools: Tool[],
  presentCommands: Set<string>,
): ReadinessRow[] => {
  return tools.map((tool) => {
    if (presentCommands.has(tool.command)) return makeReadinessRow(tool.label, 'ok');
    if (tool.tier === 'recommended')
      return makeReadinessRow(tool.label, 'info', `recommended - ${fixHint(tool)}`);
    return makeReadinessRow(tool.label, 'todo', fixHint(tool));
  });
};

/** Read host and package-manager facts for the Environment group. */
const environmentReadinessRows = () =>
  Effect.gen(function* () {
    const { cores } = yield* readHostResources;
    const operatingSystemLabel = yield* resolveHostOperatingSystemLabel;
    const packageSetup = yield* inspectPackageSetup((yield* LaunchPaths).workingDirectory);
    let packageManagerVersion = '';
    if (packageSetup.pm.version !== undefined)
      packageManagerVersion = `@${packageSetup.pm.version}`;
    let workspaceText = '';
    if (packageSetup.workspace !== null)
      workspaceText = ` - ${packageSetup.workspace.kind} workspace`;
    return [
      makeReadinessRow('Host', 'info', `${operatingSystemLabel} - ${cores} cores`),
      makeReadinessRow(
        'Package manager',
        'info',
        `${packageSetup.pm.name}${packageManagerVersion}${workspaceText}`,
      ),
    ];
  });

/** Describe configuration discovery without changing the project. */
const configReadinessRows = (apps: AppDescriptor[]) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const projectDirectory = (yield* LaunchPaths).workingDirectory;
    const readinessEntries: ReadinessRow[] = [];
    if (yield* fileSystem.exists(pathService.join(projectDirectory, 'launch.config.ts')))
      readinessEntries.push(makeReadinessRow('launch.config.ts', 'ok', 'present'));
    else readinessEntries.push(makeReadinessRow('launch.config.ts', 'todo', 'run: launch init'));
    if (apps.length > 0) {
      readinessEntries.push(
        makeReadinessRow(
          `Apps detected: ${apps.length}`,
          'ok',
          apps.map((app) => app.name).join(', '),
        ),
      );
    } else {
      readinessEntries.push(
        makeReadinessRow('Apps', 'todo', "no app.json found - run Launch from your app's repo"),
      );
    }
    return readinessEntries;
  });

/** Probe the active Apple account and each configured App Store record. */
const appleAccountReadinessRows = (apps: AppDescriptor[]) =>
  Effect.gen(function* () {
    const activeAccount = yield* getActiveAccount();
    if (activeAccount === null) {
      return [
        makeReadinessRow(
          'Apple account',
          'todo',
          'import your App Store Connect key: launch creds set-key',
        ),
      ];
    }
    const readinessEntries = [
      makeReadinessRow(
        `Apple account: ${activeAccount.label}`,
        'ok',
        formatAccountSummary(activeAccount, { includeLabel: false }),
      ),
    ];
    const ascKey = yield* loadActiveAscKey();
    if (ascKey === null) return readinessEntries;
    const storeReadiness = yield* SetupStoreReadiness;
    const agreementCheck = yield* storeReadiness.checkAppleAgreements(ascKey).pipe(Effect.either);
    if (agreementCheck._tag === 'Left') {
      readinessEntries.push(
        makeReadinessRow('Apple agreements', 'todo', errorMessage(agreementCheck.left)),
      );
      return readinessEntries;
    }
    readinessEntries.push(
      makeReadinessRow('Apple agreements', 'ok', 'accepted - API-key auth (no password, no 2FA)'),
    );
    yield* Effect.forEach(
      apps,
      (app) =>
        Effect.gen(function* () {
          if (app.bundleId === undefined) return;
          const appCheck = yield* storeReadiness
            .checkAppleApp(ascKey, app.bundleId)
            .pipe(Effect.either);
          if (appCheck._tag === 'Right' && appCheck.right) {
            readinessEntries.push(makeReadinessRow(`App Store record - ${app.bundleId}`, 'ok'));
            return;
          }
          readinessEntries.push(
            makeReadinessRow(
              `App Store record - ${app.bundleId}`,
              'todo',
              'create it once at appstoreconnect.apple.com/apps',
            ),
          );
        }),
      { concurrency: 1, discard: true },
    );
    return readinessEntries;
  });

/** Probe the stored Play account and each configured Play application. */
const playAccountReadinessRows = (apps: AppDescriptor[]) =>
  Effect.gen(function* () {
    const serviceAccountJson = yield* loadServiceAccount();
    if (serviceAccountJson === null) {
      return [
        makeReadinessRow(
          'Play service account',
          'todo',
          'import it: launch creds set-key --platform android',
        ),
      ];
    }
    const readinessEntries = [makeReadinessRow('Play service account', 'ok', 'imported')];
    const storeReadiness = yield* SetupStoreReadiness;
    yield* Effect.forEach(
      apps,
      (app) =>
        Effect.gen(function* () {
          if (app.packageName === undefined) return;
          const appCheck = yield* storeReadiness
            .checkPlayApp(serviceAccountJson, app.packageName)
            .pipe(Effect.either);
          if (appCheck._tag === 'Right') {
            readinessEntries.push(makeReadinessRow(`Play app - ${app.packageName}`, 'ok'));
            return;
          }
          readinessEntries.push(
            makeReadinessRow(
              `Play app - ${app.packageName}`,
              'todo',
              'create + enroll in Play App Signing at play.google.com/console',
            ),
          );
        }),
      { concurrency: 1, discard: true },
    );
    return readinessEntries;
  });

/** Check whether codesign can see a distribution identity on macOS. */
const signingReadinessRows = (): Effect.Effect<ReadinessRow[], never> =>
  Effect.gen(function* () {
    const isMacOperatingSystem = yield* checkIsMacOperatingSystem;
    if (!isMacOperatingSystem) return [];
    const identityCheck = yield* provideNodeCommandServices(
      captureCommandOutput('security', ['find-identity', '-v', '-p', 'codesigning']),
    ).pipe(Effect.either);
    if (identityCheck._tag === 'Left') {
      return [
        makeReadinessRow('Distribution identity', 'info', 'could not query codesign identities'),
      ];
    }
    if (/Apple Distribution|iPhone Distribution/.test(identityCheck.right)) {
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
        'none yet - the build provisions one, or run: launch creds setup',
      ),
    ];
  });

/** Check each app for configuration findings on the selected platform. */
const appConfigReadinessRows = (apps: AppDescriptor[], platform: Platform) =>
  Effect.gen(function* () {
    const readinessEntries: ReadinessRow[] = [];
    yield* Effect.forEach(
      apps,
      (app) =>
        Effect.gen(function* () {
          const findings = yield* checkApp(app, platform);
          if (findings.length === 0) {
            readinessEntries.push(makeReadinessRow(app.name, 'ok', 'app config clean'));
            return;
          }
          for (const finding of findings) {
            let readinessStatus: ReadinessStatus = 'info';
            if (finding.severity === 'error') readinessStatus = 'todo';
            readinessEntries.push(
              makeReadinessRow(app.name, readinessStatus, formatFinding(finding)),
            );
          }
        }),
      { concurrency: 1, discard: true },
    );
    return readinessEntries;
  });

/** Collect the complete setup readiness picture without changing external state. */
export const collectReadiness = (platform: Platform, apps: AppDescriptor[]) =>
  Effect.gen(function* () {
    let tools = REQUIRED_TOOLS;
    if (platform === 'android') tools = ANDROID_TOOLS;
    const presentCommands = new Set<string>();
    yield* Effect.forEach(
      tools,
      (tool) =>
        provideNodeCommandServices(checkCommandExists(tool.command)).pipe(
          Effect.tap((isPresent) =>
            Effect.sync(() => {
              if (isPresent) presentCommands.add(tool.command);
            }),
          ),
        ),
      { concurrency: 1, discard: true },
    );
    const readinessGroups: ReadinessGroup[] = [
      { title: 'Environment', rows: yield* environmentReadinessRows() },
      { title: 'Config', rows: yield* configReadinessRows(apps) },
      { title: 'Toolchain', rows: toolchainReadinessRows(tools, presentCommands) },
    ];
    if (isApplePlatform(platform)) {
      readinessGroups.push({
        title: 'Apple account',
        rows: yield* appleAccountReadinessRows(apps),
      });
      const signingEntries = yield* signingReadinessRows();
      if (signingEntries.length > 0)
        readinessGroups.push({ title: 'Signing', rows: signingEntries });
    } else {
      readinessGroups.push({
        title: 'Google Play',
        rows: yield* playAccountReadinessRows(apps),
      });
    }
    readinessGroups.push({
      title: 'App config',
      rows: yield* appConfigReadinessRows(apps, platform),
    });
    return { groups: readinessGroups };
  });

/** Write the initial config files and ignore the in-repository artifact directory. */
const scaffoldConfig = (apps: AppDescriptor[]) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const projectDirectory = (yield* LaunchPaths).workingDirectory;
    const appRoot = yield* detectAppRoot(apps, projectDirectory);
    yield* fileSystem.writeFileString(
      pathService.join(projectDirectory, 'launch.config.ts'),
      configTemplate(appRoot, undefined, undefined, DEFAULT_IN_REPO_ARTIFACT_DIR),
    );
    const environmentExamplePath = pathService.join(projectDirectory, '.env.example');
    if (!(yield* fileSystem.exists(environmentExamplePath))) {
      yield* fileSystem.writeFileString(environmentExamplePath, ENV_EXAMPLE_TEMPLATE);
    }
    yield* ensureArtifactDirIgnored(
      yield* resolveArtifactDir(DEFAULT_IN_REPO_ARTIFACT_DIR, projectDirectory),
      projectDirectory,
    );
  });

export type SetupOptions = {
  platform: Platform;
  yes: boolean;
  rehearse: boolean;
};

/** Rehearse the build pipeline without changing external state. */
const rehearsePipeline = (platform: Platform, app: AppDescriptor) => {
  return runBuild({
    platform,
    appName: app.name,
    profileName: 'production',
    explain: false,
    submit: true,
    target: 'testing',
    dryRun: true,
  });
};

/** Configure safe defaults, report remaining gaps, and optionally rehearse the pipeline. */
export const runSetup = (options: SetupOptions) =>
  Effect.gen(function* () {
    const { platform, yes, rehearse } = options;
    const logger = yield* createLogger(false);
    yield* logger.notice(
      'Launch setup',
      `Getting your ${platformLabel(platform)} app ready to ship - hands-off where it is safe.`,
    );

    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const projectDirectory = (yield* LaunchPaths).workingDirectory;
    let loadedConfig = yield* loadConfig(projectDirectory);
    let apps = loadedConfig.apps;
    if (yield* fileSystem.exists(pathService.join(projectDirectory, 'launch.config.ts'))) {
      yield* logger.step('config', 'launch.config.ts present');
    } else {
      yield* scaffoldConfig(apps);
      yield* logger.step('config', 'scaffolded launch.config.ts + .env.example');
      loadedConfig = yield* loadConfig(projectDirectory);
      apps = loadedConfig.apps;
    }

    const terminalIsInteractive = yield* checkTerminalIsInteractive;
    let mayInstallTools = terminalIsInteractive;
    if (yes) mayInstallTools = true;
    const isMacOperatingSystem = yield* checkIsMacOperatingSystem;
    const missingTools = yield* missingRequiredTools();
    if (
      isApplePlatform(platform) &&
      isMacOperatingSystem &&
      mayInstallTools &&
      missingTools.length > 0
    ) {
      let assumeToolInstallConsent = !terminalIsInteractive;
      if (yes) assumeToolInstallConsent = true;
      yield* ensureToolchain({ assumeYes: assumeToolInstallConsent });
    }

    const readiness = yield* collectReadiness(platform, apps);
    yield* logger.gap();
    yield* logger.box('Launch setup', formatSetupBoard(readiness));

    const firstApp = apps[0];
    if (rehearse && firstApp !== undefined) {
      yield* logger.gap();
      yield* logger.notice(
        'Rehearsing the pipeline',
        'Dry-run - no build, no network, no account changes.',
      );
      const rehearsal = yield* rehearsePipeline(platform, firstApp).pipe(Effect.either);
      if (rehearsal._tag === 'Left')
        yield* logger.warn(`Rehearsal stopped early: ${errorMessage(rehearsal.left)}`);
    }

    const remainingTodos = pendingTodos(readiness);
    yield* logger.gap();
    if (remainingTodos.length === 0) {
      yield* logger.box("You're ready", [`Ship it now:  launch build ${platform}`]);
      return;
    }
    let stepSuffix = 's';
    if (remainingTodos.length === 1) stepSuffix = '';
    yield* logger.notice(
      `Almost there - ${remainingTodos.length} step${stepSuffix} left:`,
      ...remainingTodos.map((readinessEntry) => {
        if (readinessEntry.detail === undefined) return readinessEntry.label;
        return `${readinessEntry.label} - ${readinessEntry.detail}`;
      }),
    );
    if (!terminalIsInteractive) {
      yield* logger.note(
        'Re-run `launch setup` once those are done to confirm everything is green.',
      );
    }
  });

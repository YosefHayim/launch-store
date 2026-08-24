import { FileSystem, Path, Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { adoptCommandProgram } from '../adopt/command.js';
import { countPrunableBuilds, runPrune } from '../build/buildHistoryCommand.js';
import { runEasBuild } from '../build/easPipeline.js';
import { prepareBuild, runBuild } from '../build/pipeline.js';
import { DEFAULT_SIZE_BUDGET_MB, type BuildRunOptions } from '../build/pipelineTypes.js';
import { loadConfig } from '../config/config.js';
import { hasSeenTour, markTourSeen } from '../config/firstRun.js';
import { initCommandProgram } from '../config/initCommand.js';
import { setupCommandProgram } from '../config/setupCommand.js';
import { missingRequiredTools } from '../config/toolchain.js';
import { chooseAccountInteractive, setupIos } from '../credentials/command.js';
import {
  formatAccountSummary,
  getActiveAccount,
  listAccounts,
  setActiveKeyId,
} from '../credentials/accounts.js';
import { readLastFlow, rememberLastFlow, type LastFlow } from '../distribution/lastRun.js';
import { runDoctorProgram } from '../doctor/command.js';
import {
  aiScreenshotsCommandProgram,
  ensureGenshotForInteractiveScreenshotsLive,
} from '../listing/aiScreenshotsCommand.js';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger, outroDone } from '../services/logger.js';
import { checkIsMacOperatingSystem, resolveHostOperatingSystemLabel } from '../services/os.js';
import { LaunchPaths } from '../services/paths.js';
import { LaunchPrompt, type PromptSelectionFailure } from '../services/prompt.js';
import type { AppDescriptor, BuildLocation, Platform } from '../types/app.js';
import type { LaunchConfig } from '../types/config.js';
import { explainTopic, type GlossaryTopic } from './glossary.js';
import { promptTourPlatform } from './demoCommand.js';
import { runTour } from './tour.js';

export const WizardCommandInputSchema = Schema.Struct({});

export type WizardCommandFailure = Readonly<{
  readonly _tag: 'WizardCommandFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeWizardCommandFailure = Data.tagged<WizardCommandFailure>('WizardCommandFailure');

type WizardMenuSelection = 'build' | 'adopt' | 'setup' | 'screenshots' | 'prune';

/** Build the no-argument TUI menu, including optional cleanup when old builds exist. */
export const wizardMenuChoices = (
  prunableBuildCount: number,
): ReadonlyArray<{
  readonly selection: WizardMenuSelection;
  readonly label: string;
  readonly hint: string;
}> => {
  const menuChoices: Array<{
    selection: WizardMenuSelection;
    label: string;
    hint: string;
  }> = [
    { selection: 'build', label: 'Build an app', hint: 'compile, check size, upload' },
    {
      selection: 'screenshots',
      label: 'Generate store screenshots',
      hint: 'install/sign in to Genshot, then enhance real app screens',
    },
    {
      selection: 'adopt',
      label: 'Adopt an existing app',
      hint: "import an already-shipping app's store setup",
    },
    {
      selection: 'setup',
      label: 'Set up Launch',
      hint: 'config, account, toolchain, signing',
    },
  ];
  if (prunableBuildCount <= 0) return menuChoices;
  let buildLabel = 'builds';
  if (prunableBuildCount === 1) buildLabel = 'build';
  menuChoices.push({
    selection: 'prune',
    label: 'Clean up old builds',
    hint: `${prunableBuildCount} ${buildLabel} past the retention window`,
  });
  return menuChoices;
};

/** Build the shared pipeline input for one wizard run. */
const buildRunOptions = (
  platform: Platform,
  profileName: string,
  submit: boolean,
  sizeBudgetMB?: number,
): BuildRunOptions => {
  const commandOptions: BuildRunOptions = {
    platform,
    profileName,
    explain: false,
    submit,
    target: 'testing',
    dryRun: false,
  };
  if (sizeBudgetMB !== undefined) commandOptions.sizeBudgetMB = sizeBudgetMB;
  return commandOptions;
};

/** Print the glossary teaching block that introduces one wizard decision. */
const teach = (topic: GlossaryTopic, title: string) =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    yield* logger.notice(title, explainTopic(topic));
  });

/** Select the app platform while showing whether each store is configured. */
const selectPlatform = (configuredApps: readonly AppDescriptor[]) =>
  Effect.gen(function* () {
    const hasIosApp = configuredApps.some((configuredApp) => configuredApp.bundleId !== undefined);
    const hasAndroidApp = configuredApps.some(
      (configuredApp) => configuredApp.packageName !== undefined,
    );
    let iosHint = 'no iOS app configured';
    if (hasIosApp) iosHint = 'build and sign on macOS, a remote Mac, or EAS';
    let androidHint = 'no Android app configured';
    if (hasAndroidApp) androidHint = 'build locally on any OS';
    const prompt = yield* LaunchPrompt;
    return yield* prompt.select<Platform>({
      message: 'Which platform?',
      choices: [
        {
          selection: 'ios',
          label: 'iOS',
          hint: iosHint,
        },
        {
          selection: 'android',
          label: 'Android',
          hint: androidHint,
        },
      ],
    });
  });

/** Select where an Apple build should run. */
const selectBuildLocation = () =>
  Effect.gen(function* () {
    const locationChoices: Array<{
      selection: BuildLocation;
      label: string;
      hint: string;
    }> = [];
    if (yield* checkIsMacOperatingSystem) {
      locationChoices.push({
        selection: 'local',
        label: 'This Mac',
        hint: 'fastest; your local Xcode',
      });
    }
    locationChoices.push(
      { selection: 'aws', label: 'AWS cloud Mac', hint: 'your own AWS; about $16 min / 24h' },
      { selection: 'ssh', label: 'A Mac over SSH', hint: 'a Mac you already reach' },
      { selection: 'eas', label: 'Expo EAS', hint: "Expo's cloud; free-tier caps" },
    );
    const prompt = yield* LaunchPrompt;
    return yield* prompt.select({ message: 'Where should we build?', choices: locationChoices });
  });

/** Select a named build profile from the loaded Launch configuration. */
const selectProfile = (launchConfig: LaunchConfig) =>
  Effect.gen(function* () {
    const profileNames = Object.keys(launchConfig.profiles);
    if (profileNames.length === 0) return 'production';
    const profileChoices = profileNames.map((profileName) => {
      const configuredBudget = launchConfig.profiles[profileName]?.sizeBudgetMB;
      if (configuredBudget === undefined) {
        return { selection: profileName, label: profileName };
      }
      return {
        selection: profileName,
        label: profileName,
        hint: `budget ${configuredBudget} MB`,
      };
    });
    let initialProfile = profileNames[0];
    if (profileNames.includes('production')) initialProfile = 'production';
    if (initialProfile === undefined) initialProfile = 'production';
    const prompt = yield* LaunchPrompt;
    return yield* prompt.select({
      message: 'Which profile?',
      choices: profileChoices,
      initialSelection: initialProfile,
    });
  });

/** Return the selected profile budget or the pipeline default. */
export const profileBudgetMB = (launchConfig: LaunchConfig, profileName: string): number => {
  const configuredBudget = launchConfig.profiles[profileName]?.sizeBudgetMB;
  if (configuredBudget === undefined) return DEFAULT_SIZE_BUDGET_MB;
  return configuredBudget;
};

/** Validate a positive custom size-budget entry. */
export const validateCustomBudget = (enteredText: string): string | undefined => {
  const parsedBudget = Number.parseFloat(enteredText);
  if (Number.isNaN(parsedBudget)) return 'Enter a number of megabytes.';
  if (parsedBudget <= 0) return 'Enter a budget greater than 0 MB.';
  return undefined;
};

/** Select the profile budget or read a custom per-build override. */
const selectSizeBudget = (launchConfig: LaunchConfig, profileName: string) =>
  Effect.gen(function* () {
    const configuredBudget = profileBudgetMB(launchConfig, profileName);
    const prompt = yield* LaunchPrompt;
    const budgetChoice = yield* prompt.select<'profile' | 'custom'>({
      message: 'Size budget for this build?',
      choices: [
        {
          selection: 'profile',
          label: `Use profile budget (${configuredBudget} MB)`,
          hint: 'no change',
        },
        {
          selection: 'custom',
          label: 'Enter a custom budget...',
          hint: 'this build only',
        },
      ],
      initialSelection: 'profile',
    });
    if (budgetChoice === 'profile') return undefined;
    const enteredBudget = yield* prompt.requiredText('Custom size budget (MB)');
    const validationMessage = validateCustomBudget(enteredBudget);
    if (validationMessage !== undefined) {
      return yield* Effect.fail(
        makeWizardCommandFailure({
          message: validationMessage,
          cause: enteredBudget,
        }),
      );
    }
    return Number.parseFloat(enteredBudget);
  });

/** Ask whether the build should also upload to its testing track. */
const selectSubmit = (destination: string) =>
  Effect.gen(function* () {
    const prompt = yield* LaunchPrompt;
    const afterBuild = yield* prompt.select<'upload' | 'build'>({
      message: 'After building?',
      choices: [
        { selection: 'upload', label: `Upload to ${destination}`, hint: 'build, then submit' },
        {
          selection: 'build',
          label: 'Build only',
          hint: "stop after building; don't upload",
        },
      ],
    });
    return afterBuild === 'upload';
  });

/** Read the remote Mac connection string for an SSH build. */
const readSshTarget = () =>
  Effect.gen(function* () {
    const prompt = yield* LaunchPrompt;
    return (yield* prompt.requiredText('SSH target for your Mac (user@host[:port])')).trim();
  });

/** Dispatch an Apple build to its selected execution location. */
const dispatchIosBuild = (
  buildLocation: BuildLocation,
  commandOptions: BuildRunOptions,
  sshTarget?: string,
) => {
  switch (buildLocation) {
    case 'local':
      return runBuild(commandOptions);
    case 'aws':
      return runBuild({ ...commandOptions, remote: { kind: 'aws' } });
    case 'ssh':
      if (sshTarget === undefined) {
        return Effect.fail(
          makeWizardCommandFailure({
            message: 'An SSH build needs a target (user@host).',
            cause: buildLocation,
          }),
        );
      }
      return runBuild({
        ...commandOptions,
        remote: { kind: 'ssh', target: sshTarget },
      });
    case 'eas':
      return Effect.gen(function* () {
        const preparedBuild = yield* prepareBuild(commandOptions);
        yield* runEasBuild(preparedBuild, commandOptions);
      });
  }
};

/** Run and remember the Apple branch of the guided build. */
const runIosJourney = (launchConfig: LaunchConfig) =>
  Effect.gen(function* () {
    yield* teach('build-location', 'Where to build');
    const buildLocation = yield* selectBuildLocation();
    yield* teach('apple-account', 'Apple account');
    const selectedAccount = yield* chooseAccountInteractive();
    if (buildLocation === 'eas') {
      const logger = yield* createLogger(false);
      yield* logger.note(
        "EAS signs in Expo's cloud. This Apple account remains active for other Launch commands.",
      );
    }
    yield* teach('build-profile', 'Profile');
    const profileName = yield* selectProfile(launchConfig);
    const sizeBudgetMB = yield* selectSizeBudget(launchConfig, profileName);
    yield* teach('testflight', 'After build');
    const submit = yield* selectSubmit('TestFlight');
    let sshTarget: string | undefined;
    if (buildLocation === 'ssh') sshTarget = yield* readSshTarget();
    yield* dispatchIosBuild(
      buildLocation,
      buildRunOptions('ios', profileName, submit, sizeBudgetMB),
      sshTarget,
    );
    const completedFlow: LastFlow = {
      platform: 'ios',
      location: buildLocation,
      profile: profileName,
      submit,
      account: selectedAccount.keyId,
    };
    if (sshTarget !== undefined) completedFlow.sshTarget = sshTarget;
    yield* rememberLastFlow(completedFlow);
  });

/** Run and remember the Android branch of the guided build. */
const runAndroidJourney = (launchConfig: LaunchConfig) =>
  Effect.gen(function* () {
    yield* teach('build-profile', 'Profile');
    const profileName = yield* selectProfile(launchConfig);
    const sizeBudgetMB = yield* selectSizeBudget(launchConfig, profileName);
    yield* teach('play-track', 'After build');
    const submit = yield* selectSubmit('Google Play (internal track)');
    yield* runBuild(buildRunOptions('android', profileName, submit, sizeBudgetMB));
    yield* rememberLastFlow({
      platform: 'android',
      location: 'local',
      profile: profileName,
      submit,
    });
  });

/** Run the shared platform selection and its matching build journey. */
const runBuildJourney = () =>
  Effect.gen(function* () {
    const loadedConfiguration = yield* loadConfig();
    yield* teach('build-platform', 'Platform');
    const platform = yield* selectPlatform(loadedConfiguration.apps);
    if (platform === 'android') {
      yield* runAndroidJourney(loadedConfiguration.config);
      return;
    }
    yield* runIosJourney(loadedConfiguration.config);
  });

/** Return the short wizard label for one Apple build location. */
const locationLabel = (buildLocation: BuildLocation): string => {
  switch (buildLocation) {
    case 'local':
      return 'This Mac';
    case 'aws':
      return 'AWS cloud Mac';
    case 'ssh':
      return 'Mac over SSH';
    case 'eas':
      return 'Expo EAS';
  }
};

/** Format the remembered flow shown by the repeat-build prompt. */
export const formatFlowSummary = (rememberedFlow: LastFlow): string => {
  const summaryParts: string[] = [rememberedFlow.platform];
  if (rememberedFlow.platform === 'ios') {
    summaryParts.push(locationLabel(rememberedFlow.location));
  }
  summaryParts.push(rememberedFlow.profile);
  let submissionLabel = 'build only';
  if (rememberedFlow.submit) submissionLabel = 'upload';
  summaryParts.push(submissionLabel);
  return summaryParts.join(' - ');
};

/** Identify prompt cancellation so an Esc exits the wizard successfully. */
const isPromptSelectionFailure = (cause: unknown): cause is PromptSelectionFailure => {
  if (typeof cause !== 'object') return false;
  if (cause === null) return false;
  if (!('_tag' in cause)) return false;
  return cause._tag === 'PromptSelectionFailure';
};

/** Explain why a remembered flow can no longer be replayed. */
export const flowInvalidReason = (
  rememberedFlow: LastFlow,
  launchConfig: LaunchConfig,
  configuredApps: readonly AppDescriptor[],
  accountKeyIds: Set<string>,
): string | null => {
  let platformConfigured = configuredApps.some(
    (configuredApp) => configuredApp.packageName !== undefined,
  );
  if (rememberedFlow.platform === 'ios') {
    platformConfigured = configuredApps.some(
      (configuredApp) => configuredApp.bundleId !== undefined,
    );
  }
  if (!platformConfigured) return `no ${rememberedFlow.platform} app configured`;
  const profileNames = Object.keys(launchConfig.profiles);
  if (profileNames.length > 0 && !profileNames.includes(rememberedFlow.profile)) {
    return `profile "${rememberedFlow.profile}" no longer exists`;
  }
  if (rememberedFlow.platform === 'ios') {
    if (rememberedFlow.account !== undefined && !accountKeyIds.has(rememberedFlow.account)) {
      return 'the Apple account it used is no longer registered';
    }
    if (rememberedFlow.location === 'ssh' && rememberedFlow.sshTarget === undefined) {
      return 'the remembered SSH flow has no target';
    }
  }
  return null;
};

/** Replay one validated remembered build flow. */
const replayFlow = (rememberedFlow: LastFlow) =>
  Effect.gen(function* () {
    if (rememberedFlow.account !== undefined) {
      yield* setActiveKeyId(rememberedFlow.account);
    }
    const commandOptions = buildRunOptions(
      rememberedFlow.platform,
      rememberedFlow.profile,
      rememberedFlow.submit,
    );
    if (rememberedFlow.platform === 'android') yield* runBuild(commandOptions);
    if (rememberedFlow.platform === 'ios') {
      yield* dispatchIosBuild(rememberedFlow.location, commandOptions, rememberedFlow.sshTarget);
    }
    yield* rememberLastFlow(rememberedFlow);
  });

/** Offer the one-keypress repeat when the remembered flow still resolves. */
const maybeRepeatLastBuild = () =>
  Effect.gen(function* () {
    const rememberedFlow = yield* readLastFlow();
    if (rememberedFlow === undefined) return false;
    const loadedConfiguration = yield* loadConfig();
    const registeredAccounts = yield* listAccounts();
    const invalidReason = flowInvalidReason(
      rememberedFlow,
      loadedConfiguration.config,
      loadedConfiguration.apps,
      new Set(registeredAccounts.map((registeredAccount) => registeredAccount.keyId)),
    );
    if (invalidReason !== null) return false;
    const prompt = yield* LaunchPrompt;
    const repeatBuild = yield* prompt.confirm(
      `Repeat last build? ${formatFlowSummary(rememberedFlow)}`,
    );
    if (!repeatBuild) return false;
    yield* replayFlow(rememberedFlow);
    return true;
  });

/** Run config, account, toolchain, and signing setup in sequence. */
const runGuidedSetup = () =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    yield* logger.notice(
      'Set up Launch',
      'Four quick steps: config, Apple account, toolchain, signing.',
    );
    if (!(yield* configFileExists())) {
      yield* initCommandProgram({ framed: false });
    }
    yield* setupCommandProgram({
      operation: 'auto',
      platform: 'ios',
      yes: false,
      rehearse: false,
    });
    let activeAccount = yield* getActiveAccount();
    if (activeAccount === null) {
      const prompt = yield* LaunchPrompt;
      const addAccount = yield* prompt.confirm(
        'Add an Apple account now? Skip this if you only ship Android.',
      );
      if (addAccount) activeAccount = yield* chooseAccountInteractive();
    } else {
      yield* logger.ok(`Active account: ${formatAccountSummary(activeAccount)}.`);
    }
    if (yield* checkIsMacOperatingSystem) {
      yield* runDoctorProgram({
        platform: 'ios',
        fix: false,
        yes: false,
        json: false,
      });
      const missingTools = yield* missingRequiredTools();
      if (missingTools.length > 0) {
        const prompt = yield* LaunchPrompt;
        const installTools = yield* prompt.confirm(
          `Missing build tool(s): ${missingTools.map((tool) => tool.label).join(', ')}. Install them now with Homebrew?`,
        );
        if (installTools) {
          yield* runDoctorProgram({
            platform: 'ios',
            fix: true,
            yes: false,
            json: false,
          });
        }
      }
      if (activeAccount !== null) {
        const prompt = yield* LaunchPrompt;
        const provisionSigning = yield* prompt.confirm(
          'Provision or reuse your iOS signing certificate and profile now?',
        );
        if (provisionSigning) {
          yield* setupIos({}).pipe(
            Effect.catchAll((cause) => logger.warn(`Signing skipped: ${errorMessage(cause)}`)),
          );
        }
      }
    } else {
      yield* logger.note(
        'No local Mac. Use `launch cloud doctor` to check a remote iOS build host.',
      );
    }
    yield* logger.ok('Setup complete.');
  });

/** Run the first-use simulated tour once on an interactive terminal. */
const maybeRunFirstRunTour = () =>
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    if (!(yield* terminal.isTTY)) return;
    if (yield* hasSeenTour()) return;
    const platform = yield* promptTourPlatform();
    yield* markTourSeen();
    if (platform !== null) yield* runTour(platform, true);
  });

/** Check whether the current project already has a Launch config file. */
const configFileExists = () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const launchPaths = yield* LaunchPaths;
    const pathService = yield* Path.Path;
    return yield* fileSystem.exists(
      pathService.join(launchPaths.workingDirectory, 'launch.config.ts'),
    );
  });

/** Ask whether setup should continue directly into a build. */
const confirmBuildNow = () =>
  Effect.gen(function* () {
    const prompt = yield* LaunchPrompt;
    return yield* prompt.confirm('Build now?');
  });

/** Prepare Genshot, choose a configured platform, and run the shared screenshot command. */
const runScreenshotJourney = () =>
  Effect.gen(function* () {
    if (!(yield* ensureGenshotForInteractiveScreenshotsLive())) return;
    const loadedConfiguration = yield* loadConfig();
    const platform = yield* selectPlatform(loadedConfiguration.apps);
    const logger = yield* createLogger(false);
    yield* aiScreenshotsCommandProgram({ platform }).pipe(
      Effect.catchAll((cause) => logger.warn(errorMessage(cause))),
    );
  });

/** Run Launch's interactive no-subcommand front door. */
export const wizardCommandProgram = (rawCommandInput: unknown) =>
  Effect.gen(function* () {
    yield* Schema.decodeUnknown(WizardCommandInputSchema)(rawCommandInput);
    const logger = yield* createLogger(false);
    const terminal = yield* Terminal.Terminal;
    if (!(yield* terminal.isTTY)) {
      yield* logger.note(
        'The interactive wizard requires a TTY. Run `launch --help` for commands.',
      );
      return;
    }
    yield* maybeRunFirstRunTour();
    yield* logger.line('Launch');
    yield* logger.note(`Detected ${yield* resolveHostOperatingSystemLabel}.`);
    if (!(yield* configFileExists())) {
      yield* logger.note("Looks like a fresh checkout. Let's get Launch ready first.");
      yield* runGuidedSetup();
      if (yield* confirmBuildNow()) yield* runBuildJourney();
      yield* outroDone();
      return;
    }
    if (yield* maybeRepeatLastBuild()) {
      yield* outroDone();
      return;
    }
    const prunableBuildCount = yield* countPrunableBuilds();
    const menuChoices = wizardMenuChoices(prunableBuildCount);
    const prompt = yield* LaunchPrompt;
    const selectedAction = yield* prompt.select({
      message: 'What would you like to do?',
      choices: menuChoices,
    });
    switch (selectedAction) {
      case 'prune':
        yield* runPrune({});
        yield* outroDone();
        return;
      case 'adopt':
        yield* adoptCommandProgram({});
        yield* outroDone();
        return;
      case 'setup':
        yield* runGuidedSetup();
        if (!(yield* confirmBuildNow())) {
          yield* outroDone();
          return;
        }
        break;
      case 'screenshots':
        yield* runScreenshotJourney();
        yield* outroDone();
        return;
      case 'build':
        break;
    }
    yield* runBuildJourney();
    yield* outroDone();
  }).pipe(
    Effect.catchIf(isPromptSelectionFailure, () => Effect.void),
    Effect.mapError((cause) => makeWizardCommandFailure({ message: errorMessage(cause), cause })),
  );

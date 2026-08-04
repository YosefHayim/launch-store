import { FileSystem, type Path, Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { errorMessage } from '../services/errorMessage.js';
import type { EffectAppStoreConnectClient } from '../services/appleStoreClient.js';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import type { BetaFeedback, BetaFeedbackKind } from '../types/app.js';
import type { BetaGroupResource } from '../types/appleCatalog.js';
import type { PlannedAction } from '../types/reconcile.js';
import {
  loadActiveAppleStore,
  type ActiveAppleStoreRequirements,
} from '../store/appleStoreCommand.js';
import { selectStoreApp, type StoreAppSelectionRequirements } from '../store/selectStoreApp.js';
import {
  loadBetaReviewConfig,
  reconcileBetaReview,
  summarizeBetaReview,
  type BetaReviewReconcileInput,
} from './betaReview.js';
import {
  downloadFeedbackAttachments,
  listBetaFeedback,
  type FeedbackFilters,
} from './testflightFeedback.js';

const OptionalAppSchema = Schema.Struct({
  app: Schema.optional(Schema.String),
});

const TesterMutationSchema = Schema.Struct({
  app: Schema.optional(Schema.String),
  group: Schema.optional(Schema.String),
  dryRun: Schema.Boolean,
  yes: Schema.Boolean,
});

export const TestflightCommandInputSchema = Schema.Union(
  Schema.Struct({ operation: Schema.Literal('groups'), ...OptionalAppSchema.fields }),
  Schema.Struct({
    operation: Schema.Literal('create-group'),
    groupName: Schema.String,
    ...OptionalAppSchema.fields,
  }),
  Schema.Struct({
    operation: Schema.Literal('testers'),
    app: Schema.optional(Schema.String),
    group: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    operation: Schema.Literal('add'),
    emails: Schema.mutable(Schema.Array(Schema.String)),
    firstName: Schema.optional(Schema.String),
    lastName: Schema.optional(Schema.String),
    csv: Schema.optional(Schema.String),
    ...TesterMutationSchema.fields,
  }),
  Schema.Struct({
    operation: Schema.Literal('remove'),
    emails: Schema.mutable(Schema.Array(Schema.String)),
    ...TesterMutationSchema.fields,
  }),
  Schema.Struct({
    operation: Schema.Literal('release'),
    app: Schema.optional(Schema.String),
    build: Schema.optional(Schema.String),
    whatsNew: Schema.optional(Schema.String),
    locale: Schema.String,
    config: Schema.String,
    review: Schema.Boolean,
    dryRun: Schema.Boolean,
    yes: Schema.Boolean,
  }),
  Schema.Struct({
    operation: Schema.Literal('feedback'),
    app: Schema.optional(Schema.String),
    build: Schema.optional(Schema.String),
    type: Schema.optional(Schema.String),
    out: Schema.optional(Schema.String),
    json: Schema.Boolean,
  }),
);

export type TestflightCommandInput = Schema.Schema.Type<typeof TestflightCommandInputSchema>;

export type TestflightCommandFailure = Readonly<{
  readonly _tag: 'TestflightCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makeTestflightCommandFailure = Data.tagged<TestflightCommandFailure>(
  'TestflightCommandFailure',
);

type TestflightCommandRequirements =
  | ActiveAppleStoreRequirements
  | FileSystem.FileSystem
  | LaunchPromptService
  | Logger
  | Path.Path
  | StoreAppSelectionRequirements
  | Terminal.Terminal;

type TesterInput = Readonly<{
  readonly email: string;
  readonly firstName?: string;
  readonly lastName?: string;
}>;

type SelectedAppleApp = Readonly<{
  readonly appId: string;
  readonly name: string;
  readonly bundleId: string;
}>;

const FEEDBACK_KINDS: readonly BetaFeedbackKind[] = ['crash', 'screenshot'];

/** Create a tagged TestFlight command failure with an optional underlying cause. */
const testflightFailure = (
  operation: string,
  message: string,
  cause?: unknown,
): TestflightCommandFailure => {
  if (cause === undefined) return makeTestflightCommandFailure({ operation, message });
  return makeTestflightCommandFailure({ operation, message, cause });
};

/** Parse tester CSV rows while ignoring headers, blanks, and malformed email cells. */
export const parseTestersCsv = (csvText: string): TesterInput[] => {
  const testers: TesterInput[] = [];
  for (const csvLine of csvText.split(/\r?\n/)) {
    const [email, firstName, lastName] = csvLine.split(',').map((cellText) => cellText.trim());
    if (email === undefined) continue;
    if (!email.includes('@')) continue;
    if (firstName !== undefined && firstName.length > 0) {
      if (lastName !== undefined && lastName.length > 0) {
        testers.push({ email, firstName, lastName });
        continue;
      }
      testers.push({ email, firstName });
      continue;
    }
    if (lastName !== undefined && lastName.length > 0) {
      testers.push({ email, lastName });
      continue;
    }
    testers.push({ email });
  }
  return testers;
};

/** Parse the optional feedback kind into the two supported values. */
export const parseFeedbackType = (
  requestedType: string | undefined,
): Effect.Effect<BetaFeedbackKind | undefined, TestflightCommandFailure> => {
  if (requestedType === undefined) return Effect.succeed(undefined);
  const normalizedType = requestedType.trim().toLowerCase();
  const matchedKind = FEEDBACK_KINDS.find((feedbackKind) => feedbackKind === normalizedType);
  if (matchedKind !== undefined) return Effect.succeed(matchedKind);
  return Effect.fail(
    testflightFailure(
      'parse feedback type',
      `--type must be one of ${FEEDBACK_KINDS.join(' | ')} (got "${requestedType}").`,
    ),
  );
};

/** Remove terminal control characters from tester-authored feedback fields. */
const cleanTerminalText = (unsafeText: string): string =>
  unsafeText.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');

/** Render one normalized TestFlight feedback block using ASCII markers. */
export const renderFeedback = (feedbackEntry: BetaFeedback): string => {
  let deviceModel: string | undefined;
  if (feedbackEntry.deviceModel !== undefined) {
    deviceModel = cleanTerminalText(feedbackEntry.deviceModel);
  }
  let operatingSystem: string | undefined;
  if (feedbackEntry.osVersion !== undefined) {
    operatingSystem = `iOS ${cleanTerminalText(feedbackEntry.osVersion)}`;
  }
  const deviceDescription = [deviceModel, operatingSystem]
    .filter((devicePart): devicePart is string => devicePart !== undefined)
    .join(' - ');
  const metadataParts: string[] = [];
  if (feedbackEntry.buildVersion !== undefined) {
    metadataParts.push(`build ${feedbackEntry.buildVersion}`);
  }
  if (deviceDescription.length > 0) metadataParts.push(deviceDescription);
  if (feedbackEntry.email !== undefined) {
    metadataParts.push(cleanTerminalText(feedbackEntry.email));
  }
  if (feedbackEntry.createdDate !== undefined) {
    metadataParts.push(feedbackEntry.createdDate.slice(0, 10));
  }
  let feedbackMarker = '[SCREENSHOT]';
  if (feedbackEntry.kind === 'crash') feedbackMarker = '[ERROR] crash';
  const feedbackLines = [`${feedbackEntry.id}  ${feedbackMarker}`, `  ${metadataParts.join('  ')}`];
  if (feedbackEntry.comment !== undefined) {
    feedbackLines.push(`  "${cleanTerminalText(feedbackEntry.comment)}"`);
  }
  let screenshots = feedbackEntry.screenshots;
  if (screenshots === undefined) screenshots = [];
  for (const screenshot of screenshots) {
    feedbackLines.push(`  ${cleanTerminalText(screenshot.url)}`);
  }
  return feedbackLines.join('\n');
};

/** Render one beta-review action with stable ASCII status markers. */
export const renderBetaAction = (action: PlannedAction): string => {
  if (action.status === 'failed') {
    let failureDetail = '';
    if (action.error !== undefined) failureDetail = ` - ${action.error}`;
    return `x ${action.description}${failureDetail}`;
  }
  if (action.status === 'skipped') return `- ${action.description}`;
  return `+ ${action.description}`;
};

/** Load one selected iOS app and its App Store Connect resource id. */
const loadSelectedAppleApp = (
  appleStore: EffectAppStoreConnectClient,
  appSelector: string | undefined,
): Effect.Effect<SelectedAppleApp, unknown, StoreAppSelectionRequirements> =>
  Effect.gen(function* () {
    const selectedApp = yield* selectStoreApp(appSelector);
    if (selectedApp.bundleId === undefined) {
      return yield* Effect.fail(
        testflightFailure(
          'select iOS app',
          `App "${selectedApp.name}" has no iOS bundle identifier (set ios.bundleIdentifier).`,
        ),
      );
    }
    const appId = yield* appleStore.getAppId(selectedApp.bundleId);
    if (appId === null) {
      return yield* Effect.fail(
        testflightFailure(
          'find App Store app',
          `No App Store Connect record for ${selectedApp.bundleId}. Create the app once in App Store Connect, then retry.`,
        ),
      );
    }
    return { appId, name: selectedApp.name, bundleId: selectedApp.bundleId };
  });

/** Select an eligible beta group without guessing in a non-interactive terminal. */
const selectBetaGroup = (
  appleStore: EffectAppStoreConnectClient,
  appId: string,
  requestedGroup: string | undefined,
  externalOnly: boolean,
): Effect.Effect<BetaGroupResource, unknown, LaunchPromptService | Terminal.Terminal> =>
  Effect.gen(function* () {
    const availableGroups = yield* appleStore.listBetaGroups(appId);
    let eligibleGroups = availableGroups;
    let groupKind = '';
    if (externalOnly) {
      eligibleGroups = availableGroups.filter((betaGroup) => betaGroup.isInternal !== true);
      groupKind = 'external ';
    }
    if (requestedGroup !== undefined) {
      const matchedGroup = eligibleGroups.find(
        (betaGroup) => betaGroup.name.toLowerCase() === requestedGroup.toLowerCase(),
      );
      if (matchedGroup !== undefined) return matchedGroup;
      return yield* Effect.fail(
        testflightFailure(
          'select beta group',
          `No ${groupKind}beta group named "${requestedGroup}". Create one with \`launch testflight create-group "${requestedGroup}"\`.`,
        ),
      );
    }
    if (eligibleGroups.length === 0) {
      return yield* Effect.fail(
        testflightFailure(
          'select beta group',
          `No ${groupKind}beta groups for this app. Create one with \`launch testflight create-group <name>\`.`,
        ),
      );
    }
    const onlyGroup = eligibleGroups[0];
    if (eligibleGroups.length === 1 && onlyGroup !== undefined) return onlyGroup;
    const terminal = yield* Terminal.Terminal;
    if (!(yield* terminal.isTTY)) {
      return yield* Effect.fail(
        testflightFailure(
          'select beta group',
          'More than one beta group is available. Pass --group <name> non-interactively.',
        ),
      );
    }
    const prompt = yield* LaunchPrompt;
    return yield* prompt.select({
      message: 'Which beta group?',
      choices: eligibleGroups.map((betaGroup) => {
        let hint = 'external';
        if (betaGroup.isInternal) hint = 'internal';
        return { selection: betaGroup, label: betaGroup.name, hint };
      }),
    });
  });

/** Read, validate, and de-duplicate testers from CLI emails and an optional CSV file. */
const collectTesters = (
  commandInput: Extract<TestflightCommandInput, { operation: 'add' }>,
): Effect.Effect<TesterInput[], TestflightCommandFailure, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const testers: TesterInput[] = [];
    for (const email of commandInput.emails) {
      if (commandInput.firstName !== undefined && commandInput.lastName !== undefined) {
        testers.push({ email, firstName: commandInput.firstName, lastName: commandInput.lastName });
        continue;
      }
      if (commandInput.firstName !== undefined) {
        testers.push({ email, firstName: commandInput.firstName });
        continue;
      }
      if (commandInput.lastName !== undefined) {
        testers.push({ email, lastName: commandInput.lastName });
        continue;
      }
      testers.push({ email });
    }
    if (commandInput.csv !== undefined) {
      const fileSystem = yield* FileSystem.FileSystem;
      const csvExists = yield* fileSystem
        .exists(commandInput.csv)
        .pipe(
          Effect.mapError((cause) =>
            testflightFailure(
              'inspect tester CSV',
              `Could not inspect ${commandInput.csv}.`,
              cause,
            ),
          ),
        );
      if (!csvExists) {
        return yield* Effect.fail(
          testflightFailure('read tester CSV', `CSV file not found: ${commandInput.csv}`),
        );
      }
      const csvText = yield* fileSystem
        .readFileString(commandInput.csv)
        .pipe(
          Effect.mapError((cause) =>
            testflightFailure('read tester CSV', `Could not read ${commandInput.csv}.`, cause),
          ),
        );
      testers.push(...parseTestersCsv(csvText));
    }
    const testersByEmail = new Map<string, TesterInput>();
    for (const tester of testers) {
      if (!tester.email.includes('@')) {
        return yield* Effect.fail(
          testflightFailure('validate tester email', `"${tester.email}" is not a valid email.`),
        );
      }
      testersByEmail.set(tester.email.toLowerCase(), tester);
    }
    return [...testersByEmail.values()];
  });

/** Confirm a TestFlight write or require --yes when no terminal is available. */
const confirmAction = (
  confirmationMessage: string,
  assumeYes: boolean,
): Effect.Effect<boolean, unknown, LaunchPromptService | Terminal.Terminal> =>
  Effect.gen(function* () {
    if (assumeYes) return true;
    const terminal = yield* Terminal.Terminal;
    if (!(yield* terminal.isTTY)) {
      return yield* Effect.fail(
        testflightFailure(
          'confirm TestFlight change',
          `${confirmationMessage} Re-run with --yes to proceed non-interactively.`,
        ),
      );
    }
    const prompt = yield* LaunchPrompt;
    return yield* prompt.confirm(confirmationMessage);
  });

/** List beta groups and tester counts for one selected app. */
const listGroups = (
  commandInput: Extract<TestflightCommandInput, { operation: 'groups' }>,
): Effect.Effect<void, unknown, TestflightCommandRequirements> =>
  Effect.gen(function* () {
    const appleStore = yield* loadActiveAppleStore();
    const selectedApp = yield* loadSelectedAppleApp(appleStore, commandInput.app);
    const betaGroups = yield* appleStore.listBetaGroups(selectedApp.appId);
    const logger = yield* createLogger(false);
    if (betaGroups.length === 0) {
      yield* logger.line(
        `No beta groups for ${selectedApp.name}. Create one with \`launch testflight create-group <name>\`.`,
      );
      return;
    }
    for (const betaGroup of betaGroups) {
      const testerCount = (yield* appleStore.listBetaTestersInGroup(betaGroup.id)).length;
      let groupKind = 'external';
      if (betaGroup.isInternal) groupKind = 'internal';
      let publicLink = '';
      if (betaGroup.publicLink !== undefined) publicLink = ` - ${betaGroup.publicLink}`;
      let testerSuffix = 's';
      if (testerCount === 1) testerSuffix = '';
      yield* logger.line(
        `- ${betaGroup.name} (${groupKind}, ${testerCount} tester${testerSuffix})${publicLink}`,
      );
    }
    yield* logger.line(`\n${betaGroups.length} group(s) for ${selectedApp.name}.`);
  });

/** Create an external beta group idempotently by name. */
const createGroup = (
  commandInput: Extract<TestflightCommandInput, { operation: 'create-group' }>,
): Effect.Effect<void, unknown, TestflightCommandRequirements> =>
  Effect.gen(function* () {
    const appleStore = yield* loadActiveAppleStore();
    const selectedApp = yield* loadSelectedAppleApp(appleStore, commandInput.app);
    const existingGroup = yield* appleStore.findBetaGroupByName(
      selectedApp.appId,
      commandInput.groupName,
    );
    const logger = yield* createLogger(false);
    if (existingGroup !== null) {
      yield* logger.line(
        `Beta group "${existingGroup.name}" already exists for ${selectedApp.name}.`,
      );
      return;
    }
    const createdGroup = yield* appleStore.createBetaGroup(
      selectedApp.appId,
      commandInput.groupName,
    );
    yield* logger.ok(`Created external beta group "${createdGroup.name}" for ${selectedApp.name}.`);
    yield* logger.line(
      `- Add testers with \`launch testflight add <email> --group "${createdGroup.name}"\`.`,
    );
  });

/** List testers in one selected beta group. */
const listTesters = (
  commandInput: Extract<TestflightCommandInput, { operation: 'testers' }>,
): Effect.Effect<void, unknown, TestflightCommandRequirements> =>
  Effect.gen(function* () {
    const appleStore = yield* loadActiveAppleStore();
    const selectedApp = yield* loadSelectedAppleApp(appleStore, commandInput.app);
    const betaGroup = yield* selectBetaGroup(
      appleStore,
      selectedApp.appId,
      commandInput.group,
      false,
    );
    const betaTesters = yield* appleStore.listBetaTestersInGroup(betaGroup.id);
    const logger = yield* createLogger(false);
    if (betaTesters.length === 0) {
      yield* logger.line(
        `No testers in "${betaGroup.name}". Add one with \`launch testflight add <email> --group "${betaGroup.name}"\`.`,
      );
      return;
    }
    for (const betaTester of betaTesters) {
      const fullName = [betaTester.firstName, betaTester.lastName]
        .filter((namePart): namePart is string => namePart !== undefined)
        .join(' ');
      let nameDetail = '';
      if (fullName.length > 0) nameDetail = ` - ${fullName}`;
      let stateDetail = '';
      if (betaTester.state !== undefined) stateDetail = ` [${betaTester.state.toLowerCase()}]`;
      yield* logger.line(`- ${betaTester.email}${nameDetail}${stateDetail}`);
    }
    yield* logger.line(`\n${betaTesters.length} tester(s) in "${betaGroup.name}".`);
  });

/** Invite new testers and link existing testers into an external beta group. */
const addTesters = (
  commandInput: Extract<TestflightCommandInput, { operation: 'add' }>,
): Effect.Effect<void, unknown, TestflightCommandRequirements> =>
  Effect.gen(function* () {
    const requestedTesters = yield* collectTesters(commandInput);
    if (requestedTesters.length === 0) {
      return yield* Effect.fail(
        testflightFailure(
          'collect testers',
          'No testers to add. Pass one or more emails, or --csv <path>.',
        ),
      );
    }
    const appleStore = yield* loadActiveAppleStore();
    const selectedApp = yield* loadSelectedAppleApp(appleStore, commandInput.app);
    const betaGroup = yield* selectBetaGroup(
      appleStore,
      selectedApp.appId,
      commandInput.group,
      true,
    );
    const existingEmails = new Set(
      (yield* appleStore.listBetaTestersInGroup(betaGroup.id)).map((betaTester) =>
        betaTester.email.toLowerCase(),
      ),
    );
    const pendingTesters = requestedTesters.filter(
      (tester) => !existingEmails.has(tester.email.toLowerCase()),
    );
    const skippedCount = requestedTesters.length - pendingTesters.length;
    const logger = yield* createLogger(false);
    if (pendingTesters.length === 0) {
      yield* logger.skip(
        `All ${requestedTesters.length} tester(s) are already in "${betaGroup.name}".`,
      );
      return;
    }
    if (commandInput.dryRun) {
      yield* logger.notice(
        `[dry-run] would add ${pendingTesters.length} tester(s) to "${betaGroup.name}" (${selectedApp.name}); ${skippedCount} already present`,
        ...pendingTesters.map((tester) => tester.email),
      );
      return;
    }
    const confirmed = yield* confirmAction(
      `Add ${pendingTesters.length} tester(s) to "${betaGroup.name}" for ${selectedApp.name}? New emails get a TestFlight invite.`,
      commandInput.yes,
    );
    if (!confirmed) {
      yield* logger.skip('No testers were added.');
      return;
    }
    let invitedCount = 0;
    let linkedCount = 0;
    for (const tester of pendingTesters) {
      const existingTester = yield* appleStore.findBetaTesterByEmail(tester.email);
      if (existingTester !== null) {
        yield* appleStore.addTestersToGroup(betaGroup.id, [existingTester.id]);
        linkedCount += 1;
        yield* logger.ok(`Added existing tester ${tester.email}`);
        continue;
      }
      yield* appleStore.createBetaTester(betaGroup.id, tester);
      invitedCount += 1;
      yield* logger.ok(`Invited ${tester.email}`);
    }
    yield* logger.line(
      `\nDone: ${invitedCount} invited, ${linkedCount} existing added, ${skippedCount} already present -> "${betaGroup.name}".`,
    );
  });

/** Remove matching testers from one beta group. */
const removeTesters = (
  commandInput: Extract<TestflightCommandInput, { operation: 'remove' }>,
): Effect.Effect<void, unknown, TestflightCommandRequirements> =>
  Effect.gen(function* () {
    if (commandInput.emails.length === 0) {
      return yield* Effect.fail(
        testflightFailure('remove testers', 'Pass one or more tester emails to remove.'),
      );
    }
    const requestedEmails = new Set(commandInput.emails.map((email) => email.toLowerCase()));
    const appleStore = yield* loadActiveAppleStore();
    const selectedApp = yield* loadSelectedAppleApp(appleStore, commandInput.app);
    const betaGroup = yield* selectBetaGroup(
      appleStore,
      selectedApp.appId,
      commandInput.group,
      false,
    );
    const matchedTesters = (yield* appleStore.listBetaTestersInGroup(betaGroup.id)).filter(
      (betaTester) => requestedEmails.has(betaTester.email.toLowerCase()),
    );
    const logger = yield* createLogger(false);
    if (matchedTesters.length === 0) {
      yield* logger.skip(`No matching testers in "${betaGroup.name}".`);
      return;
    }
    if (commandInput.dryRun) {
      yield* logger.notice(
        `[dry-run] would remove ${matchedTesters.length} tester(s) from "${betaGroup.name}"`,
        ...matchedTesters.map((betaTester) => betaTester.email),
      );
      return;
    }
    const confirmed = yield* confirmAction(
      `Remove ${matchedTesters.length} tester(s) from "${betaGroup.name}"?`,
      commandInput.yes,
    );
    if (!confirmed) {
      yield* logger.skip('No testers were removed.');
      return;
    }
    yield* appleStore.removeTestersFromGroup(
      betaGroup.id,
      matchedTesters.map((betaTester) => betaTester.id),
    );
    yield* logger.ok(`Removed ${matchedTesters.length} tester(s) from "${betaGroup.name}".`);
  });

/** Reconcile localized TestFlight notes and optional Beta App Review submission. */
const releaseBuild = (
  commandInput: Extract<TestflightCommandInput, { operation: 'release' }>,
): Effect.Effect<void, unknown, TestflightCommandRequirements> =>
  Effect.gen(function* () {
    let localizedNotes: Record<string, string>;
    if (commandInput.whatsNew !== undefined) {
      localizedNotes = { [commandInput.locale]: commandInput.whatsNew };
    } else {
      localizedNotes = (yield* loadBetaReviewConfig(commandInput.config)).whatToTest;
    }
    const appleStore = yield* loadActiveAppleStore();
    const selectedApp = yield* loadSelectedAppleApp(appleStore, commandInput.app);
    const commonInput = {
      appId: selectedApp.appId,
      whatToTest: localizedNotes,
      submitForReview: commandInput.review,
      dryRun: true,
    };
    let reconciliationInput: BetaReviewReconcileInput = commonInput;
    if (commandInput.build !== undefined) {
      reconciliationInput = { ...commonInput, buildVersion: commandInput.build };
    }
    const planReport = yield* reconcileBetaReview(appleStore, reconciliationInput);
    const plannedActions = planReport.actions.filter((action) => action.status === 'planned');
    const releaseLabel = `${selectedApp.name} build ${planReport.buildVersion}`;
    const logger = yield* createLogger(false);
    yield* logger.gap();
    if (planReport.actions.length === 0) {
      yield* logger.skip(`${releaseLabel}: TestFlight release prep is already in sync.`);
      return;
    }
    yield* logger.notice(releaseLabel, ...planReport.actions.map(renderBetaAction));
    yield* logger.gap();
    yield* logger.line(`${plannedActions.length} change(s) for ${releaseLabel}.`);
    if (commandInput.dryRun) {
      yield* logger.ok('Dry run complete; no changes were made.');
      return;
    }
    if (plannedActions.length === 0) {
      yield* logger.skip('Nothing to apply; everything is already in sync.');
      return;
    }
    const confirmed = yield* confirmAction(
      `Apply ${plannedActions.length} change(s) to ${releaseLabel}?`,
      commandInput.yes,
    );
    if (!confirmed) {
      yield* logger.skip('No TestFlight changes were applied.');
      return;
    }
    reconciliationInput = { ...reconciliationInput, dryRun: false };
    const appliedReport = yield* reconcileBetaReview(appleStore, reconciliationInput);
    const actionSummary = summarizeBetaReview(appliedReport.actions);
    const receiptLines = appliedReport.actions.map((action) => {
      if (action.status === 'failed') {
        let failureText = 'failed';
        if (action.error !== undefined) failureText = action.error;
        return `x ${action.description} - ${failureText}`;
      }
      if (action.status === 'skipped') return `- ${action.description}`;
      return `[OK] ${action.description}`;
    });
    let receiptTitle = 'Applied';
    if (actionSummary.failed > 0) receiptTitle = 'Applied with errors';
    yield* logger.box(receiptTitle, receiptLines);
    if (actionSummary.failed > 0) {
      return yield* Effect.fail(
        testflightFailure(
          'apply beta release',
          `${actionSummary.failed} TestFlight action(s) failed.`,
        ),
      );
    }
  });

/** List tester feedback and optionally download screenshot attachments. */
const showFeedback = (
  commandInput: Extract<TestflightCommandInput, { operation: 'feedback' }>,
): Effect.Effect<void, unknown, TestflightCommandRequirements> =>
  Effect.gen(function* () {
    const feedbackKind = yield* parseFeedbackType(commandInput.type);
    let filters: FeedbackFilters = {};
    if (commandInput.build !== undefined && feedbackKind !== undefined) {
      filters = { build: commandInput.build, kind: feedbackKind };
    } else if (commandInput.build !== undefined) {
      filters = { build: commandInput.build };
    } else if (feedbackKind !== undefined) {
      filters = { kind: feedbackKind };
    }
    const appleStore = yield* loadActiveAppleStore();
    const selectedApp = yield* loadSelectedAppleApp(appleStore, commandInput.app);
    const feedbackEntries = yield* listBetaFeedback(appleStore, selectedApp.bundleId, filters);
    if (commandInput.out !== undefined) {
      const downloadedAttachments = yield* downloadFeedbackAttachments(
        appleStore,
        feedbackEntries,
        commandInput.out,
      );
      if (!commandInput.json) {
        const logger = yield* createLogger(false);
        let screenshotSuffix = 's';
        if (downloadedAttachments.length === 1) screenshotSuffix = '';
        yield* logger.ok(
          `Downloaded ${downloadedAttachments.length} screenshot${screenshotSuffix} to ${commandInput.out}.`,
        );
      }
    }
    const logger = yield* createLogger(false);
    if (commandInput.json) {
      yield* logger.line(JSON.stringify(feedbackEntries, null, 2));
      return;
    }
    if (feedbackEntries.length === 0) {
      yield* logger.skip('No TestFlight feedback yet. Testers submit it from the TestFlight app.');
      return;
    }
    yield* logger.line(feedbackEntries.map(renderFeedback).join('\n\n'));
    let feedbackSuffix = 's';
    if (feedbackEntries.length === 1) feedbackSuffix = '';
    yield* logger.line(`\n${feedbackEntries.length} feedback item${feedbackSuffix}.`);
  });

/** Run one schema-decoded TestFlight operation. */
export const testflightCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, TestflightCommandFailure, TestflightCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(TestflightCommandInputSchema)(rawCommandInput);
    switch (commandInput.operation) {
      case 'groups':
        return yield* listGroups(commandInput);
      case 'create-group':
        return yield* createGroup(commandInput);
      case 'testers':
        return yield* listTesters(commandInput);
      case 'add':
        return yield* addTesters(commandInput);
      case 'remove':
        return yield* removeTesters(commandInput);
      case 'release':
        return yield* releaseBuild(commandInput);
      case 'feedback':
        return yield* showFeedback(commandInput);
    }
  }).pipe(
    Effect.mapError((cause) =>
      testflightFailure('run TestFlight command', errorMessage(cause), cause),
    ),
  );

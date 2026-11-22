import { readFile } from 'node:fs/promises';
import { pathExists } from '../path-exists.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger, type Logger } from '../services/platform/logger.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import type { EffectAppStoreConnectClient } from '../services/stores/apple-store-client.ts';
import { loadActiveAppleStore } from '../cli/commands/store/apple/apple-store-command.ts';
import { selectStoreApp } from '../store/shared/select-store-app.ts';
import type { BetaFeedback, BetaFeedbackKind } from '../types/app.ts';
import type { BetaGroupResource, BetaTesterResource } from '../types/apple-catalog.ts';
import type { PlannedAction } from '../types/reconcile.ts';
import {
  loadBetaReviewConfig,
  reconcileBetaReview,
  summarizeBetaReview,
  type BetaReviewReconcileInput,
} from './beta-review.ts';
import {
  downloadFeedbackAttachments,
  listBetaFeedback,
  type FeedbackFilters,
} from './testflight-feedback.ts';

const FEEDBACK_KINDS: readonly BetaFeedbackKind[] = ['crash', 'screenshot'];
const TESTFLIGHT_OPERATIONS = [
  'groups',
  'create-group',
  'testers',
  'add',
  'remove',
  'release',
  'feedback',
] as const;

type TestflightOperation = (typeof TESTFLIGHT_OPERATIONS)[number];

interface GroupsCommandInput {
  operation: 'groups';
  app?: string;
}

interface CreateGroupCommandInput {
  operation: 'create-group';
  groupName: string;
  app?: string;
}

interface TestersCommandInput {
  operation: 'testers';
  app?: string;
  group?: string;
}

interface AddCommandInput {
  operation: 'add';
  emails: string[];
  firstName?: string;
  lastName?: string;
  csv?: string;
  app?: string;
  group?: string;
  dryRun: boolean;
  yes: boolean;
}

interface RemoveCommandInput {
  operation: 'remove';
  emails: string[];
  app?: string;
  group?: string;
  dryRun: boolean;
  yes: boolean;
}

interface ReleaseCommandInput {
  operation: 'release';
  app?: string;
  build?: string;
  whatsNew?: string;
  locale: string;
  config: string;
  review: boolean;
  dryRun: boolean;
  yes: boolean;
}

interface FeedbackCommandInput {
  operation: 'feedback';
  app?: string;
  build?: string;
  type?: string;
  out?: string;
  json: boolean;
}

type TestflightCommandInput =
  | GroupsCommandInput
  | CreateGroupCommandInput
  | TestersCommandInput
  | AddCommandInput
  | RemoveCommandInput
  | ReleaseCommandInput
  | FeedbackCommandInput;

type TestflightCommandFailure = Readonly<{
  _tag: 'TestflightCommandFailure';
  operation: string;
  message: string;
  cause?: unknown;
}>;

interface TesterInput {
  email: string;
  firstName?: string;
  lastName?: string;
}

interface SelectedAppleApp {
  appId: string;
  name: string;
  bundleId: string;
}

function testflightFailure(
  operation: string,
  message: string,
  cause?: unknown,
): TestflightCommandFailure {
  if (cause == null) {
    return { _tag: 'TestflightCommandFailure', operation, message };
  }

  return { _tag: 'TestflightCommandFailure', operation, message, cause };
}

function isText(field: unknown): field is string {
  return typeof field == 'string';
}

function isBoolean(field: unknown): field is boolean {
  return typeof field == 'boolean';
}

function isObject(field: unknown): field is object {
  return typeof field == 'object';
}

function isCommandRecord(commandInput: unknown): commandInput is Record<string, unknown> {
  if (commandInput == null) {
    return false;
  }

  if (isObject(commandInput)) {
    return Array.isArray(commandInput) == false;
  }

  return false;
}

function isTestflightOperation(operation: string): operation is TestflightOperation {
  for (const knownOperation of TESTFLIGHT_OPERATIONS) {
    if (knownOperation == operation) {
      return true;
    }
  }

  return false;
}

function optionalTextField(
  commandRecord: Record<string, unknown>,
  fieldName: string,
): string | null {
  const hasField = Object.hasOwn(commandRecord, fieldName);

  if (hasField == false) {
    return null;
  }

  const field = commandRecord[fieldName];

  if (field == null) {
    return null;
  }

  if (isText(field)) {
    return field;
  }

  throw new Error(`TestFlight command field ${fieldName} must be a string.`);
}

function readRequiredString(commandRecord: Record<string, unknown>, fieldName: string): string {
  const field = commandRecord[fieldName];

  if (isText(field)) {
    return field;
  }

  throw new Error(`TestFlight command field ${fieldName} must be a string.`);
}

function readRequiredBoolean(commandRecord: Record<string, unknown>, fieldName: string): boolean {
  const field = commandRecord[fieldName];

  if (isBoolean(field)) {
    return field;
  }

  throw new Error(`TestFlight command field ${fieldName} must be a boolean.`);
}

function readEmailList(field: readonly unknown[]): string[] {
  const emails: string[] = [];

  for (const email of field) {
    if (isText(email)) {
      emails.push(email);
      continue;
    }

    throw new Error('TestFlight command field emails must be an array of strings.');
  }

  return emails;
}

function readEmails(commandRecord: Record<string, unknown>): string[] {
  const field = commandRecord['emails'];

  if (Array.isArray(field)) {
    return readEmailList(field);
  }

  throw new Error('TestFlight command field emails must be an array of strings.');
}

function requireKnownOperation(operation: string): TestflightOperation {
  if (isTestflightOperation(operation)) {
    return operation;
  }

  throw new Error(`Unknown TestFlight operation "${operation}".`);
}

function readOperation(commandRecord: Record<string, unknown>): TestflightOperation {
  const field = commandRecord['operation'];

  if (isText(field)) {
    return requireKnownOperation(field);
  }

  throw new Error('TestFlight command field operation must be a string.');
}

function assignApp(command: { app?: string }, commandRecord: Record<string, unknown>): void {
  const app = optionalTextField(commandRecord, 'app');

  if (app == null) {
    return;
  }

  command.app = app;
}

function assignGroup(command: { group?: string }, commandRecord: Record<string, unknown>): void {
  const group = optionalTextField(commandRecord, 'group');

  if (group == null) {
    return;
  }

  command.group = group;
}

function decodeGroups(commandRecord: Record<string, unknown>): GroupsCommandInput {
  const groupsCommand: GroupsCommandInput = { operation: 'groups' };
  assignApp(groupsCommand, commandRecord);
  return groupsCommand;
}

function decodeCreateGroup(commandRecord: Record<string, unknown>): CreateGroupCommandInput {
  const createGroupCommand: CreateGroupCommandInput = {
    operation: 'create-group',
    groupName: readRequiredString(commandRecord, 'groupName'),
  };
  assignApp(createGroupCommand, commandRecord);
  return createGroupCommand;
}

function decodeTesters(commandRecord: Record<string, unknown>): TestersCommandInput {
  const testersCommand: TestersCommandInput = { operation: 'testers' };
  assignApp(testersCommand, commandRecord);
  assignGroup(testersCommand, commandRecord);
  return testersCommand;
}

function decodeAdd(commandRecord: Record<string, unknown>): AddCommandInput {
  const addCommand: AddCommandInput = {
    operation: 'add',
    emails: readEmails(commandRecord),
    dryRun: readRequiredBoolean(commandRecord, 'dryRun'),
    yes: readRequiredBoolean(commandRecord, 'yes'),
  };
  assignApp(addCommand, commandRecord);
  assignGroup(addCommand, commandRecord);

  const firstName = optionalTextField(commandRecord, 'firstName');

  if (firstName != null) {
    addCommand.firstName = firstName;
  }

  const lastName = optionalTextField(commandRecord, 'lastName');

  if (lastName != null) {
    addCommand.lastName = lastName;
  }

  const csv = optionalTextField(commandRecord, 'csv');

  if (csv != null) {
    addCommand.csv = csv;
  }

  return addCommand;
}

function decodeRemove(commandRecord: Record<string, unknown>): RemoveCommandInput {
  const removeCommand: RemoveCommandInput = {
    operation: 'remove',
    emails: readEmails(commandRecord),
    dryRun: readRequiredBoolean(commandRecord, 'dryRun'),
    yes: readRequiredBoolean(commandRecord, 'yes'),
  };
  assignApp(removeCommand, commandRecord);
  assignGroup(removeCommand, commandRecord);
  return removeCommand;
}

function decodeRelease(commandRecord: Record<string, unknown>): ReleaseCommandInput {
  const releaseCommand: ReleaseCommandInput = {
    operation: 'release',
    locale: readRequiredString(commandRecord, 'locale'),
    config: readRequiredString(commandRecord, 'config'),
    review: readRequiredBoolean(commandRecord, 'review'),
    dryRun: readRequiredBoolean(commandRecord, 'dryRun'),
    yes: readRequiredBoolean(commandRecord, 'yes'),
  };
  assignApp(releaseCommand, commandRecord);

  const build = optionalTextField(commandRecord, 'build');

  if (build != null) {
    releaseCommand.build = build;
  }

  const whatsNew = optionalTextField(commandRecord, 'whatsNew');

  if (whatsNew != null) {
    releaseCommand.whatsNew = whatsNew;
  }

  return releaseCommand;
}

function decodeFeedback(commandRecord: Record<string, unknown>): FeedbackCommandInput {
  const feedbackCommand: FeedbackCommandInput = {
    operation: 'feedback',
    json: readRequiredBoolean(commandRecord, 'json'),
  };
  assignApp(feedbackCommand, commandRecord);

  const build = optionalTextField(commandRecord, 'build');

  if (build != null) {
    feedbackCommand.build = build;
  }

  const feedbackType = optionalTextField(commandRecord, 'type');

  if (feedbackType != null) {
    feedbackCommand.type = feedbackType;
  }

  const outputDirectory = optionalTextField(commandRecord, 'out');

  if (outputDirectory != null) {
    feedbackCommand.out = outputDirectory;
  }

  return feedbackCommand;
}

function decodeTestflightCommand(commandRecord: Record<string, unknown>): TestflightCommandInput {
  const operation = readOperation(commandRecord);

  switch (operation) {
    case 'groups':
      return decodeGroups(commandRecord);
    case 'create-group':
      return decodeCreateGroup(commandRecord);
    case 'testers':
      return decodeTesters(commandRecord);
    case 'add':
      return decodeAdd(commandRecord);
    case 'remove':
      return decodeRemove(commandRecord);
    case 'release':
      return decodeRelease(commandRecord);
    case 'feedback':
      return decodeFeedback(commandRecord);
  }
}

export function TestflightCommandInputSchema(commandInput: unknown): TestflightCommandInput {
  if (isCommandRecord(commandInput)) {
    return decodeTestflightCommand(commandInput);
  }

  throw new Error('TestFlight command input must be an object.');
}

function optionalCsvName(cellText: string | undefined): string | undefined {
  if (cellText == null) {
    return undefined;
  }

  const isBlank = cellText.length == 0;

  if (isBlank) {
    return undefined;
  }

  return cellText;
}

function testerFromParts(
  email: string,
  firstName: string | undefined,
  lastName: string | undefined,
): TesterInput {
  const tester: TesterInput = { email };

  if (firstName != null) {
    tester.firstName = firstName;
  }

  if (lastName != null) {
    tester.lastName = lastName;
  }

  return tester;
}

function countLabel(count: number, singularNoun: string): string {
  const isSingular = count == 1;

  if (isSingular) {
    return `1 ${singularNoun}`;
  }

  return `${count} ${singularNoun}s`;
}

function trimCell(cellText: string): string {
  return cellText.trim();
}

function includesAtSign(email: string): boolean {
  return email.includes('@');
}

export function parseTestersCsv(csvText: string): TesterInput[] {
  const testers: TesterInput[] = [];

  // Splits the file into lines on LF or CRLF.
  for (const csvLine of csvText.split(/\r?\n/)) {
    const cells = csvLine.split(',').map(trimCell);
    const email = cells[0];
    const firstNameCell = cells[1];
    const lastNameCell = cells[2];

    if (email == null) {
      continue;
    }

    const hasAtSign = includesAtSign(email);

    if (hasAtSign == false) {
      continue;
    }

    testers.push(
      testerFromParts(email, optionalCsvName(firstNameCell), optionalCsvName(lastNameCell)),
    );
  }

  return testers;
}

export async function parseFeedbackType(
  requestedType: string | undefined,
): Promise<BetaFeedbackKind | undefined> {
  if (requestedType == null) {
    return undefined;
  }

  const normalizedType = requestedType.trim().toLowerCase();

  function isRequestedKind(feedbackKind: BetaFeedbackKind): boolean {
    return feedbackKind == normalizedType;
  }

  const matchedKind = FEEDBACK_KINDS.find(isRequestedKind);

  if (matchedKind != null) {
    return matchedKind;
  }

  throw testflightFailure(
    'parse feedback type',
    `--type must be one of ${FEEDBACK_KINDS.join(' | ')} (got "${requestedType}").`,
  );
}

function cleanTerminalText(unsafeText: string): string {
  // Drops ASCII and Latin-1 control characters, including terminal escapes.
  return unsafeText.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
}

function isPresentName(namePart: string | undefined): namePart is string {
  return namePart != null;
}

function optionalCleanedText(unsafeText: string | undefined): string | undefined {
  if (unsafeText == null) {
    return undefined;
  }

  return cleanTerminalText(unsafeText);
}

export function renderFeedback(feedbackEntry: BetaFeedback): string {
  const deviceModel = optionalCleanedText(feedbackEntry.deviceModel);
  const operatingSystemText = optionalCleanedText(feedbackEntry.osVersion);
  const operatingSystem = isPresentName(operatingSystemText)
    ? `iOS ${operatingSystemText}`
    : undefined;

  const deviceDescription = [deviceModel, operatingSystem].filter(isPresentName).join(' - ');
  const metadataParts: string[] = [];

  if (feedbackEntry.buildVersion != null) {
    metadataParts.push(`build ${feedbackEntry.buildVersion}`);
  }

  const hasDeviceDescription = deviceDescription.length > 0;

  if (hasDeviceDescription) {
    metadataParts.push(deviceDescription);
  }

  if (feedbackEntry.email != null) {
    metadataParts.push(cleanTerminalText(feedbackEntry.email));
  }

  if (feedbackEntry.createdDate != null) {
    const isoDateLength = 10;
    metadataParts.push(feedbackEntry.createdDate.slice(0, isoDateLength));
  }

  const isCrash = feedbackEntry.kind == 'crash';
  const feedbackMarker = isCrash ? '[ERROR] crash' : '[SCREENSHOT]';
  const feedbackLines = [`${feedbackEntry.id}  ${feedbackMarker}`, `  ${metadataParts.join('  ')}`];

  if (feedbackEntry.comment != null) {
    feedbackLines.push(`  "${cleanTerminalText(feedbackEntry.comment)}"`);
  }

  const screenshots = feedbackEntry.screenshots ?? [];

  for (const screenshot of screenshots) {
    feedbackLines.push(`  ${cleanTerminalText(screenshot.url)}`);
  }

  return feedbackLines.join('\n');
}

function failedActionLine(action: PlannedAction): string {
  const failureDetail = action.error ?? 'failed';
  return `x ${action.description} - ${failureDetail}`;
}

export function renderBetaAction(action: PlannedAction): string {
  if (action.status == 'failed') {
    return failedActionLine(action);
  }

  if (action.status == 'skipped') {
    return `- ${action.description}`;
  }

  if (action.status == 'applied') {
    return `[OK] ${action.description}`;
  }

  return `+ ${action.description}`;
}

async function loadSelectedAppleApp(
  appleStore: EffectAppStoreConnectClient,
  appSelector: string | undefined,
): Promise<SelectedAppleApp> {
  const selectedApp = await selectStoreApp(appSelector);

  if (selectedApp.bundleId == null) {
    throw testflightFailure(
      'select iOS app',
      `App "${selectedApp.name}" has no iOS bundle identifier (set ios.bundleIdentifier).`,
    );
  }

  const appId = await appleStore.getAppId(selectedApp.bundleId);

  if (appId == null) {
    throw testflightFailure(
      'find App Store app',
      `No App Store Connect record for ${selectedApp.bundleId}. Create the app once in App Store Connect, then retry.`,
    );
  }

  return { appId, name: selectedApp.name, bundleId: selectedApp.bundleId };
}

function isExternalGroup(betaGroup: BetaGroupResource): boolean {
  return betaGroup.isInternal != true;
}

function listEligibleGroups(
  availableGroups: BetaGroupResource[],
  externalOnly: boolean,
): BetaGroupResource[] {
  if (externalOnly == false) {
    return availableGroups;
  }

  return availableGroups.filter(isExternalGroup);
}

function groupKindLabel(externalOnly: boolean): string {
  if (externalOnly) {
    return 'external ';
  }

  return '';
}

function requireNamedGroup(
  eligibleGroups: readonly BetaGroupResource[],
  requestedGroup: string,
  groupKind: string,
): BetaGroupResource {
  function hasRequestedName(betaGroup: BetaGroupResource): boolean {
    return betaGroup.name.toLowerCase() == requestedGroup.toLowerCase();
  }

  const matchedGroup = eligibleGroups.find(hasRequestedName);

  if (matchedGroup != null) {
    return matchedGroup;
  }

  throw testflightFailure(
    'select beta group',
    `No ${groupKind}beta group named "${requestedGroup}". Create one with \`launch testflight create-group "${requestedGroup}"\`.`,
  );
}

function onlyEligibleGroup(eligibleGroups: readonly BetaGroupResource[]): BetaGroupResource | null {
  const isSingleGroup = eligibleGroups.length == 1;

  if (isSingleGroup == false) {
    return null;
  }

  const onlyGroup = eligibleGroups[0];

  if (onlyGroup == null) {
    return null;
  }

  return onlyGroup;
}

function betaGroupChoice(betaGroup: BetaGroupResource): {
  selection: BetaGroupResource;
  label: string;
  hint: string;
} {
  const isInternal = betaGroup.isInternal == true;
  const hint = isInternal ? 'internal' : 'external';
  return { selection: betaGroup, label: betaGroup.name, hint };
}

async function selectBetaGroup(
  appleStore: EffectAppStoreConnectClient,
  appId: string,
  requestedGroup: string | undefined,
  externalOnly: boolean,
): Promise<BetaGroupResource> {
  const availableGroups = await appleStore.listBetaGroups(appId);
  const eligibleGroups = listEligibleGroups(availableGroups, externalOnly);
  const groupKind = groupKindLabel(externalOnly);

  if (requestedGroup != null) {
    return requireNamedGroup(eligibleGroups, requestedGroup, groupKind);
  }

  const isEmpty = eligibleGroups.length == 0;

  if (isEmpty) {
    throw testflightFailure(
      'select beta group',
      `No ${groupKind}beta groups for this app. Create one with \`launch testflight create-group <name>\`.`,
    );
  }

  const onlyGroup = onlyEligibleGroup(eligibleGroups);

  if (onlyGroup != null) {
    return onlyGroup;
  }

  const isInteractive = process.stdout.isTTY == true;

  if (isInteractive == false) {
    throw testflightFailure(
      'select beta group',
      'More than one beta group is available. Pass --group <name> non-interactively.',
    );
  }

  return LaunchPrompt.select({
    message: 'Which beta group?',
    choices: eligibleGroups.map(betaGroupChoice),
  });
}

async function readTesterCsv(csvPath: string): Promise<TesterInput[]> {
  var csvExists = false;

  try {
    csvExists = await pathExists(csvPath);
  } catch (cause) {
    throw testflightFailure('inspect tester CSV', `Could not inspect ${csvPath}.`, cause);
  }

  if (csvExists == false) {
    throw testflightFailure('read tester CSV', `CSV file not found: ${csvPath}`);
  }

  var csvText = '';

  try {
    csvText = await readFile(csvPath, 'utf8');
  } catch (cause) {
    throw testflightFailure('read tester CSV', `Could not read ${csvPath}.`, cause);
  }

  return parseTestersCsv(csvText);
}

function dedupeTesters(testers: readonly TesterInput[]): TesterInput[] {
  const testersByEmail = new Map<string, TesterInput>();

  for (const tester of testers) {
    const hasAtSign = includesAtSign(tester.email);

    if (hasAtSign == false) {
      throw testflightFailure('validate tester email', `"${tester.email}" is not a valid email.`);
    }

    testersByEmail.set(tester.email.toLowerCase(), tester);
  }

  return [...testersByEmail.values()];
}

async function collectTesters(commandInput: AddCommandInput): Promise<TesterInput[]> {
  const testers: TesterInput[] = [];

  for (const email of commandInput.emails) {
    testers.push(testerFromParts(email, commandInput.firstName, commandInput.lastName));
  }

  if (commandInput.csv != null) {
    const csvTesters = await readTesterCsv(commandInput.csv);
    testers.push(...csvTesters);
  }

  return dedupeTesters(testers);
}

async function confirmAction(confirmationMessage: string, assumeYes: boolean): Promise<boolean> {
  if (assumeYes) {
    return true;
  }

  const isInteractive = process.stdout.isTTY == true;

  if (isInteractive == false) {
    throw testflightFailure(
      'confirm TestFlight change',
      `${confirmationMessage} Re-run with --yes to proceed non-interactively.`,
    );
  }

  return LaunchPrompt.confirm(confirmationMessage);
}

function formatGroupLine(betaGroup: BetaGroupResource, testerCount: number): string {
  const isInternal = betaGroup.isInternal == true;
  const groupKind = isInternal ? 'internal' : 'external';
  const publicLinkText = betaGroup.publicLink;
  const publicLink = isPresentName(publicLinkText) ? ` - ${publicLinkText}` : '';
  return `- ${betaGroup.name} (${groupKind}, ${countLabel(testerCount, 'tester')})${publicLink}`;
}

async function listGroups(commandInput: GroupsCommandInput): Promise<void> {
  const appleStore = await loadActiveAppleStore();
  const selectedApp = await loadSelectedAppleApp(appleStore, commandInput.app);
  const betaGroups = await appleStore.listBetaGroups(selectedApp.appId);
  const logger = createLogger(false);
  const isEmpty = betaGroups.length == 0;

  if (isEmpty) {
    logger.line(
      `No beta groups for ${selectedApp.name}. Create one with \`launch testflight create-group <name>\`.`,
    );
    return;
  }

  for (const betaGroup of betaGroups) {
    const testers = await appleStore.listBetaTestersInGroup(betaGroup.id);
    logger.line(formatGroupLine(betaGroup, testers.length));
  }

  logger.line(`\n${betaGroups.length} group(s) for ${selectedApp.name}.`);
}

async function createGroup(commandInput: CreateGroupCommandInput): Promise<void> {
  const appleStore = await loadActiveAppleStore();
  const selectedApp = await loadSelectedAppleApp(appleStore, commandInput.app);
  const existingGroup = await appleStore.findBetaGroupByName(
    selectedApp.appId,
    commandInput.groupName,
  );
  const logger = createLogger(false);

  if (existingGroup != null) {
    logger.line(`Beta group "${existingGroup.name}" already exists for ${selectedApp.name}.`);
    return;
  }

  const createdGroup = await appleStore.createBetaGroup(selectedApp.appId, commandInput.groupName);
  logger.ok(`Created external beta group "${createdGroup.name}" for ${selectedApp.name}.`);
  logger.line(
    `- Add testers with \`launch testflight add <email> --group "${createdGroup.name}"\`.`,
  );
}

function formatTesterLine(betaTester: BetaTesterResource): string {
  const fullName = [betaTester.firstName, betaTester.lastName].filter(isPresentName).join(' ');
  const hasFullName = fullName.length > 0;
  const nameDetail = hasFullName ? ` - ${fullName}` : '';
  const testerState = betaTester.state;
  const stateDetail = isPresentName(testerState) ? ` [${testerState.toLowerCase()}]` : '';
  const isLabelEmpty = betaTester.email.length == 0;
  const testerLabel = isLabelEmpty ? '(no email, public link)' : betaTester.email;
  return `- ${testerLabel}${nameDetail}${stateDetail}`;
}

async function listTesters(commandInput: TestersCommandInput): Promise<void> {
  const appleStore = await loadActiveAppleStore();
  const selectedApp = await loadSelectedAppleApp(appleStore, commandInput.app);
  const betaGroup = await selectBetaGroup(appleStore, selectedApp.appId, commandInput.group, false);
  const betaTesters = await appleStore.listBetaTestersInGroup(betaGroup.id);
  const logger = createLogger(false);
  const isEmpty = betaTesters.length == 0;

  if (isEmpty) {
    logger.line(
      `No testers in "${betaGroup.name}". Add one with \`launch testflight add <email> --group "${betaGroup.name}"\`.`,
    );
    return;
  }

  for (const betaTester of betaTesters) {
    logger.line(formatTesterLine(betaTester));
  }

  logger.line(`\n${betaTesters.length} tester(s) in "${betaGroup.name}".`);
}

function testerEmail(tester: TesterInput): string {
  return tester.email;
}

function lowerCaseText(email: string): string {
  return email.toLowerCase();
}

function betaTesterAddress(betaTester: BetaTesterResource): string {
  return betaTester.email;
}

function betaTesterEmail(betaTester: BetaTesterResource): string {
  return betaTester.email.toLowerCase();
}

function betaTesterId(betaTester: BetaTesterResource): string {
  return betaTester.id;
}

async function addTesters(commandInput: AddCommandInput): Promise<void> {
  const requestedTesters = await collectTesters(commandInput);
  const hasNoTesters = requestedTesters.length == 0;

  if (hasNoTesters) {
    throw testflightFailure(
      'collect testers',
      'No testers to add. Pass one or more emails, or --csv <path>.',
    );
  }

  const appleStore = await loadActiveAppleStore();
  const selectedApp = await loadSelectedAppleApp(appleStore, commandInput.app);
  const betaGroup = await selectBetaGroup(appleStore, selectedApp.appId, commandInput.group, true);
  const groupTesters = await appleStore.listBetaTestersInGroup(betaGroup.id);
  const existingEmails = new Set(groupTesters.map(betaTesterEmail));

  function keepNewTester(tester: TesterInput): boolean {
    const alreadyPresent = existingEmails.has(tester.email.toLowerCase());
    return alreadyPresent == false;
  }

  const pendingTesters = requestedTesters.filter(keepNewTester);
  const skippedCount = requestedTesters.length - pendingTesters.length;
  const logger = createLogger(false);
  const hasNoPendingTesters = pendingTesters.length == 0;

  if (hasNoPendingTesters) {
    logger.skip(`All ${requestedTesters.length} tester(s) are already in "${betaGroup.name}".`);
    return;
  }

  const isDryRun = commandInput.dryRun == true;

  if (isDryRun) {
    logger.notice(
      `[dry-run] would add ${pendingTesters.length} tester(s) to "${betaGroup.name}" (${selectedApp.name}); ${skippedCount} already present`,
      ...pendingTesters.map(testerEmail),
    );
    return;
  }

  const confirmed = await confirmAction(
    `Add ${pendingTesters.length} tester(s) to "${betaGroup.name}" for ${selectedApp.name}? New emails get a TestFlight invite.`,
    commandInput.yes,
  );
  const isDeclined = confirmed == false;

  if (isDeclined) {
    logger.skip('No testers were added.');
    return;
  }

  const invitedEmails: string[] = [];
  const linkedEmails: string[] = [];

  for (const tester of pendingTesters) {
    const existingTester = await appleStore.findBetaTesterByEmail(tester.email);

    if (existingTester != null) {
      await appleStore.addTestersToGroup(betaGroup.id, [existingTester.id]);
      linkedEmails.push(tester.email);
      logger.ok(`Added existing tester ${tester.email}`);
      continue;
    }

    await appleStore.createBetaTester(betaGroup.id, tester);
    invitedEmails.push(tester.email);
    logger.ok(`Invited ${tester.email}`);
  }

  logger.line(
    `\nDone: ${invitedEmails.length} invited, ${linkedEmails.length} existing added, ${skippedCount} already present -> "${betaGroup.name}".`,
  );
}

async function removeTesters(commandInput: RemoveCommandInput): Promise<void> {
  const hasNoEmails = commandInput.emails.length == 0;

  if (hasNoEmails) {
    throw testflightFailure('remove testers', 'Pass one or more tester emails to remove.');
  }

  const requestedEmails = new Set(commandInput.emails.map(lowerCaseText));
  const appleStore = await loadActiveAppleStore();
  const selectedApp = await loadSelectedAppleApp(appleStore, commandInput.app);
  const betaGroup = await selectBetaGroup(appleStore, selectedApp.appId, commandInput.group, false);
  const groupTesters = await appleStore.listBetaTestersInGroup(betaGroup.id);

  function isRequestedTester(betaTester: BetaTesterResource): boolean {
    return requestedEmails.has(betaTester.email.toLowerCase());
  }

  const matchedTesters = groupTesters.filter(isRequestedTester);
  const logger = createLogger(false);
  const hasNoMatches = matchedTesters.length == 0;

  if (hasNoMatches) {
    logger.skip(`No matching testers in "${betaGroup.name}".`);
    return;
  }

  const isDryRun = commandInput.dryRun == true;

  if (isDryRun) {
    logger.notice(
      `[dry-run] would remove ${matchedTesters.length} tester(s) from "${betaGroup.name}"`,
      ...matchedTesters.map(betaTesterAddress),
    );
    return;
  }

  const confirmed = await confirmAction(
    `Remove ${matchedTesters.length} tester(s) from "${betaGroup.name}"?`,
    commandInput.yes,
  );
  const isDeclined = confirmed == false;

  if (isDeclined) {
    logger.skip('No testers were removed.');
    return;
  }

  const testerIds = matchedTesters.map(betaTesterId);
  await appleStore.removeTestersFromGroup(betaGroup.id, testerIds);
  logger.ok(`Removed ${matchedTesters.length} tester(s) from "${betaGroup.name}".`);
}

function isPlannedAction(action: PlannedAction): boolean {
  return action.status == 'planned';
}

async function readLocalizedNotes(
  commandInput: ReleaseCommandInput,
): Promise<Record<string, string>> {
  if (commandInput.whatsNew != null) {
    return { [commandInput.locale]: commandInput.whatsNew };
  }

  const betaReviewConfig = await loadBetaReviewConfig(commandInput.config);
  return betaReviewConfig.whatToTest;
}

function withBuildVersion(
  reconciliationInput: BetaReviewReconcileInput,
  build: string | undefined,
): BetaReviewReconcileInput {
  if (build == null) {
    return reconciliationInput;
  }

  return { ...reconciliationInput, buildVersion: build };
}

function receiptTitle(failedCount: number): string {
  const hasFailures = failedCount > 0;

  if (hasFailures) {
    return 'Applied with errors';
  }

  return 'Applied';
}

async function releaseBuild(commandInput: ReleaseCommandInput): Promise<void> {
  const localizedNotes = await readLocalizedNotes(commandInput);
  const appleStore = await loadActiveAppleStore();
  const selectedApp = await loadSelectedAppleApp(appleStore, commandInput.app);
  const reconciliationInput = withBuildVersion(
    {
      appId: selectedApp.appId,
      whatToTest: localizedNotes,
      submitForReview: commandInput.review,
      dryRun: true,
    },
    commandInput.build,
  );
  const planReport = await reconcileBetaReview(appleStore, reconciliationInput);
  const plannedActions = planReport.actions.filter(isPlannedAction);
  const releaseLabel = `${selectedApp.name} build ${planReport.buildVersion}`;
  const logger = createLogger(false);
  logger.gap();
  const hasNoActions = planReport.actions.length == 0;

  if (hasNoActions) {
    logger.skip(`${releaseLabel}: TestFlight release prep is already in sync.`);
    return;
  }

  logger.notice(releaseLabel, ...planReport.actions.map(renderBetaAction));
  logger.gap();
  logger.line(`${plannedActions.length} change(s) for ${releaseLabel}.`);
  const isDryRun = commandInput.dryRun == true;

  if (isDryRun) {
    logger.ok('Dry run complete; no changes were made.');
    return;
  }

  const hasNoPlannedChanges = plannedActions.length == 0;

  if (hasNoPlannedChanges) {
    logger.skip('Nothing to apply; everything is already in sync.');
    return;
  }

  const confirmed = await confirmAction(
    `Apply ${plannedActions.length} change(s) to ${releaseLabel}?`,
    commandInput.yes,
  );
  const isDeclined = confirmed == false;

  if (isDeclined) {
    logger.skip('No TestFlight changes were applied.');
    return;
  }

  const appliedReport = await reconcileBetaReview(appleStore, {
    ...reconciliationInput,
    dryRun: false,
  });
  const actionSummary = summarizeBetaReview(appliedReport.actions);
  const appliedTitle = receiptTitle(actionSummary.failed);
  const appliedLines = appliedReport.actions.map(renderBetaAction);
  logger.box(appliedTitle, appliedLines);
  const hasFailedActions = actionSummary.failed > 0;

  if (hasFailedActions) {
    throw testflightFailure(
      'apply beta release',
      `${actionSummary.failed} TestFlight action(s) failed.`,
    );
  }
}

function withBuildFilter(filters: FeedbackFilters, build: string | undefined): FeedbackFilters {
  if (build == null) {
    return filters;
  }

  return { ...filters, build };
}

function withKindFilter(
  filters: FeedbackFilters,
  feedbackKind: BetaFeedbackKind | undefined,
): FeedbackFilters {
  if (feedbackKind == null) {
    return filters;
  }

  return { ...filters, kind: feedbackKind };
}

async function downloadRequestedAttachments(
  appleStore: EffectAppStoreConnectClient,
  feedbackEntries: readonly BetaFeedback[],
  outputDirectory: string | undefined,
  wantsJson: boolean,
  logger: Logger,
): Promise<void> {
  if (outputDirectory == null) {
    return;
  }

  const downloadedAttachments = await downloadFeedbackAttachments(
    appleStore,
    feedbackEntries,
    outputDirectory,
  );

  if (wantsJson) {
    return;
  }

  logger.ok(
    `Downloaded ${countLabel(downloadedAttachments.length, 'screenshot')} to ${outputDirectory}.`,
  );
}

async function showFeedback(commandInput: FeedbackCommandInput): Promise<void> {
  const feedbackKind = await parseFeedbackType(commandInput.type);
  const filters = withKindFilter(withBuildFilter({}, commandInput.build), feedbackKind);
  const appleStore = await loadActiveAppleStore();
  const selectedApp = await loadSelectedAppleApp(appleStore, commandInput.app);
  const feedbackEntries = await listBetaFeedback(appleStore, selectedApp.bundleId, filters);
  const logger = createLogger(false);
  const wantsJson = commandInput.json == true;
  await downloadRequestedAttachments(
    appleStore,
    feedbackEntries,
    commandInput.out,
    wantsJson,
    logger,
  );

  if (wantsJson) {
    logger.line(JSON.stringify(feedbackEntries, null, 2));
    return;
  }

  const hasNoFeedback = feedbackEntries.length == 0;

  if (hasNoFeedback) {
    logger.skip('No TestFlight feedback yet. Testers submit it from the TestFlight app.');
    return;
  }

  const feedbackBlocks = feedbackEntries.map(renderFeedback);
  logger.line(feedbackBlocks.join('\n\n'));
  logger.line(`\n${countLabel(feedbackEntries.length, 'feedback item')}.`);
}

async function runTestflightOperation(commandInput: TestflightCommandInput): Promise<void> {
  switch (commandInput.operation) {
    case 'groups':
      return listGroups(commandInput);
    case 'create-group':
      return createGroup(commandInput);
    case 'testers':
      return listTesters(commandInput);
    case 'add':
      return addTesters(commandInput);
    case 'remove':
      return removeTesters(commandInput);
    case 'release':
      return releaseBuild(commandInput);
    case 'feedback':
      return showFeedback(commandInput);
  }
}

export async function testflightCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = TestflightCommandInputSchema(rawCommandInput);
    await runTestflightOperation(commandInput);
  } catch (cause) {
    throw testflightFailure('run TestFlight command', errorMessage(cause), cause);
  }
}

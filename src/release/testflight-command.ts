import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import { loadActiveAppleStore } from '../cli/commands/store/apple/apple-store-command.ts';
import type { BetaGroupResource, BetaTesterResource } from '../types/apple-catalog.ts';
import { addTesters, type AddCommandInput } from './testflight-add-testers.ts';
import {
  countLabel,
  isPresentName,
  loadSelectedAppleApp,
  selectBetaGroup,
  testflightFailure,
} from './testflight-group.ts';
import { releaseBuild, type ReleaseCommandInput } from './testflight-release.ts';
import { removeTesters, type RemoveCommandInput } from './testflight-remove-testers.ts';
import { showFeedback, type FeedbackCommandInput } from './testflight-show-feedback.ts';

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

type TestflightCommandInput =
  | GroupsCommandInput
  | CreateGroupCommandInput
  | TestersCommandInput
  | AddCommandInput
  | RemoveCommandInput
  | ReleaseCommandInput
  | FeedbackCommandInput;

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

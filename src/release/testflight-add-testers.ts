// Adds testers, including a list from a file, to one TestFlight group.

import { readFile } from 'node:fs/promises';
import { pathExists } from '../path-exists.ts';
import { loadActiveAppleStore } from '../apple/apple-store-command.ts';
import type { BetaTesterResource } from '../types/apple/testflight.ts';
import { confirmAction, loadSelectedAppleApp, selectBetaGroup } from './testflight-group.ts';
import { redactText } from '../services/platform/redact.ts';

export interface AddCommandInput {
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

interface TesterInput {
  email: string;
  firstName?: string;
  lastName?: string;
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

async function readTesterCsv(csvPath: string): Promise<TesterInput[]> {
  var csvExists = false;

  try {
    csvExists = await pathExists(csvPath);
  } catch (cause) {
    throw new Error(`Could not inspect ${csvPath}.`, { cause });
  }

  if (csvExists == false) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }

  var csvText = '';

  try {
    csvText = await readFile(csvPath, 'utf8');
  } catch (cause) {
    throw new Error(`Could not read ${csvPath}.`, { cause });
  }

  return parseTestersCsv(csvText);
}

function dedupeTesters(testers: readonly TesterInput[]): TesterInput[] {
  const testersByEmail = new Map<string, TesterInput>();

  for (const tester of testers) {
    const hasAtSign = includesAtSign(tester.email);

    if (hasAtSign == false) {
      throw new Error(`"${tester.email}" is not a valid email.`);
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

function testerEmail(tester: TesterInput): string {
  return tester.email;
}

function betaTesterEmail(betaTester: BetaTesterResource): string {
  return betaTester.email.toLowerCase();
}

export async function addTesters(commandInput: AddCommandInput): Promise<void> {
  const requestedTesters = await collectTesters(commandInput);

  const hasNoTesters = requestedTesters.length == 0;

  if (hasNoTesters) {
    throw new Error('No testers to add. Pass one or more emails, or --csv <path>.');
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
  const hasNoPendingTesters = pendingTesters.length == 0;

  if (hasNoPendingTesters) {
    console.log(
      redactText(`All ${requestedTesters.length} tester(s) are already in "${betaGroup.name}".`),
    );
    return;
  }

  const isDryRun = commandInput.dryRun == true;

  if (isDryRun) {
    console.log(
      redactText(
        [
          `[dry-run] would add ${pendingTesters.length} tester(s) to "${betaGroup.name}" (${selectedApp.name}); ${skippedCount} already present`,
          ...pendingTesters.map(testerEmail),
        ].join('\n  '),
      ),
    );

    return;
  }

  const confirmed = await confirmAction(
    `Add ${pendingTesters.length} tester(s) to "${betaGroup.name}" for ${selectedApp.name}? New emails get a TestFlight invite.`,
    commandInput.yes,
  );

  const isDeclined = confirmed == false;

  if (isDeclined) {
    console.log(redactText('No testers were added.'));
    return;
  }

  const invitedEmails: string[] = [];
  const linkedEmails: string[] = [];

  for (const tester of pendingTesters) {
    const existingTester = await appleStore.findBetaTesterByEmail(tester.email);

    if (existingTester != null) {
      await appleStore.addTestersToGroup(betaGroup.id, [existingTester.id]);
      linkedEmails.push(tester.email);
      console.log(redactText(`Added existing tester ${tester.email}`));
      continue;
    }

    await appleStore.createBetaTester(betaGroup.id, tester);
    invitedEmails.push(tester.email);
    console.log(redactText(`Invited ${tester.email}`));
  }

  console.log(
    redactText(
      `\nDone: ${invitedEmails.length} invited, ${linkedEmails.length} existing added, ${skippedCount} already present -> "${betaGroup.name}".`,
    ),
  );
}

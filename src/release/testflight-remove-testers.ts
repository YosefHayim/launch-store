// Removes testers from one TestFlight group after the operator confirms.

import { createLogger } from '../services/platform/logger.ts';
import { loadActiveAppleStore } from '../apple/apple-store-command.ts';
import type { BetaTesterResource } from '../types/apple/testflight.ts';
import { confirmAction, loadSelectedAppleApp, selectBetaGroup } from './testflight-group.ts';

export interface RemoveCommandInput {
  operation: 'remove';
  emails: string[];
  app?: string;
  group?: string;
  dryRun: boolean;
  yes: boolean;
}

function lowerCaseText(email: string): string {
  return email.toLowerCase();
}

function betaTesterAddress(betaTester: BetaTesterResource): string {
  return betaTester.email;
}

function betaTesterId(betaTester: BetaTesterResource): string {
  return betaTester.id;
}

export async function removeTesters(commandInput: RemoveCommandInput): Promise<void> {
  const hasNoEmails = commandInput.emails.length == 0;

  if (hasNoEmails) {
    throw new Error('Pass one or more tester emails to remove.');
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

// Loads the selected app, picks a TestFlight group, and confirms a tester change.

import { LaunchPrompt } from '../services/platform/prompt.ts';
import type { AppStoreConnectClient } from '../apple/app-store-connect-client.ts';
import { selectStoreApp } from '../store/shared/select-store-app.ts';
import type { BetaGroupResource } from '../types/apple/testflight.ts';

interface SelectedAppleApp {
  appId: string;
  name: string;
  bundleId: string;
}

export function countLabel(count: number, singularNoun: string): string {
  const isSingular = count == 1;

  if (isSingular) {
    return `1 ${singularNoun}`;
  }

  return `${count} ${singularNoun}s`;
}

export async function loadSelectedAppleApp(
  appleStore: AppStoreConnectClient,
  appSelector: string | undefined,
): Promise<SelectedAppleApp> {
  const selectedApp = await selectStoreApp(appSelector);

  if (selectedApp.bundleId == null) {
    throw new Error(
      `App "${selectedApp.name}" has no iOS bundle identifier (set ios.bundleIdentifier).`,
    );
  }

  const appId = await appleStore.getAppId(selectedApp.bundleId);

  if (appId == null) {
    throw new Error(
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

  throw new Error(
    `No ${groupKind}beta group named "${requestedGroup}". Create one with \`launch-store testflight create-group "${requestedGroup}"\`.`,
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
  let hint = 'external';

  if (isInternal) {
    hint = 'internal';
  }
  return { selection: betaGroup, label: betaGroup.name, hint };
}

export async function selectBetaGroup(
  appleStore: AppStoreConnectClient,
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
    throw new Error(
      `No ${groupKind}beta groups for this app. Create one with \`launch-store testflight create-group <name>\`.`,
    );
  }

  const onlyGroup = onlyEligibleGroup(eligibleGroups);

  if (onlyGroup != null) {
    return onlyGroup;
  }

  const isInteractive = process.stdout.isTTY == true;

  if (isInteractive == false) {
    throw new Error(
      'More than one beta group is available. Pass --group <name> non-interactively.',
    );
  }

  return new LaunchPrompt().select({
    message: 'Which beta group?',
    choices: eligibleGroups.map(betaGroupChoice),
  });
}

export async function confirmAction(
  confirmationMessage: string,
  assumeYes: boolean,
): Promise<boolean> {
  if (assumeYes) {
    return true;
  }

  const isInteractive = process.stdout.isTTY == true;

  if (isInteractive == false) {
    throw new Error(`${confirmationMessage} Re-run with --yes to proceed non-interactively.`);
  }

  return new LaunchPrompt().confirm(confirmationMessage);
}

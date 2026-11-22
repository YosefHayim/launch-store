import { LaunchPrompt } from '../services/platform/prompt.ts';
import type { EffectAppStoreConnectClient } from '../services/stores/apple-store-client.ts';
import { selectStoreApp } from '../store/shared/select-store-app.ts';
import type { BetaGroupResource } from '../types/apple-catalog.ts';

type TestflightCommandFailure = Readonly<{
  _tag: 'TestflightCommandFailure';
  operation: string;
  message: string;
  cause?: unknown;
}>;

interface SelectedAppleApp {
  appId: string;
  name: string;
  bundleId: string;
}

export function testflightFailure(
  operation: string,
  message: string,
  cause?: unknown,
): TestflightCommandFailure {
  if (cause == null) {
    return { _tag: 'TestflightCommandFailure', operation, message };
  }

  return { _tag: 'TestflightCommandFailure', operation, message, cause };
}

export function countLabel(count: number, singularNoun: string): string {
  const isSingular = count == 1;

  if (isSingular) {
    return `1 ${singularNoun}`;
  }

  return `${count} ${singularNoun}s`;
}

export async function loadSelectedAppleApp(
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

export async function selectBetaGroup(
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

export async function confirmAction(
  confirmationMessage: string,
  assumeYes: boolean,
): Promise<boolean> {
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

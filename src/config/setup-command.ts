import {
  getActiveAccount,
  listAccounts,
  loadAscKeyById,
  matchAccount,
} from '../credentials/accounts.ts';
import {
  describeStoredCredentials,
  ensureSigningCredentials,
  loadCachedSigningAssets,
} from '../credentials/apple-signing-assets.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import { Prompts } from '../prompts.ts';
import { AppleStoreClientService } from '../services/stores/apple-store-client.ts';
import { parsePlatform } from '../services/stores/platform.ts';
import type { DeviceResource } from '../types/apple-catalog.ts';
import type { AccountRecord, AscKey, SigningAssets } from '../types/credentials.ts';
import { loadStoreAppContext } from '../store/shared/select-store-app.ts';
import { runSetup } from './setup.ts';

type SetupOperation = 'auto' | 'ios';

type AutoSetupInput = Readonly<{
  operation: 'auto';
  platform?: string;
  yes: boolean;
  rehearse: boolean;
}>;

type IosSetupInput = Readonly<{
  operation: 'ios';
  account?: string;
  app?: string;
  provision: boolean;
  json: boolean;
  yes: boolean;
}>;

type SetupCommandInput = AutoSetupInput | IosSetupInput;

type ProvisioningDevice = Readonly<{
  name: string;
  udid: string;
  disabled: boolean;
}>;

type ProvisioningExtension = Readonly<{
  bundleId: string;
  provisioned: boolean;
}>;

export type ProvisioningReport = Readonly<{
  account: Readonly<{
    label: string;
    keyId: string;
    teamId: string | null;
  }>;
  app: Readonly<{
    name: string;
    bundleId: string;
  }>;
  bundleIdRegistered: boolean;
  capabilities: string[];
  certificateSerial: string | null;
  profileName: string | null;
  extensions: ProvisioningExtension[];
  devices: ProvisioningDevice[];
}>;

type SetupCommandFailure = Readonly<{
  readonly _tag: 'SetupCommandFailure';
  readonly operation: SetupOperation;
  readonly message: string;
  readonly cause?: unknown;
}>;

type SetupAccount = Readonly<{
  record: AccountRecord;
  ascKey: AscKey;
}>;

function isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  return Array.isArray(candidate) == false;
}

function setupFailure(operation: SetupOperation, message: string): SetupCommandFailure {
  return { _tag: 'SetupCommandFailure', operation, message };
}

function setupFailureWithCause(
  operation: SetupOperation,
  message: string,
  cause: unknown,
): SetupCommandFailure {
  return { _tag: 'SetupCommandFailure', operation, message, cause };
}

function optionalString(fields: Record<string, unknown>, fieldName: string): string | undefined {
  if (fieldName in fields == false) {
    return undefined;
  }

  const field = fields[fieldName];

  if (field == null) {
    return undefined;
  }

  if (typeof field == 'string') {
    return field;
  }

  throw new Error(`setup command ${fieldName} must be a string`);
}

function requiredBoolean(fields: Record<string, unknown>, fieldName: string): boolean {
  const field = fields[fieldName];

  if (typeof field == 'boolean') {
    return field;
  }

  throw new Error(`setup command ${fieldName} must be a boolean`);
}

function decodeAutoSetup(fields: Record<string, unknown>): AutoSetupInput {
  const yes = requiredBoolean(fields, 'yes');
  const rehearse = requiredBoolean(fields, 'rehearse');
  const platform = optionalString(fields, 'platform');

  if (platform == null) {
    return { operation: 'auto', yes, rehearse };
  }

  return { operation: 'auto', platform, yes, rehearse };
}

function decodeIosSetup(fields: Record<string, unknown>): IosSetupInput {
  const provision = requiredBoolean(fields, 'provision');
  const json = requiredBoolean(fields, 'json');
  const yes = requiredBoolean(fields, 'yes');
  const account = optionalString(fields, 'account');
  const app = optionalString(fields, 'app');
  const iosSetup: IosSetupInput = { operation: 'ios', provision, json, yes };

  if (account == null) {
    return iosSetupWithApp(iosSetup, app);
  }

  return iosSetupWithApp({ ...iosSetup, account }, app);
}

function iosSetupWithApp(iosSetup: IosSetupInput, app: string | undefined): IosSetupInput {
  if (app == null) {
    return iosSetup;
  }

  return { ...iosSetup, app };
}

function decodeSetupFields(fields: Record<string, unknown>): SetupCommandInput {
  const operation = fields['operation'];

  if (operation == 'auto') {
    return decodeAutoSetup(fields);
  }

  if (operation == 'ios') {
    return decodeIosSetup(fields);
  }

  throw new Error('setup command operation must be auto or ios');
}

function decodeSetupCommandInput(rawCommandInput: unknown): SetupCommandInput {
  if (isPlainRecord(rawCommandInput)) {
    return decodeSetupFields(rawCommandInput);
  }

  throw new Error('setup command input must be an object');
}

export function roleErrorMessage(feature: string): string {
  return [
    `Your App Store Connect API key's role cannot read ${feature} (Apple returned 403).`,
    'Grant the key access in Users & Access -> Integrations, or use another key.',
  ].join(' ');
}

function isAppleRoleDenied(fields: Record<string, unknown>): boolean {
  if (fields['_tag'] != 'AppleTransportFailure') {
    return false;
  }

  return fields['status'] == 403;
}

function isForbiddenApple(cause: unknown): boolean {
  if (isPlainRecord(cause)) {
    return isAppleRoleDenied(cause);
  }

  return false;
}

async function withAppleRole<Success>(
  feature: string,
  appleCall: Promise<Success>,
): Promise<Success> {
  try {
    return await appleCall;
  } catch (cause) {
    if (isForbiddenApple(cause)) {
      throw setupFailureWithCause('ios', roleErrorMessage(feature), cause);
    }

    throw cause;
  }
}

function teamText(teamId: string | null): string {
  if (teamId == null) {
    return '';
  }

  return `, team ${teamId}`;
}

function appIdText(bundleIdRegistered: boolean): string {
  if (bundleIdRegistered) {
    return 'registered';
  }

  return "NOT registered - run 'launch setup ios --provision'";
}

function capabilitiesText(capabilities: readonly string[]): string {
  if (capabilities.length > 0) {
    return capabilities.join(', ');
  }

  return 'none enabled';
}

function certificateText(certificateSerial: string | null): string {
  if (certificateSerial == null) {
    return "none cached - run 'launch creds setup'";
  }

  return certificateSerial;
}

function profileText(profileName: string | null): string {
  if (profileName == null) {
    return "none cached - run 'launch creds setup'";
  }

  return profileName;
}

function extensionText(provisioned: boolean): string {
  if (provisioned) {
    return 'profile cached';
  }

  return "not provisioned - run 'launch setup ios --provision'";
}

function deviceSummary(devices: readonly ProvisioningDevice[]): string {
  if (devices.length > 0) {
    return `${devices.length} registered`;
  }

  return "none (add with 'launch device add <udid>')";
}

function disabledText(disabled: boolean): string {
  if (disabled) {
    return ' (disabled)';
  }

  return '';
}

export function formatProvisioningReport(provisioningReport: ProvisioningReport): string {
  const reportLines = [
    `iOS provisioning - ${provisioningReport.app.name} (${provisioningReport.app.bundleId})`,
    `  account:      ${provisioningReport.account.label} (key ${provisioningReport.account.keyId}${teamText(provisioningReport.account.teamId)})`,
    `  App ID:       ${appIdText(provisioningReport.bundleIdRegistered)}`,
    `  capabilities: ${capabilitiesText(provisioningReport.capabilities)}`,
    `  certificate:  ${certificateText(provisioningReport.certificateSerial)}`,
    `  profile:      ${profileText(provisioningReport.profileName)}`,
  ];

  if (provisioningReport.extensions.length > 0) {
    reportLines.push(`  extensions:   ${provisioningReport.extensions.length} declared`);

    for (const provisioningExtension of provisioningReport.extensions) {
      reportLines.push(
        `                  - ${provisioningExtension.bundleId} - ${extensionText(provisioningExtension.provisioned)}`,
      );
    }
  }

  reportLines.push(`  devices:      ${deviceSummary(provisioningReport.devices)}`);

  for (const provisioningDevice of provisioningReport.devices) {
    reportLines.push(
      `                  - ${provisioningDevice.name} - ${provisioningDevice.udid}${disabledText(provisioningDevice.disabled)}`,
    );
  }

  return reportLines.join('\n');
}

function isMissingActiveAccount(
  accountRecord: AccountRecord | null | undefined,
): accountRecord is null {
  // Null means no active account. Undefined means the selector matched nothing, so == null is too wide.
  return accountRecord == null;
}

function isUnmatchedAccount(accountRecord: AccountRecord | undefined): accountRecord is undefined {
  return accountRecord == null;
}

async function findSetupAccount(
  accountSelector: string | undefined,
): Promise<AccountRecord | null | undefined> {
  if (accountSelector == null) {
    return getActiveAccount();
  }

  const accountRecords = await listAccounts();

  return matchAccount([...accountRecords], accountSelector);
}

async function loadSetupAccount(accountSelector: string | undefined): Promise<SetupAccount> {
  const accountRecord = await findSetupAccount(accountSelector);

  if (isMissingActiveAccount(accountRecord)) {
    throw setupFailure('ios', 'No active Apple account. Import one: launch creds set-key');
  }

  if (isUnmatchedAccount(accountRecord)) {
    throw setupFailure(
      'ios',
      `No Apple account matching "${accountSelector}". See \`launch creds status\`.`,
    );
  }

  const ascKey = await loadAscKeyById(accountRecord.keyId);

  if (ascKey == null) {
    throw setupFailure(
      'ios',
      `Account "${accountRecord.label}" has no stored key. Re-import: launch creds set-key`,
    );
  }

  return { record: accountRecord, ascKey };
}

function alwaysConfirm(): Promise<boolean> {
  return Promise.resolve(true);
}

function confirmWithPrompt(message: string): Promise<boolean> {
  return LaunchPrompt.confirm(message);
}

async function provisioningConfirmation(
  confirmed: boolean,
): Promise<(message: string) => Promise<boolean>> {
  if (confirmed) {
    return alwaysConfirm;
  }

  const terminalIsInteractive = new Prompts().isInteractive();

  if (terminalIsInteractive == false) {
    throw setupFailure(
      'ios',
      'Provisioning requires confirmation. Re-run with --yes in a non-interactive shell.',
    );
  }

  return confirmWithPrompt;
}

function extensionBundleIds(iosExtensions: string[] | undefined): string[] {
  if (iosExtensions == null) {
    return [];
  }

  return iosExtensions;
}

function storedTeamId(teamId: string | undefined): string | null {
  if (teamId == null) {
    return null;
  }

  return teamId;
}

function signingLabels(signingAssets: SigningAssets | null): {
  certificateSerial: string | null;
  profileName: string | null;
} {
  if (signingAssets == null) {
    return { certificateSerial: null, profileName: null };
  }

  return {
    certificateSerial: signingAssets.certSerial,
    profileName: signingAssets.profileName,
  };
}

function capabilityName(bundleCapability: { capabilityType: string }): string {
  return bundleCapability.capabilityType;
}

function compareText(leftCapability: string, rightCapability: string): number {
  return leftCapability.localeCompare(rightCapability);
}

function provisioningDevice(appleDevice: DeviceResource): ProvisioningDevice {
  return {
    name: appleDevice.name,
    udid: appleDevice.udid,
    disabled: appleDevice.status == 'DISABLED',
  };
}

async function listEnabledCapabilities(
  appleStore: ReturnType<typeof AppleStoreClientService.createClient>,
  bundleIdentifier: { id: string } | null,
): Promise<string[]> {
  if (bundleIdentifier == null) {
    return [];
  }

  const bundleCapabilities = await withAppleRole(
    'App ID capabilities',
    appleStore.listBundleIdCapabilities(bundleIdentifier.id),
  );

  return bundleCapabilities.map(capabilityName).sort(compareText);
}

async function setupIosProgram(commandInput: IosSetupInput): Promise<void> {
  const logger = createLogger(false);
  const setupAccount = await loadSetupAccount(commandInput.account);
  const storeAppContext = await loadStoreAppContext(commandInput.app);
  const selectedApp = storeAppContext.app;
  const bundleId = selectedApp.bundleId;

  if (bundleId == null) {
    throw setupFailure(
      'ios',
      `No iOS bundle identifier for ${selectedApp.name}. Set ios.bundleIdentifier in app.json.`,
    );
  }

  const appExtensions = extensionBundleIds(selectedApp.iosExtensions);

  if (commandInput.provision) {
    const confirmCreate = await provisioningConfirmation(commandInput.yes);

    await ensureSigningCredentials({
      platform: 'ios',
      bundleId,
      appName: selectedApp.name,
      ascKey: setupAccount.ascKey,
      log: logger,
      dryRun: false,
      confirmCreate,
      extensions: appExtensions,
    });
  }

  const appleStore = AppleStoreClientService.createClient(setupAccount.ascKey);
  const bundleIdentifier = await withAppleRole('App IDs', appleStore.findBundleId(bundleId));
  const capabilities = await listEnabledCapabilities(appleStore, bundleIdentifier);

  const appleDevices = await withAppleRole('registered devices', appleStore.listDevices());
  const signingAssets = await loadCachedSigningAssets(setupAccount.record.keyId, bundleId);
  const storedCredentials = await describeStoredCredentials(setupAccount.record.keyId);
  const provisionedBundleIds = new Set(storedCredentials.bundleIds);
  const labels = signingLabels(signingAssets);

  function provisioningExtension(extensionId: string): ProvisioningExtension {
    return {
      bundleId: extensionId,
      provisioned: provisionedBundleIds.has(extensionId),
    };
  }

  const provisioningReport: ProvisioningReport = {
    account: {
      label: setupAccount.record.label,
      keyId: setupAccount.record.keyId,
      teamId: storedTeamId(setupAccount.record.teamId),
    },
    app: { name: selectedApp.name, bundleId },
    bundleIdRegistered: bundleIdentifier != null,
    capabilities,
    certificateSerial: labels.certificateSerial,
    profileName: labels.profileName,
    extensions: appExtensions.map(provisioningExtension),
    devices: appleDevices.map(provisioningDevice),
  };

  if (commandInput.json) {
    logger.line(JSON.stringify(provisioningReport, null, 2));

    return;
  }

  logger.line(formatProvisioningReport(provisioningReport));
}

function requestedPlatformText(platform: string | undefined): string {
  if (platform == null) {
    return 'ios';
  }

  return platform;
}

async function runAutoSetup(commandInput: AutoSetupInput): Promise<void> {
  const platform = parsePlatform(requestedPlatformText(commandInput.platform));

  await runSetup({
    platform,
    yes: commandInput.yes,
    rehearse: commandInput.rehearse,
  });
}

async function runDecodedSetupCommand(commandInput: SetupCommandInput): Promise<void> {
  switch (commandInput.operation) {
    case 'auto':
      await runAutoSetup(commandInput);

      return;
    case 'ios':
      await setupIosProgram(commandInput);

      return;
  }
}

export async function setupCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    var commandInput = decodeSetupCommandInput(rawCommandInput);
  } catch (cause) {
    throw setupFailureWithCause('auto', errorMessage(cause), cause);
  }

  try {
    await runDecodedSetupCommand(commandInput);
  } catch (cause) {
    throw setupFailureWithCause(commandInput.operation, errorMessage(cause), cause);
  }
}

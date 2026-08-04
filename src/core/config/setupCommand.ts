import type { CommandExecutor } from '@effect/platform/CommandExecutor';
import { type FileSystem, type HttpClient, type Path, Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import {
  getActiveAccount,
  listAccounts,
  loadAscKeyById,
  matchAccount,
} from '../credentials/accounts.js';
import {
  describeStoredCredentials,
  ensureSigningCredentials,
  loadCachedSigningAssets,
} from '../credentials/appleSigning.js';
import type { LaunchEnvironmentService } from '../services/environment.js';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger, type Logger } from '../services/logger.js';
import type { LaunchPathsService } from '../services/paths.js';
import { parsePlatform } from '../services/platform.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import type { LaunchSecretStoreService } from '../services/secretStore.js';
import type { AppleCredentialsClientFactory } from '../services/appleCredentialsClient.js';
import type { AppStoreIdentityService } from '../services/appStoreIdentity.js';
import type { GoogleStoreClientService } from '../services/googleStoreClient.js';
import {
  AppleStoreClientService,
  type AppleStoreClientService as AppleStoreClientRequirements,
  type AppleTransportFailure,
  type EffectAppStoreConnectClient,
} from '../services/appleStoreClient.js';
import type { SetupStoreReadinessService } from '../services/setupStoreReadiness.js';
import type { AccountRecord, AscKey } from '../types/credentials.js';
import {
  loadStoreAppContext,
  type StoreAppSelectionRequirements,
} from '../store/selectStoreApp.js';
import { runSetup } from './setup.js';

export const SetupCommandInputSchema = Schema.Union(
  Schema.Struct({
    operation: Schema.Literal('auto'),
    platform: Schema.optional(Schema.String),
    yes: Schema.Boolean,
    rehearse: Schema.Boolean,
  }),
  Schema.Struct({
    operation: Schema.Literal('ios'),
    account: Schema.optional(Schema.String),
    app: Schema.optional(Schema.String),
    provision: Schema.Boolean,
    json: Schema.Boolean,
    yes: Schema.Boolean,
  }),
);

export type SetupCommandInput = Schema.Schema.Type<typeof SetupCommandInputSchema>;

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

export type SetupCommandFailure = Readonly<{
  readonly _tag: 'SetupCommandFailure';
  readonly operation: SetupCommandInput['operation'];
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makeSetupCommandFailure = Data.tagged<SetupCommandFailure>('SetupCommandFailure');

type SetupCommandRequirements =
  | AppleStoreClientRequirements
  | AppleCredentialsClientFactory
  | AppStoreIdentityService
  | CommandExecutor
  | FileSystem.FileSystem
  | GoogleStoreClientService
  | HttpClient.HttpClient
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchPromptService
  | LaunchSecretStoreService
  | Logger
  | Path.Path
  | StoreAppSelectionRequirements
  | SetupStoreReadinessService
  | Terminal.Terminal;

type SetupAccount = Readonly<{
  record: AccountRecord;
  ascKey: AscKey;
}>;

export const roleErrorMessage = (feature: string): string =>
  `Your App Store Connect API key's role cannot read ${feature} (Apple returned 403). Grant the key access in Users & Access -> Integrations, or use another key.`;

const withAppleRole = <Success>(
  feature: string,
  appleEffect: Effect.Effect<Success, AppleTransportFailure>,
): Effect.Effect<Success, AppleTransportFailure | SetupCommandFailure> =>
  appleEffect.pipe(
    Effect.mapError((cause) => {
      if (cause.status !== 403) return cause;
      return makeSetupCommandFailure({
        operation: 'ios',
        message: roleErrorMessage(feature),
        cause,
      });
    }),
  );

export const formatProvisioningReport = (provisioningReport: ProvisioningReport): string => {
  let teamText = '';
  if (provisioningReport.account.teamId !== null) {
    teamText = `, team ${provisioningReport.account.teamId}`;
  }
  let appIdText = "NOT registered - run 'launch setup ios --provision'";
  if (provisioningReport.bundleIdRegistered) appIdText = 'registered';
  let capabilitiesText = 'none enabled';
  if (provisioningReport.capabilities.length > 0) {
    capabilitiesText = provisioningReport.capabilities.join(', ');
  }
  let certificateText = "none cached - run 'launch creds setup'";
  if (provisioningReport.certificateSerial !== null) {
    certificateText = provisioningReport.certificateSerial;
  }
  let profileText = "none cached - run 'launch creds setup'";
  if (provisioningReport.profileName !== null) profileText = provisioningReport.profileName;
  const reportLines = [
    `iOS provisioning - ${provisioningReport.app.name} (${provisioningReport.app.bundleId})`,
    `  account:      ${provisioningReport.account.label} (key ${provisioningReport.account.keyId}${teamText})`,
    `  App ID:       ${appIdText}`,
    `  capabilities: ${capabilitiesText}`,
    `  certificate:  ${certificateText}`,
    `  profile:      ${profileText}`,
  ];
  if (provisioningReport.extensions.length > 0) {
    reportLines.push(`  extensions:   ${provisioningReport.extensions.length} declared`);
    for (const provisioningExtension of provisioningReport.extensions) {
      let extensionText = "not provisioned - run 'launch setup ios --provision'";
      if (provisioningExtension.provisioned) extensionText = 'profile cached';
      reportLines.push(`                  - ${provisioningExtension.bundleId} - ${extensionText}`);
    }
  }
  let deviceSummary = "none (add with 'launch device add <udid>')";
  if (provisioningReport.devices.length > 0) {
    deviceSummary = `${provisioningReport.devices.length} registered`;
  }
  reportLines.push(`  devices:      ${deviceSummary}`);
  for (const provisioningDevice of provisioningReport.devices) {
    let disabledText = '';
    if (provisioningDevice.disabled) disabledText = ' (disabled)';
    reportLines.push(
      `                  - ${provisioningDevice.name} - ${provisioningDevice.udid}${disabledText}`,
    );
  }
  return reportLines.join('\n');
};

const loadSetupAccount = (
  accountSelector: string | undefined,
): Effect.Effect<SetupAccount, unknown, SetupCommandRequirements> =>
  Effect.gen(function* () {
    let accountRecord: AccountRecord | null | undefined;
    if (accountSelector === undefined) {
      accountRecord = yield* getActiveAccount();
    } else {
      const accountRecords = yield* listAccounts();
      accountRecord = matchAccount([...accountRecords], accountSelector);
    }
    if (accountRecord === null) {
      return yield* Effect.fail(
        makeSetupCommandFailure({
          operation: 'ios',
          message: 'No active Apple account. Import one: launch creds set-key',
        }),
      );
    }
    if (accountRecord === undefined) {
      return yield* Effect.fail(
        makeSetupCommandFailure({
          operation: 'ios',
          message: `No Apple account matching "${accountSelector}". See \`launch creds status\`.`,
        }),
      );
    }
    const ascKey = yield* loadAscKeyById(accountRecord.keyId);
    if (ascKey === null) {
      return yield* Effect.fail(
        makeSetupCommandFailure({
          operation: 'ios',
          message: `Account "${accountRecord.label}" has no stored key. Re-import: launch creds set-key`,
        }),
      );
    }
    return { record: accountRecord, ascKey };
  });

const provisioningConfirmation = (
  confirmed: boolean,
): Effect.Effect<
  (message: string) => Effect.Effect<boolean, unknown>,
  SetupCommandFailure,
  LaunchPromptService | Terminal.Terminal
> =>
  Effect.gen(function* () {
    if (confirmed) return () => Effect.succeed(true);
    const terminal = yield* Terminal.Terminal;
    if (!(yield* terminal.isTTY)) {
      return yield* Effect.fail(
        makeSetupCommandFailure({
          operation: 'ios',
          message:
            'Provisioning requires confirmation. Re-run with --yes in a non-interactive shell.',
        }),
      );
    }
    const prompt = yield* LaunchPrompt;
    return (message: string) => prompt.confirm(message);
  });

const setupIosProgram = (
  commandInput: Extract<SetupCommandInput, { operation: 'ios' }>,
): Effect.Effect<void, unknown, SetupCommandRequirements> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const setupAccount = yield* loadSetupAccount(commandInput.account);
    const storeAppContext = yield* loadStoreAppContext(commandInput.app);
    const selectedApp = storeAppContext.app;
    if (selectedApp.bundleId === undefined) {
      return yield* Effect.fail(
        makeSetupCommandFailure({
          operation: 'ios',
          message: `No iOS bundle identifier for ${selectedApp.name}. Set ios.bundleIdentifier in app.json.`,
        }),
      );
    }
    let appExtensions = selectedApp.iosExtensions;
    if (appExtensions === undefined) appExtensions = [];
    if (commandInput.provision) {
      const confirmCreate = yield* provisioningConfirmation(commandInput.yes);
      yield* ensureSigningCredentials({
        platform: 'ios',
        bundleId: selectedApp.bundleId,
        appName: selectedApp.name,
        ascKey: setupAccount.ascKey,
        log: logger,
        dryRun: false,
        confirmCreate,
        extensions: appExtensions,
      });
    }
    const appleStore = yield* loadActiveAppleStoreForAccount(setupAccount.ascKey);
    const bundleIdentifier = yield* withAppleRole(
      'App IDs',
      appleStore.findBundleId(selectedApp.bundleId),
    );
    let capabilities: string[] = [];
    if (bundleIdentifier !== null) {
      const bundleCapabilities = yield* withAppleRole(
        'App ID capabilities',
        appleStore.listBundleIdCapabilities(bundleIdentifier.id),
      );
      capabilities = bundleCapabilities
        .map((bundleCapability) => bundleCapability.capabilityType)
        .sort((leftCapability, rightCapability) => leftCapability.localeCompare(rightCapability));
    }
    const appleDevices = yield* withAppleRole('registered devices', appleStore.listDevices());
    const signingAssets = yield* loadCachedSigningAssets(
      setupAccount.record.keyId,
      selectedApp.bundleId,
    );
    const storedCredentials = yield* describeStoredCredentials(setupAccount.record.keyId);
    const provisionedBundleIds = new Set(storedCredentials.bundleIds);
    let teamId: string | null = null;
    if (setupAccount.record.teamId !== undefined) teamId = setupAccount.record.teamId;
    let certificateSerial: string | null = null;
    let profileName: string | null = null;
    if (signingAssets !== null) {
      certificateSerial = signingAssets.certSerial;
      profileName = signingAssets.profileName;
    }
    const provisioningReport: ProvisioningReport = {
      account: {
        label: setupAccount.record.label,
        keyId: setupAccount.record.keyId,
        teamId,
      },
      app: { name: selectedApp.name, bundleId: selectedApp.bundleId },
      bundleIdRegistered: bundleIdentifier !== null,
      capabilities,
      certificateSerial,
      profileName,
      extensions: appExtensions.map((extensionBundleId) => ({
        bundleId: extensionBundleId,
        provisioned: provisionedBundleIds.has(extensionBundleId),
      })),
      devices: appleDevices.map((appleDevice) => ({
        name: appleDevice.name,
        udid: appleDevice.udid,
        disabled: appleDevice.status === 'DISABLED',
      })),
    };
    if (commandInput.json) {
      yield* logger.line(JSON.stringify(provisioningReport, null, 2));
      return;
    }
    yield* logger.line(formatProvisioningReport(provisioningReport));
  });

const loadActiveAppleStoreForAccount = (
  ascKey: AscKey,
): Effect.Effect<EffectAppStoreConnectClient, unknown, AppleStoreClientRequirements> =>
  Effect.gen(function* () {
    const appleStoreClients = yield* AppleStoreClientService;
    return yield* appleStoreClients.createEffectClient(ascKey);
  });

export const setupCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, SetupCommandFailure, SetupCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(SetupCommandInputSchema)(rawCommandInput);
    switch (commandInput.operation) {
      case 'auto': {
        let platformText = 'ios';
        if (commandInput.platform !== undefined) platformText = commandInput.platform;
        const platform = yield* parsePlatform(platformText);
        return yield* runSetup({
          platform,
          yes: commandInput.yes,
          rehearse: commandInput.rehearse,
        });
      }
      case 'ios':
        return yield* setupIosProgram(commandInput);
    }
  }).pipe(
    Effect.mapError((cause) => {
      let operation: SetupCommandInput['operation'] = 'auto';
      if (Schema.is(SetupCommandInputSchema)(rawCommandInput))
        operation = rawCommandInput.operation;
      return makeSetupCommandFailure({
        operation,
        message: errorMessage(cause),
        cause,
      });
    }),
  );

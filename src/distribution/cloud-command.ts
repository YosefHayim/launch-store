import { stdin } from 'node:process';
import { costBanner, formatAge, isReleasable, releasableAt, usd } from '../build/cost.ts';
import { loadConfig } from '../config/config.ts';
import { errorMessage } from '../services/platform/error-message.ts';
import { createLogger } from '../services/platform/logger.ts';
import { LaunchPrompt } from '../services/platform/prompt.ts';
import { readLaunchDirectories } from '../services/platform/paths.ts';
import { getComputeHost } from '../services/provider-support/registry.ts';
import { completeCommand, isCommandExit } from '../terminal/command-exit.ts';
import type { AwsConfig, HostHandle } from '../types/remote.ts';
import { clearLiveHost, getAmiId, getLiveHost } from './cloud-state.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';

const cloudOperations = ['setup', 'status', 'teardown', 'doctor'] as const;

type CloudOperation = (typeof cloudOperations)[number];

type CloudCommandInput = Readonly<{
  operation: CloudOperation;
  yes: boolean;
}>;

type CloudCommandFailure = Readonly<{
  readonly _tag: 'CloudCommandFailure';
  readonly operation: CloudOperation;
  readonly message: string;
  readonly cause?: unknown;
}>;

function makeCloudCommandFailure(fields: {
  operation: CloudOperation;
  message: string;
  cause?: unknown;
}): CloudCommandFailure {
  const failureCause = fields.cause;
  const isCauseMissing = failureCause == null;

  if (isCauseMissing) {
    return {
      _tag: 'CloudCommandFailure',
      operation: fields.operation,
      message: fields.message,
    };
  }

  return {
    _tag: 'CloudCommandFailure',
    operation: fields.operation,
    message: fields.message,
    cause: failureCause,
  };
}

function isKnownCloudOperation(operation: unknown): operation is CloudOperation {
  if (operation == 'setup') {
    return true;
  }

  if (operation == 'status') {
    return true;
  }

  if (operation == 'teardown') {
    return true;
  }

  if (operation == 'doctor') {
    return true;
  }

  return false;
}

function decodeCloudCommandInput(rawCommandInput: unknown): CloudCommandInput {
  const rawCommandInputObject = readPlainObject(rawCommandInput);

  if (rawCommandInputObject == null) {
    throw new Error('Cloud command input is malformed.');
  }

  const operation = rawCommandInputObject['operation'];

  if (isKnownCloudOperation(operation) == false) {
    throw new Error('Cloud command operation is unknown.');
  }

  if (typeof rawCommandInputObject['yes'] != 'boolean') {
    throw new Error('Cloud command confirmation flag is missing.');
  }

  return { operation: operation as CloudOperation, yes: rawCommandInputObject['yes'] };
}

export const CloudCommandInputSchema = decodeCloudCommandInput;

function hostLabel(hostHandle: HostHandle): string {
  if (hostHandle.instanceId != null) {
    return hostHandle.instanceId;
  }

  return hostHandle.ssh.host;
}

async function showCloudStatus(): Promise<void> {
  const logger = createLogger(false);
  const hostHandle = await getLiveHost();

  if (hostHandle == null) {
    logger.line('No live cloud host. A remote build allocates one on demand.');

    return;
  }

  const computeHost = getComputeHost(hostHandle.provider);
  const hostStatus = await computeHost.status(hostHandle);

  if (hostStatus == null) {
    logger.line(
      `Recorded host ${hostLabel(hostHandle)} is no longer live (it was released). Clearing state.`,
    );
    await clearLiveHost();

    return;
  }

  if (hostHandle.provider == 'byo-ssh') {
    const age = formatAge(hostStatus.ageMs);
    logger.line(
      `Connected to your Mac at ${hostHandle.ssh.user}@${hostHandle.ssh.host} (up ${age}; not billed by Launch).`,
    );

    return;
  }

  logger.line(costBanner(hostHandle));
  let regionLabel = '?';

  if (hostHandle.region != null) {
    regionLabel = hostHandle.region;
  }

  let dedicatedHostLabel = '?';

  if (hostHandle.hostId != null) {
    dedicatedHostLabel = hostHandle.hostId;
  }

  logger.line(
    `  region ${regionLabel} - host ${dedicatedHostLabel} - ~${usd(hostStatus.estimatedCostUsd)} so far`,
  );
  logger.line(
    `  releasable after ${new Date(hostStatus.releasableAt).toLocaleString()} (24h Apple-license minimum).`,
  );
}

async function confirmCloudTeardown(hostHandle: HostHandle, confirmed: boolean): Promise<boolean> {
  if (confirmed) {
    return true;
  }

  const terminalIsInteractive = stdin.isTTY == true;

  if (terminalIsInteractive == false) {
    throw makeCloudCommandFailure({
      operation: 'teardown',
      message: 'Refusing to tear down a cloud host without confirmation. Re-run with --yes.',
    });
  }

  let shouldTearDown = false;

  try {
    shouldTearDown = await LaunchPrompt.confirm(`Tear down ${hostLabel(hostHandle)}?`);
  } catch (cause) {
    const failureMessage = errorMessage(cause);
    throw makeCloudCommandFailure({
      operation: 'teardown',
      message: failureMessage,
      cause,
    });
  }

  if (shouldTearDown) {
    return true;
  }

  LaunchPrompt.cancel('Left the host running.');

  return false;
}

async function teardownCloudHost(confirmed: boolean): Promise<void> {
  const logger = createLogger(false);
  const hostHandle = await getLiveHost();

  if (hostHandle == null) {
    logger.line('No live cloud host to tear down.');

    return;
  }

  const isAwsHost = hostHandle.provider == 'aws-ec2-mac';

  if (isAwsHost) {
    const canRelease = isReleasable(hostHandle.allocatedAt);

    if (canRelease == false) {
      logger.warn(
        `AWS will not release the Dedicated Host until ${new Date(releasableAt(hostHandle.allocatedAt)).toLocaleString()}. It keeps billing until then either way.`,
      );
    }
  }

  const shouldTearDown = await confirmCloudTeardown(hostHandle, confirmed);

  if (shouldTearDown == false) {
    return;
  }

  const computeHost = getComputeHost(hostHandle.provider);

  await computeHost.teardown(hostHandle);
  await clearLiveHost();
  logger.ok('Host released. No further charges accrue once AWS reports it released.');
}

async function runCloudDoctorProgram(awsConfiguration: AwsConfig): Promise<void> {
  const logger = createLogger(false);
  const computeHost = getComputeHost('aws-ec2-mac');

  if (computeHost.doctor == null) {
    throw makeCloudCommandFailure({
      operation: 'doctor',
      message: 'The registered AWS compute provider does not expose readiness checks.',
    });
  }

  const doctorReport = await computeHost.doctor(awsConfiguration);

  for (const cloudCheck of doctorReport.checks) {
    if (cloudCheck.ok) {
      logger.ok(`${cloudCheck.label} - ${cloudCheck.detail}`);
    } else {
      logger.error(`${cloudCheck.label} - ${cloudCheck.detail}`);
    }
  }

  if (doctorReport.ok == false) {
    completeCommand(1);
  }
}

async function doctorCloudSetup(): Promise<void> {
  const launchPaths = readLaunchDirectories();
  const loadedConfiguration = await loadConfig(launchPaths.workingDirectory);

  if (loadedConfiguration.config.aws == null) {
    throw makeCloudCommandFailure({
      operation: 'doctor',
      message: 'No `aws` block in launch.config.ts. Add `aws: { region: "us-east-1" }`.',
    });
  }

  await runCloudDoctorProgram(loadedConfiguration.config.aws);
}

async function showCloudSetup(): Promise<void> {
  const logger = createLogger(false);
  const launchPaths = readLaunchDirectories();
  const loadedConfiguration = await loadConfig(launchPaths.workingDirectory);
  const awsConfiguration = loadedConfiguration.config.aws;

  if (awsConfiguration == null) {
    logger.line('Add an AWS block to launch.config.ts, then run `launch-store cloud doctor`:');
    logger.line('  aws: {');
    logger.line('    region: "us-east-1",');
    logger.line('    // profile: "default",');
    logger.line('    // amiId: "ami-...",');
    logger.line('    // instanceType: "mac2.metal",');
    logger.line('  }');

    return;
  }

  let regionLine = `AWS region: ${awsConfiguration.region}`;

  if (awsConfiguration.profile != null) {
    regionLine = `${regionLine} - profile ${awsConfiguration.profile}`;
  }

  logger.line(regionLine);
  let goldenAmiId: string | undefined = awsConfiguration.amiId;

  if (goldenAmiId == null) {
    const cachedAmiId = await getAmiId();

    if (cachedAmiId != null) {
      goldenAmiId = cachedAmiId;
    }
  }

  if (goldenAmiId == null) {
    logger.line('Golden AMI: (none yet - bootstrapped and snapshotted on first remote build)');
  } else {
    logger.line(`Golden AMI: ${goldenAmiId}`);
  }

  const hostHandle = await getLiveHost();

  if (hostHandle == null) {
    logger.line('Live host: none');
  } else {
    logger.line(`Live host: ${hostLabel(hostHandle)}`);
  }

  logger.gap();
  await runCloudDoctorProgram(awsConfiguration);
}

function readKnownOperation(rawCommandInput: unknown): CloudOperation {
  try {
    return decodeCloudCommandInput(rawCommandInput).operation;
  } catch (cause) {
    const isUnknown = cause != null;

    if (isUnknown) {
      return 'status';
    }

    return 'status';
  }
}

async function executeCloudCommand(commandInput: CloudCommandInput): Promise<void> {
  switch (commandInput.operation) {
    case 'status':
      await showCloudStatus();
      return;
    case 'teardown':
      await teardownCloudHost(commandInput.yes);
      return;
    case 'doctor':
      await doctorCloudSetup();
      return;
    case 'setup':
      await showCloudSetup();
      return;
  }
}

export async function cloudCommandProgram(rawCommandInput: unknown): Promise<void> {
  try {
    const commandInput = decodeCloudCommandInput(rawCommandInput);

    await executeCloudCommand(commandInput);
  } catch (cause) {
    if (isCommandExit(cause)) {
      throw cause;
    }

    const knownOperation = readKnownOperation(rawCommandInput);
    const failureMessage = errorMessage(cause);
    throw makeCloudCommandFailure({
      operation: knownOperation,
      message: failureMessage,
      cause,
    });
  }
}

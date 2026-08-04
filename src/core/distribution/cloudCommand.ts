import { type FileSystem, type Path, Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { costBanner, formatAge, isReleasable, releasableAt, usd } from '../build/cost.js';
import { loadConfig } from '../config/config.js';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import { LaunchPaths, type LaunchPathsService } from '../services/paths.js';
import { getComputeHost } from '../services/registry.js';
import { CommandExitSchema, completeCommand, type CommandExit } from '../terminal/commandExit.js';
import type { AwsConfig, HostHandle } from '../types/remote.js';
import { clearLiveHost, getAmiId, getLiveHost } from './cloudState.js';

export const CloudCommandInputSchema = Schema.Struct({
  operation: Schema.Literal('setup', 'status', 'teardown', 'doctor'),
  yes: Schema.Boolean,
});

export type CloudCommandInput = Schema.Schema.Type<typeof CloudCommandInputSchema>;

export type CloudCommandFailure = Readonly<{
  readonly _tag: 'CloudCommandFailure';
  readonly operation: CloudCommandInput['operation'];
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makeCloudCommandFailure = Data.tagged<CloudCommandFailure>('CloudCommandFailure');

type CloudCommandRequirements =
  | FileSystem.FileSystem
  | LaunchPathsService
  | LaunchPromptService
  | Logger
  | Path.Path
  | Terminal.Terminal;

const hostLabel = (hostHandle: HostHandle): string => {
  if (hostHandle.instanceId !== undefined) return hostHandle.instanceId;
  return hostHandle.ssh.host;
};

const showCloudStatus = (): Effect.Effect<
  void,
  unknown,
  FileSystem.FileSystem | LaunchPathsService | Logger | Path.Path
> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const hostHandle = yield* getLiveHost();
    if (hostHandle === null) {
      yield* logger.line('No live cloud host. A remote build allocates one on demand.');
      return;
    }
    const computeHost = yield* getComputeHost(hostHandle.provider);
    const hostStatus = yield* computeHost.status(hostHandle);
    if (hostStatus === null) {
      yield* logger.line(
        `Recorded host ${hostLabel(hostHandle)} is no longer live (it was released). Clearing state.`,
      );
      yield* clearLiveHost();
      return;
    }
    if (hostHandle.provider === 'byo-ssh') {
      yield* logger.line(
        `Connected to your Mac at ${hostHandle.ssh.user}@${hostHandle.ssh.host} (up ${formatAge(hostStatus.ageMs)}; not billed by Launch).`,
      );
      return;
    }
    yield* logger.line(costBanner(hostHandle));
    let regionLabel = '?';
    if (hostHandle.region !== undefined) regionLabel = hostHandle.region;
    let dedicatedHostLabel = '?';
    if (hostHandle.hostId !== undefined) dedicatedHostLabel = hostHandle.hostId;
    yield* logger.line(
      `  region ${regionLabel} - host ${dedicatedHostLabel} - ~${usd(hostStatus.estimatedCostUsd)} so far`,
    );
    yield* logger.line(
      `  releasable after ${new Date(hostStatus.releasableAt).toLocaleString()} (24h Apple-license minimum).`,
    );
  });

const confirmCloudTeardown = (
  hostHandle: HostHandle,
  confirmed: boolean,
): Effect.Effect<boolean, CloudCommandFailure, LaunchPromptService | Terminal.Terminal> =>
  Effect.gen(function* () {
    if (confirmed) return true;
    const terminal = yield* Terminal.Terminal;
    const terminalIsInteractive = yield* terminal.isTTY;
    if (!terminalIsInteractive) {
      return yield* Effect.fail(
        makeCloudCommandFailure({
          operation: 'teardown',
          message: 'Refusing to tear down a cloud host without confirmation. Re-run with --yes.',
        }),
      );
    }
    const prompt = yield* LaunchPrompt;
    const shouldTearDown = yield* prompt.confirm(`Tear down ${hostLabel(hostHandle)}?`).pipe(
      Effect.mapError((cause) =>
        makeCloudCommandFailure({
          operation: 'teardown',
          message: errorMessage(cause),
          cause,
        }),
      ),
    );
    if (shouldTearDown) return true;
    yield* prompt.cancel('Left the host running.');
    return false;
  });

const teardownCloudHost = (
  confirmed: boolean,
): Effect.Effect<void, unknown, CloudCommandRequirements> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const hostHandle = yield* getLiveHost();
    if (hostHandle === null) {
      yield* logger.line('No live cloud host to tear down.');
      return;
    }
    if (hostHandle.provider === 'aws-ec2-mac' && !isReleasable(hostHandle.allocatedAt)) {
      yield* logger.warn(
        `AWS will not release the Dedicated Host until ${new Date(releasableAt(hostHandle.allocatedAt)).toLocaleString()}. It keeps billing until then either way.`,
      );
    }
    if (!(yield* confirmCloudTeardown(hostHandle, confirmed))) return;
    const computeHost = yield* getComputeHost(hostHandle.provider);
    yield* computeHost.teardown(hostHandle);
    yield* clearLiveHost();
    yield* logger.ok('Host released. No further charges accrue once AWS reports it released.');
  });

const runCloudDoctorProgram = (
  awsConfiguration: AwsConfig,
): Effect.Effect<void, CommandExit | unknown, Logger> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const computeHost = yield* getComputeHost('aws-ec2-mac');
    if (computeHost.doctor === undefined) {
      return yield* Effect.fail(
        makeCloudCommandFailure({
          operation: 'doctor',
          message: 'The registered AWS compute provider does not expose readiness checks.',
        }),
      );
    }
    const doctorReport = yield* computeHost.doctor(awsConfiguration);
    for (const cloudCheck of doctorReport.checks) {
      if (cloudCheck.ok) {
        yield* logger.ok(`${cloudCheck.label} - ${cloudCheck.detail}`);
      } else {
        yield* logger.error(`${cloudCheck.label} - ${cloudCheck.detail}`);
      }
    }
    if (!doctorReport.ok) yield* completeCommand(1);
  });

const doctorCloudSetup = (): Effect.Effect<
  void,
  CommandExit | unknown,
  FileSystem.FileSystem | LaunchPathsService | Logger | Path.Path
> =>
  Effect.gen(function* () {
    const launchPaths = yield* LaunchPaths;
    const loadedConfiguration = yield* loadConfig(launchPaths.workingDirectory);
    if (loadedConfiguration.config.aws === undefined) {
      return yield* Effect.fail(
        makeCloudCommandFailure({
          operation: 'doctor',
          message: 'No `aws` block in launch.config.ts. Add `aws: { region: "us-east-1" }`.',
        }),
      );
    }
    yield* runCloudDoctorProgram(loadedConfiguration.config.aws);
  });

const showCloudSetup = (): Effect.Effect<
  void,
  CommandExit | unknown,
  FileSystem.FileSystem | LaunchPathsService | Logger | Path.Path
> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const launchPaths = yield* LaunchPaths;
    const loadedConfiguration = yield* loadConfig(launchPaths.workingDirectory);
    const awsConfiguration = loadedConfiguration.config.aws;
    if (awsConfiguration === undefined) {
      yield* logger.line('Add an AWS block to launch.config.ts, then run `launch cloud doctor`:');
      yield* logger.line('  aws: {');
      yield* logger.line('    region: "us-east-1",');
      yield* logger.line('    // profile: "default",');
      yield* logger.line('    // amiId: "ami-...",');
      yield* logger.line('    // instanceType: "mac2.metal",');
      yield* logger.line('  }');
      return;
    }
    let regionLine = `AWS region: ${awsConfiguration.region}`;
    if (awsConfiguration.profile !== undefined) {
      regionLine = `${regionLine} - profile ${awsConfiguration.profile}`;
    }
    yield* logger.line(regionLine);
    let goldenAmi: string | null | undefined = awsConfiguration.amiId;
    if (goldenAmi === undefined) goldenAmi = yield* getAmiId();
    if (goldenAmi === null) {
      yield* logger.line(
        'Golden AMI: (none yet - bootstrapped and snapshotted on first remote build)',
      );
    } else if (goldenAmi === undefined) {
      yield* logger.line(
        'Golden AMI: (none yet - bootstrapped and snapshotted on first remote build)',
      );
    } else {
      yield* logger.line(`Golden AMI: ${goldenAmi}`);
    }
    const hostHandle = yield* getLiveHost();
    if (hostHandle === null) {
      yield* logger.line('Live host: none');
    } else {
      yield* logger.line(`Live host: ${hostLabel(hostHandle)}`);
    }
    yield* logger.gap();
    yield* runCloudDoctorProgram(awsConfiguration);
  });

export const cloudCommandProgram = (
  rawCommandInput: unknown,
): Effect.Effect<void, CloudCommandFailure | CommandExit, CloudCommandRequirements> =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(CloudCommandInputSchema)(rawCommandInput);
    switch (commandInput.operation) {
      case 'status':
        return yield* showCloudStatus();
      case 'teardown':
        return yield* teardownCloudHost(commandInput.yes);
      case 'doctor':
        return yield* doctorCloudSetup();
      case 'setup':
        return yield* showCloudSetup();
    }
  }).pipe(
    Effect.mapError((cause) => {
      if (Schema.is(CommandExitSchema)(cause)) return cause;
      let operation: CloudCommandInput['operation'] = 'status';
      if (Schema.is(CloudCommandInputSchema)(rawCommandInput)) {
        operation = rawCommandInput.operation;
      }
      return makeCloudCommandFailure({
        operation,
        message: errorMessage(cause),
        cause,
      });
    }),
  );

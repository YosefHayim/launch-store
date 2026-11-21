import { type HttpClient, Terminal } from '@effect/platform';
import { NodeContext, NodeHttpClient } from '@effect/platform-node';
import { Cause, Effect, Layer, Option, Schema } from 'effect';
import { homedir } from 'node:os';
import {
  LaunchEnvironmentLive,
  type LaunchEnvironmentService,
} from '../services/platform/environment.js';
import {
  AppleStoreClientLive,
  type AppleStoreClientService,
} from '../services/stores/appleStoreClient.js';
import {
  AppleCredentialsClientLive,
  type AppleCredentialsClientFactory,
} from '../services/stores/appleCredentialsClient.js';
import {
  AppStoreIdentityLive,
  type AppStoreIdentityService,
} from '../services/stores/appStoreIdentity.js';
import {
  GoogleStoreClientLive,
  type GoogleStoreClientService,
} from '../services/stores/googleStoreClient.js';
import {
  GoogleReportingClientLive,
  type GoogleReportingClientService,
} from '../services/stores/googleReportingClient.js';
import {
  GoogleAccessTokenLive,
  type GoogleAccessTokenService,
} from '../services/stores/googleAccessToken.js';
import { StatsCredentialsLive } from '../stats/statsCredentials.js';
import type { StatsCredentialsShape } from '../types/stats.js';
import {
  jsonLine,
  makeLaunchLoggerJson,
  LaunchLoggerLive,
  type Logger,
} from '../services/platform/logger.js';
import { errorMessage } from '../services/platform/errorMessage.js';
import { setJsonOutput } from '../services/platform/jsonOutputMode.js';
import { CommandExitSchema, completeCommand } from '../terminal/commandExit.js';
import { type LaunchPathsService, makeLaunchPathsLive } from '../services/platform/paths.js';
import {
  LaunchPromptJson,
  LaunchPromptLive,
  type LaunchPromptService,
} from '../services/platform/prompt.js';
import {
  LaunchSecretStoreLive,
  type LaunchSecretStoreService,
} from '../services/credentials/secretStore.js';
import {
  SetupStoreReadinessLive,
  type SetupStoreReadinessService,
} from '../services/stores/setupStoreReadiness.js';

type CliRequirements =
  | HttpClient.HttpClient
  | AppleStoreClientService
  | AppleCredentialsClientFactory
  | AppStoreIdentityService
  | GoogleStoreClientService
  | GoogleAccessTokenService
  | GoogleReportingClientService
  | StatsCredentialsShape
  | LaunchEnvironmentService
  | LaunchPathsService
  | LaunchPromptService
  | LaunchSecretStoreService
  | Logger
  | NodeContext.NodeContext
  | SetupStoreReadinessService;

const runWithTerminalServices = <Success, Failure>(
  program: Effect.Effect<Success, Failure, CliRequirements>,
  loggerLayer: Layer.Layer<Logger, never, Terminal.Terminal>,
  promptLayer: Layer.Layer<LaunchPromptService>,
) =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(loggerLayer),
      Effect.provide(AppStoreIdentityLive),
      Effect.provide(AppleCredentialsClientLive),
      Effect.provide(SetupStoreReadinessLive),
      Effect.provide(StatsCredentialsLive),
      Effect.provide(GoogleAccessTokenLive),
      Effect.provide(AppleStoreClientLive),
      Effect.provide(GoogleStoreClientLive),
      Effect.provide(GoogleReportingClientLive),
      Effect.provide(LaunchEnvironmentLive),
      Effect.provide(makeLaunchPathsLive(homedir(), process.cwd())),
      Effect.provide(promptLayer),
      Effect.provide(LaunchSecretStoreLive),
      Effect.provide(NodeHttpClient.layer),
      Effect.provide(NodeContext.layer),
    ),
  );

/** Run a fully composed core command with the shared Node terminal logger boundary. */
export const runCliProgram = <Success, Failure>(
  program: Effect.Effect<Success, Failure, CliRequirements>,
) => runWithTerminalServices(program, LaunchLoggerLive, LaunchPromptLive);

/** The fixed fields of a `--json` run's final result line. */
export type JsonRunSummary = Readonly<{
  command: 'build' | 'release';
  platform: string;
  dryRun: boolean;
  profile: string;
}>;

const writeStderr = (text: string) =>
  Effect.sync(() => {
    process.stderr.write(text);
  });

/** A terminal that reports itself as non-interactive, so no code path waits on a TTY. */
const NonInteractiveTerminalLive = Layer.effect(
  Terminal.Terminal,
  Effect.map(Terminal.Terminal, (terminal) => ({ ...terminal, isTTY: Effect.succeed(false) })),
);

const failureOutcomeOf = (cause: Cause.Cause<unknown>) => {
  const commandFailure = Cause.failureOption(cause);
  const commandExit = Option.flatMap(commandFailure, Schema.decodeUnknownOption(CommandExitSchema));
  if (Option.isSome(commandExit)) {
    const { exitCode, message } = commandExit.value;
    if (message !== undefined) return { exitCode, message };
    return { exitCode, message: `The command ended with exit code ${exitCode}.` };
  }
  return { exitCode: 1, message: errorMessage(Cause.squash(cause)) };
};

/**
 * Run a core command for `--json`: stdout carries only NDJSON events (see {@link makeLaunchLoggerJson}),
 * no prompt can ask anything, and the run ends with exactly one `result` line. A failure ends with
 * `ok: false` plus the readable message and a non-zero exit code.
 */
export const runJsonCliProgram = <Success, Failure>(
  summary: JsonRunSummary,
  program: Effect.Effect<Success, Failure, CliRequirements>,
) => {
  const jsonRun = Effect.gen(function* () {
    yield* Effect.sync(() => setJsonOutput(true));
    const terminal = yield* Terminal.Terminal;
    const quietProgram = program.pipe(Effect.provide(NonInteractiveTerminalLive));
    yield* quietProgram.pipe(
      Effect.matchCauseEffect({
        onSuccess: () => terminal.display(jsonLine({ event: 'result', ok: true, ...summary })),
        onFailure: (cause) =>
          Effect.gen(function* () {
            const outcome = failureOutcomeOf(cause);
            yield* terminal.display(
              jsonLine({ event: 'result', ok: false, ...summary, message: outcome.message }),
            );
            yield* completeCommand(outcome.exitCode);
          }),
      }),
    );
  });
  return runWithTerminalServices(jsonRun, makeLaunchLoggerJson(writeStderr), LaunchPromptJson);
};

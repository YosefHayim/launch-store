import type { HttpClient } from '@effect/platform';
import { NodeContext, NodeHttpClient } from '@effect/platform-node';
import { Effect } from 'effect';
import { homedir } from 'node:os';
import {
  LaunchEnvironmentLive,
  type LaunchEnvironmentService,
} from '../core/services/environment.js';
import {
  AppleStoreClientLive,
  type AppleStoreClientService,
} from '../core/services/appleStoreClient.js';
import {
  AppleCredentialsClientLive,
  type AppleCredentialsClientFactory,
} from '../core/services/appleCredentialsClient.js';
import {
  AppStoreIdentityLive,
  type AppStoreIdentityService,
} from '../core/services/appStoreIdentity.js';
import {
  GoogleStoreClientLive,
  type GoogleStoreClientService,
} from '../core/services/googleStoreClient.js';
import {
  GoogleReportingClientLive,
  type GoogleReportingClientService,
} from '../core/services/googleReportingClient.js';
import { LaunchLoggerLive, type Logger } from '../core/services/logger.js';
import { type LaunchPathsService, makeLaunchPathsLive } from '../core/services/paths.js';
import { LaunchPromptLive, type LaunchPromptService } from '../core/services/prompt.js';
import {
  LaunchSecretStoreLive,
  type LaunchSecretStoreService,
} from '../core/services/secretStore.js';
import {
  SetupStoreReadinessLive,
  type SetupStoreReadinessService,
} from '../core/services/setupStoreReadiness.js';

/** Run a fully composed core command with the shared Node terminal logger boundary. */
export const runCliProgram = <Success, Failure>(
  program: Effect.Effect<
    Success,
    Failure,
    | HttpClient.HttpClient
    | AppleStoreClientService
    | AppleCredentialsClientFactory
    | AppStoreIdentityService
    | GoogleStoreClientService
    | GoogleReportingClientService
    | LaunchEnvironmentService
    | LaunchPathsService
    | LaunchPromptService
    | LaunchSecretStoreService
    | Logger
    | NodeContext.NodeContext
    | SetupStoreReadinessService
  >,
) =>
  Effect.runPromise(
    program.pipe(
      Effect.provide(LaunchLoggerLive),
      Effect.provide(AppStoreIdentityLive),
      Effect.provide(AppleCredentialsClientLive),
      Effect.provide(SetupStoreReadinessLive),
      Effect.provide(AppleStoreClientLive),
      Effect.provide(GoogleStoreClientLive),
      Effect.provide(GoogleReportingClientLive),
      Effect.provide(LaunchEnvironmentLive),
      Effect.provide(makeLaunchPathsLive(homedir(), process.cwd())),
      Effect.provide(LaunchPromptLive),
      Effect.provide(LaunchSecretStoreLive),
      Effect.provide(NodeHttpClient.layer),
      Effect.provide(NodeContext.layer),
    ),
  );

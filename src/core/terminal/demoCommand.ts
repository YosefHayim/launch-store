import { Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { errorMessage } from '../services/errorMessage.js';
import { createLogger, type Logger } from '../services/logger.js';
import { parsePlatform } from '../services/platform.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import type { Platform } from '../types/app.js';
import { runTour } from './tour.js';

export const DemoCommandInputSchema = Schema.Struct({
  platform: Schema.optionalWith(Schema.String, { exact: true }),
});

export type DemoCommandFailure = Readonly<{
  readonly _tag: 'DemoCommandFailure';
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeDemoCommandFailure = Data.tagged<DemoCommandFailure>('DemoCommandFailure');

/** Ask which store journey the simulated tour should show. */
export const promptTourPlatform = (): Effect.Effect<Platform | null, never, LaunchPromptService> =>
  Effect.gen(function* () {
    const prompt = yield* LaunchPrompt;
    const chosenPlatform = yield* prompt
      .select<Platform>({
        message: 'Take the 60-second tour? Pick a platform to walk through (Esc to skip)',
        choices: [
          { selection: 'ios', label: 'iOS -> TestFlight' },
          { selection: 'android', label: 'Android -> Google Play' },
        ],
        initialSelection: 'ios',
      })
      .pipe(Effect.option);
    if (chosenPlatform._tag === 'None') return null;
    return chosenPlatform.value;
  });

/** Resolve an explicit demo platform or apply the interactive/non-interactive default. */
export const resolveDemoPlatform = (
  platformText: string | undefined,
  terminalIsInteractive: boolean,
): Effect.Effect<Platform | null, unknown, LaunchPromptService> => {
  if (platformText !== undefined) return parsePlatform(platformText);
  if (!terminalIsInteractive) return Effect.succeed('ios');
  return promptTourPlatform();
};

/** Run the simulated release tour and print the real next commands. */
export const demoCommandProgram = (rawCommandInput: unknown) =>
  Effect.gen(function* () {
    const commandInput = yield* Schema.decodeUnknown(DemoCommandInputSchema)(rawCommandInput);
    const terminal = yield* Terminal.Terminal;
    const terminalIsInteractive = yield* terminal.isTTY;
    const platform = yield* resolveDemoPlatform(commandInput.platform, terminalIsInteractive);
    if (platform === null) return;
    yield* runTour(platform, terminalIsInteractive);
    const logger = yield* createLogger(false);
    yield* logger.box('Next - go from zero to the testing track', [
      'launch init             scaffold launch.config.ts',
      'launch creds set-key    import your App Store Connect API key',
      'launch creds setup      create or reuse your cert + provisioning profile',
      'launch build ios        build, sign, size-check, and upload to TestFlight',
    ]);
  }).pipe(
    Effect.mapError((cause) => makeDemoCommandFailure({ message: errorMessage(cause), cause })),
  );

export type DemoCommandRequirements = LaunchPromptService | Logger | Terminal.Terminal;

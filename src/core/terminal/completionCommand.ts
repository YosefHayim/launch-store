import { Terminal } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import type { Command } from 'commander';
import { Effect } from 'effect';
import { LaunchEnvironment, type LaunchEnvironmentService } from '../services/environment.js';
import { createLogger, type Logger } from '../services/logger.js';
import type { Shell } from '../types/remote.js';
import {
  completionScript,
  detectShell,
  installCompletion,
  makeCompletionFailure,
  parseShell,
  resolveCompletions,
  type CompletionFailure,
  type CompletionRequirements,
} from './completion.js';

/** One shell-completion operation selected by Commander. */
export type CompletionCommandInput =
  | Readonly<{ operation: 'install'; shell: string | undefined }>
  | Readonly<{ operation: 'script'; shell: string | undefined }>
  | Readonly<{ operation: 'complete'; words: readonly string[]; commandTree: Command }>;

/** Resolve an explicit shell or detect the configured login shell. */
const resolveShell = (
  shellText: string | undefined,
): Effect.Effect<Shell, CompletionFailure, LaunchEnvironmentService> =>
  Effect.gen(function* () {
    if (shellText !== undefined) return yield* parseShell(shellText);
    const launchEnvironment = yield* LaunchEnvironment;
    const detectedShell = detectShell(launchEnvironment.rawVariables);
    if (detectedShell !== undefined) return detectedShell;
    return yield* Effect.fail(
      makeCompletionFailure({
        message: 'Could not detect your shell. Pass one explicitly: bash, zsh, or fish.',
      }),
    );
  });

/** Render the outcome of installing a managed shell-completion block. */
const renderInstallOutcome = (
  shellText: string | undefined,
): Effect.Effect<
  void,
  CompletionFailure | PlatformError,
  CompletionRequirements | LaunchEnvironmentService | Logger
> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const shell = yield* resolveShell(shellText);
    const installOutcome = yield* installCompletion({ shell });
    if (installOutcome.status === 'manual') {
      yield* logger.warn(
        `Could not edit ${installOutcome.rcFile} - its directory does not exist yet.`,
      );
      yield* logger.tip(
        `Add this line to your ${installOutcome.shell} config, then restart your shell: ${installOutcome.line}`,
      );
      return;
    }
    let installVerb = 'installed';
    if (installOutcome.updated) installVerb = 'updated';
    yield* logger.step(
      'completion',
      `${installVerb} for ${installOutcome.shell} in ${installOutcome.rcFile}`,
    );
    yield* logger.tip('Restart your shell (or source the rc file) to activate it.');
  });

/** Print a completion script without adding presentation prefixes. */
const printCompletionScript = (
  shellText: string | undefined,
): Effect.Effect<
  void,
  CompletionFailure | PlatformError,
  LaunchEnvironmentService | Terminal.Terminal
> =>
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    const shell = yield* resolveShell(shellText);
    yield* terminal.display(completionScript(shell));
  });

/** Print dynamic completion candidates for the hidden shell callback. */
const printCompletionCandidates = (
  words: readonly string[],
  commandTree: Command,
): Effect.Effect<void, PlatformError, CompletionRequirements | Terminal.Terminal> =>
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    const candidates = yield* resolveCompletions([...words], commandTree);
    yield* terminal.display(`${candidates.join('\n')}\n`);
  });

/** Run one completion operation through the shared Effect runtime. */
export const completionCommandProgram = (
  commandInput: CompletionCommandInput,
): Effect.Effect<
  void,
  CompletionFailure | PlatformError,
  CompletionRequirements | LaunchEnvironmentService | Logger | Terminal.Terminal
> => {
  switch (commandInput.operation) {
    case 'install':
      return renderInstallOutcome(commandInput.shell);
    case 'script':
      return printCompletionScript(commandInput.shell);
    case 'complete':
      return printCompletionCandidates(commandInput.words, commandInput.commandTree);
  }
};

import { type FileSystem, type Path, Terminal } from '@effect/platform';
import type { PlatformError } from '@effect/platform/Error';
import { Data, Effect } from 'effect';
import { createLogger, type Logger } from '../services/logger.js';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import type { SandboxTesterResource } from '../types/appleCatalog.js';
import { clearPurchaseHistory, listSandboxTesters } from '../services/sandbox.js';
import { loadActiveAppleStore, type ActiveAppleStoreRequirements } from './appleStoreCommand.js';

/** One sandbox-tester operation selected by Commander. */
export type SandboxCommandInput =
  | Readonly<{ operation: 'list'; json: boolean }>
  | Readonly<{
      operation: 'clear';
      emails: readonly string[];
      all: boolean;
      yes: boolean;
    }>;

/** A sandbox command could not load credentials, call Apple, prompt, or render output. */
export type SandboxCommandFailure = Readonly<{
  readonly _tag: 'SandboxCommandFailure';
  readonly operation: SandboxCommandInput['operation'];
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeSandboxCommandFailure =
  Data.tagged<SandboxCommandFailure>('SandboxCommandFailure');

type SandboxCommandRequirements =
  | ActiveAppleStoreRequirements
  | FileSystem.FileSystem
  | LaunchPromptService
  | Logger
  | Path.Path
  | Terminal.Terminal;

/** Convert any dependency failure to the command's stable tagged error. */
const sandboxFailure = (
  operation: SandboxCommandInput['operation'],
  cause: unknown,
): SandboxCommandFailure => {
  let message = `Sandbox ${operation} failed.`;
  if (cause instanceof Error) message = cause.message;
  if (typeof cause === 'object' && cause !== null && 'message' in cause) {
    const causeMessage = cause.message;
    if (typeof causeMessage === 'string') message = causeMessage;
  }
  return makeSandboxCommandFailure({ operation, message, cause });
};

/** Render one sandbox tester as email, name, territory, and renewal rate. */
export const renderSandboxTester = (sandboxTester: SandboxTesterResource): string => {
  const nameParts = [sandboxTester.firstName, sandboxTester.lastName].filter(
    (namePart): namePart is string => namePart !== undefined && namePart.length > 0,
  );
  const testerFields = [sandboxTester.acAccountName];
  if (nameParts.length > 0) testerFields.push(nameParts.join(' '));
  if (sandboxTester.territory !== undefined) testerFields.push(sandboxTester.territory);
  if (sandboxTester.subscriptionRenewalRate !== undefined) {
    testerFields.push(`renews ${sandboxTester.subscriptionRenewalRate}`);
  }
  return testerFields.join('  ');
};

/** Ask before clearing purchase history, with an explicit non-interactive guard. */
const confirmClear = (
  targetLabel: string,
  confirmed: boolean,
): Effect.Effect<boolean, SandboxCommandFailure, LaunchPromptService | Terminal.Terminal> =>
  Effect.gen(function* () {
    if (confirmed) return true;
    const terminal = yield* Terminal.Terminal;
    const terminalIsInteractive = yield* terminal.isTTY;
    if (!terminalIsInteractive) {
      return yield* Effect.fail(
        makeSandboxCommandFailure({
          operation: 'clear',
          message:
            'Refusing to clear purchase history without confirmation. Re-run with --yes (non-interactive).',
          cause: 'confirmation-required',
        }),
      );
    }
    const prompt = yield* LaunchPrompt;
    const shouldClear = yield* prompt
      .confirm(`Clear purchase history for ${targetLabel}?`)
      .pipe(Effect.mapError((cause) => sandboxFailure('clear', cause)));
    if (shouldClear) return true;
    yield* prompt.cancel('Aborted - nothing cleared.');
    return false;
  });

/** List the active account's StoreKit sandbox testers. */
const listSandboxTestersProgram = (
  json: boolean,
): Effect.Effect<void, SandboxCommandFailure, SandboxCommandRequirements> =>
  Effect.gen(function* () {
    const logger = yield* createLogger(false);
    const sandboxStore = yield* loadActiveAppleStore();
    const sandboxTesters = yield* listSandboxTesters(sandboxStore);
    if (json) {
      yield* logger.line(JSON.stringify(sandboxTesters, null, 2));
      return;
    }
    if (sandboxTesters.length === 0) {
      yield* logger.line(
        'No sandbox testers. Create them in App Store Connect -> Users and Access -> Sandbox Testers.',
      );
      return;
    }
    yield* logger.line(sandboxTesters.map(renderSandboxTester).join('\n'));
    let testerSuffix = 's';
    if (sandboxTesters.length === 1) testerSuffix = '';
    yield* logger.line(`\n${sandboxTesters.length} sandbox tester${testerSuffix}.`);
  }).pipe(Effect.mapError((cause) => sandboxFailure('list', cause)));

/** Clear selected or all StoreKit sandbox purchase histories. */
const clearSandboxTestersProgram = (
  commandInput: Extract<SandboxCommandInput, { operation: 'clear' }>,
): Effect.Effect<void, SandboxCommandFailure, SandboxCommandRequirements> =>
  Effect.gen(function* () {
    let targetLabel = `${commandInput.emails.length} sandbox tester(s)`;
    if (commandInput.all) targetLabel = 'every sandbox tester';
    const shouldClear = yield* confirmClear(targetLabel, commandInput.yes);
    if (!shouldClear) return;
    const logger = yield* createLogger(false);
    const sandboxStore = yield* loadActiveAppleStore();
    const clearOutcome = yield* clearPurchaseHistory(sandboxStore, {
      emails: [...commandInput.emails],
      all: commandInput.all,
    });
    if (clearOutcome.cleared.length > 0) {
      yield* logger.step(
        'purchase history cleared',
        clearOutcome.cleared.map((sandboxTester) => sandboxTester.acAccountName).join(', '),
      );
    } else {
      yield* logger.note('No matching sandbox testers - nothing cleared.');
    }
    if (clearOutcome.notFound.length > 0) {
      yield* logger.warn(`No sandbox tester found for: ${clearOutcome.notFound.join(', ')}`);
    }
  }).pipe(Effect.mapError((cause) => sandboxFailure('clear', cause)));

/** Run one sandbox-tester operation through the shared Effect runtime. */
export const sandboxCommandProgram = (
  commandInput: SandboxCommandInput,
): Effect.Effect<void, SandboxCommandFailure | PlatformError, SandboxCommandRequirements> => {
  switch (commandInput.operation) {
    case 'list':
      return listSandboxTestersProgram(commandInput.json);
    case 'clear':
      return clearSandboxTestersProgram(commandInput);
  }
};

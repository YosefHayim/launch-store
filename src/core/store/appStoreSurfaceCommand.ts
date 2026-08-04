import { FileSystem, Terminal } from '@effect/platform';
import { Data, Effect, Schema } from 'effect';
import { LaunchPrompt, type LaunchPromptService } from '../services/prompt.js';
import type { PlannedAction } from '../types/reconcile.js';

/** Reading a sidecar or confirming an App Store surface write failed. */
export type AppStoreSurfaceCommandFailure = Readonly<{
  readonly _tag: 'AppStoreSurfaceCommandFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;
export const makeAppStoreSurfaceCommandFailure = Data.tagged<AppStoreSurfaceCommandFailure>(
  'AppStoreSurfaceCommandFailure',
);

/** Convert a surface helper failure into its tagged channel. */
const surfaceFailure = (
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): AppStoreSurfaceCommandFailure => {
  let message = `${operation} failed.`;
  if (explicitMessage !== undefined) message = explicitMessage;
  if (explicitMessage === undefined && typeof cause === 'string' && cause.length > 0)
    message = cause;
  if (explicitMessage === undefined && cause instanceof Error) message = cause.message;
  return makeAppStoreSurfaceCommandFailure({ operation, message, cause });
};

/** Render one planned App Store surface action with ASCII markers. */
export const renderStoreSurfaceAction = (plannedAction: PlannedAction): string => {
  if (plannedAction.status === 'skipped') return `- ${plannedAction.description}`;
  if (plannedAction.status === 'failed') {
    let failureText = '';
    if (plannedAction.error !== undefined) failureText = ` - ${plannedAction.error}`;
    return `x ${plannedAction.description}${failureText}`;
  }
  return `+ ${plannedAction.description}`;
};

/** Render one applied App Store surface action with ASCII markers. */
export const renderAppliedStoreSurfaceAction = (appliedAction: PlannedAction): string => {
  if (appliedAction.status === 'failed') {
    let failureText = 'failed';
    if (appliedAction.error !== undefined) failureText = appliedAction.error;
    return `x ${appliedAction.description} - ${failureText}`;
  }
  if (appliedAction.status === 'skipped') return `- ${appliedAction.description}`;
  return `OK ${appliedAction.description}`;
};

/** Resolve a typed config section or its backward-compatible JSON sidecar. */
export const resolveStoreSurfaceSection = <StoreSurfaceSection>(
  typedSection: StoreSurfaceSection | undefined,
  configPath: string,
  explicitPath: boolean,
  parseDocument: (
    parsedDocument: unknown,
  ) => StoreSurfaceSection | Effect.Effect<StoreSurfaceSection, unknown>,
): Effect.Effect<
  StoreSurfaceSection | undefined,
  AppStoreSurfaceCommandFailure,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    if (!explicitPath && typedSection !== undefined) return typedSection;
    const sidecarExists = yield* fileSystem
      .exists(configPath)
      .pipe(Effect.mapError((cause) => surfaceFailure('inspect store surface config', cause)));
    if (!sidecarExists && !explicitPath) return undefined;
    if (!sidecarExists) {
      return yield* Effect.fail(
        surfaceFailure(
          'read store surface config',
          configPath,
          `No store surface config at ${configPath}.`,
        ),
      );
    }
    const sidecarText = yield* fileSystem
      .readFileString(configPath)
      .pipe(Effect.mapError((cause) => surfaceFailure('read store surface config', cause)));
    const parsedDocument = yield* Schema.decodeUnknown(Schema.parseJson())(sidecarText).pipe(
      Effect.mapError((cause) => surfaceFailure('parse store surface JSON', cause)),
    );
    const decodedSection = yield* Effect.try({
      try: () => parseDocument(parsedDocument),
      catch: (cause) => surfaceFailure('decode store surface config', cause),
    });
    if (Effect.isEffect(decodedSection)) {
      return yield* decodedSection.pipe(
        Effect.mapError((cause) => surfaceFailure('decode store surface config', cause)),
      );
    }
    return decodedSection;
  });

/** Confirm a store-surface write unless the caller supplied --yes. */
export const confirmStoreSurfaceWrite = (
  confirmationMessage: string,
  assumeYes: boolean,
): Effect.Effect<boolean, AppStoreSurfaceCommandFailure, LaunchPromptService | Terminal.Terminal> =>
  Effect.gen(function* () {
    if (assumeYes) return true;
    const terminal = yield* Terminal.Terminal;
    if (!(yield* terminal.isTTY)) {
      return yield* Effect.fail(
        surfaceFailure(
          'confirm store surface write',
          'confirmation-required',
          'Refusing to apply without confirmation. Re-run with --yes (or --dry-run to preview).',
        ),
      );
    }
    const prompt = yield* LaunchPrompt;
    const confirmed = yield* prompt
      .confirm(confirmationMessage)
      .pipe(Effect.mapError((cause) => surfaceFailure('confirm store surface write', cause)));
    if (confirmed) return true;
    yield* prompt.cancel('Aborted - no changes made.');
    return false;
  });

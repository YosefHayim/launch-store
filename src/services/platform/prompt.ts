import { Context, Data, Effect, Layer } from 'effect';
import { Prompts } from '../../prompts.js';
import { createLogger, type Logger } from './logger.js';

const prompts = new Prompts();

type PromptSelectionFailure = Readonly<{
  readonly _tag: 'PromptSelectionFailure';
  readonly message: string;
  readonly cause?: unknown;
}>;

const makePromptSelectionFailure = Data.tagged<PromptSelectionFailure>('PromptSelectionFailure');

type PromptChoice<TSelection> = {
  readonly selection: TSelection;
  readonly label: string;
  readonly hint?: string;
};

type PromptSelectionRequest<TSelection> = {
  readonly message: string;
  readonly choices: readonly PromptChoice<TSelection>[];
  readonly searchThreshold?: number;
  readonly initialSelection?: TSelection;
};

type PromptMultiSelectionRequest<TSelection> = Readonly<{
  readonly message: string;
  readonly choices: readonly PromptChoice<TSelection>[];
  readonly initialSelections?: readonly TSelection[];
}>;

type NonInteractivePolicy<TSelection> =
  | {
      readonly kind: 'require';
      readonly flagHint: string;
    }
  | {
      readonly kind: 'fallback';
      readonly selection: TSelection;
      readonly note?: string;
    };

export type PickOneArgs<TSelection> = PromptSelectionRequest<TSelection> & {
  readonly canPrompt: boolean;
  readonly nonInteractive: NonInteractivePolicy<TSelection>;
};

export type LaunchPromptService = Readonly<{
  readonly confirm: (message: string) => Effect.Effect<boolean, PromptSelectionFailure>;
  readonly requiredText: (message: string) => Effect.Effect<string, PromptSelectionFailure>;
  readonly requiredSecret: (message: string) => Effect.Effect<string, PromptSelectionFailure>;
  readonly select: <TSelection>(
    request: PromptSelectionRequest<TSelection>,
  ) => Effect.Effect<TSelection, PromptSelectionFailure>;
  readonly selectMany: <TSelection>(
    request: PromptMultiSelectionRequest<TSelection>,
  ) => Effect.Effect<readonly TSelection[] | null, PromptSelectionFailure>;
  readonly cancel: (message: string) => Effect.Effect<void>;
}>;

type LaunchPromptTestAnswers = Readonly<{
  readonly confirmation?: boolean;
  readonly text?: string;
  readonly secret?: string;
  readonly selectionIndex?: number;
  readonly selectionIndexes?: readonly number[];
}>;

export const LaunchPrompt = Context.GenericTag<LaunchPromptService>('launch-store/Prompt');

const requireEnteredText = (
  enteredText: string | null,
): Effect.Effect<string, PromptSelectionFailure> => {
  if (enteredText == null) {
    return Effect.fail(makePromptSelectionFailure({ message: 'Prompt cancelled.' }));
  }

  const isBlank = enteredText.trim() == '';

  if (isBlank) {
    return Effect.fail(makePromptSelectionFailure({ message: 'A value is required.' }));
  }

  return Effect.succeed(enteredText);
};

export const LaunchPromptLive = Layer.succeed(LaunchPrompt, {
  confirm: (message) =>
    Effect.tryPromise({
      try: () => prompts.confirm(message),
      catch: (cause) =>
        makePromptSelectionFailure({ message: 'The confirmation prompt failed.', cause }),
    }),
  requiredText: (message) =>
    Effect.tryPromise({
      try: () => prompts.text(message),
      catch: (cause) => makePromptSelectionFailure({ message: 'The text prompt failed.', cause }),
    }).pipe(Effect.flatMap(requireEnteredText)),
  requiredSecret: (message) =>
    Effect.tryPromise({
      try: () => prompts.secret(message),
      catch: (cause) => makePromptSelectionFailure({ message: 'The secret prompt failed.', cause }),
    }).pipe(Effect.flatMap(requireEnteredText)),
  select: (request) =>
    Effect.tryPromise({
      try: () => prompts.select(request),
      catch: (cause) =>
        makePromptSelectionFailure({ message: 'The selection prompt failed.', cause }),
    }).pipe(
      Effect.flatMap((selection) => {
        if (selection == null) {
          return Effect.fail(makePromptSelectionFailure({ message: 'Selection cancelled.' }));
        }
        return Effect.succeed(selection);
      }),
    ),
  selectMany: (request) =>
    Effect.tryPromise({
      try: () => prompts.selectMany(request),
      catch: (cause) =>
        makePromptSelectionFailure({ message: 'The multi-selection prompt failed.', cause }),
    }),
  cancel: (message) =>
    Effect.sync(() => {
      prompts.cancel(message);
    }),
});

const JSON_PROMPT_MESSAGE =
  'This step needs an answer, but --json never prompts. Pass the flag that answers it (for example --yes to confirm).';

const failJsonPrompt = () =>
  Effect.fail(makePromptSelectionFailure({ message: JSON_PROMPT_MESSAGE }));

/** `--json` prompt service: every question fails with a message that names the flag to pass. */
export const LaunchPromptJson = Layer.succeed(LaunchPrompt, {
  confirm: failJsonPrompt,
  requiredText: failJsonPrompt,
  requiredSecret: failJsonPrompt,
  select: failJsonPrompt,
  selectMany: failJsonPrompt,
  cancel: () => Effect.void,
});

export const makeLaunchPromptTest = (
  answers: LaunchPromptTestAnswers = {},
): Layer.Layer<LaunchPromptService> => {
  let confirmation = true;
  if (answers.confirmation !== undefined) confirmation = answers.confirmation;
  let enteredText = 'test-text';
  if (answers.text !== undefined) enteredText = answers.text;
  let enteredSecret = 'test-secret';
  if (answers.secret !== undefined) enteredSecret = answers.secret;
  let selectionIndex = 0;
  if (answers.selectionIndex !== undefined) selectionIndex = answers.selectionIndex;
  let selectionIndexes: readonly number[] = [];
  if (answers.selectionIndexes !== undefined) selectionIndexes = answers.selectionIndexes;

  return Layer.succeed(LaunchPrompt, {
    confirm: () => Effect.succeed(confirmation),
    requiredText: () => Effect.succeed(enteredText),
    requiredSecret: () => Effect.succeed(enteredSecret),
    select: <TSelection>(request: PromptSelectionRequest<TSelection>) => {
      const selectedChoice = request.choices[selectionIndex];
      if (selectedChoice === undefined)
        return Effect.fail(
          makePromptSelectionFailure({ message: 'The test selection index is unavailable.' }),
        );
      return Effect.succeed(selectedChoice.selection);
    },
    selectMany: <TSelection>(request: PromptMultiSelectionRequest<TSelection>) => {
      const selections: TSelection[] = [];
      for (const requestedIndex of selectionIndexes) {
        const selectedChoice = request.choices[requestedIndex];
        if (selectedChoice === undefined) {
          return Effect.fail(
            makePromptSelectionFailure({
              message: 'A test multi-selection index is unavailable.',
            }),
          );
        }
        selections.push(selectedChoice.selection);
      }
      return Effect.succeed(selections);
    },
    cancel: () => Effect.void,
  });
};

export const pickOne = <TSelection>(
  request: PickOneArgs<TSelection>,
): Effect.Effect<TSelection, PromptSelectionFailure, LaunchPromptService | Logger> =>
  Effect.gen(function* () {
    if (!request.canPrompt) {
      if (request.nonInteractive.kind === 'fallback') {
        if (request.nonInteractive.note !== undefined) {
          const logger = yield* createLogger(false);
          yield* logger.line(request.nonInteractive.note).pipe(
            Effect.mapError((cause) =>
              makePromptSelectionFailure({
                message: 'The prompt note could not be written.',
                cause,
              }),
            ),
          );
        }
        return request.nonInteractive.selection;
      }
      return yield* Effect.fail(
        makePromptSelectionFailure({
          message: `${request.message} ${request.nonInteractive.flagHint}`,
        }),
      );
    }

    const launchPrompt = yield* LaunchPrompt;
    return yield* launchPrompt.select(request);
  });

import {
  autocomplete,
  cancel,
  confirm as clackConfirm,
  isCancel,
  multiselect,
  password,
  select,
  text,
} from '@clack/prompts';
import { Context, Data, Effect, Layer } from 'effect';
import { createLogger, type Logger } from './logger.js';

export const PICK_SEARCH_THRESHOLD = 8;

export type PromptSelectionFailure = Readonly<{
  readonly _tag: 'PromptSelectionFailure';
  readonly message: string;
  readonly cause?: unknown;
}>;

export const makePromptSelectionFailure =
  Data.tagged<PromptSelectionFailure>('PromptSelectionFailure');

export type PromptChoice<TSelection> = {
  readonly selection: TSelection;
  readonly label: string;
  readonly hint?: string;
};

export type PromptSelectionRequest<TSelection> = {
  readonly message: string;
  readonly choices: readonly PromptChoice<TSelection>[];
  readonly searchThreshold?: number;
  readonly initialSelection?: TSelection;
};

export type PromptMultiSelectionRequest<TSelection> = Readonly<{
  readonly message: string;
  readonly choices: readonly PromptChoice<TSelection>[];
  readonly initialSelections?: readonly TSelection[];
}>;

export type NonInteractivePolicy<TSelection> =
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

export type LaunchPromptTestAnswers = Readonly<{
  readonly confirmation?: boolean;
  readonly text?: string;
  readonly secret?: string;
  readonly selectionIndex?: number;
  readonly selectionIndexes?: readonly number[];
}>;

export const LaunchPrompt = Context.GenericTag<LaunchPromptService>('launch-store/Prompt');

export const fuzzyMatch = (query: string, candidate: string): boolean => {
  const searchNeedle = query.trim().toLowerCase();
  if (searchNeedle.length === 0) return true;
  const searchableText = candidate.toLowerCase();
  let needleOffset = 0;
  for (
    let candidateOffset = 0;
    candidateOffset < searchableText.length && needleOffset < searchNeedle.length;
    candidateOffset += 1
  ) {
    if (searchableText[candidateOffset] === searchNeedle[needleOffset]) needleOffset += 1;
  }
  return needleOffset === searchNeedle.length;
};

const requirePromptAnswer = (
  promptEffect: Effect.Effect<string | symbol, PromptSelectionFailure>,
): Effect.Effect<string, PromptSelectionFailure> =>
  promptEffect.pipe(
    Effect.flatMap((answer) => {
      if (isCancel(answer))
        return Effect.fail(makePromptSelectionFailure({ message: 'Prompt cancelled.' }));
      return Effect.succeed(answer);
    }),
  );

const makeClackChoices = <TSelection>(
  choices: readonly PromptChoice<TSelection>[],
): Array<{
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
}> =>
  choices.map((promptChoice, choiceIndex) => {
    if (promptChoice.hint === undefined)
      return { value: String(choiceIndex), label: promptChoice.label };
    return { value: String(choiceIndex), label: promptChoice.label, hint: promptChoice.hint };
  });

const resolveSearchThreshold = (requestedThreshold: number | undefined): number => {
  if (requestedThreshold === undefined) return PICK_SEARCH_THRESHOLD;
  return requestedThreshold;
};

const runSelectionPrompt = <TSelection>(
  request: PromptSelectionRequest<TSelection>,
): Effect.Effect<TSelection, PromptSelectionFailure> =>
  Effect.gen(function* () {
    const clackChoices = makeClackChoices(request.choices);
    const searchThreshold = resolveSearchThreshold(request.searchThreshold);
    let initialChoiceIndex = -1;
    if (request.initialSelection !== undefined)
      initialChoiceIndex = request.choices.findIndex(
        (promptChoice) => promptChoice.selection === request.initialSelection,
      );

    const selectedIdentifier = yield* Effect.tryPromise({
      try: () => {
        if (request.choices.length > searchThreshold) {
          return autocomplete({
            message: request.message,
            options: clackChoices,
            placeholder: 'Type to search...',
            maxItems: 10,
            filter: (searchText, clackChoice) => {
              let searchableHint = '';
              if (clackChoice.hint !== undefined) searchableHint = clackChoice.hint;
              return fuzzyMatch(searchText, `${clackChoice.label} ${searchableHint}`);
            },
          });
        }
        if (initialChoiceIndex >= 0) {
          return select({
            message: request.message,
            options: clackChoices,
            initialValue: String(initialChoiceIndex),
          });
        }
        return select({ message: request.message, options: clackChoices });
      },
      catch: (cause) =>
        makePromptSelectionFailure({ message: 'The selection prompt failed.', cause }),
    });

    if (isCancel(selectedIdentifier)) {
      cancel('Cancelled.');
      return yield* Effect.fail(makePromptSelectionFailure({ message: 'Selection cancelled.' }));
    }
    const selectedChoice = request.choices[Number(selectedIdentifier)];
    if (selectedChoice === undefined)
      return yield* Effect.fail(
        makePromptSelectionFailure({ message: 'The selection did not match a provided choice.' }),
      );
    return selectedChoice.selection;
  });

/** Present a typed multi-selection prompt and retain cancellation as an explicit null. */
const runMultiSelectionPrompt = <TSelection>(
  request: PromptMultiSelectionRequest<TSelection>,
): Effect.Effect<readonly TSelection[] | null, PromptSelectionFailure> =>
  Effect.gen(function* () {
    const clackChoices = makeClackChoices(request.choices);
    const initialIdentifiers: string[] = [];
    if (request.initialSelections !== undefined) {
      for (const initialSelection of request.initialSelections) {
        const choiceIndex = request.choices.findIndex(
          (promptChoice) => promptChoice.selection === initialSelection,
        );
        if (choiceIndex >= 0) initialIdentifiers.push(String(choiceIndex));
      }
    }
    const selectedIdentifiers = yield* Effect.tryPromise({
      try: () =>
        multiselect({
          message: request.message,
          options: clackChoices,
          initialValues: initialIdentifiers,
        }),
      catch: (cause) =>
        makePromptSelectionFailure({ message: 'The multi-selection prompt failed.', cause }),
    });
    if (isCancel(selectedIdentifiers)) return null;
    const selections: TSelection[] = [];
    for (const selectedIdentifier of selectedIdentifiers) {
      const selectedChoice = request.choices[Number(selectedIdentifier)];
      if (selectedChoice === undefined) {
        return yield* Effect.fail(
          makePromptSelectionFailure({
            message: 'A multi-selection did not match a provided choice.',
          }),
        );
      }
      selections.push(selectedChoice.selection);
    }
    return selections;
  });

export const LaunchPromptLive = Layer.succeed(LaunchPrompt, {
  confirm: (message) =>
    Effect.tryPromise({
      try: () => clackConfirm({ message }),
      catch: (cause) =>
        makePromptSelectionFailure({ message: 'The confirmation prompt failed.', cause }),
    }).pipe(
      Effect.map((confirmation) => {
        if (isCancel(confirmation)) return false;
        return confirmation;
      }),
    ),
  requiredText: (message) =>
    requirePromptAnswer(
      Effect.tryPromise({
        try: () =>
          text({
            message,
            validate: (enteredText) => {
              if (enteredText === undefined) return 'A value is required.';
              if (enteredText.trim().length === 0) return 'A value is required.';
              return undefined;
            },
          }),
        catch: (cause) => makePromptSelectionFailure({ message: 'The text prompt failed.', cause }),
      }),
    ),
  requiredSecret: (message) =>
    requirePromptAnswer(
      Effect.tryPromise({
        try: () =>
          password({
            message,
            validate: (enteredSecret) => {
              if (enteredSecret === undefined) return 'A value is required.';
              if (enteredSecret.trim().length === 0) return 'A value is required.';
              return undefined;
            },
          }),
        catch: (cause) =>
          makePromptSelectionFailure({ message: 'The secret prompt failed.', cause }),
      }),
    ),
  select: runSelectionPrompt,
  selectMany: runMultiSelectionPrompt,
  cancel: (message) =>
    Effect.sync(() => {
      cancel(message);
    }),
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

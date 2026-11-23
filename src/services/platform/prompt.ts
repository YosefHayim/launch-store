import { Prompts } from '@/prompts.js';
import { createLogger } from './logger.ts';

const prompts = new Prompts();

type PromptSelectionFailure = Readonly<{
  _tag: 'PromptSelectionFailure';
  message: string;
  cause?: unknown;
}>;

function makePromptSelectionFailure(fields: {
  message: string;
  cause?: unknown;
}): PromptSelectionFailure {
  return { _tag: 'PromptSelectionFailure', message: fields.message, cause: fields.cause };
}

type PromptChoice<Selection> = {
  selection: Selection;
  label: string;
  hint?: string;
};

type PromptSelectionRequest<Selection> = {
  message: string;
  choices: readonly PromptChoice<Selection>[];
  searchThreshold?: number;
  initialSelection?: Selection;
};

type PromptMultiSelectionRequest<Selection> = Readonly<{
  message: string;
  choices: readonly PromptChoice<Selection>[];
  initialSelections?: readonly Selection[];
}>;

type NonInteractivePolicy<Selection> =
  | {
      kind: 'require';
      flagHint: string;
    }
  | {
      kind: 'fallback';
      selection: Selection;
      note?: string;
    };

export type PickOneArgs<Selection> = PromptSelectionRequest<Selection> & {
  canPrompt: boolean;
  nonInteractive: NonInteractivePolicy<Selection>;
};

type PromptAnswers = Readonly<{
  confirmation?: boolean;
  text?: string;
  secret?: string;
  selectionIndex?: number;
  selectionIndexes?: readonly number[];
}>;

let promptAnswers: PromptAnswers | null = null;
let jsonPrompts = false;

export function usePromptAnswers(answers: PromptAnswers | null): void {
  promptAnswers = answers;
  jsonPrompts = false;
}

export function useJsonPrompts(enabled: boolean): void {
  jsonPrompts = enabled;
}

export function resetPrompts(): void {
  promptAnswers = null;
  jsonPrompts = false;
}

function requireEnteredText(enteredText: string | null): string {
  if (enteredText == null) {
    throw makePromptSelectionFailure({ message: 'Prompt cancelled.' });
  }

  const isBlank = enteredText.trim() == '';

  if (isBlank) {
    throw makePromptSelectionFailure({ message: 'A value is required.' });
  }

  return enteredText;
}

function failJsonPrompt(): never {
  throw makePromptSelectionFailure({
    message:
      'This step needs an answer, but --json never prompts. Pass the flag that answers it (for example --yes to confirm).',
  });
}

function isTaggedFailure(cause: unknown): boolean {
  if (cause == null) {
    return false;
  }

  if (typeof cause != 'object') {
    return false;
  }

  return '_tag' in cause;
}

async function askConfirm(message: string): Promise<boolean> {
  if (jsonPrompts) {
    failJsonPrompt();
  }

  if (promptAnswers != null) {
    let confirmation = true;

    if (promptAnswers.confirmation != null) {
      confirmation = promptAnswers.confirmation;
    }

    return confirmation;
  }

  try {
    return await prompts.confirm(message);
  } catch (cause) {
    throw makePromptSelectionFailure({ message: 'The confirmation prompt failed.', cause });
  }
}

async function askText(message: string, failureMessage: string): Promise<string> {
  if (jsonPrompts) {
    failJsonPrompt();
  }

  if (promptAnswers != null) {
    let enteredText = 'test-text';

    if (promptAnswers.text != null) {
      enteredText = promptAnswers.text;
    }

    return requireEnteredText(enteredText);
  }

  try {
    const enteredText = await prompts.text(message);
    return requireEnteredText(enteredText);
  } catch (cause) {
    const isAlreadyTagged = isTaggedFailure(cause);

    if (isAlreadyTagged) {
      throw cause;
    }

    throw makePromptSelectionFailure({ message: failureMessage, cause });
  }
}

async function askSecret(message: string): Promise<string> {
  if (jsonPrompts) {
    failJsonPrompt();
  }

  if (promptAnswers != null) {
    let enteredSecret = 'test-secret';

    if (promptAnswers.secret != null) {
      enteredSecret = promptAnswers.secret;
    }

    return requireEnteredText(enteredSecret);
  }

  try {
    const enteredSecret = await prompts.secret(message);
    return requireEnteredText(enteredSecret);
  } catch (cause) {
    const isAlreadyTagged = isTaggedFailure(cause);

    if (isAlreadyTagged) {
      throw cause;
    }

    throw makePromptSelectionFailure({ message: 'The secret prompt failed.', cause });
  }
}

export const LaunchPrompt = {
  confirm: askConfirm,
  requiredText(message: string): Promise<string> {
    return askText(message, 'The text prompt failed.');
  },
  requiredSecret: askSecret,
  async select<Selection>(request: PromptSelectionRequest<Selection>): Promise<Selection> {
    if (jsonPrompts) {
      failJsonPrompt();
    }

    if (promptAnswers != null) {
      let selectionIndex = 0;

      if (promptAnswers.selectionIndex != null) {
        selectionIndex = promptAnswers.selectionIndex;
      }

      const selectedChoice = request.choices[selectionIndex];

      if (selectedChoice == null) {
        throw makePromptSelectionFailure({ message: 'The test selection index is unavailable.' });
      }

      return selectedChoice.selection;
    }

    try {
      const selection = await prompts.select(request);

      if (selection == null) {
        throw makePromptSelectionFailure({ message: 'Selection cancelled.' });
      }

      return selection;
    } catch (cause) {
      const isAlreadyTagged = isTaggedFailure(cause);

      if (isAlreadyTagged) {
        throw cause;
      }

      throw makePromptSelectionFailure({ message: 'The selection prompt failed.', cause });
    }
  },
  async selectMany<Selection>(
    request: PromptMultiSelectionRequest<Selection>,
  ): Promise<readonly Selection[] | null> {
    if (jsonPrompts) {
      failJsonPrompt();
    }

    if (promptAnswers != null) {
      let selectionIndexes: readonly number[] = [];

      if (promptAnswers.selectionIndexes != null) {
        selectionIndexes = promptAnswers.selectionIndexes;
      }

      const selections: Selection[] = [];

      for (const requestedIndex of selectionIndexes) {
        const selectedChoice = request.choices[requestedIndex];

        if (selectedChoice == null) {
          throw makePromptSelectionFailure({
            message: 'A test multi-selection index is unavailable.',
          });
        }

        selections.push(selectedChoice.selection);
      }

      return selections;
    }

    try {
      return await prompts.selectMany(request);
    } catch (cause) {
      throw makePromptSelectionFailure({ message: 'The multi-selection prompt failed.', cause });
    }
  },
  cancel(message: string): void {
    if (jsonPrompts) {
      return;
    }

    if (promptAnswers != null) {
      return;
    }

    prompts.cancel(message);
  },
};

export type LaunchPromptService = typeof LaunchPrompt;

export async function pickOne<Selection>(request: PickOneArgs<Selection>): Promise<Selection> {
  const isInteractive = request.canPrompt;

  if (isInteractive) {
    return LaunchPrompt.select(request);
  }

  const policy = request.nonInteractive;
  const isFallback = policy.kind == 'fallback';

  if (isFallback == false) {
    throw makePromptSelectionFailure({
      message: `${request.message} ${policy.flagHint}`,
    });
  }

  if (policy.note != null) {
    createLogger(false).line(policy.note);
  }

  return policy.selection;
}

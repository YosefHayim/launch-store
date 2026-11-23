import { once } from 'node:events';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const SEARCH_ROUND_LIMIT = 20;

interface PromptChoice<Selection> {
  selection: Selection;
  label: string;
  hint?: string;
}

interface SelectRequest<Selection> {
  message: string;
  choices: readonly PromptChoice<Selection>[];
  initialSelection?: Selection;
}

interface SelectManyRequest<Selection> {
  message: string;
  choices: readonly PromptChoice<Selection>[];
}

export function fuzzyMatch(query: string, candidate: string): boolean {
  const searchNeedle = query.trim().toLowerCase();

  const isBlankQuery = searchNeedle.length == 0;

  if (isBlankQuery) {
    return true;
  }

  const searchableText = candidate.toLowerCase();
  let needleOffset = 0;

  for (let candidateOffset = 0; candidateOffset < searchableText.length; candidateOffset += 1) {
    const isNeedleFound = needleOffset == searchNeedle.length;

    if (isNeedleFound) {
      break;
    }

    const isSameCharacter = searchableText[candidateOffset] == searchNeedle[needleOffset];

    if (isSameCharacter) {
      needleOffset += 1;
    }
  }

  return needleOffset == searchNeedle.length;
}

function readChoiceIndex(answer: string, choiceCount: number): number | null {
  const trimmed = answer.trim();
  const pickedIndex = Number(trimmed);
  const isWholeNumber = Number.isInteger(pickedIndex);

  if (isWholeNumber == false) {
    return null;
  }

  const matchesDigits = String(pickedIndex) == trimmed;

  if (matchesDigits == false) {
    return null;
  }

  const isBeforeFirst = pickedIndex < 1;

  if (isBeforeFirst) {
    return null;
  }

  const isPastEnd = pickedIndex > choiceCount;

  if (isPastEnd) {
    return null;
  }

  return pickedIndex;
}

function matchingChoices<Selection>(
  query: string,
  choices: readonly PromptChoice<Selection>[],
): PromptChoice<Selection>[] {
  function keepChoice(choice: PromptChoice<Selection>): boolean {
    let hint = '';

    if (choice.hint != null) {
      hint = choice.hint;
    }

    return fuzzyMatch(query, `${choice.label} ${hint}`);
  }

  return choices.filter(keepChoice);
}

function readChoiceIndexes(answer: string, choiceCount: number): number[] | null {
  const parts = answer.split(',');
  const indexes: number[] = [];

  for (const part of parts) {
    const choiceIndex = readChoiceIndex(part, choiceCount);

    if (choiceIndex == null) {
      return null;
    }

    indexes.push(choiceIndex);
  }

  return indexes;
}

export class Prompts {
  isInteractive(): boolean {
    const isInputTerminal = stdin.isTTY == true;

    if (isInputTerminal == false) {
      return false;
    }

    return stdout.isTTY == true;
  }

  async confirm(message: string): Promise<boolean> {
    const answer = await this.ask(`${message} (y/N)`);

    if (answer == null) {
      return false;
    }

    return answer.trim().toLowerCase() == 'y';
  }

  async text(message: string): Promise<string | null> {
    return this.ask(message);
  }

  async secret(message: string): Promise<string | null> {
    return this.askSecret(message);
  }

  async select<Selection>(request: SelectRequest<Selection>): Promise<Selection | null> {
    const isInteractive = this.isInteractive();

    if (isInteractive == false) {
      return null;
    }

    let visibleChoices = request.choices;

    for (let round = 0; round < SEARCH_ROUND_LIMIT; round += 1) {
      this.showChoices(request.message, visibleChoices);

      const answer = await this.ask('Number, or words to search');

      if (answer == null) {
        return null;
      }

      const trimmed = answer.trim();

      const isBlank = trimmed == '';

      if (isBlank) {
        return request.initialSelection ?? null;
      }

      const choiceIndex = readChoiceIndex(trimmed, visibleChoices.length);

      if (choiceIndex != null) {
        const chosen = visibleChoices[choiceIndex - 1];

        if (chosen == null) {
          stdout.write('Choose a number from the list.\n');
          continue;
        }

        return chosen.selection;
      }

      const filtered = matchingChoices(trimmed, request.choices);

      const isOneMatch = filtered.length == 1;

      if (isOneMatch) {
        const onlyChoice = filtered[0];

        if (onlyChoice == null) {
          return null;
        }

        return onlyChoice.selection;
      }

      const isNone = filtered.length == 0;

      if (isNone) {
        stdout.write('No matching choice.\n');
        visibleChoices = request.choices;
        continue;
      }

      visibleChoices = filtered;
    }

    return null;
  }

  async selectMany<Selection>(
    request: SelectManyRequest<Selection>,
  ): Promise<readonly Selection[] | null> {
    const isInteractive = this.isInteractive();

    if (isInteractive == false) {
      return null;
    }

    for (let round = 0; round < SEARCH_ROUND_LIMIT; round += 1) {
      this.showChoices(request.message, request.choices);

      const answer = await this.ask('Numbers separated by commas');

      if (answer == null) {
        return null;
      }

      const trimmed = answer.trim();

      const isBlank = trimmed == '';

      if (isBlank) {
        return null;
      }

      const choiceIndexes = readChoiceIndexes(trimmed, request.choices.length);

      if (choiceIndexes == null) {
        stdout.write('Choose numbers from the list, separated by commas.\n');
        continue;
      }

      const selections: Selection[] = [];

      for (const choiceIndex of choiceIndexes) {
        const chosen = request.choices[choiceIndex - 1];

        if (chosen == null) {
          return null;
        }

        selections.push(chosen.selection);
      }

      return selections;
    }

    return null;
  }

  cancel(message: string): void {
    stdout.write(`${message}\n`);
  }

  private showChoices<Selection>(
    message: string,
    choices: readonly PromptChoice<Selection>[],
  ): void {
    stdout.write(`${message}\n`);

    for (let choiceIndex = 0; choiceIndex < choices.length; choiceIndex += 1) {
      const choice = choices[choiceIndex];

      if (choice == null) {
        continue;
      }

      const choiceNumber = choiceIndex + 1;
      let choiceLine = `${choiceNumber}. ${choice.label}`;

      if (choice.hint != null) {
        choiceLine = `${choiceLine} (${choice.hint})`;
      }

      stdout.write(`${choiceLine}\n`);
    }
  }

  private async ask(message: string): Promise<string | null> {
    const isInteractive = this.isInteractive();

    if (isInteractive == false) {
      return null;
    }

    const reader = createInterface({ input: stdin, output: stdout });

    try {
      var line = await reader.question(`${message} `);
    } catch (error) {
      const isPromptClosed = error != null;

      if (isPromptClosed) {
        return null;
      }

      throw error;
    } finally {
      reader.close();
    }

    return line;
  }

  private async askSecret(message: string): Promise<string | null> {
    const isInteractive = this.isInteractive();

    if (isInteractive == false) {
      return null;
    }

    stdout.write(`${message} `);
    stdin.setRawMode(true);
    stdin.resume();

    let enteredSecret = '';

    try {
      for (;;) {
        const keyPress = await once(stdin, 'data');
        const key = Buffer.from(keyPress[0]).toString('utf8');

        const isCancel = key == '\u0003';

        if (isCancel) {
          stdout.write('\n');
          return null;
        }

        const isReturn = key == '\r';

        if (isReturn) {
          stdout.write('\n');
          return enteredSecret;
        }

        const isNewline = key == '\n';

        if (isNewline) {
          stdout.write('\n');
          return enteredSecret;
        }

        const isBackspace = key == '\u007f';

        if (isBackspace) {
          enteredSecret = enteredSecret.slice(0, -1);
          continue;
        }

        const isDelete = key == '\b';

        if (isDelete) {
          enteredSecret = enteredSecret.slice(0, -1);
          continue;
        }

        const isSingleCharacter = key.length == 1;

        if (isSingleCharacter == false) {
          continue;
        }

        enteredSecret += key;
      }
    } catch (error) {
      const isPromptClosed = error != null;

      if (isPromptClosed) {
        return null;
      }

      throw error;
    } finally {
      stdin.setRawMode(false);
      stdin.pause();
    }
  }
}

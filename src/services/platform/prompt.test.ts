import { afterEach, describe, expect, it, vi } from 'vitest';
import { fuzzyMatch } from '../../prompts.ts';
import { LaunchPrompt, pickOne, resetPrompts, usePromptAnswers } from './prompt.ts';

afterEach(function resetPromptSinks() {
  resetPrompts();

  const isLogMocked = vi.isMockFunction(console.log);

  if (isLogMocked) {
    vi.mocked(console.log).mockRestore();
  }
});

function describeFuzzyPieceThePickerSSubsequenceFilter() {
  function matchesAnInOrderSubsequenceCaseInsensitively() {
    const fuzzy = fuzzyMatch('sml', 'sampleapp');
    expect(fuzzy).toBe(true);
    expect(fuzzyMatch('MPL', 'Mapleleaf')).toBe(true);
    expect(fuzzyMatch('sampleapp', 'sampleapp')).toBe(true);
  }

  it(
    'matches an in-order subsequence, case-insensitively',
    matchesAnInOrderSubsequenceCaseInsensitively,
  );

  function rejectsCharactersThatArenTASubsequence() {
    const fuzzy = fuzzyMatch('pms', 'sampleapp');
    expect(fuzzy).toBe(false);
    expect(fuzzyMatch('xyz', 'sampleapp')).toBe(false);
  }

  it("rejects characters that aren't a subsequence", rejectsCharactersThatArenTASubsequence);

  function treatsABlankQueryAsAPieceSoTheFullListShows() {
    const fuzzy = fuzzyMatch('', 'anything');
    expect(fuzzy).toBe(true);
    expect(fuzzyMatch('   ', 'anything')).toBe(true);
  }

  it(
    'treats a blank query as a match so the full list shows',
    treatsABlankQueryAsAPieceSoTheFullListShows,
  );
}

describe(
  "fuzzyMatch - the picker's subsequence filter",
  describeFuzzyPieceThePickerSSubsequenceFilter,
);

function describePickOneNonInteractivePolicyNoTTY() {
  const choices = [
    { selection: 'a', label: 'Alpha' },
    { selection: 'b', label: 'Beta' },
  ];

  async function throwsWithTheFlagHintUnderTheRequirePolicy() {
    const one = pickOne({
      message: 'Which app? (2 found)',
      choices,
      canPrompt: false,
      nonInteractive: { kind: 'require', flagHint: '- pass --app <name>.' },
    });

    await expect(one).rejects.toMatchObject({ message: expect.stringContaining('--app') });
  }

  it(
    'throws with the flag hint under the require policy',
    throwsWithTheFlagHintUnderTheRequirePolicy,
  );

  async function returnsTheFallbackPieceAndPrintsItsNoteUnderTheFallbackPolicy() {
    const terminalWrites: string[] = [];

    function writeLine(message: unknown) {
      terminalWrites.push(`${String(message)}\n`);
    }

    vi.spyOn(console, 'log').mockImplementation(writeLine);

    const chosen = await pickOne({
      message: 'Multiple keys found',
      choices,
      canPrompt: false,
      nonInteractive: {
        kind: 'fallback',
        selection: 'b',
        note: 'using Beta; pass --p8 to choose another.',
      },
    });

    expect(chosen).toBe('b');
    expect(terminalWrites.join('')).toContain('using Beta; pass --p8 to choose another.');
  }

  it(
    'returns the fallback value and prints its note under the fallback policy',
    returnsTheFallbackPieceAndPrintsItsNoteUnderTheFallbackPolicy,
  );
}

describe('pickOne - non-interactive policy (no TTY)', describePickOneNonInteractivePolicyNoTTY);

function describeLaunchPromptSelectManyTestAnswers() {
  async function returnsTheConfiguredDomainSelections() {
    usePromptAnswers({ selectionIndexes: [0, 2] });

    const selectedAgents = await new LaunchPrompt().selectMany({
      message: 'Choose agents',
      choices: [
        { selection: 'claude', label: 'Claude' },
        { selection: 'codex', label: 'Codex' },
        { selection: 'cursor', label: 'Cursor' },
      ],
    });

    expect(selectedAgents).toEqual(['claude', 'cursor']);
  }

  it('returns the configured domain selections', returnsTheConfiguredDomainSelections);
}

describe('LaunchPrompt selectMany test answers', describeLaunchPromptSelectManyTestAnswers);

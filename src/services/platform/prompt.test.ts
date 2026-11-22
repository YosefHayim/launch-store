import { afterEach, describe, expect, it } from 'vitest';
import { fuzzyMatch } from '../../prompts.ts';
import { resetLogger, useLoggerSink } from './logger.ts';
import { LaunchPrompt, pickOne, resetPrompts, usePromptAnswers } from './prompt.ts';

afterEach(function resetPromptSinks() {
  resetPrompts();
  resetLogger();
});

describe("fuzzyMatch - the picker's subsequence filter", () => {
  it('matches an in-order subsequence, case-insensitively', () => {
    expect(fuzzyMatch('sml', 'sampleapp')).toBe(true);
    expect(fuzzyMatch('MPL', 'Mapleleaf')).toBe(true);
    expect(fuzzyMatch('sampleapp', 'sampleapp')).toBe(true);
  });
  it("rejects characters that aren't a subsequence", () => {
    expect(fuzzyMatch('pms', 'sampleapp')).toBe(false);
    expect(fuzzyMatch('xyz', 'sampleapp')).toBe(false);
  });
  it('treats a blank query as a match so the full list shows', () => {
    expect(fuzzyMatch('', 'anything')).toBe(true);
    expect(fuzzyMatch('   ', 'anything')).toBe(true);
  });
});

describe('pickOne - non-interactive policy (no TTY)', () => {
  const choices = [
    { selection: 'a', label: 'Alpha' },
    { selection: 'b', label: 'Beta' },
  ];

  it('throws with the flag hint under the require policy', async () => {
    await expect(
      pickOne({
        message: 'Which app? (2 found)',
        choices,
        canPrompt: false,
        nonInteractive: { kind: 'require', flagHint: '- pass --app <name>.' },
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('--app') });
  });

  it('returns the fallback value and prints its note under the fallback policy', async () => {
    const terminalWrites: string[] = [];
    useLoggerSink(function writeLine(text: string) {
      terminalWrites.push(text);
    });
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
  });
});

describe('LaunchPrompt.selectMany test answers', () => {
  it('returns the configured domain selections', async () => {
    usePromptAnswers({ selectionIndexes: [0, 2] });
    const selectedAgents = await LaunchPrompt.selectMany({
      message: 'Choose agents',
      choices: [
        { selection: 'claude', label: 'Claude' },
        { selection: 'codex', label: 'Codex' },
        { selection: 'cursor', label: 'Cursor' },
      ],
    });
    expect(selectedAgents).toEqual(['claude', 'cursor']);
  });
});

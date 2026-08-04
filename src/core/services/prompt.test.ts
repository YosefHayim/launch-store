import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { fuzzyMatch, LaunchPrompt, makeLaunchPromptTest, pickOne } from './prompt.js';
import { makeLaunchLoggerTest } from './logger.js';
describe("fuzzyMatch - the picker's subsequence filter", () => {
  it('matches an in-order subsequence, case-insensitively', () => {
    expect(fuzzyMatch('sml', 'sampleapp')).toBe(true);
    expect(fuzzyMatch('MPL', 'Mapleleaf')).toBe(true);
    expect(fuzzyMatch('sampleapp', 'sampleapp')).toBe(true);
  });
  it("rejects characters that aren't a subsequence", () => {
    expect(fuzzyMatch('pms', 'sampleapp')).toBe(false); // all present, wrong order
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
  it('throws with the flag hint under the `require` policy', async () => {
    await expect(
      Effect.runPromise(
        pickOne({
          message: 'Which app? (2 found)',
          choices,
          canPrompt: false,
          nonInteractive: { kind: 'require', flagHint: '- pass --app <name>.' },
        }).pipe(Effect.provide(makeLaunchLoggerTest([])), Effect.provide(makeLaunchPromptTest())),
      ),
    ).rejects.toThrow(/--app/);
  });
  it('returns the fallback value (and prints its note) under the `fallback` policy', async () => {
    const terminalWrites: string[] = [];
    const chosen = await Effect.runPromise(
      pickOne({
        message: 'Multiple keys found',
        choices,
        canPrompt: false,
        nonInteractive: {
          kind: 'fallback',
          selection: 'b',
          note: 'using Beta; pass --p8 to choose another.',
        },
      }).pipe(
        Effect.provide(makeLaunchLoggerTest(terminalWrites)),
        Effect.provide(makeLaunchPromptTest()),
      ),
    );
    expect(chosen).toBe('b');
    expect(terminalWrites.join('')).toContain('using Beta; pass --p8 to choose another.');
  });
});

describe('LaunchPrompt.selectMany test layer', () => {
  it('returns the configured domain selections', async () => {
    const selectedAgents = await Effect.runPromise(
      Effect.gen(function* () {
        const prompt = yield* LaunchPrompt;
        return yield* prompt.selectMany({
          message: 'Choose agents',
          choices: [
            { selection: 'claude', label: 'Claude' },
            { selection: 'codex', label: 'Codex' },
            { selection: 'cursor', label: 'Cursor' },
          ],
        });
      }).pipe(Effect.provide(makeLaunchPromptTest({ selectionIndexes: [0, 2] }))),
    );
    expect(selectedAgents).toEqual(['claude', 'cursor']);
  });
});

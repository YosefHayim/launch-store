import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeLaunchPromptTest } from '../services/prompt.js';
import { resolveDemoPlatform } from './demoCommand.js';

describe('resolveDemoPlatform', () => {
  it('uses the explicit platform', async () => {
    expect(
      await Effect.runPromise(
        resolveDemoPlatform('android', false).pipe(Effect.provide(makeLaunchPromptTest())),
      ),
    ).toBe('android');
  });

  it('defaults to iOS when no terminal can prompt', async () => {
    expect(
      await Effect.runPromise(
        resolveDemoPlatform(undefined, false).pipe(Effect.provide(makeLaunchPromptTest())),
      ),
    ).toBe('ios');
  });

  it('prompts when an interactive terminal omits the platform', async () => {
    expect(
      await Effect.runPromise(
        resolveDemoPlatform(undefined, true).pipe(
          Effect.provide(makeLaunchPromptTest({ selectionIndex: 1 })),
        ),
      ),
    ).toBe('android');
  });
});

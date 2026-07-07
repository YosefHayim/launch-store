import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { ReleaseConfirmationRequired, resolveReleaseConfirmationMode } from './confirmation.js';

describe('resolveReleaseConfirmationMode', () => {
  it('confirms immediately when --yes was passed', () => {
    expect(Effect.runSync(resolveReleaseConfirmationMode({ yes: true, canPrompt: false }))).toBe(
      'confirmed',
    );
  });

  it('allows the CLI to prompt when a TTY is available', () => {
    expect(Effect.runSync(resolveReleaseConfirmationMode({ yes: false, canPrompt: true }))).toBe(
      'prompt',
    );
  });

  it('fails clearly when a non-interactive release has no --yes', async () => {
    const exit = await Effect.runPromiseExit(
      resolveReleaseConfirmationMode({ yes: false, canPrompt: false }),
    );
    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      expect(exit.cause.toString()).toContain('ReleaseConfirmationRequired');
      expect(exit.cause.toString()).toContain('--yes');
    }
  });

  it('uses the typed confirmation-required error', () => {
    const error = new ReleaseConfirmationRequired({ message: 'needs approval' });
    expect(error._tag).toBe('ReleaseConfirmationRequired');
    expect(error.message).toBe('needs approval');
  });
});

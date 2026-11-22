import { describe, expect, it } from 'vitest';
import { makeReleaseConfirmationRequired, resolveReleaseConfirmationMode } from './confirmation.ts';

describe('resolveReleaseConfirmationMode', () => {
  it('confirms immediately when --yes was passed', () => {
    const releaseConfirmationMode = resolveReleaseConfirmationMode({ yes: true, canPrompt: false });
    expect(releaseConfirmationMode).toBe('confirmed');
  });

  it('allows the CLI to prompt when a TTY is available', () => {
    const releaseConfirmationMode = resolveReleaseConfirmationMode({ yes: false, canPrompt: true });
    expect(releaseConfirmationMode).toBe('prompt');
  });

  it('fails clearly when a non-interactive release has no --yes', () => {
    expect(() => resolveReleaseConfirmationMode({ yes: false, canPrompt: false })).toThrowError(
      expect.objectContaining({
        _tag: 'ReleaseConfirmationRequired',
        message: expect.stringContaining('--yes'),
      }),
    );
  });

  it('uses the typed confirmation-required error', () => {
    const error = makeReleaseConfirmationRequired({ message: 'needs approval' });

    expect(error._tag).toBe('ReleaseConfirmationRequired');
    expect(error.message).toBe('needs approval');
  });
});

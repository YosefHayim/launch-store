import { describe, expect, it } from 'vitest';
import { makeReleaseConfirmationRequired, readReleaseConfirmationMode } from './confirmation.ts';

function describeResolveReleaseConfirmationMode() {
  function confirmsImmediatelyWhenYesWasPassed() {
    const releaseConfirmationMode = readReleaseConfirmationMode({ yes: true, canPrompt: false });
    expect(releaseConfirmationMode).toBe('confirmed');
  }

  it('confirms immediately when --yes was passed', confirmsImmediatelyWhenYesWasPassed);

  function allowsTheCLIToPromptWhenATTYIsAvailable() {
    const releaseConfirmationMode = readReleaseConfirmationMode({ yes: false, canPrompt: true });
    expect(releaseConfirmationMode).toBe('prompt');
  }

  it('allows the CLI to prompt when a TTY is available', allowsTheCLIToPromptWhenATTYIsAvailable);

  function failsClearlyWhenANonInteractiveReleaseHasNoYes() {
    function callResolveReleaseConfirmationMode() {
      return readReleaseConfirmationMode({ yes: false, canPrompt: false });
    }

    expect(callResolveReleaseConfirmationMode).toThrowError(
      expect.objectContaining({
        _tag: 'ReleaseConfirmationRequired',
        message: expect.stringContaining('--yes'),
      }),
    );
  }

  it(
    'fails clearly when a non-interactive release has no --yes',
    failsClearlyWhenANonInteractiveReleaseHasNoYes,
  );

  function usesTheTypedConfirmationRequiredError() {
    const error = makeReleaseConfirmationRequired({ message: 'needs approval' });

    expect(error._tag).toBe('ReleaseConfirmationRequired');
    expect(error.message).toBe('needs approval');
  }

  it('uses the typed confirmation-required error', usesTheTypedConfirmationRequiredError);
}

describe('readReleaseConfirmationMode', describeResolveReleaseConfirmationMode);

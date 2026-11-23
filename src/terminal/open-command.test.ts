import { describe, expect, it } from 'vitest';
import { readOpenCommandInput } from './open-command.ts';
function describeReadOpenCommandPiece() {
  function keepsTheTargetAndOptionalSelectorsFromCommander() {
    const commandInput = readOpenCommandInput({
      target: 'reviews',
      platform: 'ios',
      app: 'sample',
    });

    expect(commandInput).toEqual({
      target: 'reviews',
      platform: 'ios',
      app: 'sample',
    });
  }

  it(
    'keeps the target and optional selectors from Commander',
    keepsTheTargetAndOptionalSelectorsFromCommander,
  );
}

describe('readOpenCommandInput', describeReadOpenCommandPiece);

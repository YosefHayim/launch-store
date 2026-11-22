import { describe, expect, it } from 'vitest';
import { readOpenCommandInput } from './open-command.ts';

describe('readOpenCommandInput', () => {
  it('keeps the target and optional selectors from Commander', () => {
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
  });
});

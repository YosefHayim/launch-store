import { describe, expect, it } from 'vitest';
import { renderAction } from './gameCenter.js';

describe('renderAction', () => {
  it('marks a change with +, a skip with •', () => {
    expect(
      renderAction({
        description: 'create achievement first_win (10 pts)',
        destructive: false,
        status: 'planned',
      }),
    ).toBe('+ create achievement first_win (10 pts)');
    expect(
      renderAction({
        description: 'enable Game Center for the app',
        destructive: false,
        status: 'applied',
      }),
    ).toBe('+ enable Game Center for the app');
    expect(
      renderAction({
        description: 'localization for first_win: created the item, but no version id was returned',
        destructive: false,
        status: 'skipped',
      }),
    ).toBe('• localization for first_win: created the item, but no version id was returned');
  });

  it("renders a failed action with ✗ and Apple's error detail", () => {
    expect(
      renderAction({
        description: 'create leaderboard high_score (INTEGER)',
        destructive: false,
        status: 'failed',
        error: 'vendorIdentifier already in use',
      }),
    ).toBe('✗ create leaderboard high_score (INTEGER) — vendorIdentifier already in use');
  });
});

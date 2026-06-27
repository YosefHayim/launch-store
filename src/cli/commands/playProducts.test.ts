import { describe, expect, it } from 'vitest';
import { renderAction } from './playProducts.js';

describe('renderAction', () => {
  it('marks a planned change with +', () => {
    expect(
      renderAction({
        description: 'create Play product com.acme.coins.100',
        destructive: false,
        status: 'planned',
      }),
    ).toBe('+ create Play product com.acme.coins.100');
  });

  it("renders a failed action with ✗ and Play's error detail", () => {
    expect(
      renderAction({
        description: 'update Play product com.acme.coins.100',
        destructive: false,
        status: 'failed',
        error: 'price not on a valid tier',
      }),
    ).toBe('✗ update Play product com.acme.coins.100 — price not on a valid tier');
  });
});

import { describe, expect, it } from 'vitest';
import { renderPlayCatalogAction } from '@core/store/playCatalogCommand.js';
describe('renderAction', () => {
  it('marks a planned change with +', () => {
    expect(
      renderPlayCatalogAction({
        description: 'create Play product com.acme.coins.100',
        destructive: false,
        status: 'planned',
      }),
    ).toBe('+ create Play product com.acme.coins.100');
  });
  it("renders a failed action with x and Play's error detail", () => {
    expect(
      renderPlayCatalogAction({
        description: 'update Play product com.acme.coins.100',
        destructive: false,
        status: 'failed',
        error: 'price not on a valid tier',
      }),
    ).toBe('x update Play product com.acme.coins.100 - price not on a valid tier');
  });
});

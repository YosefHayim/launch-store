import { describe, expect, it } from 'vitest';
import { renderPlayCatalogAction } from './play-catalog-command.ts';
describe('renderAction', () => {
  it('marks a planned change with +', () => {
    const playCatalogAction = renderPlayCatalogAction({
      description: 'create Play product com.acme.coins.100',
      destructive: false,
      status: 'planned',
    });
    expect(playCatalogAction).toBe('+ create Play product com.acme.coins.100');
  });
  it("renders a failed action with x and Play's error detail", () => {
    const playCatalogAction = renderPlayCatalogAction({
      description: 'update Play product com.acme.coins.100',
      destructive: false,
      status: 'failed',
      error: 'price not on a valid tier',
    });
    expect(playCatalogAction).toBe(
      'x update Play product com.acme.coins.100 - price not on a valid tier',
    );
  });
});

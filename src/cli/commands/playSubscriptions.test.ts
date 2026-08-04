import { describe, expect, it } from 'vitest';
import { renderPlayCatalogAction } from '@core/store/playCatalogCommand.js';
describe('renderAction', () => {
  it('marks a planned change with +', () => {
    expect(
      renderPlayCatalogAction({
        description: 'create Play subscription com.acme.pro.monthly',
        destructive: false,
        status: 'planned',
      }),
    ).toBe('+ create Play subscription com.acme.pro.monthly');
  });
  it("renders a failed action with x and Play's error detail", () => {
    expect(
      renderPlayCatalogAction({
        description: 'create offer trial on base plan p1m',
        destructive: false,
        status: 'failed',
        error: 'no region common to its trial and intro-price phases',
      }),
    ).toBe(
      'x create offer trial on base plan p1m - no region common to its trial and intro-price phases',
    );
  });
});

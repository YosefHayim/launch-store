import { describe, expect, it } from 'vitest';
import { renderAccessibilityAction } from '@core/store/accessibilityCommand.js';
describe('renderAction', () => {
  it('marks a planned or applied change with +', () => {
    expect(
      renderAccessibilityAction({
        description: 'create accessibility declaration (IPHONE)',
        destructive: false,
        status: 'planned',
      }),
    ).toBe('+ create accessibility declaration (IPHONE)');
    expect(
      renderAccessibilityAction({
        description: 'update accessibility declaration (IPAD) + publish',
        destructive: false,
        status: 'applied',
      }),
    ).toBe('+ update accessibility declaration (IPAD) + publish');
  });
  it("renders a failed action with x and Apple's error detail", () => {
    expect(
      renderAccessibilityAction({
        description: 'publish accessibility declaration (IPHONE)',
        destructive: false,
        status: 'failed',
        error: 'declaration incomplete',
      }),
    ).toBe('x publish accessibility declaration (IPHONE) - declaration incomplete');
  });
});

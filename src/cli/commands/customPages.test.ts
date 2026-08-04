import { describe, expect, it } from 'vitest';
import { renderStoreSurfaceAction } from '@core/store/appStoreSurfaceCommand.js';
describe('renderAction', () => {
  it('marks a change with +, a skip with -', () => {
    expect(
      renderStoreSurfaceAction({
        description: 'create custom product page "Spring Sale"',
        destructive: false,
        status: 'planned',
      }),
    ).toBe('+ create custom product page "Spring Sale"');
    expect(
      renderStoreSurfaceAction({
        description: 'promotional text on "Spring Sale": skipped - no editable version',
        destructive: false,
        status: 'skipped',
      }),
    ).toBe('- promotional text on "Spring Sale": skipped - no editable version');
  });
  it("renders a failed action with x and Apple's error detail", () => {
    expect(
      renderStoreSurfaceAction({
        description: 'create custom product page "Spring Sale"',
        destructive: false,
        status: 'failed',
        error: 'page name taken',
      }),
    ).toBe('x create custom product page "Spring Sale" - page name taken');
  });
});

import { describe, expect, it } from 'vitest';
import { renderStoreSurfaceAction } from '@core/store/appStoreSurfaceCommand.js';
describe('renderAction', () => {
  it('marks a change with + and a skipped clip with -', () => {
    expect(
      renderStoreSurfaceAction({
        description: 'set com.acme.app.Clip card action = OPEN',
        destructive: false,
        status: 'planned',
      }),
    ).toBe('+ set com.acme.app.Clip card action = OPEN');
    expect(
      renderStoreSurfaceAction({
        description: 'set com.acme.app.Clip card subtitle (en-US)',
        destructive: false,
        status: 'applied',
      }),
    ).toBe('+ set com.acme.app.Clip card subtitle (en-US)');
    expect(
      renderStoreSurfaceAction({
        description: 'App Clip com.acme.app.Clip: no clip record yet',
        destructive: false,
        status: 'skipped',
      }),
    ).toBe('- App Clip com.acme.app.Clip: no clip record yet');
  });
  it("renders a failed action with x and Apple's error detail", () => {
    expect(
      renderStoreSurfaceAction({
        description: 'create com.acme.app.Clip App Clip default experience (action=OPEN)',
        destructive: false,
        status: 'failed',
        error: 'appClip is in an invalid state',
      }),
    ).toBe(
      'x create com.acme.app.Clip App Clip default experience (action=OPEN) - appClip is in an invalid state',
    );
  });
});

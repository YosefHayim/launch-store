import { describe, expect, it } from 'vitest';
import { renderStoreSurfaceAction } from './app-store-surface-command.ts';

function describeRenderAction() {
  function marksAChangeWithAndASkippedClipWith() {
    const storeSurfaceAction = renderStoreSurfaceAction({
      description: 'set com.acme.app.Clip card action = OPEN',
      destructive: false,
      status: 'planned',
    });

    expect(storeSurfaceAction).toBe('+ set com.acme.app.Clip card action = OPEN');
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
  }

  it('marks a change with + and a skipped clip with -', marksAChangeWithAndASkippedClipWith);

  function rendersAFailedActionWithXAndAppleSErrorDetail() {
    const storeSurfaceAction = renderStoreSurfaceAction({
      description: 'create com.acme.app.Clip App Clip default experience (action=OPEN)',
      destructive: false,
      status: 'failed',
      error: 'appClip is in an invalid state',
    });

    expect(storeSurfaceAction).toBe(
      'x create com.acme.app.Clip App Clip default experience (action=OPEN) - appClip is in an invalid state',
    );
  }

  it(
    "renders a failed action with x and Apple's error detail",
    rendersAFailedActionWithXAndAppleSErrorDetail,
  );
}

describe('renderAction', describeRenderAction);

import { describe, expect, it } from 'vitest';
import { renderStoreSurfaceAction } from './app-store-surface-command.ts';

function describeAppClipSurfaceAction() {
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

describe('App Clip surface action', describeAppClipSurfaceAction);

function describeEuDistributionSurfaceAction() {
  function marksAPlannedAppliedAuthorizationWith() {
    const storeSurfaceAction = renderStoreSurfaceAction({
      description: 'authorize distribution domain cdn.acme.com (Acme CDN)',
      destructive: false,
      status: 'planned',
    });

    expect(storeSurfaceAction).toBe('+ authorize distribution domain cdn.acme.com (Acme CDN)');
    expect(
      renderStoreSurfaceAction({
        description: 'authorize distribution domain cdn.acme.com (Acme CDN)',
        destructive: false,
        status: 'applied',
      }),
    ).toBe('+ authorize distribution domain cdn.acme.com (Acme CDN)');
  }

  it('marks a planned/applied authorization with +', marksAPlannedAppliedAuthorizationWith);

  function rendersAFailedAuthorizationWithXAndAppleSErrorDetail() {
    const storeSurfaceAction = renderStoreSurfaceAction({
      description: 'authorize distribution domain bad..com (Bad)',
      destructive: false,
      status: 'failed',
      error: 'is not a valid domain',
    });

    expect(storeSurfaceAction).toBe(
      'x authorize distribution domain bad..com (Bad) - is not a valid domain',
    );
  }

  it(
    "renders a failed authorization with x and Apple's error detail",
    rendersAFailedAuthorizationWithXAndAppleSErrorDetail,
  );
}

describe('EU distribution surface action', describeEuDistributionSurfaceAction);

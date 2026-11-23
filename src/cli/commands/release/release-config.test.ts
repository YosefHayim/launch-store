import { describe, expect, it } from 'vitest';
import { renderAction } from '../../../release/release-config-command.ts';
function describeRenderAction() {
  function marksAChangeWithAndASkippedAreaWith() {
    const action = renderAction({
      description: 'set categories (primary=GAMES)',
      destructive: false,
      status: 'planned',
    });

    expect(action).toBe('+ set categories (primary=GAMES)');
    expect(
      renderAction({
        description: 'set app price = 9.99 (USA)',
        destructive: false,
        status: 'applied',
      }),
    ).toBe('+ set app price = 9.99 (USA)');
    expect(
      renderAction({
        description: 'App Review details: no editable App Store version',
        destructive: false,
        status: 'skipped',
      }),
    ).toBe('- App Review details: no editable App Store version');
  }

  it('marks a change with + and a skipped area with -', marksAChangeWithAndASkippedAreaWith);

  function rendersAFailedActionWithXAndAppleSErrorDetail() {
    const action = renderAction({
      description: 'set app price = 9.99 (USA)',
      destructive: false,
      status: 'failed',
      error: 'No USA app price point matches 9.99.',
    });

    expect(action).toBe('x set app price = 9.99 (USA) - No USA app price point matches 9.99.');
  }

  it(
    "renders a failed action with x and Apple's error detail",
    rendersAFailedActionWithXAndAppleSErrorDetail,
  );
}

describe('renderAction', describeRenderAction);

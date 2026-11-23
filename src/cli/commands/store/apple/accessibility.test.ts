import { describe, expect, it } from 'vitest';
import { renderAccessibilityAction } from './accessibility-command.ts';
function describeRenderAction() {
  function marksAPlannedOrAppliedChangeWith() {
    const accessibilityAction = renderAccessibilityAction({
      description: 'create accessibility declaration (IPHONE)',
      destructive: false,
      status: 'planned',
    });
    expect(accessibilityAction).toBe('+ create accessibility declaration (IPHONE)');
    expect(
      renderAccessibilityAction({
        description: 'update accessibility declaration (IPAD) + publish',
        destructive: false,
        status: 'applied',
      }),
    ).toBe('+ update accessibility declaration (IPAD) + publish');
  }

  it('marks a planned or applied change with +', marksAPlannedOrAppliedChangeWith);
  function rendersAFailedActionWithXAndAppleSErrorDetail() {
    const accessibilityAction = renderAccessibilityAction({
      description: 'publish accessibility declaration (IPHONE)',
      destructive: false,
      status: 'failed',
      error: 'declaration incomplete',
    });
    expect(accessibilityAction).toBe(
      'x publish accessibility declaration (IPHONE) - declaration incomplete',
    );
  }

  it(
    "renders a failed action with x and Apple's error detail",
    rendersAFailedActionWithXAndAppleSErrorDetail,
  );
}

describe('renderAction', describeRenderAction);

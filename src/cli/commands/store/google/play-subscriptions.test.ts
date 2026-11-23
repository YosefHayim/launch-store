import { describe, expect, it } from 'vitest';
import { renderPlayCatalogAction } from './play-catalog-command.ts';
function describeRenderAction() {
  function marksAPlannedChangeWith() {
    const playCatalogAction = renderPlayCatalogAction({
      description: 'create Play subscription com.acme.pro.monthly',
      destructive: false,
      status: 'planned',
    });

    expect(playCatalogAction).toBe('+ create Play subscription com.acme.pro.monthly');
  }

  it('marks a planned change with +', marksAPlannedChangeWith);

  function rendersAFailedActionWithXAndPlaySErrorDetail() {
    const playCatalogAction = renderPlayCatalogAction({
      description: 'create offer trial on base plan p1m',
      destructive: false,
      status: 'failed',
      error: 'no region common to its trial and intro-price phases',
    });

    expect(playCatalogAction).toBe(
      'x create offer trial on base plan p1m - no region common to its trial and intro-price phases',
    );
  }

  it(
    "renders a failed action with x and Play's error detail",
    rendersAFailedActionWithXAndPlaySErrorDetail,
  );
}

describe('renderAction', describeRenderAction);

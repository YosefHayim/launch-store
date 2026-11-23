import { describe, expect, it } from 'vitest';
import { renderPlayCatalogAction } from './play-catalog-command.ts';

function describePlayProductSurfaceAction() {
  function marksAPlannedChangeWith() {
    const playCatalogAction = renderPlayCatalogAction({
      description: 'create Play product com.acme.coins.100',
      destructive: false,
      status: 'planned',
    });

    expect(playCatalogAction).toBe('+ create Play product com.acme.coins.100');
  }

  it('marks a planned change with +', marksAPlannedChangeWith);

  function rendersAFailedActionWithXAndPlaySErrorDetail() {
    const playCatalogAction = renderPlayCatalogAction({
      description: 'update Play product com.acme.coins.100',
      destructive: false,
      status: 'failed',
      error: 'price not on a valid tier',
    });

    expect(playCatalogAction).toBe(
      'x update Play product com.acme.coins.100 - price not on a valid tier',
    );
  }

  it(
    "renders a failed action with x and Play's error detail",
    rendersAFailedActionWithXAndPlaySErrorDetail,
  );
}

describe('Play product surface action', describePlayProductSurfaceAction);

function describePlaySubscriptionSurfaceAction() {
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

describe('Play subscription surface action', describePlaySubscriptionSurfaceAction);

import { describe, expect, it } from 'vitest';
import { renderStoreSurfaceAction } from '@core/store/appStoreSurfaceCommand.js';
describe('renderAction', () => {
  it('marks a planned/applied registration with +', () => {
    expect(
      renderStoreSurfaceAction({
        description: 'register Apple Pay merchant id merchant.com.acme.app (Acme Pay)',
        destructive: false,
        status: 'planned',
      }),
    ).toBe('+ register Apple Pay merchant id merchant.com.acme.app (Acme Pay)');
    expect(
      renderStoreSurfaceAction({
        description: 'register Wallet pass type id pass.com.acme.coupon (Acme Coupon)',
        destructive: false,
        status: 'applied',
      }),
    ).toBe('+ register Wallet pass type id pass.com.acme.coupon (Acme Coupon)');
  });
  it("renders a failed registration with x and Apple's error detail", () => {
    expect(
      renderStoreSurfaceAction({
        description: 'register Apple Pay merchant id merchant.com.acme.app (Acme Pay)',
        destructive: false,
        status: 'failed',
        error: 'identifier already exists',
      }),
    ).toBe(
      'x register Apple Pay merchant id merchant.com.acme.app (Acme Pay) - identifier already exists',
    );
  });
});

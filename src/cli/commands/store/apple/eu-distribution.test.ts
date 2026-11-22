import { describe, expect, it } from 'vitest';
import { renderStoreSurfaceAction } from './app-store-surface-command.ts';
describe('renderAction', () => {
  it('marks a planned/applied authorization with +', () => {
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
  });
  it("renders a failed authorization with x and Apple's error detail", () => {
    const storeSurfaceAction = renderStoreSurfaceAction({
      description: 'authorize distribution domain bad..com (Bad)',
      destructive: false,
      status: 'failed',
      error: 'is not a valid domain',
    });
    expect(storeSurfaceAction).toBe(
      'x authorize distribution domain bad..com (Bad) - is not a valid domain',
    );
  });
});

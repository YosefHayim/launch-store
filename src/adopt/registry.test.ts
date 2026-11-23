import { describe, expect, it } from 'vitest';
import type { Adopter } from '../types/adopt.ts';
import { listAdopters, registerAdopter, registerBuiltinAdopters } from './registry.ts';

describe('adopter registry', () => {
  it('registers the four built-in adopters, smallest-blast-radius first', () => {
    registerBuiltinAdopters();
    expect(listAdopters().map((adopter) => adopter.domain)).toEqual([
      'products',
      'capabilities',
      'certs',
      'listing',
    ]);
  });

  it('replaces an adopter registered under the same domain rather than duplicating it', () => {
    registerBuiltinAdopters();

    const stub: Adopter = {
      domain: 'products',
      fidelity: 'importable',
      async read() {
        return [];
      },
    };

    registerAdopter(stub);

    const products = listAdopters().filter((adopter) => adopter.domain == 'products');

    expect(products).toHaveLength(1);
    expect(products[0]).toBe(stub);
  });
});

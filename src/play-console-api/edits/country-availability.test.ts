import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCountryAvailability,
  makeTestApi,
  openReadEdit,
} from '@/play-console-api/test-helpers.js';
let client: ReturnType<typeof makeTestApi>;
beforeEach(() => {
  vi.clearAllMocks();
  client = makeTestApi();
});
describe('country availability', () => {
  it('keeps only the countries with a string code and the rest-of-world flag', async () => {
    openReadEdit();
    getCountryAvailability.mockResolvedValue({
      data: {
        countries: [{ countryCode: 'US' }, { countryCode: 1 }],
        restOfWorld: true,
      },
    });

    expect(await client.getCountryAvailability('com.example.app', 'production')).toEqual({
      countries: [{ countryCode: 'US' }],
      restOfWorld: true,
    });
  });
});

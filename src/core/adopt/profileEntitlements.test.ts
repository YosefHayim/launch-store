import { describe, expect, it } from 'vitest';
import { extractProfileEntitlements } from './profileEntitlements.js';

describe('extractProfileEntitlements', () => {
  it("returns null for content that isn't a decodable provisioning profile (or off-Mac)", async () => {
    // Off-Mac this short-circuits on `isMac()`; on a Mac, `security cms -D` fails to decode the garbage —
    // both honest outcomes degrade to null so the capabilities adopter falls back to NEEDS_VALUE.
    expect(await extractProfileEntitlements('bm90LWEtcHJvZmlsZQ==')).toBeNull();
  });
});

import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import { assertListingPlatform, MetadataCommandInputSchema } from './metadataCommand.js';

describe('MetadataCommandInputSchema', () => {
  it('decodes a pull with omitted optional selectors', () => {
    expect(
      Schema.decodeUnknownSync(MetadataCommandInputSchema)({
        operation: 'pull',
        dryRun: true,
      }),
    ).toEqual({ operation: 'pull', dryRun: true });
  });

  it('rejects an explicit undefined exact optional platform', () => {
    expect(() =>
      Schema.decodeUnknownSync(MetadataCommandInputSchema)({
        operation: 'push',
        platform: undefined,
        dryRun: false,
      }),
    ).toThrow();
  });
});

describe('assertListingPlatform', () => {
  it('allows the iOS and Android listing adapters', () => {
    expect(Effect.runSync(assertListingPlatform('ios'))).toBeUndefined();
    expect(Effect.runSync(assertListingPlatform('android'))).toBeUndefined();
  });

  it('rejects unsupported Apple listing targets', () => {
    for (const platform of ['tvos', 'macos', 'visionos'] as const) {
      const platformFailure = Effect.runSync(Effect.flip(assertListingPlatform(platform)));
      expect(platformFailure.message).toMatch(/syncs the iOS and Android store listing only/);
    }
  });
});

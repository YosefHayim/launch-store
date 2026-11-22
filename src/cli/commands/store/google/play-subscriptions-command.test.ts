import { describe, expect, it } from 'vitest';
import { PlaySubscriptionsCommandInputSchema } from './play-subscriptions-command.ts';

describe('PlaySubscriptionsCommandInputSchema', () => {
  it('decodes the Commander boundary', () => {
    const playSubscriptionsCommandSchema = PlaySubscriptionsCommandInputSchema({
      app: 'mobile',
      dryRun: false,
      yes: true,
    });
    expect(playSubscriptionsCommandSchema).toEqual({ app: 'mobile', dryRun: false, yes: true });
  });

  it('accepts an omitted app selector', () => {
    const playSubscriptionsCommandSchema = PlaySubscriptionsCommandInputSchema({
      dryRun: true,
      yes: false,
    });
    expect(playSubscriptionsCommandSchema).toEqual({ dryRun: true, yes: false });
  });

  it('rejects an undefined exact optional app', () => {
    expect(() =>
      PlaySubscriptionsCommandInputSchema({
        app: undefined,
        dryRun: false,
        yes: false,
      }),
    ).toThrow();
  });
});

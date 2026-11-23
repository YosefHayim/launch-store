import { describe, expect, it } from 'vitest';
import { PlaySubscriptionsCommandInputSchema } from './play-subscriptions-command.ts';

function describePlaySubscriptionsCommandPieceSchema() {
  function decodesTheCommanderBoundary() {
    const playSubscriptionsCommandSchema = PlaySubscriptionsCommandInputSchema({
      app: 'mobile',
      dryRun: false,
      yes: true,
    });

    expect(playSubscriptionsCommandSchema).toEqual({ app: 'mobile', dryRun: false, yes: true });
  }

  it('decodes the Commander boundary', decodesTheCommanderBoundary);

  function acceptsAnOmittedAppSelector() {
    const playSubscriptionsCommandSchema = PlaySubscriptionsCommandInputSchema({
      dryRun: true,
      yes: false,
    });

    expect(playSubscriptionsCommandSchema).toEqual({ dryRun: true, yes: false });
  }

  it('accepts an omitted app selector', acceptsAnOmittedAppSelector);

  function rejectsAnUndefinedExactOptionalApp() {
    function callPlaySubscriptionsCommandPieceSchema() {
      return PlaySubscriptionsCommandInputSchema({
        app: undefined,
        dryRun: false,
        yes: false,
      });
    }

    expect(callPlaySubscriptionsCommandPieceSchema).toThrow();
  }

  it('rejects an undefined exact optional app', rejectsAnUndefinedExactOptionalApp);
}

describe('PlaySubscriptionsCommandInputSchema', describePlaySubscriptionsCommandPieceSchema);

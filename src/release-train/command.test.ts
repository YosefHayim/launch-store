import { describe, expect, it } from 'vitest';
import type { Car } from '../types/release-train.ts';
import {
  ReleaseTrainCommandInputSchema,
  carLabel,
  carStatusDetail,
  carStatusLine,
  mintTrainId,
  trainAppSlug,
} from './command.ts';

const NOW = '2026-06-16T00:00:00.000Z';
const BASE_OPTIONS = {
  profile: 'production',
  ota: true,
  channel: 'production',
  env: [],
  includeLocal: false,
} as const;
function describeReleaseTrainCommandPieceSchema() {
  function decodesAStartRequestWithExactOptionalFlags() {
    const releaseTrainCommandSchema = ReleaseTrainCommandInputSchema({
      action: 'start',
      options: {
        ...BASE_OPTIONS,
        app: 'demo',
        platform: 'ios',
        hold: true,
      },
    });

    expect(releaseTrainCommandSchema).toEqual({
      action: 'start',
      options: {
        ...BASE_OPTIONS,
        app: 'demo',
        platform: 'ios',
        hold: true,
      },
    });
  }

  it(
    'decodes a start request with exact optional flags',
    decodesAStartRequestWithExactOptionalFlags,
  );

  function decodesAStatusRequestWithATrainId() {
    const releaseTrainCommandSchema = ReleaseTrainCommandInputSchema({
      action: 'status',
      id: 'demo-ab12',
      options: { ...BASE_OPTIONS, watch: true, json: false },
    });

    expect(releaseTrainCommandSchema).toEqual({
      action: 'status',
      id: 'demo-ab12',
      options: { ...BASE_OPTIONS, watch: true, json: false },
    });
  }

  it('decodes a status request with a train id', decodesAStatusRequestWithATrainId);

  function rejectsExplicitUndefinedExactOptionals() {
    function decodeExplicitUndefined(): void {
      ReleaseTrainCommandInputSchema({
        action: 'start',
        id: undefined,
        options: { ...BASE_OPTIONS },
      });
    }

    expect(decodeExplicitUndefined).toThrow();
  }

  it('rejects explicit undefined exact optionals', rejectsExplicitUndefinedExactOptionals);
}

describe('ReleaseTrainCommandInputSchema', describeReleaseTrainCommandPieceSchema);
function describeTrainAppSlugMintTrainId() {
  function slugifiesAppNamesForTrainIds() {
    expect(trainAppSlug('Hello World!')).toBe('hello-world');
    expect(trainAppSlug('!!!')).toBe('train');
  }

  it('slugifies app names for train ids', slugifiesAppNamesForTrainIds);

  function usesAnAppSlugAndShortRandomSuffix() {
    const mintedTrainId = mintTrainId('Hello World!');
    expect(mintedTrainId).toMatch(/^hello-world-[0-9a-f]{4}$/);
  }

  it('uses an app slug and short random suffix', usesAnAppSlugAndShortRandomSuffix);

  function usesTheTrainFallbackForAPunctuationOnlyName() {
    expect(mintTrainId('!!!')).toMatch(/^train-[0-9a-f]{4}$/);
  }

  it(
    'uses the train fallback for a punctuation-only name',
    usesTheTrainFallbackForAPunctuationOnlyName,
  );

  function mintsANewSuffixForEachTrain() {
    expect(mintTrainId('app')).not.toBe(mintTrainId('app'));
  }

  it('mints a new suffix for each train', mintsANewSuffixForEachTrain);
}

describe('trainAppSlug / mintTrainId', describeTrainAppSlugMintTrainId);
function describeReleaseTrainPresentation() {
  function rendersNativeCarsWithTheirBuildOrFailure() {
    expect(carLabel({ kind: 'ios', state: 'submitted', updatedAt: NOW })).toBe('ios');
    expect(
      carStatusDetail({ kind: 'ios', state: 'submitted', buildId: 'b-1', updatedAt: NOW }),
    ).toBe(' - build b-1');
    expect(carStatusLine({ kind: 'ios', state: 'submitted', buildId: 'b-1', updatedAt: NOW })).toBe(
      'ios: submitted - build b-1',
    );
    expect(carStatusLine({ kind: 'ios', state: 'failed', error: 'rejected', updatedAt: NOW })).toBe(
      'ios: failed - rejected',
    );
  }

  it('renders native cars with their build or failure', rendersNativeCarsWithTheirBuildOrFailure);

  function rendersAPublishedOTAFollowerWithItsManifestId() {
    const otaCar: Car = {
      kind: 'ota',
      platform: 'android',
      channel: 'production',
      runtimeVersion: '1.0.0',
      state: 'published',
      manifestId: 'm-9',
      updatedAt: NOW,
    };

    expect(carLabel(otaCar)).toBe('OTA android (production/1.0.0)');
    expect(carStatusDetail(otaCar)).toBe(' - m-9');
    expect(carStatusLine(otaCar)).toBe('OTA android (production/1.0.0): published - m-9');
  }

  it(
    'renders a published OTA follower with its manifest id',
    rendersAPublishedOTAFollowerWithItsManifestId,
  );

  function omitsDetailWhenACarHasNoBuildErrorOrManifest() {
    expect(carStatusDetail({ kind: 'ios', state: 'building', updatedAt: NOW })).toBe('');
    expect(
      carStatusDetail({
        kind: 'ota',
        platform: 'ios',
        channel: 'production',
        runtimeVersion: '1.0.0',
        state: 'pending',
        updatedAt: NOW,
      }),
    ).toBe('');
  }

  it(
    'omits detail when a car has no build, error, or manifest',
    omitsDetailWhenACarHasNoBuildErrorOrManifest,
  );
}

describe('release-train presentation', describeReleaseTrainPresentation);

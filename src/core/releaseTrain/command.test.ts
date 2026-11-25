import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import type { Car } from '../types/releaseTrain.js';
import {
  ReleaseTrainCommandInputSchema,
  carLabel,
  carStatusDetail,
  carStatusLine,
  mintTrainId,
  trainAppSlug,
} from './command.js';

const NOW = '2026-06-16T00:00:00.000Z';
const BASE_OPTIONS = {
  profile: 'production',
  ota: true,
  channel: 'production',
  env: [],
  includeLocal: false,
} as const;

describe('ReleaseTrainCommandInputSchema', () => {
  it('decodes a start request with exact optional flags', () => {
    expect(
      Schema.decodeUnknownSync(ReleaseTrainCommandInputSchema)({
        action: 'start',
        options: {
          ...BASE_OPTIONS,
          app: 'demo',
          platform: 'ios',
          hold: true,
        },
      }),
    ).toEqual({
      action: 'start',
      options: {
        ...BASE_OPTIONS,
        app: 'demo',
        platform: 'ios',
        hold: true,
      },
    });
  });

  it('decodes a status request with a train id', () => {
    expect(
      Schema.decodeUnknownSync(ReleaseTrainCommandInputSchema)({
        action: 'status',
        id: 'demo-ab12',
        options: { ...BASE_OPTIONS, watch: true, json: false },
      }),
    ).toEqual({
      action: 'status',
      id: 'demo-ab12',
      options: { ...BASE_OPTIONS, watch: true, json: false },
    });
  });

  it('rejects explicit undefined exact optionals', () => {
    expect(() =>
      Schema.decodeUnknownSync(ReleaseTrainCommandInputSchema)({
        action: 'start',
        id: undefined,
        options: { ...BASE_OPTIONS },
      }),
    ).toThrow();
  });
});

describe('trainAppSlug / mintTrainId', () => {
  it('slugifies app names for train ids', () => {
    expect(trainAppSlug('Hello World!')).toBe('hello-world');
    expect(trainAppSlug('!!!')).toBe('train');
  });

  it('uses an app slug and short random suffix', () => {
    const mintedTrainId = mintTrainId('Hello World!');
    expect(mintedTrainId).toMatch(/^hello-world-[0-9a-f]{4}$/);
  });

  it('uses the train fallback for a punctuation-only name', () => {
    expect(mintTrainId('!!!')).toMatch(/^train-[0-9a-f]{4}$/);
  });

  it('mints a new suffix for each train', () => {
    expect(mintTrainId('app')).not.toBe(mintTrainId('app'));
  });
});

describe('release-train presentation', () => {
  it('renders native cars with their build or failure', () => {
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
  });

  it('renders a published OTA follower with its manifest id', () => {
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
  });

  it('omits detail when a car has no build, error, or manifest', () => {
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
  });
});

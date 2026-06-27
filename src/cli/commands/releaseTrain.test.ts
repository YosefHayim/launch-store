import { describe, expect, it } from 'vitest';
import { carLabel, carStatusLine, hasLiveCar, mintTrainId } from './releaseTrain.js';
import type { Car, TrainRecord } from '../../core/releaseTrain/types.js';

const NOW = '2026-06-16T00:00:00.000Z';

describe('mintTrainId', () => {
  it('slugs the app name and appends a short suffix', () => {
    const id = mintTrainId('Hello World!');
    expect(id).toMatch(/^hello-world-[0-9a-f]{4}$/);
  });

  it("falls back to 'train' when the name has no slug characters", () => {
    expect(mintTrainId('!!!')).toMatch(/^train-[0-9a-f]{4}$/);
  });

  it('mints a different suffix each call', () => {
    expect(mintTrainId('app')).not.toBe(mintTrainId('app'));
  });
});

describe('carLabel / carStatusLine', () => {
  it('labels and renders a native car with its build, and an error when failed', () => {
    expect(carLabel({ kind: 'ios', state: 'submitted', updatedAt: NOW })).toBe('ios');
    expect(carStatusLine({ kind: 'ios', state: 'submitted', buildId: 'b-1', updatedAt: NOW })).toBe(
      'ios: submitted · build b-1',
    );
    expect(carStatusLine({ kind: 'ios', state: 'failed', error: 'rejected', updatedAt: NOW })).toBe(
      'ios: failed — rejected',
    );
  });

  it('labels and renders an OTA follower with its manifest id once published', () => {
    const car: Car = {
      kind: 'ota',
      platform: 'android',
      channel: 'production',
      runtimeVersion: '1.0.0',
      state: 'published',
      manifestId: 'm-9',
      updatedAt: NOW,
    };
    expect(carLabel(car)).toBe('OTA android (production/1.0.0)');
    expect(carStatusLine(car)).toBe('OTA android (production/1.0.0): published · m-9');
  });
});

describe('hasLiveCar', () => {
  function record(cars: Car[]): TrainRecord {
    return {
      id: 'app-ab12',
      app: 'app',
      hold: false,
      state: 'running',
      createdAt: NOW,
      updatedAt: NOW,
      cars,
    };
  }

  it('is true while any car is in flight', () => {
    expect(hasLiveCar(record([{ kind: 'ios', state: 'in-review', updatedAt: NOW }]))).toBe(true);
  });

  it('is false once every car is terminal', () => {
    expect(
      hasLiveCar(
        record([
          { kind: 'ios', state: 'released', updatedAt: NOW },
          {
            kind: 'ota',
            platform: 'ios',
            channel: 'production',
            runtimeVersion: '1.0.0',
            state: 'published',
            updatedAt: NOW,
          },
        ]),
      ),
    ).toBe(false);
    expect(hasLiveCar(record([{ kind: 'ios', state: 'failed', updatedAt: NOW }]))).toBe(false);
  });
});

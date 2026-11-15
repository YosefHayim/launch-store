import { describe, expect, it, vi } from 'vitest';

const cryptoCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('node:crypto', () => ({
  createHash: () => {
    cryptoCalls.count += 1;
    throw new Error('node:crypto must not run in the playground');
  },
}));

import { PLAYGROUND_PRESETS, PRICE_CHOICES, type PlaygroundSettings } from './presets.js';
import { runSamplePlan } from './runSamplePlan.js';

const BOOLEANS = [true, false] as const;

describe('playground planners', () => {
  it('never call node:crypto for any preset and control combination', async () => {
    const everySettings: PlaygroundSettings[] = PLAYGROUND_PRESETS.flatMap((preset) =>
      PRICE_CHOICES.flatMap((price) =>
        BOOLEANS.flatMap((trial) =>
          BOOLEANS.flatMap((winback) =>
            BOOLEANS.map((play) => ({ presetId: preset.id, price, trial, winback, play })),
          ),
        ),
      ),
    );
    const samplePlans = await Promise.all(everySettings.map(runSamplePlan));
    for (const samplePlan of samplePlans) {
      expect(samplePlan.appErrorCount).toBe(0);
    }
    expect(cryptoCalls.count).toBe(0);
  });
});

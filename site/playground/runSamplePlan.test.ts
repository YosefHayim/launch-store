import { describe, expect, it } from 'vitest';
import { PLAYGROUND_PRESETS, type PlaygroundSettings } from './presets.js';
import { runSamplePlan } from './runSamplePlan.js';

const settingsFor = (
  presetId: PlaygroundSettings['presetId'],
  changes: Partial<PlaygroundSettings> = {},
): PlaygroundSettings => {
  const preset = PLAYGROUND_PRESETS.find((candidate) => candidate.id === presetId);
  if (preset === undefined) throw new Error(`unknown preset ${presetId}`);
  return { presetId, ...preset.defaults, ...changes };
};

describe('runSamplePlan', () => {
  it.each(PLAYGROUND_PRESETS)('plans the $label preset with no app errors', async (preset) => {
    const samplePlan = await runSamplePlan(settingsFor(preset.id));
    expect(samplePlan.appErrorCount).toBe(0);
    expect(samplePlan.lines.length).toBeGreaterThan(0);
    expect(samplePlan.deleteCount).toBe(0);
  });

  it('sets the chosen price on the existing subscription', async () => {
    const samplePlan = await runSamplePlan(settingsFor('subscriptionApp', { price: 9.99 }));
    const descriptions = samplePlan.lines.map((line) => line.description);
    expect(descriptions).toContain('set subscription price pro.monthly = 9.99 (USA)');
  });

  it('adds the intro offer only when the trial is on', async () => {
    const withTrial = await runSamplePlan(settingsFor('subscriptionApp', { trial: true }));
    const withoutTrial = await runSamplePlan(settingsFor('subscriptionApp', { trial: false }));
    const hasIntroLine = (lines: readonly { description: string }[]): boolean =>
      lines.some((line) => /intro/i.test(line.description));
    expect(hasIntroLine(withTrial.lines)).toBe(true);
    expect(hasIntroLine(withoutTrial.lines)).toBe(false);
  });

  it('adds Google Play lines only when the play toggle is on', async () => {
    const withPlay = await runSamplePlan(settingsFor('subscriptionApp', { play: true }));
    const withoutPlay = await runSamplePlan(settingsFor('subscriptionApp', { play: false }));
    expect(withPlay.lines.length).toBeGreaterThan(withoutPlay.lines.length);
  });

  it('plans every toggle together without an app error', async () => {
    const samplePlan = await runSamplePlan(
      settingsFor('firstRelease', { trial: true, winback: true, play: true }),
    );
    expect(samplePlan.appErrorCount).toBe(0);
  });
});

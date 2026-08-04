import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import {
  formatElapsed,
  formatProgressLine,
  gradleProgressStep,
  isInteractiveTerminal,
  renderBar,
  selectProgressMode,
  withSpinner,
  xcodeProgressStep,
} from './progress.js';
import { makeLaunchLoggerTest } from './logger.js';
describe('selectProgressMode - only a real interactive TTY gets the spinner', () => {
  it('uses the spinner on an interactive, non-CI TTY without --verbose', () => {
    expect(selectProgressMode(true, {}, false)).toBe('spinner');
  });
  it('streams raw output under --verbose so the full log is visible', () => {
    expect(selectProgressMode(true, {}, true)).toBe('stream');
  });
  it('streams when not a TTY (piped output, log files, agents)', () => {
    expect(selectProgressMode(false, {}, false)).toBe('stream');
  });
  it('streams in CI so transcripts keep the complete output', () => {
    expect(selectProgressMode(true, { CI: 'true' }, false)).toBe('stream');
  });
});
describe('formatElapsed - compact mm ss clock', () => {
  it('shows bare seconds under a minute', () => {
    expect(formatElapsed(5000)).toBe('5s');
    expect(formatElapsed(45000)).toBe('45s');
  });
  it('shows minutes with zero-padded seconds past a minute', () => {
    expect(formatElapsed(72000)).toBe('1m 12s');
    expect(formatElapsed(125000)).toBe('2m 05s');
  });
});
describe('xcodeProgressStep - surface the xcpretty step', () => {
  const xcprettyStepMarker = String.fromCodePoint(0x25b8);
  it('extracts the text after the xcpretty marker', () => {
    expect(xcodeProgressStep(`[02:56:43]: ${xcprettyStepMarker} Compiling yuv_sse2.c`)).toBe(
      'Compiling yuv_sse2.c',
    );
  });
  it('ignores lines without a step marker', () => {
    expect(xcodeProgressStep('[02:56:36]: Clean Succeeded')).toBeUndefined();
  });
  it('truncates an over-long step so it stays on one line', () => {
    const long = `${xcprettyStepMarker} ${'Compiling/a/very/deep/path/to/some/Source.swift'.repeat(3)}`;
    const step = xcodeProgressStep(long);
    expect(step).toBeDefined();
    expect(step?.length).toBeLessThanOrEqual(52);
    expect(step?.endsWith('...')).toBe(true);
  });
});
describe('isInteractive - prompt only on a real, non-CI TTY', () => {
  it('is true on an interactive TTY with no CI marker', () => {
    expect(isInteractiveTerminal(true, {})).toBe(true);
  });
  it("is false when stdout isn't a TTY (pipes, log files, agents)", () => {
    expect(isInteractiveTerminal(false, {})).toBe(false);
  });
  it('is false in CI even on a TTY, so it never blocks on stdin', () => {
    expect(isInteractiveTerminal(true, { CI: 'true' })).toBe(false);
  });
});
describe('withSpinner - silent network steps degrade cleanly off-TTY', () => {
  it('runs the task and returns its result (no spinner without a TTY)', async () => {
    await expect(
      Effect.runPromise(
        withSpinner('looking up', () => Effect.succeed(42)).pipe(
          Effect.provide(makeLaunchLoggerTest([])),
        ),
      ),
    ).resolves.toBe(42);
  });
  it('propagates a task rejection', async () => {
    await expect(
      Effect.runPromise(
        withSpinner('looking up', () => Effect.fail(new Error('boom'))).pipe(
          Effect.provide(makeLaunchLoggerTest([])),
        ),
      ),
    ).rejects.toThrow('boom');
  });
});
describe('gradleProgressStep - surface the Gradle task', () => {
  it('extracts the task path', () => {
    expect(gradleProgressStep('> Task :app:bundleRelease')).toBe(':app:bundleRelease');
  });
  it('extracts the task even with surrounding state and indentation', () => {
    expect(gradleProgressStep('  > Task :app:compileReleaseKotlin UP-TO-DATE')).toBe(
      ':app:compileReleaseKotlin',
    );
  });
  it('ignores non-task lines', () => {
    expect(gradleProgressStep('BUILD SUCCESSFUL in 1m 12s')).toBeUndefined();
  });
});
describe('renderBar - candy Aurora bar, clamped (plain off-TTY)', () => {
  // Under vitest stdout isn't a TTY, so the bar renders plain (no color): rounded caps ..., a heavy
  // fill, and a dim  track - exactly the captured-log path.
  it('renders empty, half, and full at width 14', () => {
    expect(renderBar(0)).toBe('[--------------]');
    expect(renderBar(0.5)).toBe('[#######-------]');
    expect(renderBar(1)).toBe('[##############]');
  });
  it('clamps out-of-range fractions instead of overflowing the line', () => {
    expect(renderBar(1.7)).toBe('[##############]');
    expect(renderBar(-3)).toBe('[--------------]');
  });
  it('honors a custom width', () => {
    expect(renderBar(0.5, 4)).toBe('[##--]');
  });
});
describe('formatProgressLine - bar + step-count + elapsed/eta, degrading gracefully', () => {
  it("shows only the label, step, and elapsed clock when there's no estimate (first build of a kind)", () => {
    expect(
      formatProgressLine({
        label: 'Building iOS - sampleapp',
        step: 'Compiling X.m',
        elapsedMs: 25000,
        steps: 12,
      }),
    ).toBe('Building iOS - sampleapp - Compiling X.m   25s');
  });
  it('fills the bar by step-count and shows count/~total - elapsed / ~eta', () => {
    const line = formatProgressLine({
      label: 'Building iOS - sampleapp',
      step: 'Signing sampleapp.app',
      elapsedMs: 18000,
      steps: 21,
      estimate: { ms: 41000, steps: 28 },
    });
    expect(line).toContain('21/~28');
    expect(line).toContain('18s / ~41s');
    expect(line).toContain('[##########----]');
  });
  it('falls back to the time fraction before any step parses (steps 0)', () => {
    const line = formatProgressLine({
      label: 'Building iOS - sampleapp',
      step: '',
      elapsedMs: 20500, // ~half of the 41s estimate
      steps: 0,
      estimate: { ms: 41000, steps: 28 },
    });
    expect(line).not.toContain('/~28'); // no step counter when steps haven't parsed yet
    expect(line).toContain('[#######-------]');
    expect(line).toContain('20s / ~41s');
  });
  it('caps the bar below 100% when the build runs longer/larger than the estimate', () => {
    const line = formatProgressLine({
      label: 'Building iOS - sampleapp',
      step: 'Compiling',
      elapsedMs: 90000,
      steps: 99,
      estimate: { ms: 41000, steps: 28 },
    });
    expect(line).toContain('[#############-]');
  });
});

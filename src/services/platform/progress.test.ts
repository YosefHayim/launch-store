import { afterEach, describe, expect, it } from 'vitest';
import { formatElapsed } from './elapsed.ts';
import { resetLogger, useJsonHumanWriter, useLoggerSink } from './logger.ts';
import {
  formatProgressLine,
  gradleProgressStep,
  isInteractiveTerminal,
  renderBar,
  selectProgressMode,
  withSpinner,
  xcodeProgressStep,
} from './progress.ts';

afterEach(function resetLoggerSink() {
  resetLogger();
});
function describeSelectProgressModeOnlyARealInteractiveTTYGetsTheSpinner() {
  function usesTheSpinnerOnAnInteractiveNonCITTYWithoutVerbose() {
    const progressMode = selectProgressMode(true, {}, false);
    expect(progressMode).toBe('spinner');
  }

  it(
    'uses the spinner on an interactive, non-CI TTY without --verbose',
    usesTheSpinnerOnAnInteractiveNonCITTYWithoutVerbose,
  );

  function streamsPiecePieceUnderVerboseSoTheFullLogIsVisible() {
    const progressMode = selectProgressMode(true, {}, true);
    expect(progressMode).toBe('stream');
  }

  it(
    'streams raw output under --verbose so the full log is visible',
    streamsPiecePieceUnderVerboseSoTheFullLogIsVisible,
  );

  function streamsWhenNotATTYPipedPieceLogFilesAgents() {
    const progressMode = selectProgressMode(false, {}, false);
    expect(progressMode).toBe('stream');
  }

  it(
    'streams when not a TTY (piped output, log files, agents)',
    streamsWhenNotATTYPipedPieceLogFilesAgents,
  );

  function streamsInCISoTranscriptsKeepTheCompletePiece() {
    const progressMode = selectProgressMode(true, { CI: 'true' }, false);
    expect(progressMode).toBe('stream');
  }

  it(
    'streams in CI so transcripts keep the complete output',
    streamsInCISoTranscriptsKeepTheCompletePiece,
  );
}

describe(
  'selectProgressMode - only a real interactive TTY gets the spinner',
  describeSelectProgressModeOnlyARealInteractiveTTYGetsTheSpinner,
);
function describeSelectProgressModePieceNeverStreamsPieceChildPiece() {
  function takesTheQuietPathEvenOffATTYOrUnderVerbose() {
    const progressMode = selectProgressMode(false, {}, false, true);
    expect(progressMode).toBe('spinner');
    expect(selectProgressMode(true, { CI: 'true' }, true, true)).toBe('spinner');
  }

  it(
    'takes the quiet path even off a TTY or under --verbose',
    takesTheQuietPathEvenOffATTYOrUnderVerbose,
  );
}

describe(
  'selectProgressMode - --json never streams raw child output',
  describeSelectProgressModePieceNeverStreamsPieceChildPiece,
);
function describeFormatElapsedCompactMmSsClock() {
  function showsBareSecondsUnderAMinute() {
    const elapsedLabel = formatElapsed(5000);
    expect(elapsedLabel).toBe('5s');
    const elapsed = formatElapsed(45000);
    expect(elapsed).toBe('45s');
  }

  it('shows bare seconds under a minute', showsBareSecondsUnderAMinute);

  function showsMinutesWithZeroPaddedSecondsPastAMinute() {
    const elapsedLabel = formatElapsed(72000);
    expect(elapsedLabel).toBe('1m 12s');
    const elapsed = formatElapsed(125000);
    expect(elapsed).toBe('2m 05s');
  }

  it(
    'shows minutes with zero-padded seconds past a minute',
    showsMinutesWithZeroPaddedSecondsPastAMinute,
  );
}

describe('formatElapsed - compact mm ss clock', describeFormatElapsedCompactMmSsClock);
function describeXcodeProgressStepSurfaceThePieceXcodebuildStep() {
  function namesTheFileForCompileLinkAndSignLines() {
    const compileLine =
      "CompileC /b/Pods/yuv_sse2.o /s/yuv_sse2.c normal arm64 c com.apple.compilers.llvm.clang.1_0.compiler (in target 'libwebp' from project 'Pods')";
    const swiftLine =
      "SwiftCompile normal arm64 /s/AppDelegate.swift (in target 'App' from project 'App')";

    expect(xcodeProgressStep(compileLine)).toBe('CompileC yuv_sse2.o');
    expect(xcodeProgressStep(swiftLine)).toBe('SwiftCompile AppDelegate.swift');
    expect(xcodeProgressStep('Ld /b/App.app/App normal')).toBe('Ld App');
    expect(xcodeProgressStep('CodeSign /b/App.app')).toBe('CodeSign App.app');
  }

  it('names the file for compile, link and sign lines', namesTheFileForCompileLinkAndSignLines);

  function namesTheBuildPhaseScriptInsteadOfItsPath() {
    const scriptLine =
      "PhaseScriptExecution [CP]\\ Embed\\ Pods\\ Frameworks /b/Script-1.sh (in target 'App' from project 'App')";
    expect(xcodeProgressStep(scriptLine)).toBe('PhaseScriptExecution [CP] Embed Pods Frameworks');
  }

  it('names the build phase script instead of its path', namesTheBuildPhaseScriptInsteadOfItsPath);

  function reportsTheArchiveAndExportSuccessMarkers() {
    expect(xcodeProgressStep('** ARCHIVE SUCCEEDED **')).toBe('archive succeeded');
    expect(xcodeProgressStep('** EXPORT SUCCEEDED **')).toBe('export succeeded');
  }

  it('reports the archive and export success markers', reportsTheArchiveAndExportSuccessMarkers);

  function ignoresLinesThatAreNotBuildSteps() {
    expect(xcodeProgressStep('note: Using new build system')).toBeUndefined();
    expect(xcodeProgressStep('')).toBeUndefined();
  }

  it('ignores lines that are not build steps', ignoresLinesThatAreNotBuildSteps);

  function truncatesAnOverLongStepSoItStaysOnOneLine() {
    const long = `CompileC /b/${'LongName'.repeat(12)}.o /s/x.c normal arm64`;
    const step = xcodeProgressStep(long);

    expect(step).toBeDefined();
    expect(step?.length).toBeLessThanOrEqual(52);
    expect(step?.endsWith('...')).toBe(true);
  }

  it(
    'truncates an over-long step so it stays on one line',
    truncatesAnOverLongStepSoItStaysOnOneLine,
  );
}

describe(
  'xcodeProgressStep - surface the raw xcodebuild step',
  describeXcodeProgressStepSurfaceThePieceXcodebuildStep,
);
function describeIsInteractivePromptOnlyOnARealNonCITTY() {
  function isTrueOnAnInteractiveTTYWithNoCIMarker() {
    expect(isInteractiveTerminal(true, {})).toBe(true);
  }

  it('is true on an interactive TTY with no CI marker', isTrueOnAnInteractiveTTYWithNoCIMarker);

  function isFalseWhenStdoutIsnTATTYPipesLogFilesAgents() {
    expect(isInteractiveTerminal(false, {})).toBe(false);
  }

  it(
    "is false when stdout isn't a TTY (pipes, log files, agents)",
    isFalseWhenStdoutIsnTATTYPipesLogFilesAgents,
  );

  function isFalseInCIEvenOnATTYSoItNeverBlocksOnStdin() {
    expect(isInteractiveTerminal(true, { CI: 'true' })).toBe(false);
  }

  it(
    'is false in CI even on a TTY, so it never blocks on stdin',
    isFalseInCIEvenOnATTYSoItNeverBlocksOnStdin,
  );
}

describe(
  'isInteractive - prompt only on a real, non-CI TTY',
  describeIsInteractivePromptOnlyOnARealNonCITTY,
);
function describeWithSpinnerSilentNetworkStepsDegradeCleanlyOffTTY() {
  async function runsTheTaskAndReturnsItsPieceNoSpinnerWithoutATTY() {
    async function lookup(): Promise<number> {
      return 42;
    }

    const lookedUp = await withSpinner('looking up', lookup);

    expect(lookedUp).toBe(42);
  }

  it(
    'runs the task and returns its result (no spinner without a TTY)',
    runsTheTaskAndReturnsItsPieceNoSpinnerWithoutATTY,
  );

  async function propagatesATaskRejection() {
    async function failLookup(): Promise<number> {
      throw new Error('boom');
    }

    await expect(withSpinner('looking up', failLookup)).rejects.toThrow('boom');
  }

  it('propagates a task rejection', propagatesATaskRejection);
}

describe(
  'withSpinner - silent network steps degrade cleanly off-TTY',
  describeWithSpinnerSilentNetworkStepsDegradeCleanlyOffTTY,
);
function describeWithSpinnerProgressEventsUnderPiece() {
  async function emitsStartThenDoneWithTheElapsedTime() {
    const eventLines: string[] = [];

    useLoggerSink(function writeEvent(text: string) {
      eventLines.push(text);
    });
    useJsonHumanWriter(function writeHuman() {
      return undefined;
    });

    async function lookup(): Promise<number> {
      return 42;
    }

    await withSpinner('looking up', lookup);

    function parseEventLine(eventLine: string) {
      return JSON.parse(eventLine);
    }

    const events = eventLines.map(parseEventLine);

    expect(events[0]).toEqual({ event: 'progress', label: 'looking up', status: 'start' });
    expect(events[1]).toMatchObject({ event: 'progress', label: 'looking up', status: 'done' });
    expect(typeof events[1].elapsedMs).toBe('number');
  }

  it('emits start then done with the elapsed time', emitsStartThenDoneWithTheElapsedTime);

  async function emitsStartThenFailWhenTheTaskFails() {
    const eventLines: string[] = [];
    const humanLines: string[] = [];

    useLoggerSink(function writeEvent(text: string) {
      eventLines.push(text);
    });
    useJsonHumanWriter(function writeHuman(text: string) {
      humanLines.push(text);
    });

    async function failLookup(): Promise<number> {
      throw new Error('boom');
    }

    await expect(withSpinner('looking up', failLookup)).rejects.toThrow('boom');

    function parseEventLine(eventLine: string) {
      return JSON.parse(eventLine);
    }

    const events = eventLines.map(parseEventLine);

    expect(events).toEqual([
      { event: 'progress', label: 'looking up', status: 'start' },
      { event: 'progress', label: 'looking up', status: 'fail' },
    ]);
    expect(humanLines.join('')).toBe('[ERROR] looking up failed\n');
  }

  it('emits start then fail when the task fails', emitsStartThenFailWhenTheTaskFails);
}

describe('withSpinner - progress events under --json', describeWithSpinnerProgressEventsUnderPiece);
function describeGradleProgressStepSurfaceTheGradleTask() {
  function extractsTheTaskPath() {
    expect(gradleProgressStep('> Task :app:bundleRelease')).toBe(':app:bundleRelease');
  }

  it('extracts the task path', extractsTheTaskPath);

  function extractsTheTaskEvenWithSurroundingPieceAndIndentation() {
    expect(gradleProgressStep('  > Task :app:compileReleaseKotlin UP-TO-DATE')).toBe(
      ':app:compileReleaseKotlin',
    );
  }

  it(
    'extracts the task even with surrounding state and indentation',
    extractsTheTaskEvenWithSurroundingPieceAndIndentation,
  );

  function ignoresNonTaskLines() {
    expect(gradleProgressStep('BUILD SUCCESSFUL in 1m 12s')).toBeUndefined();
  }

  it('ignores non-task lines', ignoresNonTaskLines);
}

describe(
  'gradleProgressStep - surface the Gradle task',
  describeGradleProgressStepSurfaceTheGradleTask,
);
function describeRenderBarCandyAuroraBarClampedPlainOffTTY() {
  function rendersEmptyHalfAndFullAtWidth14() {
    const bar = renderBar(0);
    expect(bar).toBe('[--------------]');
    expect(renderBar(0.5)).toBe('[#######-------]');
    expect(renderBar(1)).toBe('[##############]');
  }

  // Under vitest stdout isn't a TTY, so the bar renders plain (no color): rounded caps ..., a heavy
  // fill, and a dim  track - exactly the captured-log path.
  it('renders empty, half, and full at width 14', rendersEmptyHalfAndFullAtWidth14);

  function clampsOutOfRangeFractionsInsteadOfOverflowingTheLine() {
    const bar = renderBar(1.7);
    expect(bar).toBe('[##############]');
    expect(renderBar(-3)).toBe('[--------------]');
  }

  it(
    'clamps out-of-range fractions instead of overflowing the line',
    clampsOutOfRangeFractionsInsteadOfOverflowingTheLine,
  );

  function honorsACustomWidth() {
    const bar = renderBar(0.5, 4);
    expect(bar).toBe('[##--]');
  }

  it('honors a custom width', honorsACustomWidth);
}

describe(
  'renderBar - candy Aurora bar, clamped (plain off-TTY)',
  describeRenderBarCandyAuroraBarClampedPlainOffTTY,
);
function describeFormatProgressLineBarStepCountElapsedEtaDegradingGracefully() {
  function showsOnlyTheLabelStepAndElapsedClockWhenThereSNoEstimateFirstBuildOfAKind() {
    const progressLine = formatProgressLine({
      label: 'Building iOS - sampleapp',
      step: 'Compiling X.m',
      elapsedMs: 25000,
      steps: 12,
    });

    expect(progressLine).toBe('Building iOS - sampleapp - Compiling X.m   25s');
  }

  it(
    "shows only the label, step, and elapsed clock when there's no estimate (first build of a kind)",
    showsOnlyTheLabelStepAndElapsedClockWhenThereSNoEstimateFirstBuildOfAKind,
  );

  function fillsTheBarByStepCountAndShowsCountTotalElapsedEta() {
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
  }

  it(
    'fills the bar by step-count and shows count/~total - elapsed / ~eta',
    fillsTheBarByStepCountAndShowsCountTotalElapsedEta,
  );

  function fallsBackToTheTimeFractionBeforeAnyStepParsesSteps0() {
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
  }

  it(
    'falls back to the time fraction before any step parses (steps 0)',
    fallsBackToTheTimeFractionBeforeAnyStepParsesSteps0,
  );

  function capsTheBarBelow100WhenTheBuildRunsLongerLargerThanTheEstimate() {
    const line = formatProgressLine({
      label: 'Building iOS - sampleapp',
      step: 'Compiling',
      elapsedMs: 90000,
      steps: 99,
      estimate: { ms: 41000, steps: 28 },
    });

    expect(line).toContain('[#############-]');
  }

  it(
    'caps the bar below 100% when the build runs longer/larger than the estimate',
    capsTheBarBelow100WhenTheBuildRunsLongerLargerThanTheEstimate,
  );
}

describe(
  'formatProgressLine - bar + step-count + elapsed/eta, degrading gracefully',
  describeFormatProgressLineBarStepCountElapsedEtaDegradingGracefully,
);

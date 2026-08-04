import type { GlossaryTopic } from './glossary.js';
import { Terminal } from '@effect/platform';
import { Effect } from 'effect';
import { createLogger } from '../services/logger.js';
import type { PipelinePhase } from '../build/phases.js';
import { isApplePlatform, platformLabel } from '../services/platform.js';
import type { Platform } from '../types/app.js';
/**
 * The fixed sample app the tour narrates. Deterministic on purpose - identical for every user, so the
 * output is stable for docs/screenshots and easy to assert in tests. It is never read from disk and
 * never built; it only supplies names for the "what this step would do" lines.
 */
const SAMPLE = { name: 'DemoApp', bundleId: 'com.example.demo', version: '1.0.0' } as const;
/**
 * One narrated step of the tour.
 *
 * `phase` ties the step to the canonical pipeline spine (so coverage is testable). `detail` is the canned
 * "what this would do" line, keyed by **build track** - every Apple platform (iOS/tvOS/macOS/visionOS)
 * shares the Xcode/App Store journey, so the Apple line is a function of the chosen platform (it names the
 * platform where it matters); Android has its own. `topic`, when present, is the glossary term whose
 * teaching block prints under the step - omitted for phases the live pipeline also prints without one
 * (e.g. `store`), so the tour mirrors a real `--explain` run.
 */
type TourStep = {
  phase: PipelinePhase;
  title: string;
  detail: {
    apple: (platform: Platform) => string;
    android: string;
  };
  topic?: {
    apple: GlossaryTopic;
    android: GlossaryTopic;
  };
};
/** The narration, one entry per {@link PIPELINE_PHASES} phase, in pipeline order. */
const TOUR_STEPS: readonly TourStep[] = [
  {
    phase: 'resolve',
    title: 'Resolve app, profile & env',
    detail: {
      apple: (platform) =>
        `${SAMPLE.name} ${SAMPLE.version} - production - ${platform} - .env validated`,
      android: `${SAMPLE.name} ${SAMPLE.version} - production - android - .env validated`,
    },
    topic: { apple: 'app-config', android: 'app-config' },
  },
  {
    phase: 'prebuild',
    title: 'Prebuild the native project',
    detail: {
      apple: (platform) => `would run \`expo prebuild --platform ${platform}\` -> ${platform}/`,
      android: 'would run `expo prebuild --platform android` -> android/',
    },
    topic: { apple: 'prebuild', android: 'prebuild' },
  },
  {
    phase: 'credentials',
    title: 'Resolve signing credentials',
    detail: {
      apple: () => 'ASC API key from the Keychain - reuse distribution cert + provisioning profile',
      android: 'service account + upload keystore from the OS secret store',
    },
    topic: { apple: 'provisioning-profile', android: 'upload-key' },
  },
  {
    phase: 'build',
    title: 'Build & sign',
    detail: {
      apple: () => `fastlane gym -> signed ${SAMPLE.name}.ipa (caches warm - incremental)`,
      android: `gradle :app:bundleRelease -> signed ${SAMPLE.name}.aab`,
    },
    topic: { apple: 'fastlane', android: 'gradle' },
  },
  {
    phase: 'size',
    title: 'Real download-size check',
    detail: {
      apple: () => 'App Thinning Size Report -> per-device download - gated by sizeBudgetMB',
      android: 'bundletool -> per-device download - gated by sizeBudgetMB',
    },
    topic: { apple: 'app-thinning', android: 'bundletool' },
  },
  {
    phase: 'store',
    title: 'Store the artifact',
    detail: {
      apple: () => `${SAMPLE.name}.ipa -> ~/.launch/artifacts (newest-first index)`,
      android: `${SAMPLE.name}.aab -> ~/.launch/artifacts (newest-first index)`,
    },
  },
  {
    phase: 'submit',
    title: 'Submit to the testing track',
    detail: {
      apple: () => 'upload to TestFlight - the safe default (public release is `launch release`)',
      android: 'upload to the Play internal track',
    },
    topic: { apple: 'testflight', android: 'play-track' },
  },
];
/** The glossary topics the tour relies on - exported so a test can assert they're all real terms. */
export const tourTopics = (): GlossaryTopic[] => {
  const topics: GlossaryTopic[] = [];
  for (const step of TOUR_STEPS) {
    if (step.topic) topics.push(step.topic.apple, step.topic.android);
  }
  return topics;
};
/** The pipeline phases the tour covers, in order - exported for the drift-guard test. */
export const tourPhases = (): PipelinePhase[] => {
  return TOUR_STEPS.map((step) => step.phase);
};
/** Read one tour response through the platform terminal. */
const readContinueOrSkip = () =>
  Effect.gen(function* () {
    const terminal = yield* Terminal.Terminal;
    const responseText = yield* terminal.readLine;
    if (responseText.trim().toLowerCase() === 's') return 'skip' as const;
    return 'continue' as const;
  });

/** Render the simulated release tour and optionally pause between steps. */
export const runTour = (platform: Platform, interactive: boolean) =>
  Effect.gen(function* () {
    const logger = yield* createLogger(true);
    const terminal = yield* Terminal.Terminal;
    yield* logger.gap();
    yield* logger.notice(
      `Launch tour - how an ${platformLabel(platform)} app ships, end to end`,
      'Simulated: no build, no network, no account changes. Enter s to skip.',
    );
    yield* logger.gap();
    const apple = isApplePlatform(platform);
    const total = TOUR_STEPS.length;
    for (const [stepIndex, step] of TOUR_STEPS.entries()) {
      yield* logger.line(`Step ${stepIndex + 1}/${total}`);
      let detail = step.detail.android;
      if (apple) detail = step.detail.apple(platform);
      let topic: GlossaryTopic | undefined;
      if (step.topic !== undefined) {
        topic = step.topic.android;
        if (apple) topic = step.topic.apple;
      }
      yield* logger.step(step.title, detail, topic);
      if (interactive && stepIndex < total - 1) {
        yield* terminal.display(`  [Enter] continue   [s] skip   (${stepIndex + 1}/${total})\n`);
        if ((yield* readContinueOrSkip()) === 'skip') break;
      }
    }
    yield* logger.gap();
    yield* logger.note(
      'That is the whole flow - every step above was a simulation. Now do it for real:',
    );
  });

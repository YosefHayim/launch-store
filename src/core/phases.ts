/**
 * The canonical build-pipeline spine — the ordered phases every `launch build` runs.
 *
 * This is the single source of truth for "the steps Launch takes," shared by everything that needs
 * to name them in order: `src/core/pipeline.ts` (the live flow, see its `log.step` calls) and
 * `src/core/tour.ts` (the first-run walkthrough that narrates each phase). Keeping the list here means
 * the tour can't silently fall out of step with the pipeline — a test asserts the tour covers exactly
 * these phases, so adding a phase to the flow forces it into the tour too.
 *
 * The same seven phases are described prose-side in `CONTEXT.md` ("The core flow: build → sign →
 * submit"); keep all three in agreement when the flow changes.
 */

/**
 * The ordered pipeline phases, newest user-facing names. Order is meaningful — it's the sequence the
 * pipeline executes and the tour narrates.
 */
export const PIPELINE_PHASES = [
  "resolve", // pick the app + profile + env from config
  "prebuild", // generate the native ios/ or android/ project from app.json
  "credentials", // load signing assets (ASC key + cert/profile, or service account + upload key)
  "build", // compile & sign — fastlane gym (iOS) or gradle :app:bundleRelease (Android)
  "size", // real per-device download size (App Thinning report / bundletool)
  "store", // copy the artifact into storage with a newest-first index
  "submit", // upload to the testing track (TestFlight / Play internal)
] as const;

/** One phase of {@link PIPELINE_PHASES}. */
export type PipelinePhase = (typeof PIPELINE_PHASES)[number];

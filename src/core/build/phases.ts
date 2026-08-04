export const PIPELINE_PHASES = [
  'resolve', // pick the app + profile + env from config
  'prebuild', // generate the native ios/ or android/ project from app.json
  'credentials', // load signing assets (ASC key + cert/profile, or service account + upload key)
  'build', // compile & sign - fastlane gym (iOS) or gradle :app:bundleRelease (Android)
  'size', // real per-device download size (App Thinning report / bundletool)
  'store', // copy the artifact into storage with a newest-first index
  'submit', // upload to the testing track (TestFlight / Play internal)
] as const;
/** One phase of {@link PIPELINE_PHASES}. */
export type PipelinePhase = (typeof PIPELINE_PHASES)[number];

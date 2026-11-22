import type { LaunchConfig, LaunchConfigInput } from './types/config.ts';
import {
  DEFAULT_BUILD_ENGINE,
  DEFAULT_CREDENTIALS_PROVIDER,
  DEFAULT_STORAGE_PROVIDER,
  DEFAULT_SUBMITTER,
} from './types/config.ts';

// Spread first so a typo'd key survives for `launch config validate` (issue #197).
export function defineConfig(launchFile: LaunchConfigInput): LaunchConfig {
  const credentials = launchFile.credentials ?? DEFAULT_CREDENTIALS_PROVIDER;
  const storage = launchFile.storage ?? DEFAULT_STORAGE_PROVIDER;
  const buildEngine = launchFile.buildEngine ?? DEFAULT_BUILD_ENGINE;
  const submit = launchFile.submit ?? DEFAULT_SUBMITTER;

  return { ...launchFile, credentials, storage, buildEngine, submit };
}

export function createLaunchFileScaffold(): string {
  return `import { defineConfig } from "launch-store";

export default defineConfig({
  credentials: "local",
  storage: "local",
  buildEngine: "xcode",
  profiles: {
    production: {
      name: "production",
    },
  },
});
`;
}

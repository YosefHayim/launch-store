import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import type { AppDescriptor } from '../types/app.js';
import type { LaunchConfig } from '../types/config.js';

vi.mock('../config/config.js', () => ({
  loadConfig: vi.fn(),
}));
vi.mock('../services/exec.js', () => ({
  captureCommandOutput: vi.fn(() => Effect.succeed('')),
  checkCommandExists: vi.fn(() => Effect.succeed(true)),
}));
vi.mock('../store/storeClients.js', () => ({
  createAscClientResolver: () => () => Effect.succeed(null),
  createPlayClientResolver: () => () => Effect.succeed(null),
}));
vi.mock('../services/registry.js', () => ({
  getCredentialsProvider: () =>
    Effect.succeed({ name: 'local', status: () => Effect.succeed('no credentials') }),
}));

import { loadConfig } from '../config/config.js';
import { makeLaunchEnvironmentTest } from '../services/environment.js';
import { makeLaunchPathsTest } from '../services/paths.js';
import { buildDoctorContext } from './context.js';

const apps: AppDescriptor[] = [
  {
    name: 'alpha',
    dir: '/apps/alpha',
    configPath: '/apps/alpha/app.json',
    bundleId: 'com.example.alpha',
  },
  {
    name: 'beta',
    dir: '/apps/beta',
    configPath: '/apps/beta/app.json',
    bundleId: 'com.example.beta',
  },
];

const launchConfig: LaunchConfig = {
  profiles: {},
  credentials: 'local',
  storage: 'local',
  buildEngine: 'fastlane',
  submit: 'app-store-connect',
};

/** Run context construction with deterministic environment and path services. */
const runBuildDoctorContext = (appSelector?: string) =>
  Effect.runPromise(
    buildDoctorContext('ios', appSelector).pipe(
      Effect.provide(makeLaunchEnvironmentTest({ LANG: 'en_US.UTF-8' })),
      Effect.provide(makeLaunchPathsTest('/test-home', '/workspace')),
      Effect.provide(NodeContext.layer),
    ),
  );

describe('buildDoctorContext', () => {
  it('filters apps when an app selector is provided', async () => {
    vi.mocked(loadConfig).mockReturnValue(
      Effect.succeed({
        config: launchConfig,
        apps,
      }),
    );
    const doctorContext = await runBuildDoctorContext('alpha');
    expect(doctorContext.apps.map((app) => app.name)).toEqual(['alpha']);
    expect(doctorContext.cwd).toBe('/workspace');
    expect(doctorContext.shellLocale).toEqual({ LANG: 'en_US.UTF-8' });
  });

  it('includes every app when no selector is provided', async () => {
    vi.mocked(loadConfig).mockReturnValue(
      Effect.succeed({
        config: launchConfig,
        apps,
      }),
    );
    const doctorContext = await runBuildDoctorContext();
    expect(doctorContext.apps.map((app) => app.name)).toEqual(['alpha', 'beta']);
  });
});

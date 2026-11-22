import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/config.ts';
import { resetLaunchEnvironment, useLaunchEnvironment } from '../services/platform/environment.ts';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import type { AppDescriptor } from '../types/app.ts';
import type { LaunchConfig } from '../types/config.ts';
import { buildDoctorContext } from './context.ts';

vi.mock('../config/config.ts', function mockConfigModule() {
  return {
    loadConfig: vi.fn(),
  };
});

vi.mock('../store/shared/store-clients.ts', function mockStoreClients() {
  return {
    createAscClientResolver: function createAscClientResolver() {
      return function resolveAscClient() {
        return Promise.resolve(null);
      };
    },
    createPlayClientResolver: function createPlayClientResolver() {
      return function resolvePlayClient() {
        return Promise.resolve(null);
      };
    },
  };
});

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
  buildEngine: 'xcode',
  submit: 'app-store-connect',
};

function appName(app: AppDescriptor): string {
  return app.name;
}

async function runBuildDoctorContext(appSelector?: string) {
  useLaunchEnvironment({ LANG: 'en_US.UTF-8' });
  useLaunchDirectories({
    homeDirectory: '/test-home',
    workingDirectory: '/workspace',
  });

  return buildDoctorContext('ios', appSelector);
}

describe('buildDoctorContext', function describeBuildDoctorContext() {
  afterEach(function resetDoctorContextDoubles() {
    resetLaunchEnvironment();
    resetLaunchDirectories();
    vi.clearAllMocks();
  });

  it('filters apps when an app selector is provided', async function filtersSelectedApp() {
    vi.mocked(loadConfig).mockResolvedValue({
      config: launchConfig,
      apps,
    });

    const doctorContext = await runBuildDoctorContext('alpha');

    expect(doctorContext.apps.map(appName)).toEqual(['alpha']);
    expect(doctorContext.cwd).toBe('/workspace');
    expect(doctorContext.shellLocale).toEqual({ LANG: 'en_US.UTF-8' });
  });

  it('includes every app when no selector is provided', async function includesEveryApp() {
    vi.mocked(loadConfig).mockResolvedValue({
      config: launchConfig,
      apps,
    });

    const doctorContext = await runBuildDoctorContext();

    expect(doctorContext.apps.map(appName)).toEqual(['alpha', 'beta']);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { AppDescriptor } from '../types/app.js';
import type { LaunchConfig } from '../types.js';

vi.mock('../config.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../exec.js', () => ({
  capture: vi.fn(),
  exists: vi.fn(async () => true),
}));

vi.mock('../storeClients.js', () => ({
  createAscClientResolver: () => async () => null,
  createPlayClientResolver: () => async () => null,
}));

vi.mock('../../providers/credentials/local.js', () => ({
  localCredentialsProvider: { status: async () => 'no credentials' },
}));

import { loadConfig } from '../config.js';
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

describe('buildDoctorContext', () => {
  it('filters apps when an app selector is provided', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      config: {} as LaunchConfig,
      apps,
    });
    const ctx = await buildDoctorContext('ios', 'alpha');
    expect(ctx.apps.map((app) => app.name)).toEqual(['alpha']);
  });

  it('includes every app when no selector is provided', async () => {
    vi.mocked(loadConfig).mockResolvedValue({
      config: {} as LaunchConfig,
      apps,
    });
    const ctx = await buildDoctorContext('ios');
    expect(ctx.apps.map((app) => app.name)).toEqual(['alpha', 'beta']);
  });
});

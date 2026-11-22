import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.js';
import type { HostHandle } from '../types/remote.js';
import {
  clearLiveHost,
  getAmiId,
  getLiveHost,
  readCloudState,
  setAmiId,
  setLiveHost,
} from './cloudState.js';

const hostHandle: HostHandle = {
  provider: 'aws-ec2-mac',
  ssh: { host: '1.2.3.4', user: 'ec2-user', port: 22 },
  allocatedAt: '2026-06-14T00:00:00.000Z',
  instanceId: 'i-123',
  hostId: 'h-123',
  region: 'us-east-1',
  instanceType: 'mac2.metal',
};

describe('cloud state', () => {
  let testHomeDirectory = '';

  beforeEach(() => {
    testHomeDirectory = mkdtempSync(join(tmpdir(), 'launch-cloud-state-'));
    useLaunchDirectories({
      homeDirectory: testHomeDirectory,
      workingDirectory: testHomeDirectory,
    });
  });

  afterEach(() => {
    resetLaunchDirectories();
    rmSync(testHomeDirectory, { recursive: true, force: true });
  });

  it('is empty when the file does not exist', async () => {
    expect(await readCloudState()).toEqual({});
    expect(await getLiveHost()).toBeNull();
    expect(await getAmiId()).toBeNull();
  });

  it('round-trips the live host and clears it without losing the AMI id', async () => {
    await setAmiId('ami-abc');
    await setLiveHost(hostHandle);
    expect(await getLiveHost()).toEqual(hostHandle);
    expect(await getAmiId()).toBe('ami-abc');
    await clearLiveHost();
    expect(await getLiveHost()).toBeNull();
    expect(await getAmiId()).toBe('ami-abc');
  });

  it('tolerates a malformed file by returning empty state', async () => {
    const launchDirectory = join(testHomeDirectory, '.launch');
    await setAmiId('ami-before-corruption');
    writeFileSync(join(launchDirectory, 'cloud.json'), '{ not json');
    expect(await readCloudState()).toEqual({});
  });
});

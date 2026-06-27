import { afterEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';

// Redirect ~/.launch to a throwaway temp dir so the test never touches the real cloud state.
vi.mock('./paths.js', async () => {
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const dir = path.join(os.tmpdir(), 'launch-cloudstate-test');
  return {
    LAUNCH_HOME: dir,
    CLOUD_STATE: path.join(dir, 'cloud.json'),
    ensureDir: (target: string): string => {
      fs.mkdirSync(target, { recursive: true });
      return target;
    },
  };
});

import { CLOUD_STATE } from './paths.js';
import {
  clearLiveHost,
  getAmiId,
  getLiveHost,
  readCloudState,
  setAmiId,
  setLiveHost,
} from './cloudState.js';
import type { HostHandle } from './types.js';

const handle: HostHandle = {
  provider: 'aws-ec2-mac',
  ssh: { host: '1.2.3.4', user: 'ec2-user', port: 22 },
  allocatedAt: '2026-06-14T00:00:00.000Z',
  instanceId: 'i-123',
  hostId: 'h-123',
  region: 'us-east-1',
  instanceType: 'mac2.metal',
};

afterEach(() => {
  rmSync(CLOUD_STATE, { force: true });
});

describe('cloud state (~/.launch/cloud.json)', () => {
  it('is empty when the file does not exist', () => {
    expect(readCloudState()).toEqual({});
    expect(getLiveHost()).toBeNull();
    expect(getAmiId()).toBeNull();
  });

  it('round-trips the live host and clears it without losing the AMI id', () => {
    setAmiId('ami-abc');
    setLiveHost(handle);
    expect(getLiveHost()).toEqual(handle);
    expect(getAmiId()).toBe('ami-abc');

    clearLiveHost();
    expect(getLiveHost()).toBeNull();
    expect(getAmiId()).toBe('ami-abc'); // AMI survives a host teardown
  });

  it('tolerates a malformed file by returning empty state', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(CLOUD_STATE, '{ not json');
    expect(readCloudState()).toEqual({});
  });
});

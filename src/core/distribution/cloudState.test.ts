import type { FileSystem, Path } from '@effect/platform';
import { NodeContext } from '@effect/platform-node';
import { Effect } from 'effect';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeLaunchPathsTest, type LaunchPathsService } from '../services/paths.js';
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
  let testHomeDirectory: string;

  beforeEach(() => {
    testHomeDirectory = mkdtempSync(join(tmpdir(), 'launch-cloud-state-'));
  });

  afterEach(() => {
    rmSync(testHomeDirectory, { recursive: true, force: true });
  });

  const runCloudState = <Success, Failure>(
    cloudStateEffect: Effect.Effect<
      Success,
      Failure,
      FileSystem.FileSystem | LaunchPathsService | Path.Path
    >,
  ) =>
    Effect.runPromise(
      cloudStateEffect.pipe(
        Effect.provide(makeLaunchPathsTest(testHomeDirectory, testHomeDirectory)),
        Effect.provide(NodeContext.layer),
      ),
    );

  it('is empty when the file does not exist', async () => {
    expect(await runCloudState(readCloudState())).toEqual({});
    expect(await runCloudState(getLiveHost())).toBeNull();
    expect(await runCloudState(getAmiId())).toBeNull();
  });

  it('round-trips the live host and clears it without losing the AMI id', async () => {
    await runCloudState(setAmiId('ami-abc'));
    await runCloudState(setLiveHost(hostHandle));
    expect(await runCloudState(getLiveHost())).toEqual(hostHandle);
    expect(await runCloudState(getAmiId())).toBe('ami-abc');
    await runCloudState(clearLiveHost());
    expect(await runCloudState(getLiveHost())).toBeNull();
    expect(await runCloudState(getAmiId())).toBe('ami-abc');
  });

  it('tolerates a malformed file by returning empty state', async () => {
    const launchDirectory = join(testHomeDirectory, '.launch');
    await runCloudState(setAmiId('ami-before-corruption'));
    writeFileSync(join(launchDirectory, 'cloud.json'), '{ not json');
    expect(await runCloudState(readCloudState())).toEqual({});
  });
});

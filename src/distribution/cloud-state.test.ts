import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import type { HostHandle } from '../types/remote.ts';
import {
  clearLiveHost,
  getAmiId,
  getLiveHost,
  readCloudState,
  setAmiId,
  setLiveHost,
} from './cloud-state.ts';

const hostHandle: HostHandle = {
  provider: 'aws-ec2-mac',
  ssh: { host: '1.2.3.4', user: 'ec2-user', port: 22 },
  allocatedAt: '2026-06-14T00:00:00.000Z',
  instanceId: 'i-123',
  hostId: 'h-123',
  region: 'us-east-1',
  instanceType: 'mac2.metal',
};

function describeCloudPiece() {
  let testHomeDirectory = '';

  function prepareCloudPiece() {
    const systemTemporaryDirectory = tmpdir();
    const joinedPath = join(systemTemporaryDirectory, 'launch-cloud-state-');

    testHomeDirectory = mkdtempSync(joinedPath);
    useLaunchDirectories({
      homeDirectory: testHomeDirectory,
      workingDirectory: testHomeDirectory,
    });
  }

  beforeEach(prepareCloudPiece);

  function cleanupCloudPiece() {
    resetLaunchDirectories();
    rmSync(testHomeDirectory, { recursive: true, force: true });
  }

  afterEach(cleanupCloudPiece);

  async function isEmptyWhenTheFileDoesNotExist() {
    const readCloud = await readCloudState();

    expect(readCloud).toEqual({});

    const liveHost = await getLiveHost();

    expect(liveHost).toBeNull();

    const amiId = await getAmiId();

    expect(amiId).toBeNull();
  }

  it('is empty when the file does not exist', isEmptyWhenTheFileDoesNotExist);

  async function roundTripsTheLiveHostAndClearsItWithoutLosingTheAMIId() {
    await setAmiId('ami-abc');
    await setLiveHost(hostHandle);

    const liveHost = await getLiveHost();

    expect(liveHost).toEqual(hostHandle);

    const amiId = await getAmiId();

    expect(amiId).toBe('ami-abc');
    await clearLiveHost();
    expect(await getLiveHost()).toBeNull();
    expect(await getAmiId()).toBe('ami-abc');
  }

  it(
    'round-trips the live host and clears it without losing the AMI id',
    roundTripsTheLiveHostAndClearsItWithoutLosingTheAMIId,
  );

  async function toleratesAMalformedFileByReturningEmptyPiece() {
    const launchDirectory = join(testHomeDirectory, '.launch');

    await setAmiId('ami-before-corruption');

    const cloudPath = join(launchDirectory, 'cloud.json');

    writeFileSync(cloudPath, '{ not json');

    const readCloud = await readCloudState();

    expect(readCloud).toEqual({});
  }

  it(
    'tolerates a malformed file by returning empty state',
    toleratesAMalformedFileByReturningEmptyPiece,
  );
}

describe('cloud state', describeCloudPiece);

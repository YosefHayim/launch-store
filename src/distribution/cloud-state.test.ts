import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetLaunchDirectories, useLaunchDirectories } from '../services/platform/paths.ts';
import type { HostHandle } from '../types/remote.ts';
import { clearLiveHost, getLiveHost, readCloudState, setLiveHost } from './cloud-state.ts';

const hostHandle: HostHandle = {
  provider: 'byo-ssh',
  ssh: { host: '1.2.3.4', user: 'builder', port: 22 },
  allocatedAt: '2026-06-14T00:00:00.000Z',
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
  }

  it('is empty when the file does not exist', isEmptyWhenTheFileDoesNotExist);

  async function roundTripsTheLiveHostAndClearsIt() {
    await setLiveHost(hostHandle);

    const liveHost = await getLiveHost();

    expect(liveHost).toEqual(hostHandle);
    await clearLiveHost();
    expect(await getLiveHost()).toBeNull();
  }

  it('round-trips the live host and clears it', roundTripsTheLiveHostAndClearsIt);

  async function toleratesAMalformedFileByReturningEmptyPiece() {
    const launchDirectory = join(testHomeDirectory, '.launch');

    await setLiveHost(hostHandle);

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

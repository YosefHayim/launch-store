import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INSTANCE_TYPE,
  bootstrapReportsMissingXcode,
  configuredInstanceType,
  countLiveDedicatedHosts,
  datedMacImages,
  hostIsReleasedOrMissing,
  isDedicatedHostQuotaFailure,
  macosArchitectureFor,
  newestImageId,
  publicAddress,
  releaseFailureDetail,
} from './awsEc2Mac.js';
import { awsFailure, requireAws } from './awsEc2MacClient.js';

describe('publicAddress', () => {
  it('prefers a non-empty public DNS name', () => {
    expect(publicAddress('ec2.example', '1.2.3.4')).toBe('ec2.example');
  });

  it('falls back to a public IP when DNS is missing or empty', () => {
    expect(publicAddress(undefined, '1.2.3.4')).toBe('1.2.3.4');
    expect(publicAddress('', '9.9.9.9')).toBe('9.9.9.9');
  });

  it('returns undefined when both addresses are unusable', () => {
    expect(publicAddress(undefined, undefined)).toBeUndefined();
    expect(publicAddress('', '')).toBeUndefined();
  });
});

describe('configuredInstanceType', () => {
  it('defaults to mac2.metal', () => {
    expect(configuredInstanceType({})).toBe(DEFAULT_INSTANCE_TYPE);
    expect(DEFAULT_INSTANCE_TYPE).toBe('mac2.metal');
  });

  it('honors an explicit instance type', () => {
    expect(configuredInstanceType({ instanceType: 'mac2-m2.metal' })).toBe('mac2-m2.metal');
  });
});

describe('macosArchitectureFor', () => {
  it('maps mac2 families to arm64_mac and older families to x86_64_mac', () => {
    expect(macosArchitectureFor('mac2.metal')).toBe('arm64_mac');
    expect(macosArchitectureFor('mac2-m2pro.metal')).toBe('arm64_mac');
    expect(macosArchitectureFor('mac1.metal')).toBe('x86_64_mac');
  });
});

describe('isDedicatedHostQuotaFailure', () => {
  it('detects quota-style AllocateHosts failures', () => {
    expect(isDedicatedHostQuotaFailure('HostLimitExceeded: vCPU limit')).toBe(true);
    expect(isDedicatedHostQuotaFailure('InsufficientInstanceCapacity')).toBe(true);
    expect(isDedicatedHostQuotaFailure('Request limit exceeded')).toBe(true);
    expect(isDedicatedHostQuotaFailure('UnauthorizedOperation')).toBe(false);
  });
});

describe('datedMacImages / newestImageId', () => {
  it('drops images without id or creation date', () => {
    expect(
      datedMacImages([
        { ImageId: 'ami-a', CreationDate: '2024-01-01T00:00:00.000Z' },
        { ImageId: 'ami-b' },
        { CreationDate: '2024-02-01T00:00:00.000Z' },
      ]),
    ).toEqual([{ id: 'ami-a', date: '2024-01-01T00:00:00.000Z' }]);
  });

  it('selects the newest creation date', () => {
    expect(
      newestImageId([
        { id: 'ami-old', date: '2023-01-01T00:00:00.000Z' },
        { id: 'ami-new', date: '2025-06-01T00:00:00.000Z' },
        { id: 'ami-mid', date: '2024-06-01T00:00:00.000Z' },
      ]),
    ).toBe('ami-new');
  });

  it('returns undefined for an empty catalog', () => {
    expect(newestImageId([])).toBeUndefined();
  });
});

describe('countLiveDedicatedHosts', () => {
  it('counts only hosts that are present and not released*', () => {
    expect(
      countLiveDedicatedHosts([
        { State: 'available' },
        { State: 'pending' },
        { State: 'released' },
        { State: 'released-permanent-failure' },
        {},
      ]),
    ).toBe(2);
  });
});

describe('hostIsReleasedOrMissing', () => {
  it('treats missing and released* states as not statusable', () => {
    expect(hostIsReleasedOrMissing(undefined)).toBe(true);
    expect(hostIsReleasedOrMissing('released')).toBe(true);
    expect(hostIsReleasedOrMissing('released-permanent-failure')).toBe(true);
    expect(hostIsReleasedOrMissing('available')).toBe(false);
  });
});

describe('releaseFailureDetail', () => {
  it('returns undefined when release fully succeeded', () => {
    expect(releaseFailureDetail(undefined)).toBeUndefined();
  });

  it('prefers the AWS error message and falls back to unknown', () => {
    expect(releaseFailureDetail({ Error: { Message: 'minimum allocation period' } })).toBe(
      'minimum allocation period',
    );
    expect(releaseFailureDetail({})).toBe('unknown');
    expect(releaseFailureDetail({ Error: {} })).toBe('unknown');
  });
});

describe('bootstrapReportsMissingXcode', () => {
  it('detects the LAUNCH_NO_XCODE marker from the bootstrap script', () => {
    expect(bootstrapReportsMissingXcode('ok\nLAUNCH_NO_XCODE\n')).toBe(true);
    expect(bootstrapReportsMissingXcode('Xcode 16.0')).toBe(false);
  });
});

describe('awsFailure / requireAws', () => {
  it('tags failures and prefers an explicit detail message', () => {
    const failure = awsFailure('allocate', new Error('raw'), 'friendly detail');
    expect(failure._tag).toBe('AwsComputeFailure');
    expect(failure.operation).toBe('allocate');
    expect(failure.message).toBe('friendly detail');
  });

  it('requires an aws config block on allocate requests', async () => {
    const missing = await Effect.runPromise(
      requireAws({
        confirm: () => Effect.succeed(true),
      }).pipe(Effect.flip),
    );
    expect(missing._tag).toBe('AwsComputeFailure');
    expect(missing.message).toMatch(/AWS settings missing/);

    const present = await Effect.runPromise(
      requireAws({
        aws: { region: 'us-east-1' },
        confirm: () => Effect.succeed(true),
      }),
    );
    expect(present.region).toBe('us-east-1');
  });
});

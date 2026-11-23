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
} from './aws-ec2-mac.ts';
import { awsFailure, requireAws } from './aws-ec2-mac-client.ts';
function describePublicAddress() {
  function prefersANonEmptyPublicDNSName() {
    expect(publicAddress('ec2.example', '1.2.3.4')).toBe('ec2.example');
  }

  it('prefers a non-empty public DNS name', prefersANonEmptyPublicDNSName);
  function fallsBackToAPublicIPWhenDNSIsMissingOrEmpty() {
    expect(publicAddress(undefined, '1.2.3.4')).toBe('1.2.3.4');
    expect(publicAddress('', '9.9.9.9')).toBe('9.9.9.9');
  }

  it(
    'falls back to a public IP when DNS is missing or empty',
    fallsBackToAPublicIPWhenDNSIsMissingOrEmpty,
  );
  function returnsUndefinedWhenBothAddressesAreUnusable() {
    expect(publicAddress(undefined, undefined)).toBeUndefined();
    expect(publicAddress('', '')).toBeUndefined();
  }

  it(
    'returns undefined when both addresses are unusable',
    returnsUndefinedWhenBothAddressesAreUnusable,
  );
}

describe('publicAddress', describePublicAddress);
function describeConfiguredInstanceType() {
  function defaultsToMac2Metal() {
    expect(configuredInstanceType({})).toBe(DEFAULT_INSTANCE_TYPE);
    expect(DEFAULT_INSTANCE_TYPE).toBe('mac2.metal');
  }

  it('defaults to mac2.metal', defaultsToMac2Metal);
  function honorsAnExplicitInstanceType() {
    expect(configuredInstanceType({ instanceType: 'mac2-m2.metal' })).toBe('mac2-m2.metal');
  }

  it('honors an explicit instance type', honorsAnExplicitInstanceType);
}

describe('configuredInstanceType', describeConfiguredInstanceType);
function describeMacosArchitectureFor() {
  function mapsMac2FamiliesToArm64MacAndOlderFamiliesToX8664Mac() {
    expect(macosArchitectureFor('mac2.metal')).toBe('arm64_mac');
    expect(macosArchitectureFor('mac2-m2pro.metal')).toBe('arm64_mac');
    expect(macosArchitectureFor('mac1.metal')).toBe('x86_64_mac');
  }

  it(
    'maps mac2 families to arm64_mac and older families to x86_64_mac',
    mapsMac2FamiliesToArm64MacAndOlderFamiliesToX8664Mac,
  );
}

describe('macosArchitectureFor', describeMacosArchitectureFor);
function describeIsDedicatedHostQuotaFailure() {
  function detectsQuotaStyleAllocateHostsFailures() {
    expect(isDedicatedHostQuotaFailure('HostLimitExceeded: vCPU limit')).toBe(true);
    expect(isDedicatedHostQuotaFailure('InsufficientInstanceCapacity')).toBe(true);
    expect(isDedicatedHostQuotaFailure('Request limit exceeded')).toBe(true);
    expect(isDedicatedHostQuotaFailure('UnauthorizedOperation')).toBe(false);
  }

  it('detects quota-style AllocateHosts failures', detectsQuotaStyleAllocateHostsFailures);
}

describe('isDedicatedHostQuotaFailure', describeIsDedicatedHostQuotaFailure);
function describeDatedMacImagesNewestImageId() {
  function dropsImagesWithoutIdOrCreationDate() {
    expect(
      datedMacImages([
        { ImageId: 'ami-a', CreationDate: '2024-01-01T00:00:00.000Z' },
        { ImageId: 'ami-b' },
        { CreationDate: '2024-02-01T00:00:00.000Z' },
      ]),
    ).toEqual([{ id: 'ami-a', date: '2024-01-01T00:00:00.000Z' }]);
  }

  it('drops images without id or creation date', dropsImagesWithoutIdOrCreationDate);
  function selectsTheNewestCreationDate() {
    expect(
      newestImageId([
        { id: 'ami-old', date: '2023-01-01T00:00:00.000Z' },
        { id: 'ami-new', date: '2025-06-01T00:00:00.000Z' },
        { id: 'ami-mid', date: '2024-06-01T00:00:00.000Z' },
      ]),
    ).toBe('ami-new');
  }

  it('selects the newest creation date', selectsTheNewestCreationDate);
  function returnsUndefinedForAnEmptyCatalog() {
    expect(newestImageId([])).toBeUndefined();
  }

  it('returns undefined for an empty catalog', returnsUndefinedForAnEmptyCatalog);
}

describe('datedMacImages / newestImageId', describeDatedMacImagesNewestImageId);
function describeCountLiveDedicatedHosts() {
  function countsOnlyHostsThatArePresentAndNotReleased() {
    const liveDedicatedHosts = countLiveDedicatedHosts([
      { State: 'available' },
      { State: 'pending' },
      { State: 'released' },
      { State: 'released-permanent-failure' },
      {},
    ]);
    expect(liveDedicatedHosts).toBe(2);
  }

  it(
    'counts only hosts that are present and not released*',
    countsOnlyHostsThatArePresentAndNotReleased,
  );
}

describe('countLiveDedicatedHosts', describeCountLiveDedicatedHosts);
function describeHostIsReleasedOrMissing() {
  function treatsMissingAndReleasedStatesAsNotStatusable() {
    expect(hostIsReleasedOrMissing(undefined)).toBe(true);
    expect(hostIsReleasedOrMissing('released')).toBe(true);
    expect(hostIsReleasedOrMissing('released-permanent-failure')).toBe(true);
    expect(hostIsReleasedOrMissing('available')).toBe(false);
  }

  it(
    'treats missing and released* states as not statusable',
    treatsMissingAndReleasedStatesAsNotStatusable,
  );
}

describe('hostIsReleasedOrMissing', describeHostIsReleasedOrMissing);
function describeReleaseFailureDetail() {
  function returnsUndefinedWhenReleaseFullySucceeded() {
    expect(releaseFailureDetail(undefined)).toBeUndefined();
  }

  it('returns undefined when release fully succeeded', returnsUndefinedWhenReleaseFullySucceeded);
  function prefersTheAWSErrorMessageAndFallsBackToUnknown() {
    expect(releaseFailureDetail({ Error: { Message: 'minimum allocation period' } })).toBe(
      'minimum allocation period',
    );
    expect(releaseFailureDetail({})).toBe('unknown');
    expect(releaseFailureDetail({ Error: {} })).toBe('unknown');
  }

  it(
    'prefers the AWS error message and falls back to unknown',
    prefersTheAWSErrorMessageAndFallsBackToUnknown,
  );
}

describe('releaseFailureDetail', describeReleaseFailureDetail);
function describeBootstrapReportsMissingXcode() {
  function detectsTheLAUNCHNOXCODEMarkerFromTheBootstrapScript() {
    expect(bootstrapReportsMissingXcode('ok\nLAUNCH_NO_XCODE\n')).toBe(true);
    expect(bootstrapReportsMissingXcode('Xcode 16.0')).toBe(false);
  }

  it(
    'detects the LAUNCH_NO_XCODE marker from the bootstrap script',
    detectsTheLAUNCHNOXCODEMarkerFromTheBootstrapScript,
  );
}

describe('bootstrapReportsMissingXcode', describeBootstrapReportsMissingXcode);
function describeAwsFailureRequireAws() {
  function tagsFailuresAndPrefersAnExplicitDetailMessage() {
    const failure = awsFailure('allocate', new Error('raw'), 'friendly detail');
    expect(failure._tag).toBe('AwsComputeFailure');
    expect(failure.operation).toBe('allocate');
    expect(failure.message).toBe('friendly detail');
  }

  it(
    'tags failures and prefers an explicit detail message',
    tagsFailuresAndPrefersAnExplicitDetailMessage,
  );
  function requiresAnAwsPieceBlockOnAllocateRequests() {
    let failure: unknown = null;

    try {
      requireAws({
        confirm() {
          return Promise.resolve(true);
        },
      });
    } catch (caught) {
      failure = caught;
    }

    expect(failure).toMatchObject({
      _tag: 'AwsComputeFailure',
      message: expect.stringMatching(/AWS settings missing/),
    });

    const present = requireAws({
      aws: { region: 'us-east-1' },
      confirm() {
        return Promise.resolve(true);
      },
    });
    expect(present.region).toBe('us-east-1');
  }

  it(
    'requires an aws config block on allocate requests',
    requiresAnAwsPieceBlockOnAllocateRequests,
  );
}

describe('awsFailure / requireAws', describeAwsFailureRequireAws);

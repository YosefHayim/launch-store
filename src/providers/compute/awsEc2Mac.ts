import { FileSystem, Path } from '@effect/platform';
import { Effect, unsafeCoerce } from 'effect';
import type { _InstanceType } from '@aws-sdk/client-ec2';
import {
  AWS_BOOTSTRAP_TOOLS,
  awsAllocationConsentMessage,
  awsCostForDurationUsd,
  awsHostReleasableAt,
  getAwsGoldenAmiId,
  setAwsGoldenAmiId,
} from '@core/services/awsComputeSupport.js';
import { errorMessage } from '@core/services/errorMessage.js';
import { LAUNCH_HOME } from '@core/services/paths.js';
import { sshCapture, sshReachable } from '@core/services/ssh.js';
import type { ComputeHost } from '@core/types/providers.js';
import type {
  AllocateRequest,
  AwsConfig,
  CloudCheck,
  CloudDoctorReport,
  HostHandle,
  SshTarget,
} from '@core/types/remote.js';
import {
  type AwsComputeFailure,
  type Ec2Client,
  type Ec2Module,
  awsFailure,
  makeClient,
  requireAws,
  sendAwsRequest,
} from './awsEc2MacClient.js';

const KEY_NAME = 'launch-ec2-mac';
const SG_NAME = 'launch-ec2-mac-sg';
export const DEFAULT_INSTANCE_TYPE = 'mac2.metal';
const SSH_BOOT_TIMEOUT_MS = 12 * 60 * 1000;
const AMI_AVAILABLE_TIMEOUT_MS = 30 * 60 * 1000;
const TERMINATE_TIMEOUT_MS = 5 * 60 * 1000;

/** Prefer public DNS, then public IP; empty strings are treated as missing. */
export const publicAddress = (
  publicDnsName: string | undefined,
  publicIpAddress: string | undefined,
): string | undefined => {
  if (publicDnsName !== undefined && publicDnsName.length > 0) return publicDnsName;
  if (publicIpAddress !== undefined && publicIpAddress.length > 0) return publicIpAddress;
  return undefined;
};

export const configuredInstanceType = (
  awsConfiguration: Pick<AwsConfig, 'instanceType'>,
): string => {
  if (awsConfiguration.instanceType !== undefined) return awsConfiguration.instanceType;
  return DEFAULT_INSTANCE_TYPE;
};

/** Amazon macOS AMI architecture for an EC2 Mac instance family (`mac2*` is arm64). */
export const macosArchitectureFor = (instanceType: string): string => {
  if (instanceType.startsWith('mac2')) return 'arm64_mac';
  return 'x86_64_mac';
};

export const isDedicatedHostQuotaFailure = (failureMessage: string): boolean =>
  /quota|limit|exceeded|insufficient/i.test(failureMessage);

export type DatedAmiImage = Readonly<{
  readonly id: string;
  readonly date: string;
}>;

export const datedMacImages = (
  catalogImages: ReadonlyArray<{
    ImageId?: string | undefined;
    CreationDate?: string | undefined;
  }>,
): DatedAmiImage[] =>
  catalogImages.flatMap((imageDescription) => {
    if (imageDescription.ImageId === undefined) return [];
    if (imageDescription.CreationDate === undefined) return [];
    return [{ id: imageDescription.ImageId, date: imageDescription.CreationDate }];
  });

/** Newest by CreationDate; stable for equal dates. */
export const newestImageId = (datedImages: readonly DatedAmiImage[]): string | undefined => {
  if (datedImages.length === 0) return undefined;
  const sortedImages = datedImages.slice().sort((firstImage, secondImage) => {
    if (firstImage.date < secondImage.date) return 1;
    if (firstImage.date > secondImage.date) return -1;
    return 0;
  });
  return sortedImages[0]?.id;
};

export const countLiveDedicatedHosts = (
  describedHosts: ReadonlyArray<{ State?: string | undefined }>,
): number =>
  describedHosts.filter((describedHost) => {
    if (describedHost.State === undefined) return false;
    return !describedHost.State.startsWith('released');
  }).length;

/** Missing or already-released hosts are not billable status targets. */
export const hostIsReleasedOrMissing = (hostState: string | undefined): boolean => {
  if (hostState === undefined) return true;
  return hostState.startsWith('released');
};

export const releaseFailureDetail = (
  failedRelease:
    | {
        Error?:
          | {
              Message?: string | undefined;
            }
          | undefined;
      }
    | undefined,
): string | undefined => {
  if (failedRelease === undefined) return undefined;
  if (failedRelease.Error?.Message !== undefined) return failedRelease.Error.Message;
  return 'unknown';
};

export const bootstrapReportsMissingXcode = (bootstrapOutput: string): boolean =>
  bootstrapOutput.includes('LAUNCH_NO_XCODE');

type AwsComputeRequirements =
  | Effect.Effect.Context<ReturnType<typeof getAwsGoldenAmiId>>
  | FileSystem.FileSystem
  | Path.Path;

export const makeAwsEc2MacComputeHost = () =>
  Effect.gen(function* () {
    const computeServices = yield* Effect.context<AwsComputeRequirements>();
    const provideComputeServices = <Success, Failure>(
      computeProgram: Effect.Effect<Success, Failure, AwsComputeRequirements>,
    ): Effect.Effect<Success, Failure> => computeProgram.pipe(Effect.provide(computeServices));

    return {
      name: 'aws-ec2-mac',
      doctor: runCloudDoctor,
      allocate(allocationRequest: AllocateRequest) {
        return Effect.gen(function* () {
          const awsConfiguration = yield* requireAws(allocationRequest);
          let reportProgress: (message: string) => void = () => undefined;
          if (allocationRequest.onProgress !== undefined) {
            reportProgress = allocationRequest.onProgress;
          }
          const instanceType = configuredInstanceType(awsConfiguration);
          const { ec2, client } = yield* makeClient(awsConfiguration);
          const allocationConfirmed = yield* allocationRequest.confirm(
            awsAllocationConsentMessage(),
          );
          if (!allocationConfirmed) {
            const message = 'Cancelled before allocating a cloud Mac.';
            return yield* Effect.fail(awsFailure('confirm host allocation', message, message));
          }
          const availabilityZone = yield* firstAvailableZone(ec2, client);
          reportProgress(
            `Allocating a Dedicated Host (${instanceType}) in ${availabilityZone} - the 24h billing minimum starts now.`,
          );
          const hostId = yield* allocateHost(ec2, client, instanceType, availabilityZone);
          const allocatedAt = new Date().toISOString();

          return yield* provisionAllocatedHost({
            ec2,
            client,
            awsConfiguration,
            instanceType,
            hostId,
            availabilityZone,
            allocatedAt,
            reportProgress,
            provideComputeServices,
          }).pipe(
            Effect.catchAll((cause) =>
              Effect.gen(function* () {
                reportProgress('Allocation failed - releasing the Dedicated Host to stop billing.');
                yield* releaseHostQuietly(ec2, client, hostId);
                return yield* Effect.fail(cause);
              }),
            ),
          );
        }).pipe(provideComputeServices);
      },
      status(hostHandle: HostHandle) {
        return Effect.gen(function* () {
          if (hostHandle.region === undefined) return null;
          if (hostHandle.hostId === undefined) return null;
          const hostId = hostHandle.hostId;
          const { ec2, client } = yield* makeClient({ region: hostHandle.region });
          const hostDescription = yield* sendAwsRequest('describe the Dedicated Host', () =>
            client.send(new ec2.DescribeHostsCommand({ HostIds: [hostId] })),
          );
          const hostState = hostDescription.Hosts?.[0]?.State;
          if (hostIsReleasedOrMissing(hostState)) return null;
          const ageMs = Date.now() - new Date(hostHandle.allocatedAt).getTime();
          return {
            handle: hostHandle,
            ageMs,
            estimatedCostUsd: awsCostForDurationUsd(ageMs),
            releasableAt: awsHostReleasableAt(hostHandle.allocatedAt),
          };
        });
      },
      teardown(hostHandle: HostHandle) {
        return Effect.gen(function* () {
          if (hostHandle.region === undefined) return;
          const { ec2, client } = yield* makeClient({ region: hostHandle.region });
          if (hostHandle.instanceId !== undefined) {
            const instanceId = hostHandle.instanceId;
            yield* sendAwsRequest('terminate the EC2 Mac instance', () =>
              client.send(new ec2.TerminateInstancesCommand({ InstanceIds: [instanceId] })),
            );
            yield* waitForTerminated(ec2, client, instanceId);
          }
          if (hostHandle.hostId === undefined) return;
          const hostId = hostHandle.hostId;
          const releaseReply = yield* sendAwsRequest('release the Dedicated Host', () =>
            client.send(new ec2.ReleaseHostsCommand({ HostIds: [hostId] })),
          );
          const failureDetail = releaseFailureDetail(releaseReply.Unsuccessful?.[0]);
          if (failureDetail === undefined) return;
          const message =
            `Could not release host ${hostId}: ${failureDetail}. ` +
            'AWS only allows release after the 24h minimum - it keeps billing until then.';
          return yield* Effect.fail(awsFailure('release the Dedicated Host', message, message));
        });
      },
    } satisfies ComputeHost;
  });

type ProvisionAllocatedHostOptions = Readonly<{
  ec2: Ec2Module;
  client: Ec2Client;
  awsConfiguration: AwsConfig;
  instanceType: string;
  hostId: string;
  availabilityZone: string;
  allocatedAt: string;
  reportProgress: (message: string) => void;
  provideComputeServices: <Success, Failure>(
    computeProgram: Effect.Effect<Success, Failure, AwsComputeRequirements>,
  ) => Effect.Effect<Success, Failure>;
}>;

const provisionAllocatedHost = (
  provisionOptions: ProvisionAllocatedHostOptions,
): Effect.Effect<HostHandle, unknown, AwsComputeRequirements> =>
  Effect.gen(function* () {
    const {
      ec2,
      client,
      awsConfiguration,
      instanceType,
      hostId,
      availabilityZone,
      allocatedAt,
      reportProgress,
      provideComputeServices,
    } = provisionOptions;
    const keyPair = yield* ensureKeyPair(ec2, client);
    const { subnetId, vpcId } = yield* defaultSubnet(ec2, client, availabilityZone);
    const securityGroupId = yield* ensureSecurityGroup(ec2, client, vpcId);
    let goldenAmiId: string | null | undefined = awsConfiguration.amiId;
    if (goldenAmiId === undefined) {
      goldenAmiId = yield* provideComputeServices(getAwsGoldenAmiId());
    }
    const shouldCreateGoldenImage = goldenAmiId === null;
    let imageId: string;
    if (goldenAmiId === null) {
      imageId = yield* latestMacosAmi(ec2, client, instanceType);
    } else {
      imageId = goldenAmiId;
    }
    reportProgress('Launching the EC2 Mac instance...');
    const instanceId = yield* runInstance(ec2, client, {
      imageId,
      instanceType,
      hostId,
      keyName: keyPair.keyName,
      subnetId,
      securityGroupId,
    });
    const sshTarget = yield* waitForSsh(ec2, client, instanceId, keyPair.keyPath, reportProgress);
    if (shouldCreateGoldenImage) {
      reportProgress(
        'First run: bootstrapping the toolchain and snapshotting a golden AMI for next time...',
      );
      yield* bootstrapToolchain(sshTarget);
      const newGoldenAmiId = yield* snapshotGoldenAmi(ec2, client, instanceId);
      yield* provideComputeServices(setAwsGoldenAmiId(newGoldenAmiId));
    }
    return {
      provider: 'aws-ec2-mac',
      ssh: sshTarget,
      allocatedAt,
      instanceId,
      hostId,
      region: awsConfiguration.region,
      instanceType,
    };
  });

/** Diagnose AWS credentials, regional Mac availability, host visibility, and IAM needs. */
export const runCloudDoctor = (
  awsConfiguration: AwsConfig,
): Effect.Effect<CloudDoctorReport, never> =>
  Effect.gen(function* () {
    const cloudChecks: CloudCheck[] = [];
    const instanceType = configuredInstanceType(awsConfiguration);
    const clientAttempt = yield* makeClient(awsConfiguration).pipe(Effect.either);
    if (clientAttempt._tag === 'Left') {
      return {
        ok: false,
        checks: [{ label: 'AWS SDK', ok: false, detail: errorMessage(clientAttempt.left) }],
      };
    }
    const { ec2, client } = clientAttempt.right;
    const regionAttempt = yield* sendAwsRequest('reach the configured AWS region', () =>
      client.send(
        new ec2.DescribeAvailabilityZonesCommand({
          Filters: [{ Name: 'state', Values: ['available'] }],
        }),
      ),
    ).pipe(Effect.either);
    if (regionAttempt._tag === 'Left') {
      cloudChecks.push({
        label: 'AWS credentials + region',
        ok: false,
        detail: errorMessage(regionAttempt.left),
      });
      return { ok: false, checks: cloudChecks };
    }
    cloudChecks.push({
      label: 'AWS credentials + region',
      ok: true,
      detail: `reachable in ${awsConfiguration.region}`,
    });

    const offeringAttempt = yield* sendAwsRequest('check the EC2 Mac instance offering', () =>
      client.send(
        new ec2.DescribeInstanceTypeOfferingsCommand({
          LocationType: 'region',
          Filters: [{ Name: 'instance-type', Values: [instanceType] }],
        }),
      ),
    ).pipe(Effect.either);
    if (offeringAttempt._tag === 'Left') {
      cloudChecks.push({
        label: `${instanceType} availability`,
        ok: false,
        detail: errorMessage(offeringAttempt.left),
      });
    } else {
      let instanceTypeOfferings = offeringAttempt.right.InstanceTypeOfferings;
      if (instanceTypeOfferings === undefined) instanceTypeOfferings = [];
      const instanceTypeIsAvailable = instanceTypeOfferings.length > 0;
      let offeringDetail = `NOT offered in ${awsConfiguration.region} - try another region`;
      if (instanceTypeIsAvailable) offeringDetail = `offered in ${awsConfiguration.region}`;
      cloudChecks.push({
        label: `${instanceType} availability`,
        ok: instanceTypeIsAvailable,
        detail: offeringDetail,
      });
    }

    const hostAttempt = yield* sendAwsRequest('inspect the Dedicated Host quota', () =>
      client.send(
        new ec2.DescribeHostsCommand({
          Filter: [{ Name: 'instance-type', Values: [instanceType] }],
        }),
      ),
    ).pipe(Effect.either);
    if (hostAttempt._tag === 'Left') {
      cloudChecks.push({
        label: 'Dedicated Host quota',
        ok: false,
        detail: errorMessage(hostAttempt.left),
      });
    } else {
      let describedHosts = hostAttempt.right.Hosts;
      if (describedHosts === undefined) describedHosts = [];
      const liveHostCount = countLiveDedicatedHosts(describedHosts);
      cloudChecks.push({
        label: 'Dedicated Host quota',
        ok: true,
        detail: `${liveHostCount} ${instanceType} host(s) currently allocated. If AllocateHosts fails, request an increase in Service Quotas -> "Running Dedicated mac2 Hosts" (often not granted instantly).`,
      });
    }
    cloudChecks.push({
      label: 'IAM actions needed',
      ok: true,
      detail:
        'ec2: AllocateHosts, ReleaseHosts, DescribeHosts, RunInstances, DescribeInstances, TerminateInstances, ' +
        'CreateKeyPair, DeleteKeyPair, CreateSecurityGroup, DescribeSecurityGroups, AuthorizeSecurityGroupIngress, ' +
        'DescribeImages, CreateImage, DescribeSubnets, DescribeAvailabilityZones, DescribeInstanceTypeOfferings.',
    });
    return { ok: cloudChecks.every((cloudCheck) => cloudCheck.ok), checks: cloudChecks };
  });

const firstAvailableZone = (
  ec2: Ec2Module,
  client: Ec2Client,
): Effect.Effect<string, AwsComputeFailure> =>
  Effect.gen(function* () {
    const availabilityReply = yield* sendAwsRequest('find an available zone', () =>
      client.send(
        new ec2.DescribeAvailabilityZonesCommand({
          Filters: [{ Name: 'state', Values: ['available'] }],
        }),
      ),
    );
    let availabilityZones = availabilityReply.AvailabilityZones;
    if (availabilityZones === undefined) availabilityZones = [];
    const zoneName = availabilityZones.find(
      (zoneDescription) => zoneDescription.ZoneName !== undefined,
    )?.ZoneName;
    if (zoneName !== undefined) return zoneName;
    const message = 'No available Availability Zone found in this region.';
    return yield* Effect.fail(awsFailure('find an available zone', message, message));
  });

const allocateHost = (
  ec2: Ec2Module,
  client: Ec2Client,
  instanceType: string,
  availabilityZone: string,
): Effect.Effect<string, AwsComputeFailure> =>
  sendAwsRequest('allocate a Mac Dedicated Host', () =>
    client.send(
      new ec2.AllocateHostsCommand({
        AvailabilityZone: availabilityZone,
        InstanceType: instanceType,
        Quantity: 1,
        AutoPlacement: 'off',
      }),
    ),
  ).pipe(
    Effect.catchAll((cause) => {
      const failureMessage = errorMessage(cause);
      if (isDedicatedHostQuotaFailure(failureMessage)) {
        const message =
          `AWS won't allocate a Mac Dedicated Host: ${failureMessage}\n` +
          'Mac hosts almost always need a quota increase first - run `launch cloud doctor` for the request link.';
        return Effect.fail(awsFailure('allocate a Mac Dedicated Host', cause, message));
      }
      return Effect.fail(cause);
    }),
    Effect.flatMap((allocationReply) => {
      const hostId = allocationReply.HostIds?.[0];
      if (hostId !== undefined) return Effect.succeed(hostId);
      const message = 'AllocateHosts returned no host id.';
      return Effect.fail(awsFailure('allocate a Mac Dedicated Host', message, message));
    }),
  );

const ensureKeyPair = (
  ec2: Ec2Module,
  client: Ec2Client,
): Effect.Effect<
  { keyName: string; keyPath: string },
  unknown,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const keyPath = pathService.join(LAUNCH_HOME, 'ec2-mac-key.pem');
    if (yield* fileSystem.exists(keyPath)) return { keyName: KEY_NAME, keyPath };
    yield* sendAwsRequest('delete an unusable EC2 key pair', () =>
      client.send(new ec2.DeleteKeyPairCommand({ KeyName: KEY_NAME })),
    ).pipe(Effect.ignore);
    const keyPairReply = yield* sendAwsRequest('create an EC2 key pair', () =>
      client.send(new ec2.CreateKeyPairCommand({ KeyName: KEY_NAME })),
    );
    if (keyPairReply.KeyMaterial === undefined) {
      const message = 'CreateKeyPair returned no private key material.';
      return yield* Effect.fail(awsFailure('create an EC2 key pair', message, message));
    }
    yield* fileSystem.makeDirectory(LAUNCH_HOME, { recursive: true });
    yield* fileSystem.writeFileString(keyPath, keyPairReply.KeyMaterial);
    yield* fileSystem.chmod(keyPath, 0o600);
    return { keyName: KEY_NAME, keyPath };
  });

const defaultSubnet = (
  ec2: Ec2Module,
  client: Ec2Client,
  availabilityZone: string,
): Effect.Effect<{ subnetId: string; vpcId: string }, AwsComputeFailure> =>
  Effect.gen(function* () {
    const subnetReply = yield* sendAwsRequest('find the default subnet', () =>
      client.send(
        new ec2.DescribeSubnetsCommand({
          Filters: [
            { Name: 'availability-zone', Values: [availabilityZone] },
            { Name: 'default-for-az', Values: ['true'] },
          ],
        }),
      ),
    );
    const subnet = subnetReply.Subnets?.[0];
    if (subnet?.SubnetId !== undefined && subnet.VpcId !== undefined) {
      return { subnetId: subnet.SubnetId, vpcId: subnet.VpcId };
    }
    const message = `No default subnet in ${availabilityZone}. Create one (or set a subnet) and retry.`;
    return yield* Effect.fail(awsFailure('find the default subnet', message, message));
  });

const ensureSecurityGroup = (
  ec2: Ec2Module,
  client: Ec2Client,
  vpcId: string,
): Effect.Effect<string, AwsComputeFailure> =>
  Effect.gen(function* () {
    const securityGroupCatalog = yield* sendAwsRequest('find the SSH security group', () =>
      client.send(
        new ec2.DescribeSecurityGroupsCommand({
          Filters: [
            { Name: 'group-name', Values: [SG_NAME] },
            { Name: 'vpc-id', Values: [vpcId] },
          ],
        }),
      ),
    );
    const existingSecurityGroupId = securityGroupCatalog.SecurityGroups?.[0]?.GroupId;
    if (existingSecurityGroupId !== undefined) return existingSecurityGroupId;
    const createdSecurityGroup = yield* sendAwsRequest('create the SSH security group', () =>
      client.send(
        new ec2.CreateSecurityGroupCommand({
          GroupName: SG_NAME,
          Description: 'Launch EC2 Mac SSH access',
          VpcId: vpcId,
        }),
      ),
    );
    const securityGroupId = createdSecurityGroup.GroupId;
    if (securityGroupId === undefined) {
      const message = 'CreateSecurityGroup returned no group id.';
      return yield* Effect.fail(awsFailure('create the SSH security group', message, message));
    }
    yield* sendAwsRequest('authorize SSH ingress', () =>
      client.send(
        new ec2.AuthorizeSecurityGroupIngressCommand({
          GroupId: securityGroupId,
          IpPermissions: [
            {
              IpProtocol: 'tcp',
              FromPort: 22,
              ToPort: 22,
              IpRanges: [
                {
                  CidrIp: '0.0.0.0/0',
                  Description: 'SSH (key-only; tighten to your IP if needed)',
                },
              ],
            },
          ],
        }),
      ),
    );
    return securityGroupId;
  });

const latestMacosAmi = (
  ec2: Ec2Module,
  client: Ec2Client,
  instanceType: string,
): Effect.Effect<string, AwsComputeFailure> =>
  Effect.gen(function* () {
    const architecture = macosArchitectureFor(instanceType);
    const imageCatalog = yield* sendAwsRequest('find an Amazon macOS image', () =>
      client.send(
        new ec2.DescribeImagesCommand({
          Owners: ['amazon'],
          Filters: [
            { Name: 'name', Values: ['amzn-ec2-macos-*'] },
            { Name: 'architecture', Values: [architecture] },
            { Name: 'state', Values: ['available'] },
          ],
        }),
      ),
    );
    let catalogImages = imageCatalog.Images;
    if (catalogImages === undefined) catalogImages = [];
    const newestImage = newestImageId(datedMacImages(catalogImages));
    if (newestImage !== undefined) return newestImage;
    const message =
      'No Amazon macOS AMI found in this region. Set aws.amiId to a Mac image with Xcode.';
    return yield* Effect.fail(awsFailure('find an Amazon macOS image', message, message));
  });

type RunInstanceOptions = Readonly<{
  imageId: string;
  instanceType: string;
  hostId: string;
  keyName: string;
  subnetId: string;
  securityGroupId: string;
}>;

const runInstance = (
  ec2: Ec2Module,
  client: Ec2Client,
  instanceOptions: RunInstanceOptions,
): Effect.Effect<string, AwsComputeFailure> =>
  sendAwsRequest('launch the EC2 Mac instance', () =>
    client.send(
      new ec2.RunInstancesCommand({
        ImageId: instanceOptions.imageId,
        InstanceType: unsafeCoerce<string, _InstanceType>(instanceOptions.instanceType),
        MinCount: 1,
        MaxCount: 1,
        KeyName: instanceOptions.keyName,
        Placement: { Tenancy: 'host', HostId: instanceOptions.hostId },
        NetworkInterfaces: [
          {
            DeviceIndex: 0,
            AssociatePublicIpAddress: true,
            SubnetId: instanceOptions.subnetId,
            Groups: [instanceOptions.securityGroupId],
          },
        ],
        TagSpecifications: [
          {
            ResourceType: 'instance',
            Tags: [
              { Key: 'Name', Value: 'launch-ec2-mac' },
              { Key: 'managed-by', Value: 'launch' },
            ],
          },
        ],
      }),
    ),
  ).pipe(
    Effect.flatMap((launchReply) => {
      const instanceId = launchReply.Instances?.[0]?.InstanceId;
      if (instanceId !== undefined) return Effect.succeed(instanceId);
      const message = 'RunInstances returned no instance id.';
      return Effect.fail(awsFailure('launch the EC2 Mac instance', message, message));
    }),
  );

const waitForSsh = (
  ec2: Ec2Module,
  client: Ec2Client,
  instanceId: string,
  keyPath: string,
  reportProgress: (message: string) => void,
): Effect.Effect<SshTarget, AwsComputeFailure> =>
  Effect.gen(function* () {
    const deadline = Date.now() + SSH_BOOT_TIMEOUT_MS;
    let host: string | undefined;
    while (Date.now() < deadline) {
      const instanceCatalog = yield* sendAwsRequest('poll the EC2 Mac boot state', () =>
        client.send(new ec2.DescribeInstancesCommand({ InstanceIds: [instanceId] })),
      );
      const instanceDescription = instanceCatalog.Reservations?.[0]?.Instances?.[0];
      host = publicAddress(
        instanceDescription?.PublicDnsName,
        instanceDescription?.PublicIpAddress,
      );
      if (instanceDescription?.State?.Name === 'running' && host !== undefined) break;
      let instanceState = 'pending';
      if (instanceDescription?.State?.Name !== undefined) {
        instanceState = instanceDescription.State.Name;
      }
      reportProgress(`Waiting for the instance to boot (state: ${instanceState})...`);
      yield* Effect.sleep('15 seconds');
    }
    if (host === undefined) {
      const message = 'Instance did not get a public address before the boot timeout.';
      return yield* Effect.fail(awsFailure('wait for the EC2 Mac to boot', message, message));
    }
    const sshTarget: SshTarget = {
      host,
      user: 'ec2-user',
      port: 22,
      identityFile: keyPath,
    };
    while (Date.now() < deadline) {
      if (yield* sshReachable(sshTarget)) return sshTarget;
      reportProgress('Instance running; waiting for SSH to come up (EC2 Macs boot slowly)...');
      yield* Effect.sleep('15 seconds');
    }
    const message = 'SSH did not become reachable before the boot timeout.';
    return yield* Effect.fail(awsFailure('wait for SSH', message, message));
  });

/** Brew lines share doctor's toolchain list; fastlane falls back to gem when brew misses. */
const BOOTSTRAP_BREW_LINES = AWS_BOOTSTRAP_TOOLS.flatMap((requiredTool) => {
  if (requiredTool.install.kind !== 'brew') return [];
  let fastlaneFallback = '';
  if (requiredTool.command === 'fastlane') fastlaneFallback = ' || sudo gem install fastlane';
  return [
    `command -v ${requiredTool.command} >/dev/null || brew install ${requiredTool.install.formula}${fastlaneFallback} || true`,
  ];
});

const BOOTSTRAP_SCRIPT = [
  'set -e',
  'command -v brew >/dev/null || echo LAUNCH_NO_BREW',
  ...BOOTSTRAP_BREW_LINES,
  'xcodebuild -version >/dev/null 2>&1 || echo LAUNCH_NO_XCODE',
].join('\n');

const bootstrapToolchain = (sshTarget: SshTarget): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const bootstrapOutput = yield* sshCapture(sshTarget, BOOTSTRAP_SCRIPT);
    if (!bootstrapReportsMissingXcode(bootstrapOutput)) return;
    const message =
      'The base AMI has no full Xcode (gym needs it). Provide a BYO golden AMI with Xcode preinstalled ' +
      "via aws.amiId - Xcode can't be redistributed in a shared image.";
    return yield* Effect.fail(awsFailure('bootstrap the EC2 Mac toolchain', message, message));
  });

const snapshotGoldenAmi = (
  ec2: Ec2Module,
  client: Ec2Client,
  instanceId: string,
): Effect.Effect<string, AwsComputeFailure> =>
  Effect.gen(function* () {
    const imageCreationReply = yield* sendAwsRequest('create the golden AMI', () =>
      client.send(
        new ec2.CreateImageCommand({
          InstanceId: instanceId,
          Name: `launch-golden-${instanceId}-${Date.now()}`,
        }),
      ),
    );
    const amiId = imageCreationReply.ImageId;
    if (amiId === undefined) {
      const message = 'CreateImage returned no AMI id.';
      return yield* Effect.fail(awsFailure('create the golden AMI', message, message));
    }
    const deadline = Date.now() + AMI_AVAILABLE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const imageCatalog = yield* sendAwsRequest('wait for the golden AMI', () =>
        client.send(new ec2.DescribeImagesCommand({ ImageIds: [amiId] })),
      );
      if (imageCatalog.Images?.[0]?.State === 'available') return amiId;
      yield* Effect.sleep('20 seconds');
    }
    return amiId;
  });

const waitForTerminated = (
  ec2: Ec2Module,
  client: Ec2Client,
  instanceId: string,
): Effect.Effect<void, AwsComputeFailure> =>
  Effect.gen(function* () {
    const deadline = Date.now() + TERMINATE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const instanceCatalog = yield* sendAwsRequest('wait for instance termination', () =>
        client.send(new ec2.DescribeInstancesCommand({ InstanceIds: [instanceId] })),
      );
      if (instanceCatalog.Reservations?.[0]?.Instances?.[0]?.State?.Name === 'terminated') return;
      yield* Effect.sleep('10 seconds');
    }
  });

const releaseHostQuietly = (
  ec2: Ec2Module,
  client: Ec2Client,
  hostId: string,
): Effect.Effect<void> =>
  sendAwsRequest('release a failed Dedicated Host allocation', () =>
    client.send(new ec2.ReleaseHostsCommand({ HostIds: [hostId] })),
  ).pipe(Effect.ignore);

import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { _InstanceType } from '@aws-sdk/client-ec2';
import {
  AWS_BOOTSTRAP_TOOLS,
  awsAllocationConsentMessage,
  awsCostForDurationUsd,
  awsHostReleasableAt,
  getAwsGoldenAmiId,
  setAwsGoldenAmiId,
} from '@/services/provider-support/aws-compute-support.js';
import { errorMessage } from '@/services/platform/error-message.js';
import { LAUNCH_HOME } from '@/services/platform/paths.js';
import { sshCapture, sshReachable } from '@/services/platform/ssh.js';
import { pathExists } from '@/path-exists.js';
import type { ComputeHost } from '@/types/providers.js';
import type {
  AllocateRequest,
  AwsConfig,
  CloudCheck,
  CloudDoctorReport,
  HostHandle,
  SshTarget,
} from '@/types/remote.js';
import {
  type Ec2Client,
  type Ec2Module,
  awsFailure,
  makeClient,
  requireAws,
  sendAwsRequest,
} from './aws-ec2-mac-client.ts';

const KEY_NAME = 'launch-ec2-mac';
const SG_NAME = 'launch-ec2-mac-sg';
export const DEFAULT_INSTANCE_TYPE = 'mac2.metal';
const sshBootTimeoutMs = 12 * 60 * 1000;
const amiAvailableTimeoutMs = 30 * 60 * 1000;
const terminateTimeoutMs = 5 * 60 * 1000;
const BOOT_POLL_MILLISECONDS = 15 * 1000;
const amiPollMilliseconds = 20 * 1000;
const terminatePollMilliseconds = 10 * 1000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise(function wake(finish) {
    setTimeout(finish, milliseconds);
  });
}

/** Prefer public DNS, then public IP; empty strings are treated as missing. */
export function publicAddress(
  publicDnsName: string | undefined,
  publicIpAddress: string | undefined,
): string | undefined {
  if (publicDnsName != null && publicDnsName.length > 0) return publicDnsName;

  if (publicIpAddress != null && publicIpAddress.length > 0) return publicIpAddress;

  return undefined;
}

export function configuredInstanceType(awsConfiguration: Pick<AwsConfig, 'instanceType'>): string {
  if (awsConfiguration.instanceType != null) return awsConfiguration.instanceType;

  return DEFAULT_INSTANCE_TYPE;
}

/** Amazon macOS AMI architecture for an EC2 Mac instance family (`mac2*` is arm64). */
export function macosArchitectureFor(instanceType: string): string {
  if (instanceType.startsWith('mac2')) return 'arm64_mac';

  return 'x86_64_mac';
}

export function isDedicatedHostQuotaFailure(failureMessage: string): boolean {
  return /quota|limit|exceeded|insufficient/i.test(failureMessage);
}

type DatedAmiImage = Readonly<{
  readonly id: string;
  readonly date: string;
}>;
function flatMapImageDescription(imageDescription: {
  ImageId?: string | undefined;
  CreationDate?: string | undefined;
}) {
  if (imageDescription.ImageId == null) return [];

  if (imageDescription.CreationDate == null) return [];

  return [{ id: imageDescription.ImageId, date: imageDescription.CreationDate }];
}

export function datedMacImages(
  catalogImages: ReadonlyArray<{
    ImageId?: string | undefined;
    CreationDate?: string | undefined;
  }>,
): DatedAmiImage[] {
  return catalogImages.flatMap(flatMapImageDescription);
}

/** Newest by CreationDate; stable for equal dates. */
export function newestImageId(datedImages: readonly DatedAmiImage[]): string | undefined {
  if (datedImages.length == 0) return undefined;

  function sortFirstImage(
    firstImage: { readonly id: string; readonly date: string },
    secondImage: { readonly id: string; readonly date: string },
  ) {
    if (firstImage.date < secondImage.date) return 1;

    if (firstImage.date > secondImage.date) return -1;

    return 0;
  }

  const sortedImages = datedImages.slice().sort(sortFirstImage);

  return sortedImages[0]?.id;
}
function filterDescribedHost(describedHost: { State?: string | undefined }) {
  if (describedHost.State == null) return false;

  return !describedHost.State.startsWith('released');
}

export function countLiveDedicatedHosts(
  describedHosts: ReadonlyArray<{ State?: string | undefined }>,
): number {
  return describedHosts.filter(filterDescribedHost).length;
}

/** Missing or already-released hosts are not billable status targets. */
export function hostIsReleasedOrMissing(hostState: string | undefined): boolean {
  if (hostState == null) return true;

  return hostState.startsWith('released');
}

export function releaseFailureDetail(
  failedRelease:
    | {
        Error?:
          | {
              Message?: string | undefined;
            }
          | undefined;
      }
    | undefined,
): string | undefined {
  if (failedRelease == null) return undefined;

  if (failedRelease.Error?.Message != null) return failedRelease.Error.Message;

  return 'unknown';
}

export function bootstrapReportsMissingXcode(bootstrapOutput: string): boolean {
  return bootstrapOutput.includes('LAUNCH_NO_XCODE');
}

type Ec2Pair = Readonly<{ ec2: Ec2Module; client: Ec2Client }>;

type LaunchedInstance = Readonly<{
  imageId: string;
  instanceType: string;
  hostId: string;
  keyName: string;
  subnetId: string;
  securityGroupId: string;
}>;

function checkPassed(cloudCheck: CloudCheck): boolean {
  return cloudCheck.ok;
}

function zoneHasName(zoneDescription: { ZoneName?: string | undefined }): boolean {
  return zoneDescription.ZoneName != null;
}

function readDefaultSubnet(
  subnet:
    | {
        SubnetId?: string | undefined;
        VpcId?: string | undefined;
      }
    | undefined,
): { subnetId: string; vpcId: string } | null {
  if (subnet == null) {
    return null;
  }

  const subnetId = subnet.SubnetId;

  if (subnetId == null) {
    return null;
  }

  const vpcId = subnet.VpcId;

  if (vpcId == null) {
    return null;
  }

  return { subnetId, vpcId };
}

function instanceIsReady(stateName: string | undefined, host: string | undefined): boolean {
  if (stateName != 'running') {
    return false;
  }

  return host != null;
}

async function firstAvailableZone(ec2: Ec2Module, client: Ec2Client): Promise<string> {
  const availabilityReply = await sendAwsRequest(
    'find an available zone',
    function describeZones() {
      return client.send(
        new ec2.DescribeAvailabilityZonesCommand({
          Filters: [{ Name: 'state', Values: ['available'] }],
        }),
      );
    },
  );
  let availabilityZones = availabilityReply.AvailabilityZones;

  if (availabilityZones == null) {
    availabilityZones = [];
  }

  const zoneName = availabilityZones.find(zoneHasName)?.ZoneName;

  if (zoneName != null) {
    return zoneName;
  }

  const message = 'No available Availability Zone found in this region.';

  throw awsFailure('find an available zone', message, message);
}

async function allocateHost(
  ec2: Ec2Module,
  client: Ec2Client,
  instanceType: string,
  availabilityZone: string,
): Promise<string> {
  let hostIds: string[] | null = null;

  try {
    const allocationReply = await sendAwsRequest(
      'allocate a Mac Dedicated Host',
      function allocate() {
        return client.send(
          new ec2.AllocateHostsCommand({
            AvailabilityZone: availabilityZone,
            InstanceType: instanceType,
            Quantity: 1,
            AutoPlacement: 'off',
          }),
        );
      },
    );
    const allocatedHostIds = allocationReply.HostIds;

    if (allocatedHostIds != null) {
      hostIds = allocatedHostIds;
    }
  } catch (cause) {
    const failureMessage = errorMessage(cause);

    const isQuotaFailure = isDedicatedHostQuotaFailure(failureMessage);

    if (isQuotaFailure) {
      const message =
        `AWS won't allocate a Mac Dedicated Host: ${failureMessage}\n` +
        'Mac hosts almost always need a quota increase first - run `launch-store cloud doctor` for the request link.';

      throw awsFailure('allocate a Mac Dedicated Host', cause, message);
    }

    throw cause;
  }

  const hostId = hostIds?.[0];

  if (hostId != null) {
    return hostId;
  }

  const message = 'AllocateHosts returned no host id.';

  throw awsFailure('allocate a Mac Dedicated Host', message, message);
}

async function ensureKeyPair(
  ec2: Ec2Module,
  client: Ec2Client,
): Promise<{ keyName: string; keyPath: string }> {
  const keyPath = join(LAUNCH_HOME, 'ec2-mac-key.pem');

  const keyExists = await pathExists(keyPath);

  if (keyExists) {
    return { keyName: KEY_NAME, keyPath };
  }

  try {
    await sendAwsRequest('delete an unusable EC2 key pair', function deleteKeyPair() {
      return client.send(new ec2.DeleteKeyPairCommand({ KeyName: KEY_NAME }));
    });
  } catch (cause) {
    const keyPairWasMissing = cause != null;

    if (keyPairWasMissing) {
      // Creating the pair below replaces one that was never stored.
    }
  }

  const keyPairReply = await sendAwsRequest('create an EC2 key pair', function createKeyPair() {
    return client.send(new ec2.CreateKeyPairCommand({ KeyName: KEY_NAME }));
  });

  if (keyPairReply.KeyMaterial == null) {
    const message = 'CreateKeyPair returned no private key material.';

    throw awsFailure('create an EC2 key pair', message, message);
  }

  await mkdir(LAUNCH_HOME, { recursive: true });
  await writeFile(keyPath, keyPairReply.KeyMaterial);
  await chmod(keyPath, 0o600);

  return { keyName: KEY_NAME, keyPath };
}

async function defaultSubnet(
  ec2: Ec2Module,
  client: Ec2Client,
  availabilityZone: string,
): Promise<{ subnetId: string; vpcId: string }> {
  const subnetReply = await sendAwsRequest('find the default subnet', function describeSubnets() {
    return client.send(
      new ec2.DescribeSubnetsCommand({
        Filters: [
          { Name: 'availability-zone', Values: [availabilityZone] },
          { Name: 'default-for-az', Values: ['true'] },
        ],
      }),
    );
  });
  const subnet = readDefaultSubnet(subnetReply.Subnets?.[0]);

  if (subnet != null) {
    return subnet;
  }

  const message = `No default subnet in ${availabilityZone}. Create one (or set a subnet) and retry.`;

  throw awsFailure('find the default subnet', message, message);
}

async function ensureSecurityGroup(
  ec2: Ec2Module,
  client: Ec2Client,
  vpcId: string,
): Promise<string> {
  const securityGroupCatalog = await sendAwsRequest(
    'find the SSH security group',
    function describeSecurityGroups() {
      return client.send(
        new ec2.DescribeSecurityGroupsCommand({
          Filters: [
            { Name: 'group-name', Values: [SG_NAME] },
            { Name: 'vpc-id', Values: [vpcId] },
          ],
        }),
      );
    },
  );
  const existingSecurityGroupId = securityGroupCatalog.SecurityGroups?.[0]?.GroupId;

  if (existingSecurityGroupId != null) {
    return existingSecurityGroupId;
  }

  const createdSecurityGroup = await sendAwsRequest(
    'create the SSH security group',
    function createSecurityGroup() {
      return client.send(
        new ec2.CreateSecurityGroupCommand({
          GroupName: SG_NAME,
          Description: 'Launch EC2 Mac SSH access',
          VpcId: vpcId,
        }),
      );
    },
  );
  const securityGroupId = createdSecurityGroup.GroupId;

  if (securityGroupId == null) {
    const message = 'CreateSecurityGroup returned no group id.';

    throw awsFailure('create the SSH security group', message, message);
  }

  await sendAwsRequest('authorize SSH ingress', function authorizeIngress() {
    return client.send(
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
    );
  });

  return securityGroupId;
}

async function latestMacosAmi(
  ec2: Ec2Module,
  client: Ec2Client,
  instanceType: string,
): Promise<string> {
  const architecture = macosArchitectureFor(instanceType);
  const imageCatalog = await sendAwsRequest(
    'find an Amazon macOS image',
    function describeImages() {
      return client.send(
        new ec2.DescribeImagesCommand({
          Owners: ['amazon'],
          Filters: [
            { Name: 'name', Values: ['amzn-ec2-macos-*'] },
            { Name: 'architecture', Values: [architecture] },
            { Name: 'state', Values: ['available'] },
          ],
        }),
      );
    },
  );
  let catalogImages = imageCatalog.Images;

  if (catalogImages == null) {
    catalogImages = [];
  }

  const newestImage = newestImageId(datedMacImages(catalogImages));

  if (newestImage != null) {
    return newestImage;
  }

  const message =
    'No Amazon macOS AMI found in this region. Set aws.amiId to a Mac image with Xcode.';

  throw awsFailure('find an Amazon macOS image', message, message);
}

async function runInstance(
  ec2: Ec2Module,
  client: Ec2Client,
  instanceOptions: LaunchedInstance,
): Promise<string> {
  const launchReply = await sendAwsRequest('launch the EC2 Mac instance', function launch() {
    return client.send(
      new ec2.RunInstancesCommand({
        ImageId: instanceOptions.imageId,
        InstanceType: instanceOptions.instanceType as _InstanceType,
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
    );
  });
  const instanceId = launchReply.Instances?.[0]?.InstanceId;

  if (instanceId != null) {
    return instanceId;
  }

  const message = 'RunInstances returned no instance id.';

  throw awsFailure('launch the EC2 Mac instance', message, message);
}

async function waitForSsh(
  ec2: Ec2Module,
  client: Ec2Client,
  instanceId: string,
  keyPath: string,
  reportProgress: (message: string) => void,
): Promise<SshTarget> {
  const deadline = Date.now() + sshBootTimeoutMs;
  let host: string | undefined;

  while (Date.now() < deadline) {
    const instanceCatalog = await sendAwsRequest(
      'poll the EC2 Mac boot state',
      function describeInstances() {
        return client.send(new ec2.DescribeInstancesCommand({ InstanceIds: [instanceId] }));
      },
    );
    const instanceDescription = instanceCatalog.Reservations?.[0]?.Instances?.[0];

    host = publicAddress(instanceDescription?.PublicDnsName, instanceDescription?.PublicIpAddress);

    const isReady = instanceIsReady(instanceDescription?.State?.Name, host);

    if (isReady) {
      break;
    }

    let instanceState = 'pending';

    if (instanceDescription?.State?.Name != null) {
      instanceState = instanceDescription.State.Name;
    }

    reportProgress(`Waiting for the instance to boot (state: ${instanceState})...`);
    await sleep(BOOT_POLL_MILLISECONDS);
  }

  if (host == null) {
    const message = 'Instance did not get a public address before the boot timeout.';

    throw awsFailure('wait for the EC2 Mac to boot', message, message);
  }

  const sshTarget: SshTarget = {
    host,
    user: 'ec2-user',
    port: 22,
    identityFile: keyPath,
  };

  while (Date.now() < deadline) {
    const isReachable = await sshReachable(sshTarget);

    if (isReachable) {
      return sshTarget;
    }

    reportProgress('Instance running; waiting for SSH to come up (EC2 Macs boot slowly)...');
    await sleep(BOOT_POLL_MILLISECONDS);
  }

  const message = 'SSH did not become reachable before the boot timeout.';

  throw awsFailure('wait for SSH', message, message);
}
function flatMapRequiredTool(requiredTool: {
  label: string;
  command: string;
  tier: 'required' | 'recommended';
  install: { kind: 'brew'; formula: string } | { kind: 'guide'; how: string };
}) {
  if (requiredTool.install.kind != 'brew') return [];

  return [
    `command -v ${requiredTool.command} >/dev/null || brew install ${requiredTool.install.formula} || true`,
  ];
}

const bootstrapBrewLines = AWS_BOOTSTRAP_TOOLS.flatMap(flatMapRequiredTool);

const bootstrapScript = [
  'set -e',
  'command -v brew >/dev/null || echo LAUNCH_NO_BREW',
  ...bootstrapBrewLines,
  'xcodebuild -version >/dev/null 2>&1 || echo LAUNCH_NO_XCODE',
].join('\n');

async function bootstrapToolchain(sshTarget: SshTarget): Promise<void> {
  const bootstrapOutput = await sshCapture(sshTarget, bootstrapScript);
  const isMissingXcode = bootstrapReportsMissingXcode(bootstrapOutput);

  if (isMissingXcode == false) {
    return;
  }

  const message =
    'The base AMI has no full Xcode (xcodebuild needs it). Provide a BYO golden AMI with Xcode preinstalled ' +
    "via aws.amiId - Xcode can't be redistributed in a shared image.";

  throw awsFailure('bootstrap the EC2 Mac toolchain', message, message);
}

async function snapshotGoldenAmi(
  ec2: Ec2Module,
  client: Ec2Client,
  instanceId: string,
): Promise<string> {
  const imageCreationReply = await sendAwsRequest('create the golden AMI', function createImage() {
    return client.send(
      new ec2.CreateImageCommand({
        InstanceId: instanceId,
        Name: `launch-golden-${instanceId}-${Date.now()}`,
      }),
    );
  });
  const amiId = imageCreationReply.ImageId;

  if (amiId == null) {
    const message = 'CreateImage returned no AMI id.';

    throw awsFailure('create the golden AMI', message, message);
  }

  const deadline = Date.now() + amiAvailableTimeoutMs;

  while (Date.now() < deadline) {
    const imageCatalog = await sendAwsRequest('wait for the golden AMI', function describeImage() {
      return client.send(new ec2.DescribeImagesCommand({ ImageIds: [amiId] }));
    });

    if (imageCatalog.Images?.[0]?.State == 'available') {
      return amiId;
    }

    await sleep(amiPollMilliseconds);
  }

  return amiId;
}

async function waitForTerminated(
  ec2: Ec2Module,
  client: Ec2Client,
  instanceId: string,
): Promise<void> {
  const deadline = Date.now() + terminateTimeoutMs;

  while (Date.now() < deadline) {
    const instanceCatalog = await sendAwsRequest(
      'wait for instance termination',
      function describeInstances() {
        return client.send(new ec2.DescribeInstancesCommand({ InstanceIds: [instanceId] }));
      },
    );

    if (instanceCatalog.Reservations?.[0]?.Instances?.[0]?.State?.Name == 'terminated') {
      return;
    }

    await sleep(terminatePollMilliseconds);
  }
}

async function releaseHostQuietly(
  ec2: Ec2Module,
  client: Ec2Client,
  hostId: string,
): Promise<void> {
  try {
    await sendAwsRequest('release a failed Dedicated Host allocation', function releaseHost() {
      return client.send(new ec2.ReleaseHostsCommand({ HostIds: [hostId] }));
    });
  } catch (cause) {
    const releaseFailed = cause != null;

    if (releaseFailed) {
      return;
    }
  }
}

type ProvisionRequest = Readonly<{
  ec2: Ec2Module;
  client: Ec2Client;
  awsConfiguration: AwsConfig;
  instanceType: string;
  hostId: string;
  availabilityZone: string;
  allocatedAt: string;
  reportProgress: (message: string) => void;
}>;

async function provisionAllocatedHost(provisionRequest: ProvisionRequest): Promise<HostHandle> {
  const {
    ec2,
    client,
    awsConfiguration,
    instanceType,
    hostId,
    availabilityZone,
    allocatedAt,
    reportProgress,
  } = provisionRequest;
  const keyPair = await ensureKeyPair(ec2, client);
  const { subnetId, vpcId } = await defaultSubnet(ec2, client, availabilityZone);
  const securityGroupId = await ensureSecurityGroup(ec2, client, vpcId);
  let goldenAmiId: string | null | undefined = awsConfiguration.amiId;

  if (goldenAmiId == null) {
    goldenAmiId = await getAwsGoldenAmiId();
  }

  const shouldCreateGoldenImage = goldenAmiId == null;
  let imageId = goldenAmiId;

  if (typeof imageId != 'string') {
    imageId = await latestMacosAmi(ec2, client, instanceType);
  }

  reportProgress('Launching the EC2 Mac instance...');

  const instanceId = await runInstance(ec2, client, {
    imageId,
    instanceType,
    hostId,
    keyName: keyPair.keyName,
    subnetId,
    securityGroupId,
  });
  const sshTarget = await waitForSsh(ec2, client, instanceId, keyPair.keyPath, reportProgress);

  if (shouldCreateGoldenImage) {
    reportProgress(
      'First run: bootstrapping the toolchain and snapshotting a golden AMI for next time...',
    );
    await bootstrapToolchain(sshTarget);

    const newGoldenAmiId = await snapshotGoldenAmi(ec2, client, instanceId);

    await setAwsGoldenAmiId(newGoldenAmiId);
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
}

async function runCloudDoctor(awsConfiguration: AwsConfig): Promise<CloudDoctorReport> {
  const cloudChecks: CloudCheck[] = [];
  const instanceType = configuredInstanceType(awsConfiguration);
  let ec2Pair: Ec2Pair;

  try {
    ec2Pair = await makeClient(awsConfiguration);
  } catch (cause) {
    return {
      ok: false,
      checks: [{ label: 'AWS SDK', ok: false, detail: errorMessage(cause) }],
    };
  }

  const { ec2, client } = ec2Pair;

  try {
    await sendAwsRequest('reach the configured AWS region', function describeZones() {
      return client.send(
        new ec2.DescribeAvailabilityZonesCommand({
          Filters: [{ Name: 'state', Values: ['available'] }],
        }),
      );
    });
  } catch (cause) {
    const failureMessage = errorMessage(cause);

    cloudChecks.push({
      label: 'AWS credentials + region',
      ok: false,
      detail: failureMessage,
    });

    return { ok: false, checks: cloudChecks };
  }

  cloudChecks.push({
    label: 'AWS credentials + region',
    ok: true,
    detail: `reachable in ${awsConfiguration.region}`,
  });

  try {
    const offeringReply = await sendAwsRequest(
      'check the EC2 Mac instance offering',
      function describeOfferings() {
        return client.send(
          new ec2.DescribeInstanceTypeOfferingsCommand({
            LocationType: 'region',
            Filters: [{ Name: 'instance-type', Values: [instanceType] }],
          }),
        );
      },
    );
    let instanceTypeOfferings = offeringReply.InstanceTypeOfferings;

    if (instanceTypeOfferings == null) {
      instanceTypeOfferings = [];
    }

    const instanceTypeIsAvailable = instanceTypeOfferings.length > 0;
    let offeringDetail = `NOT offered in ${awsConfiguration.region} - try another region`;

    if (instanceTypeIsAvailable) {
      offeringDetail = `offered in ${awsConfiguration.region}`;
    }

    cloudChecks.push({
      label: `${instanceType} availability`,
      ok: instanceTypeIsAvailable,
      detail: offeringDetail,
    });
  } catch (cause) {
    const failureMessage = errorMessage(cause);

    cloudChecks.push({
      label: `${instanceType} availability`,
      ok: false,
      detail: failureMessage,
    });
  }

  try {
    const hostReply = await sendAwsRequest(
      'inspect the Dedicated Host quota',
      function describeHosts() {
        return client.send(
          new ec2.DescribeHostsCommand({
            Filter: [{ Name: 'instance-type', Values: [instanceType] }],
          }),
        );
      },
    );
    let describedHosts = hostReply.Hosts;

    if (describedHosts == null) {
      describedHosts = [];
    }

    const liveHostCount = countLiveDedicatedHosts(describedHosts);

    cloudChecks.push({
      label: 'Dedicated Host quota',
      ok: true,
      detail: `${liveHostCount} ${instanceType} host(s) currently allocated. If AllocateHosts fails, request an increase in Service Quotas -> "Running Dedicated mac2 Hosts" (often not granted instantly).`,
    });
  } catch (cause) {
    const failureMessage = errorMessage(cause);

    cloudChecks.push({
      label: 'Dedicated Host quota',
      ok: false,
      detail: failureMessage,
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

  return { ok: cloudChecks.every(checkPassed), checks: cloudChecks };
}

function ignoreProgress(_message: string): void {}

export function makeAwsEc2MacComputeHost(): ComputeHost {
  return {
    name: 'aws-ec2-mac',
    doctor: runCloudDoctor,
    async allocate(allocationRequest: AllocateRequest) {
      const awsConfiguration = requireAws(allocationRequest);
      let reportProgress = ignoreProgress;

      if (allocationRequest.onProgress != null) {
        reportProgress = allocationRequest.onProgress;
      }

      const instanceType = configuredInstanceType(awsConfiguration);
      const { ec2, client } = await makeClient(awsConfiguration);
      const allocationConfirmed = await allocationRequest.confirm(awsAllocationConsentMessage());

      if (allocationConfirmed == false) {
        const message = 'Cancelled before allocating a cloud Mac.';

        throw awsFailure('confirm host allocation', message, message);
      }

      const availabilityZone = await firstAvailableZone(ec2, client);

      reportProgress(
        `Allocating a Dedicated Host (${instanceType}) in ${availabilityZone} - the 24h billing minimum starts now.`,
      );

      const hostId = await allocateHost(ec2, client, instanceType, availabilityZone);
      const allocatedAt = new Date().toISOString();

      try {
        return await provisionAllocatedHost({
          ec2,
          client,
          awsConfiguration,
          instanceType,
          hostId,
          availabilityZone,
          allocatedAt,
          reportProgress,
        });
      } catch (cause) {
        reportProgress('Allocation failed - releasing the Dedicated Host to stop billing.');
        await releaseHostQuietly(ec2, client, hostId);
        throw cause;
      }
    },
    async status(hostHandle: HostHandle) {
      if (hostHandle.region == null) {
        return null;
      }

      if (hostHandle.hostId == null) {
        return null;
      }

      const hostId = hostHandle.hostId;
      const { ec2, client } = await makeClient({ region: hostHandle.region });
      const hostDescription = await sendAwsRequest(
        'describe the Dedicated Host',
        function describeHosts() {
          return client.send(new ec2.DescribeHostsCommand({ HostIds: [hostId] }));
        },
      );
      const hostState = hostDescription.Hosts?.[0]?.State;

      if (hostIsReleasedOrMissing(hostState)) {
        return null;
      }

      const ageMs = Date.now() - new Date(hostHandle.allocatedAt).getTime();

      return {
        handle: hostHandle,
        ageMs,
        estimatedCostUsd: awsCostForDurationUsd(ageMs),
        releasableAt: awsHostReleasableAt(hostHandle.allocatedAt),
      };
    },
    async teardown(hostHandle: HostHandle) {
      if (hostHandle.region == null) {
        return;
      }

      const { ec2, client } = await makeClient({ region: hostHandle.region });

      if (hostHandle.instanceId != null) {
        const instanceId = hostHandle.instanceId;

        await sendAwsRequest('terminate the EC2 Mac instance', function terminate() {
          return client.send(new ec2.TerminateInstancesCommand({ InstanceIds: [instanceId] }));
        });
        await waitForTerminated(ec2, client, instanceId);
      }

      if (hostHandle.hostId == null) {
        return;
      }

      const hostId = hostHandle.hostId;
      const releaseReply = await sendAwsRequest(
        'release the Dedicated Host',
        function releaseHost() {
          return client.send(new ec2.ReleaseHostsCommand({ HostIds: [hostId] }));
        },
      );
      const failureDetail = releaseFailureDetail(releaseReply.Unsuccessful?.[0]);

      if (failureDetail == null) {
        return;
      }

      const message =
        `Could not release host ${hostId}: ${failureDetail}. ` +
        'AWS only allows release after the 24h minimum - it keeps billing until then.';

      throw awsFailure('release the Dedicated Host', message, message);
    },
  };
}

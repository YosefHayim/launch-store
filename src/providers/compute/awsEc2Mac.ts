/**
 * The `aws-ec2-mac` compute host — provisions a cloud Mac in YOUR OWN AWS account.
 *
 * Implements {@link ComputeHost} against EC2 Mac: allocate a Dedicated Host (the resource that bills,
 * with Apple's hard 24h minimum), launch a Mac instance on it, wait for SSH, and — first time only —
 * bootstrap the toolchain and snapshot a golden AMI into the user's account for fast reuse (decision 8).
 * Cost facts and the consent gate live in `core/cost.ts`; status/teardown make the 24h floor explicit.
 *
 * Launch stores NO AWS secrets (decision 4): credentials come from the standard SDK chain (env →
 * `~/.aws` → SSO → IMDS). The whole AWS SDK is an OPTIONAL dependency, dynamic-imported here so a
 * local-only Mac install never loads it. AWS-specific concerns are quarantined to this file; the
 * build itself runs through the host-agnostic SSH layer (`core/remoteBuild.ts`).
 */

import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AllocateRequest, AwsConfig, ComputeHost, HostHandle, HostStatus, SshTarget } from "../../core/types.js";
import { LAUNCH_HOME, ensureDir } from "../../core/paths.js";
import { consentMessage, costForDurationUsd, releasableAt } from "../../core/cost.js";
import { getAmiId, setAmiId } from "../../core/cloudState.js";
import { requireOptional } from "../../core/optionalDep.js";
import { REQUIRED_TOOLS } from "../../core/toolchain.js";
import { sshCapture, sshReachable } from "../../core/ssh.js";

import type { _InstanceType } from "@aws-sdk/client-ec2";

/** The optional AWS SDK module shapes; type-only so importing them stays erased + lazy. */
type Ec2Module = typeof import("@aws-sdk/client-ec2");
type CredModule = typeof import("@aws-sdk/credential-providers");
type Ec2Client = InstanceType<Ec2Module["EC2Client"]>;

const INSTALL_HINT = "npm install @aws-sdk/client-ec2 @aws-sdk/credential-providers";
/** Reused names so a second run finds the same key pair / security group instead of piling up resources. */
const KEY_NAME = "launch-ec2-mac";
const SG_NAME = "launch-ec2-mac-sg";
const DEFAULT_INSTANCE_TYPE = "mac2.metal";
/** Local home of the EC2 SSH private key (chmod 600). Not a credential the keychain stores — it's an infra key. */
const KEY_PATH = join(LAUNCH_HOME, "ec2-mac-key.pem");
/** EC2 Mac instances boot slowly (bare metal); give SSH a generous window. */
const SSH_BOOT_TIMEOUT_MS = 12 * 60 * 1000;
const AMI_AVAILABLE_TIMEOUT_MS = 30 * 60 * 1000;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Lazy-load the EC2 client module with an actionable hint if the optional package is absent. */
const loadEc2 = (): Promise<Ec2Module> =>
  requireOptional("AWS EC2 Mac builds", INSTALL_HINT, () => import("@aws-sdk/client-ec2"));

/** Lazy-load the credential-providers module (the standard AWS credential chain). */
const loadCreds = (): Promise<CredModule> =>
  requireOptional("AWS EC2 Mac builds", INSTALL_HINT, () => import("@aws-sdk/credential-providers"));

/** Construct an EC2 client for a region, resolving credentials via the standard chain (+ optional profile). */
async function makeClient(aws: Pick<AwsConfig, "region" | "profile">): Promise<{ ec2: Ec2Module; client: Ec2Client }> {
  const ec2 = await loadEc2();
  const credsMod = await loadCreds();
  const credentials = credsMod.fromNodeProviderChain(aws.profile ? { profile: aws.profile } : {});
  const client = new ec2.EC2Client({ region: aws.region, credentials });
  return { ec2, client };
}

function requireAws(request: AllocateRequest): AwsConfig {
  if (!request.aws) throw new Error("AWS settings missing — add an `aws: { region: ... }` block to launch.config.ts.");
  return request.aws;
}

/** Pick the first usable PublicDnsName/PublicIpAddress (both may be empty strings before assignment). */
function publicAddress(dns: string | undefined, ip: string | undefined): string | undefined {
  if (dns && dns.length > 0) return dns;
  if (ip && ip.length > 0) return ip;
  return undefined;
}

export const awsEc2MacComputeHost: ComputeHost = {
  name: "aws-ec2-mac",

  async allocate(request: AllocateRequest): Promise<HostHandle> {
    const aws = requireAws(request);
    const report = request.onProgress ?? ((): void => undefined);
    const instanceType = aws.instanceType ?? DEFAULT_INSTANCE_TYPE;
    const { ec2, client } = await makeClient(aws);

    if (!(await request.confirm(consentMessage()))) throw new Error("Cancelled before allocating a cloud Mac.");

    const az = await firstAvailableAz(ec2, client);
    report(`Allocating a Dedicated Host (${instanceType}) in ${az} — the 24h billing minimum starts now.`);
    const hostId = await allocateHost(ec2, client, instanceType, az);
    const allocatedAt = new Date().toISOString();

    try {
      const keyName = await ensureKeyPair(ec2, client);
      const { subnetId, vpcId } = await defaultSubnet(ec2, client, az);
      const sgId = await ensureSecurityGroup(ec2, client, vpcId);
      const goldenAmi = aws.amiId ?? getAmiId();
      const imageId = goldenAmi ?? (await latestMacosAmi(ec2, client, instanceType));

      report("Launching the EC2 Mac instance…");
      const instanceId = await runInstance(ec2, client, { imageId, instanceType, hostId, keyName, subnetId, sgId });
      const ssh = await waitForSsh(ec2, client, instanceId, report);

      if (!goldenAmi) {
        report("First run: bootstrapping the toolchain and snapshotting a golden AMI for next time…");
        await bootstrapToolchain(ssh);
        setAmiId(await snapshotGoldenAmi(ec2, client, instanceId));
      }

      return {
        provider: "aws-ec2-mac",
        ssh,
        allocatedAt,
        instanceId,
        hostId,
        region: aws.region,
        instanceType,
      };
    } catch (error) {
      // Never leave a freshly-allocated host billing after a failed launch — release it best-effort.
      report("Allocation failed — releasing the Dedicated Host to stop billing.");
      await releaseHostQuietly(ec2, client, hostId);
      throw error instanceof Error ? error : new Error(String(error));
    }
  },

  async status(handle: HostHandle): Promise<HostStatus | null> {
    if (!handle.region || !handle.hostId) return null;
    const { ec2, client } = await makeClient({ region: handle.region });
    const res = await client.send(new ec2.DescribeHostsCommand({ HostIds: [handle.hostId] }));
    const state = res.Hosts?.[0]?.State;
    if (!state || state.startsWith("released")) return null;
    const ageMs = Date.now() - new Date(handle.allocatedAt).getTime();
    return {
      handle,
      ageMs,
      estimatedCostUsd: costForDurationUsd(ageMs),
      releasableAt: releasableAt(handle.allocatedAt),
    };
  },

  async teardown(handle: HostHandle): Promise<void> {
    if (!handle.region) return;
    const { ec2, client } = await makeClient({ region: handle.region });
    if (handle.instanceId) {
      await client.send(new ec2.TerminateInstancesCommand({ InstanceIds: [handle.instanceId] }));
      await waitForTerminated(ec2, client, handle.instanceId);
    }
    if (handle.hostId) {
      const res = await client.send(new ec2.ReleaseHostsCommand({ HostIds: [handle.hostId] }));
      const failed = res.Unsuccessful?.[0];
      if (failed) {
        throw new Error(
          `Could not release host ${handle.hostId}: ${failed.Error?.Message ?? "unknown"}. ` +
            "AWS only allows release after the 24h minimum — it keeps billing until then.",
        );
      }
    }
  },
};

/** One `cloud doctor` probe result. */
export interface CloudCheck {
  label: string;
  ok: boolean;
  detail: string;
}

/** Aggregate `cloud doctor` result for the AWS path. */
export interface CloudDoctorResult {
  ok: boolean;
  checks: CloudCheck[];
}

/**
 * Diagnose readiness for AWS EC2 Mac builds without allocating anything: credentials + region reach,
 * whether the instance type is offered in the region, current Mac host allocation (a quota hint), and
 * the exact IAM actions Launch needs. Stops at the first hard failure (no creds → nothing else matters).
 */
export async function runCloudDoctor(aws: AwsConfig): Promise<CloudDoctorResult> {
  const checks: CloudCheck[] = [];
  const instanceType = aws.instanceType ?? DEFAULT_INSTANCE_TYPE;

  let ec2: Ec2Module;
  let client: Ec2Client;
  try {
    ({ ec2, client } = await makeClient(aws));
  } catch (error) {
    return { ok: false, checks: [{ label: "AWS SDK", ok: false, detail: errorMessage(error) }] };
  }

  try {
    await client.send(
      new ec2.DescribeAvailabilityZonesCommand({ Filters: [{ Name: "state", Values: ["available"] }] }),
    );
    checks.push({ label: "AWS credentials + region", ok: true, detail: `reachable in ${aws.region}` });
  } catch (error) {
    checks.push({ label: "AWS credentials + region", ok: false, detail: errorMessage(error) });
    return { ok: false, checks };
  }

  try {
    const offered = await client.send(
      new ec2.DescribeInstanceTypeOfferingsCommand({
        LocationType: "region",
        Filters: [{ Name: "instance-type", Values: [instanceType] }],
      }),
    );
    const available = (offered.InstanceTypeOfferings ?? []).length > 0;
    checks.push({
      label: `${instanceType} availability`,
      ok: available,
      detail: available ? `offered in ${aws.region}` : `NOT offered in ${aws.region} — try another region`,
    });
  } catch (error) {
    checks.push({ label: `${instanceType} availability`, ok: false, detail: errorMessage(error) });
  }

  try {
    const hosts = await client.send(
      new ec2.DescribeHostsCommand({ Filter: [{ Name: "instance-type", Values: [instanceType] }] }),
    );
    const live = (hosts.Hosts ?? []).filter((host) => host.State && !host.State.startsWith("released")).length;
    checks.push({
      label: "Dedicated Host quota",
      ok: true,
      detail: `${live} ${instanceType} host(s) currently allocated. If AllocateHosts fails, request an increase in Service Quotas → "Running Dedicated mac2 Hosts" (often not granted instantly).`,
    });
  } catch (error) {
    checks.push({ label: "Dedicated Host quota", ok: false, detail: errorMessage(error) });
  }

  checks.push({
    label: "IAM actions needed",
    ok: true,
    detail:
      "ec2: AllocateHosts, ReleaseHosts, DescribeHosts, RunInstances, DescribeInstances, TerminateInstances, " +
      "CreateKeyPair, DeleteKeyPair, CreateSecurityGroup, DescribeSecurityGroups, AuthorizeSecurityGroupIngress, " +
      "DescribeImages, CreateImage, DescribeSubnets, DescribeAvailabilityZones, DescribeInstanceTypeOfferings.",
  });

  return { ok: checks.every((check) => check.ok), checks };
}

/** Narrow an unknown thrown value to a message string. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** First Availability Zone in `available` state (EC2 Mac host + subnet must share an AZ). */
async function firstAvailableAz(ec2: Ec2Module, client: Ec2Client): Promise<string> {
  const res = await client.send(
    new ec2.DescribeAvailabilityZonesCommand({ Filters: [{ Name: "state", Values: ["available"] }] }),
  );
  const zone = (res.AvailabilityZones ?? []).find((z) => z.ZoneName)?.ZoneName;
  if (!zone) throw new Error("No available Availability Zone found in this region.");
  return zone;
}

/** Allocate one Mac Dedicated Host, translating AWS's quota errors into the `cloud doctor` guidance. */
async function allocateHost(ec2: Ec2Module, client: Ec2Client, instanceType: string, az: string): Promise<string> {
  try {
    const res = await client.send(
      new ec2.AllocateHostsCommand({
        AvailabilityZone: az,
        InstanceType: instanceType,
        Quantity: 1,
        AutoPlacement: "off",
      }),
    );
    const id = res.HostIds?.[0];
    if (!id) throw new Error("AllocateHosts returned no host id.");
    return id;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/quota|limit|exceeded|insufficient/i.test(message)) {
      throw new Error(
        `AWS won't allocate a Mac Dedicated Host: ${message}\n` +
          "Mac hosts almost always need a quota increase first — run `launch cloud doctor` for the request link.",
      );
    }
    throw error instanceof Error ? error : new Error(message);
  }
}

/** Ensure a reusable SSH key pair, persisting the private key locally (the only copy AWS ever returns). */
async function ensureKeyPair(ec2: Ec2Module, client: Ec2Client): Promise<string> {
  if (existsSync(KEY_PATH)) return KEY_NAME;
  // We lack the local PEM, so a same-named AWS key (if any) is unusable — drop and recreate it.
  try {
    await client.send(new ec2.DeleteKeyPairCommand({ KeyName: KEY_NAME }));
  } catch {
    /* none existed */
  }
  const res = await client.send(new ec2.CreateKeyPairCommand({ KeyName: KEY_NAME }));
  if (!res.KeyMaterial) throw new Error("CreateKeyPair returned no private key material.");
  ensureDir(LAUNCH_HOME);
  writeFileSync(KEY_PATH, res.KeyMaterial);
  chmodSync(KEY_PATH, 0o600);
  return KEY_NAME;
}

/** Find the default subnet in an AZ (so the instance gets a public IP) and its VPC. */
async function defaultSubnet(
  ec2: Ec2Module,
  client: Ec2Client,
  az: string,
): Promise<{ subnetId: string; vpcId: string }> {
  const res = await client.send(
    new ec2.DescribeSubnetsCommand({
      Filters: [
        { Name: "availability-zone", Values: [az] },
        { Name: "default-for-az", Values: ["true"] },
      ],
    }),
  );
  const subnet = res.Subnets?.[0];
  if (!subnet?.SubnetId || !subnet.VpcId) {
    throw new Error(`No default subnet in ${az}. Create one (or set a subnet) and retry.`);
  }
  return { subnetId: subnet.SubnetId, vpcId: subnet.VpcId };
}

/**
 * Ensure a security group allowing inbound SSH. Opens 22 from anywhere; access is still key-only
 * (BatchMode), but a security-minded user can tighten the CIDR to their IP afterwards.
 */
async function ensureSecurityGroup(ec2: Ec2Module, client: Ec2Client, vpcId: string): Promise<string> {
  const existing = await client.send(
    new ec2.DescribeSecurityGroupsCommand({
      Filters: [
        { Name: "group-name", Values: [SG_NAME] },
        { Name: "vpc-id", Values: [vpcId] },
      ],
    }),
  );
  const found = existing.SecurityGroups?.[0]?.GroupId;
  if (found) return found;
  const created = await client.send(
    new ec2.CreateSecurityGroupCommand({ GroupName: SG_NAME, Description: "Launch EC2 Mac SSH access", VpcId: vpcId }),
  );
  const sgId = created.GroupId;
  if (!sgId) throw new Error("CreateSecurityGroup returned no group id.");
  await client.send(
    new ec2.AuthorizeSecurityGroupIngressCommand({
      GroupId: sgId,
      IpPermissions: [
        {
          IpProtocol: "tcp",
          FromPort: 22,
          ToPort: 22,
          IpRanges: [{ CidrIp: "0.0.0.0/0", Description: "SSH (key-only; tighten to your IP if you like)" }],
        },
      ],
    }),
  );
  return sgId;
}

/** Newest Amazon-published macOS AMI matching the instance's architecture, when no golden AMI exists. */
async function latestMacosAmi(ec2: Ec2Module, client: Ec2Client, instanceType: string): Promise<string> {
  const architecture = instanceType.startsWith("mac2") ? "arm64_mac" : "x86_64_mac";
  const res = await client.send(
    new ec2.DescribeImagesCommand({
      Owners: ["amazon"],
      Filters: [
        { Name: "name", Values: ["amzn-ec2-macos-*"] },
        { Name: "architecture", Values: [architecture] },
        { Name: "state", Values: ["available"] },
      ],
    }),
  );
  const images = (res.Images ?? []).flatMap((image) =>
    image.ImageId && image.CreationDate ? [{ id: image.ImageId, date: image.CreationDate }] : [],
  );
  images.sort((a, b) => (a.date < b.date ? 1 : -1));
  const newest = images[0];
  if (!newest) throw new Error("No Amazon macOS AMI found in this region. Set aws.amiId to a Mac image with Xcode.");
  return newest.id;
}

interface RunInstanceOptions {
  imageId: string;
  instanceType: string;
  hostId: string;
  keyName: string;
  subnetId: string;
  sgId: string;
}

/** Launch one Mac instance pinned to the Dedicated Host, on a public subnet reachable over SSH. */
async function runInstance(ec2: Ec2Module, client: Ec2Client, opts: RunInstanceOptions): Promise<string> {
  const res = await client.send(
    new ec2.RunInstancesCommand({
      ImageId: opts.imageId,
      // Config supplies a free-form string; the run API wants the instance-type enum.
      InstanceType: opts.instanceType as _InstanceType,
      MinCount: 1,
      MaxCount: 1,
      KeyName: opts.keyName,
      Placement: { Tenancy: "host", HostId: opts.hostId },
      NetworkInterfaces: [
        { DeviceIndex: 0, AssociatePublicIpAddress: true, SubnetId: opts.subnetId, Groups: [opts.sgId] },
      ],
      TagSpecifications: [
        {
          ResourceType: "instance",
          Tags: [
            { Key: "Name", Value: "launch-ec2-mac" },
            { Key: "managed-by", Value: "launch" },
          ],
        },
      ],
    }),
  );
  const id = res.Instances?.[0]?.InstanceId;
  if (!id) throw new Error("RunInstances returned no instance id.");
  return id;
}

/** Wait for the instance to be running with a public address, then for sshd to accept connections. */
async function waitForSsh(
  ec2: Ec2Module,
  client: Ec2Client,
  instanceId: string,
  report: (message: string) => void,
): Promise<SshTarget> {
  const deadline = Date.now() + SSH_BOOT_TIMEOUT_MS;
  let host: string | undefined;
  while (Date.now() < deadline) {
    const res = await client.send(new ec2.DescribeInstancesCommand({ InstanceIds: [instanceId] }));
    const instance = res.Reservations?.[0]?.Instances?.[0];
    host = publicAddress(instance?.PublicDnsName, instance?.PublicIpAddress);
    if (instance?.State?.Name === "running" && host) break;
    report(`Waiting for the instance to boot (state: ${instance?.State?.Name ?? "pending"})…`);
    await delay(15000);
  }
  if (!host) throw new Error("Instance did not get a public address before the boot timeout.");

  const target: SshTarget = { host, user: "ec2-user", port: 22, identityFile: KEY_PATH };
  while (Date.now() < deadline) {
    if (await sshReachable(target)) return target;
    report("Instance running; waiting for SSH to come up (EC2 Macs boot slowly)…");
    await delay(15000);
  }
  throw new Error("SSH did not become reachable before the boot timeout.");
}

/**
 * The brew-able half of the canonical {@link REQUIRED_TOOLS}, so a golden AMI is bootstrapped with the
 * SAME toolchain the per-build doctor checks for — not a hand-maintained subset that drifts. fastlane
 * keeps its `gem install` fallback for the rare host where the formula is unavailable.
 */
const BOOTSTRAP_BREW_LINES = REQUIRED_TOOLS.flatMap((tool) => {
  if (tool.install.kind !== "brew") return [];
  const fallback = tool.command === "fastlane" ? " || sudo gem install fastlane" : "";
  return [`command -v ${tool.command} >/dev/null || brew install ${tool.install.formula}${fallback} || true`];
});

/** Toolchain bootstrap script run once on a base AMI before snapshotting a golden image. */
const BOOTSTRAP_SCRIPT = [
  "set -e",
  "command -v brew >/dev/null || echo LAUNCH_NO_BREW",
  ...BOOTSTRAP_BREW_LINES,
  "xcodebuild -version >/dev/null 2>&1 || echo LAUNCH_NO_XCODE",
].join("\n");

/** Install the brew-able toolchain and assert full Xcode is present (the one part Launch can't legally redistribute). */
async function bootstrapToolchain(ssh: SshTarget): Promise<void> {
  const output = await sshCapture(ssh, BOOTSTRAP_SCRIPT);
  if (output.includes("LAUNCH_NO_XCODE")) {
    throw new Error(
      "The base AMI has no full Xcode (gym needs it). Provide a BYO golden AMI with Xcode preinstalled " +
        "via aws.amiId — Xcode can't be redistributed in a shared image.",
    );
  }
}

/** Snapshot the bootstrapped instance into a golden AMI in the user's account; returns its id once created. */
async function snapshotGoldenAmi(ec2: Ec2Module, client: Ec2Client, instanceId: string): Promise<string> {
  const res = await client.send(
    new ec2.CreateImageCommand({ InstanceId: instanceId, Name: `launch-golden-${instanceId}-${Date.now()}` }),
  );
  const amiId = res.ImageId;
  if (!amiId) throw new Error("CreateImage returned no AMI id.");
  const deadline = Date.now() + AMI_AVAILABLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const described = await client.send(new ec2.DescribeImagesCommand({ ImageIds: [amiId] }));
    if (described.Images?.[0]?.State === "available") return amiId;
    await delay(20000);
  }
  // Persist it anyway; a still-pending AMI will be available by the next session.
  return amiId;
}

/** Poll until the instance is fully terminated (so releasing the host succeeds). */
async function waitForTerminated(ec2: Ec2Module, client: Ec2Client, instanceId: string): Promise<void> {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const res = await client.send(new ec2.DescribeInstancesCommand({ InstanceIds: [instanceId] }));
    if (res.Reservations?.[0]?.Instances?.[0]?.State?.Name === "terminated") return;
    await delay(10000);
  }
}

/** Release a host, swallowing errors — used on the failure path where we must not block on cleanup. */
async function releaseHostQuietly(ec2: Ec2Module, client: Ec2Client, hostId: string): Promise<void> {
  try {
    await client.send(new ec2.ReleaseHostsCommand({ HostIds: [hostId] }));
  } catch {
    /* best-effort: the 24h minimum may block release; cloud status/teardown will surface it */
  }
}

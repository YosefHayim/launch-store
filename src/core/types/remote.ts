/**
 * Remote-host (off-Mac build) vocabulary: SSH/AWS targets, the host handle & status a {@link ComputeHost}
 * tracks, and the {@link AllocateRequest} it fulfils when standing a builder up.
 */

import { z } from 'zod';

/**
 * The operating-system family Launch is running on.
 *
 * iOS code signing is macOS-only, so a `windows`/`linux` host cannot build locally — it must drive
 * a remote Mac (AWS EC2 Mac or a reachable Mac over SSH) or hand off to Expo EAS. The no-args wizard
 * branches on this value.
 */
export type HostOs = 'macos' | 'windows' | 'linux';

/**
 * A shell Launch can emit tab-completion for.
 *
 * The three POSIX-family shells with the install-base to matter for a developer CLI: `bash` and `zsh`
 * (the macOS/Linux defaults) plus `fish`. PowerShell is intentionally out of scope — the iOS/Android
 * toolchains Launch drives are macOS/Linux-first. Drives both `launch completion <shell>` (which prints
 * the script) and `launch completion install` (which wires it into the shell's rc file); see
 * `core/completion.ts`.
 */
export type Shell = 'bash' | 'zsh' | 'fish';

/**
 * SSH connection parameters for reaching a remote Mac.
 *
 * Filled by a {@link ComputeHost}: `aws-ec2-mac` from a freshly-provisioned instance, `byo-ssh` from
 * a user-supplied `user@host` string. Consumed by the SSH transport helpers in `core/ssh.ts`.
 */
export interface SshTarget {
  /** Hostname or IP of the remote Mac. */
  host: string;
  /** SSH login user (EC2 Mac AMIs default to `ec2-user`). */
  user: string;
  /** SSH port. Defaults to 22. */
  port: number;
  /** Absolute path to the private key to authenticate with; omit to use the SSH agent / default key. */
  identityFile?: string;
}

/**
 * A handle to an allocated (or connected) remote Mac.
 *
 * Persisted to `~/.launch/cloud.json` so a later command can reuse the live paid-window host, show
 * accrued cost, and release it. For `byo-ssh` the AWS fields are absent — there is nothing to bill or
 * release; Launch only borrows the connection.
 */
export interface HostHandle {
  /** Registry name of the {@link ComputeHost} that owns this handle (e.g. `aws-ec2-mac`). */
  provider: string;
  /** SSH parameters to reach the host. */
  ssh: SshTarget;
  /** ISO-8601 instant the host was allocated — the 24h Apple-license billing clock starts here. */
  allocatedAt: string;
  /** EC2 instance id (`i-…`). Absent for `byo-ssh`. */
  instanceId?: string;
  /** EC2 Dedicated Host id (`h-…`) — the resource that bills until released. Absent for `byo-ssh`. */
  hostId?: string;
  /** AWS region the host lives in. Absent for `byo-ssh`. */
  region?: string;
  /** EC2 instance type (e.g. `mac2.metal`). Absent for `byo-ssh`. */
  instanceType?: string;
}

/**
 * A live host's status, for `launch cloud status` and the per-command cost banner.
 *
 * `estimatedCostUsd` is what has accrued so far under AWS's per-second billing; the real floor is
 * the 24h minimum (see `core/cost.ts`). `releasableAt` is when AWS first allows releasing the
 * Dedicated Host with no further commitment.
 */
export interface HostStatus {
  handle: HostHandle;
  /** Milliseconds since `allocatedAt`. */
  ageMs: number;
  /** Accrued cost so far in USD (informational; the 24h minimum is the real floor). */
  estimatedCostUsd: number;
  /** ISO-8601 instant the Dedicated Host can first be released (allocatedAt + 24h). */
  releasableAt: string;
}

/**
 * AWS settings for the EC2 Mac compute host, declared in `launch.config.ts` under `aws` — see
 * {@link AwsConfigSchema}. Launch stores NO AWS secrets: credentials resolve through the standard SDK
 * chain (env → `~/.aws` profiles → SSO → IMDS).
 */
export const AwsConfigSchema = z
  .strictObject({
    region: z.string().describe('AWS region to allocate the Dedicated Host in (e.g. `us-east-1`).'),
    profile: z
      .string()
      .describe(
        'Named profile in `~/.aws` to resolve via the credential chain. Omit to use the default chain.',
      )
      .optional(),
    amiId: z
      .string()
      .describe(
        'BYO golden AMI id. Omit to bootstrap + snapshot one into your own account on first use.',
      )
      .optional(),
    instanceType: z
      .string()
      .describe(
        'EC2 Mac instance type. Defaults to `mac2.metal` (cheapest M-series in most regions).',
      )
      .optional(),
  })
  .meta({
    id: 'AwsConfig',
    description:
      'AWS settings for the EC2 Mac compute host, declared in `launch.config.ts` under `aws`. Launch stores NO AWS secrets: credentials resolve through the standard SDK chain (env → `~/.aws` profiles → SSO → IMDS). `amiId` is an optional BYO golden image; omit it to let Launch bootstrap one and persist its id to `~/.launch/cloud.json`.',
  });

/** AWS settings for the EC2 Mac compute host — the inferred shape of {@link AwsConfigSchema}. */
export type AwsConfig = z.infer<typeof AwsConfigSchema>;

/**
 * Where a remote build should run, resolved from `--remote [aws|user@host]` or the wizard.
 * - `aws`: provision an EC2 Mac via the `aws-ec2-mac` {@link ComputeHost}.
 * - `ssh`: connect to an already-reachable Mac via the `byo-ssh` {@link ComputeHost}.
 */
export type RemoteTarget = { kind: 'aws' } | { kind: 'ssh'; target: string };

/**
 * Request passed to {@link ComputeHost.allocate}.
 *
 * Carries everything a host backend needs to provision without depending on the logger or the
 * pipeline: AWS settings for `aws-ec2-mac`, an `user@host` string for `byo-ssh`, a consent gate for
 * the first billable action, and an optional progress sink. Reuse of a live host is handled by the
 * caller (`core/remotePipeline.ts`), so `allocate` always provisions fresh.
 */
export interface AllocateRequest {
  /** AWS settings (region/instanceType/amiId). Required by `aws-ec2-mac`, ignored by `byo-ssh`. */
  aws?: AwsConfig;
  /** `user@host[:port]` for `byo-ssh`. Ignored by `aws-ec2-mac`. */
  sshTarget?: string;
  /** Gate the first billable action; return false to abort allocation. */
  confirm(message: string): Promise<boolean>;
  /** Optional progress sink for long provisioning steps (booting, bootstrapping Xcode, snapshotting). */
  onProgress?: (message: string) => void;
}

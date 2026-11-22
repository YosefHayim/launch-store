/**
 * The operating-system family Launch is running on.
 *
 * iOS code signing is macOS-only, so a `windows`/`linux` host cannot build locally - it must drive
 * a remote Mac (AWS EC2 Mac or a reachable Mac over SSH) or hand off to Expo EAS. Build
 * routing branches on this value.
 */
export type HostOs = 'macos' | 'windows' | 'linux';
/**
 * A shell Launch can emit tab-completion for.
 *
 * The three POSIX-family shells with the install-base to matter for a developer CLI: `bash` and `zsh`
 * (the macOS/Linux defaults) plus `fish`. PowerShell is intentionally out of scope - the iOS/Android
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
export type SshTarget = Readonly<{
  host: string;
  user: string;
  port: number;
  identityFile?: string;
}>;
/**
 * A handle to an allocated (or connected) remote Mac.
 *
 * Persisted to `~/.launch/cloud.json` so a later command can reuse the live paid-window host, show
 * accrued cost, and release it. For `byo-ssh` the AWS fields are absent - there is nothing to bill or
 * release; Launch only borrows the connection.
 */
export type HostHandle = Readonly<{
  provider: string;
  ssh: SshTarget;
  allocatedAt: string;
  instanceId?: string;
  hostId?: string;
  region?: string;
  instanceType?: string;
}>;
/**
 * A live host's status, for `launch cloud status` and the per-command cost banner.
 *
 * `estimatedCostUsd` is what has accrued so far under AWS's per-second billing; the real floor is
 * the 24h minimum (see `core/cost.ts`). `releasableAt` is when AWS first allows releasing the
 * Dedicated Host with no further commitment.
 */
export type HostStatus = Readonly<{
  handle: HostHandle;
  ageMs: number;
  estimatedCostUsd: number;
  releasableAt: string;
}>;
/**
 * AWS settings for a remote Mac, under `aws` in launch.config.ts.
 * No AWS secret belongs here. The AWS SDK reads credentials from its usual chain.
 */
export type AwsConfig = {
  /**
   * Region the Mac is started in, such as `us-east-1`.
   * `launch cloud` and `launch build ios --remote aws` use this.
   */
  readonly region: string;
  /**
   * Named profile in ~/.aws to use.
   * Leave it out to use the default credential chain.
   */
  readonly profile?: string;
  /**
   * AMI id of a Mac image you already built.
   * Leave it out and the first run builds a snapshot in your own account and reuses it later.
   */
  readonly amiId?: string;
  /**
   * EC2 Mac machine size.
   * Leave it out to use `mac2.metal`, the cheapest M-series size in most regions.
   */
  readonly instanceType?: string;
};

/** One read-only AWS readiness probe shown by `launch cloud doctor`. */
export type CloudCheck = Readonly<{
  label: string;
  ok: boolean;
  detail: string;
}>;

/** Aggregate AWS readiness state returned without allocating billable infrastructure. */
export type CloudDoctorReport = Readonly<{
  ok: boolean;
  checks: readonly CloudCheck[];
}>;
/**
 * Where a remote build should run, resolved from `--remote [aws|user@host]`.
 * - `aws`: provision an EC2 Mac via the `aws-ec2-mac` {@link ComputeHost}.
 * - `ssh`: connect to an already-reachable Mac via the `byo-ssh` {@link ComputeHost}.
 */
export type RemoteTarget =
  | Readonly<{
      kind: 'aws';
    }>
  | Readonly<{
      kind: 'ssh';
      target: string;
    }>;
/**
 * Request passed to {@link ComputeHost.allocate}.
 *
 * Carries everything a host backend needs to provision without depending on the logger or the
 * pipeline: AWS settings for `aws-ec2-mac`, an `user@host` string for `byo-ssh`, a consent gate for
 * the first billable action, and an optional progress sink. Reuse of a live host is handled by the
 * caller (`core/remote-pipeline.ts`), so `allocate` always provisions fresh.
 */
export type AllocateRequest = Readonly<{
  aws?: AwsConfig;
  sshTarget?: string;
  confirm(message: string): Promise<boolean>;
  onProgress?: (message: string) => void;
}>;

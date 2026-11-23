// Holds the local host, shell names, and a remote Mac that Launch can build on.

/** The operating-system family Launch is running on. */
export type HostOs = 'macos' | 'windows' | 'linux';

/** A shell Launch can emit tab-completion for. */
export type Shell = 'bash' | 'zsh' | 'fish';

/** SSH connection parameters for reaching a remote Mac. */
export type SshTarget = Readonly<{
  host: string;
  user: string;
  port: number;
  identityFile?: string;
}>;

/** A handle to an allocated (or connected) remote Mac. */
export type HostHandle = Readonly<{
  provider: string;
  ssh: SshTarget;
  allocatedAt: string;
  instanceId?: string;
  hostId?: string;
  region?: string;
  instanceType?: string;
}>;

/** A live host's status, for `launch-store cloud status` and the per-command cost banner. */
export type HostStatus = Readonly<{
  handle: HostHandle;
  ageMs: number;
  estimatedCostUsd: number;
  releasableAt: string;
}>;

/** AWS settings for a remote Mac, under `aws` in launch.config.ts. */
export type AwsConfig = {
  /** Region the Mac is started in, such as `us-east-1`. */
  readonly region: string;
  /** Named profile in ~/.aws to use. */
  readonly profile?: string;
  /** AMI id of a Mac image you already built. */
  readonly amiId?: string;
  /** EC2 Mac machine size. */
  readonly instanceType?: string;
};

/** One read-only AWS readiness probe shown by `launch-store cloud doctor`. */
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

/** Where a remote build should run, resolved from `--remote [aws|user@host]`. */
export type RemoteTarget =
  | Readonly<{
      kind: 'aws';
    }>
  | Readonly<{
      kind: 'ssh';
      target: string;
    }>;

/** Request passed to {@link ComputeHost.allocate}. */
export type AllocateRequest = Readonly<{
  aws?: AwsConfig;
  sshTarget?: string;

  confirm(message: string): Promise<boolean>;

  onProgress?: (message: string) => void;
}>;

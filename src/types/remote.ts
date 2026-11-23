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

/** Whether a remembered remote Mac is still reachable. */
export type HostStatus = Readonly<{
  handle: HostHandle;
  ageMs: number;
}>;

/** Where a remote iOS build runs. Pass `--remote user@host`. */
export type RemoteTarget = Readonly<{
  kind: 'ssh';
  target: string;
}>;

/** Request passed to {@link ComputeHost.allocate}. */
export type AllocateRequest = Readonly<{
  sshTarget?: string;

  confirm(message: string): Promise<boolean>;

  onProgress?: (message: string) => void;
}>;

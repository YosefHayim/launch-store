export type LaunchClaim = Readonly<{ commandLine: string; runId: string }>;
export type RunningLaunch = LaunchClaim | null;

declare module 'claude-code' {
  interface PluginState {
    'launch-store': { run: RunningLaunch };
  }
}

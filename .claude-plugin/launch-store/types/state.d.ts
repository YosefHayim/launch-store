export type RunningLaunch = string | null;

declare module 'claude-code' {
  interface PluginState {
    'launch-store': { run: RunningLaunch };
  }
}

// The engine types an MCP tool only for a session that had it, so the mod's own tools are declared here too.
type Platform = 'ios' | 'android' | 'tvos' | 'macos' | 'visionos';

declare module 'claude-code' {
  interface McpToolInputs {
    'mcp__launch-store__build': {
      platform: Platform;
      profile?: string;
      app?: string;
      dryRun?: boolean;
      submit?: boolean;
    };
    'mcp__launch-store__release': {
      platform: Platform;
      profile?: string;
      app?: string;
      dryRun?: boolean;
      rollout?: number;
      build?: string;
      upload?: boolean;
    };
    'mcp__launch-store__status': { app?: string };
    'mcp__launch-store__plan': { surface?: string; app?: string };
    'mcp__launch-store__doctor': { platform?: Platform; app?: string };
  }
}

export {};

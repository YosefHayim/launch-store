import { cpus, platform as readNodePlatform, totalmem } from 'node:os';
import type { HostOs } from '@/types/remote.js';

type HostResources = Readonly<{
  cores: number;
  memoryBytes: number;
}>;

export function readHostResources(): HostResources {
  return {
    cores: cpus().length,
    memoryBytes: totalmem(),
  };
}

export function detectHostOperatingSystem(): HostOs {
  switch (readNodePlatform()) {
    case 'darwin':
      return 'macos';
    case 'win32':
      return 'windows';
    default:
      return 'linux';
  }
}

export function checkIsMacOperatingSystem(): boolean {
  return detectHostOperatingSystem() == 'macos';
}

export function resolveHostOperatingSystemLabel(): string {
  switch (detectHostOperatingSystem()) {
    case 'macos':
      return 'macOS';
    case 'windows':
      return 'Windows';
    case 'linux':
      return 'Linux';
  }
}

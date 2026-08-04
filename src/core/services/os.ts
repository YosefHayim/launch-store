import { Effect } from 'effect';
import { cpus, platform as readNodePlatform, totalmem } from 'node:os';
import type { HostOs } from '../types/remote.js';
/**
 * The host's compile-relevant resources: logical-core count and total RAM. The build-parallelism
 * cap ({@link import("../build/buildFlags.js").computeParallelJobLimit}) reads this single source rather
 * than reaching into `node:os`.
 *
 * @returns An Effect containing logical cores and total memory bytes.
 */
export const readHostResources = Effect.sync(() => ({
  cores: cpus().length,
  memoryBytes: totalmem(),
}));
/**
 * Resolve the current {@link HostOs} from Node's platform string.
 * Anything non-darwin/win32 is treated as linux.
 *
 * @returns An Effect containing Launch's normalized host OS.
 */
export const detectHostOperatingSystem = Effect.sync((): HostOs => {
  switch (readNodePlatform()) {
    case 'darwin':
      return 'macos';
    case 'win32':
      return 'windows';
    default:
      return 'linux';
  }
});
/** An Effect that reports whether Launch can sign and build Apple targets locally. */
export const checkIsMacOperatingSystem = Effect.map(
  detectHostOperatingSystem,
  (operatingSystem) => operatingSystem === 'macos',
);
/** An Effect containing the short host-OS label used in terminal copy. */
export const resolveHostOperatingSystemLabel = Effect.map(
  detectHostOperatingSystem,
  (operatingSystem): string => {
    switch (operatingSystem) {
      case 'macos':
        return 'macOS';
      case 'windows':
        return 'Windows';
      case 'linux':
        return 'Linux';
    }
  },
);

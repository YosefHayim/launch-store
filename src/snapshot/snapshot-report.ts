import type { Logger } from '../services/platform/logger.ts';
import { completeCommand } from '../terminal/command-exit.ts';
import type { SnapshotStore } from '../types/snapshot.ts';

export const SNAPSHOT_STORES: readonly SnapshotStore[] = ['appstore', 'play'];

export function storeLabel(snapshotStore: SnapshotStore): string {
  if (snapshotStore == 'appstore') {
    return 'App Store';
  }

  return 'Google Play';
}

export function reportMissingSnapshot(logger: Logger, snapshotName: string): void {
  logger.error(`No snapshot named "${snapshotName}".`);
  logger.tip('run `launch snapshot list` to see saved snapshots');
  completeCommand(1);
}

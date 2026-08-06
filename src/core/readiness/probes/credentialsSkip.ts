import type { ProbeResult } from '@core/types/readiness.js';

/** No apps in scope for this store - drop the probe from the report. */
export const OMITTED_PROBE = { state: 'omitted' } as const satisfies ProbeResult;

/** Apple probes share one skip when ASC credentials are missing. */
export const SKIPPED_NO_APPLE_ACCOUNT = {
  state: 'skipped',
  reason: 'no active Apple account',
  hint: 'run `launch creds set-key`',
} as const satisfies ProbeResult;

/** Play probes share one skip when the service account is missing. */
export const SKIPPED_NO_PLAY_ACCOUNT = {
  state: 'skipped',
  reason: 'no Play service account',
  hint: 'configure a Play service account',
} as const satisfies ProbeResult;

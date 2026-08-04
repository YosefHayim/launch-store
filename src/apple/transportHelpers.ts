export type AppleTransportRetryPolicy = {
  readonly attempts?: number;
  readonly baseDelayMs?: number;
  readonly maximumDelayMs?: number;
  readonly isRetryableFailure: (transportFailure: unknown) => boolean;
};

export const retryAppleTransportRequest = async <TransportResponse>(
  requestAttempt: () => Promise<TransportResponse>,
  retryPolicy: AppleTransportRetryPolicy,
): Promise<TransportResponse> => {
  let attempts = 4;
  if (retryPolicy.attempts !== undefined) attempts = retryPolicy.attempts;
  let baseDelayMs = 500;
  if (retryPolicy.baseDelayMs !== undefined) baseDelayMs = retryPolicy.baseDelayMs;
  let maximumDelayMs = 8000;
  if (retryPolicy.maximumDelayMs !== undefined) maximumDelayMs = retryPolicy.maximumDelayMs;

  let lastTransportFailure: unknown;
  for (let attemptNumber = 1; attemptNumber <= attempts; attemptNumber += 1) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: retries wait for the preceding request.
      return await requestAttempt();
    } catch (transportFailure) {
      lastTransportFailure = transportFailure;
      if (attemptNumber === attempts) throw transportFailure;
      if (!retryPolicy.isRetryableFailure(transportFailure)) throw transportFailure;
      const retryDelayMs = Math.min(maximumDelayMs, baseDelayMs * 2 ** (attemptNumber - 1));
      await new Promise<void>((resumeRetry) => setTimeout(resumeRetry, retryDelayMs));
    }
  }
  throw lastTransportFailure;
};

type NumericVersion = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
};

/** Parse the numeric core of an App Store marketing version. */
const parseNumericVersion = (marketingVersion: string): NumericVersion | null => {
  const versionCore = marketingVersion.trim().replace(/^v/i, '').split(/[-+]/)[0];
  if (versionCore === undefined) return null;
  if (!/^\d+(\.\d+){0,2}$/.test(versionCore)) return null;
  const versionParts = versionCore
    .split('.')
    .map((versionPart) => Number.parseInt(versionPart, 10));
  let major = 0;
  if (versionParts[0] !== undefined) major = versionParts[0];
  let minor = 0;
  if (versionParts[1] !== undefined) minor = versionParts[1];
  let patch = 0;
  if (versionParts[2] !== undefined) patch = versionParts[2];
  return {
    major,
    minor,
    patch,
  };
};

/** Compare two App Store marketing versions by numeric core. */
const compareNumericVersions = (leftVersion: string, rightVersion: string): number => {
  const leftParts = parseNumericVersion(leftVersion);
  const rightParts = parseNumericVersion(rightVersion);
  if (leftParts === null) return -1;
  if (rightParts === null) return 1;
  for (const versionPart of ['major', 'minor', 'patch'] as const) {
    if (leftParts[versionPart] < rightParts[versionPart]) return -1;
    if (leftParts[versionPart] > rightParts[versionPart]) return 1;
  }
  return 0;
};

export const highestAppleMarketingVersion = (
  marketingVersions: readonly string[],
): string | null => {
  const parseableVersions = marketingVersions.filter(
    (marketingVersion) => parseNumericVersion(marketingVersion) !== null,
  );
  if (parseableVersions.length === 0) return null;
  return parseableVersions.reduce((highestVersion, marketingVersion) => {
    if (compareNumericVersions(marketingVersion, highestVersion) > 0) return marketingVersion;
    return highestVersion;
  });
};

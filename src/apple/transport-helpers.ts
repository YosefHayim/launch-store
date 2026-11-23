// Retries a failed App Store Connect request and picks the newest marketing version.

type AppleTransportRetryPolicy = {
  readonly attempts?: number;
  readonly baseDelayMs?: number;
  readonly maximumDelayMs?: number;
  readonly isRetryableFailure: (transportFailure: unknown) => boolean;
};

export async function retryAppleTransportRequest<TransportResponse>(
  requestAttempt: () => Promise<TransportResponse>,
  retryPolicy: AppleTransportRetryPolicy,
): Promise<TransportResponse> {
  let attempts = 4;

  if (retryPolicy.attempts != null) attempts = retryPolicy.attempts;

  let baseDelayMs = 500;

  if (retryPolicy.baseDelayMs != null) baseDelayMs = retryPolicy.baseDelayMs;

  let maximumDelayMs = 8000;

  if (retryPolicy.maximumDelayMs != null) maximumDelayMs = retryPolicy.maximumDelayMs;

  let lastTransportFailure: unknown;

  for (let attemptNumber = 1; attemptNumber <= attempts; attemptNumber += 1) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: retries wait for the preceding request.
      return await requestAttempt();
    } catch (transportFailure) {
      lastTransportFailure = transportFailure;

      if (attemptNumber == attempts) throw transportFailure;

      if (!retryPolicy.isRetryableFailure(transportFailure)) throw transportFailure;

      const retryDelayMs = Math.min(maximumDelayMs, baseDelayMs * 2 ** (attemptNumber - 1));

      function createPromiseWork(resumeRetry: (value: void | PromiseLike<void>) => void) {
        return setTimeout(resumeRetry, retryDelayMs);
      }

      await new Promise<void>(createPromiseWork);
    }
  }

  throw lastTransportFailure;
}

type NumericVersion = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
};

/** Parse the numeric core of an App Store marketing version. */
function parseNumericVersion(marketingVersion: string): NumericVersion | null {
  const versionCore = marketingVersion.trim().replace(/^v/i, '').split(/[-+]/)[0];

  if (versionCore == null) return null;

  if (!/^\d+(\.\d+){0,2}$/.test(versionCore)) return null;

  function parseVersionPart(versionPart: string) {
    return Number.parseInt(versionPart, 10);
  }

  const versionParts = versionCore.split('.').map(parseVersionPart);
  let major = 0;

  if (versionParts[0] != null) major = versionParts[0];

  let minor = 0;

  if (versionParts[1] != null) minor = versionParts[1];

  let patch = 0;

  if (versionParts[2] != null) patch = versionParts[2];

  return {
    major,
    minor,
    patch,
  };
}

/** Compare two App Store marketing versions by numeric core. */
function compareNumericVersions(leftVersion: string, rightVersion: string): number {
  const leftParts = parseNumericVersion(leftVersion);
  const rightParts = parseNumericVersion(rightVersion);

  if (leftParts == null) return -1;

  if (rightParts == null) return 1;

  for (const versionPart of ['major', 'minor', 'patch'] as const) {
    if (leftParts[versionPart] < rightParts[versionPart]) return -1;

    if (leftParts[versionPart] > rightParts[versionPart]) return 1;
  }

  return 0;
}

export function highestAppleMarketingVersion(marketingVersions: readonly string[]): string | null {
  function isParseableMarketingVersion(marketingVersion: string) {
    return parseNumericVersion(marketingVersion) != null;
  }

  const parseableVersions = marketingVersions.filter(isParseableMarketingVersion);

  if (parseableVersions.length == 0) return null;

  function pickHigherMarketingVersion(highestVersion: string, marketingVersion: string) {
    if (compareNumericVersions(marketingVersion, highestVersion) > 0) return marketingVersion;

    return highestVersion;
  }

  return parseableVersions.reduce(pickHigherMarketingVersion);
}

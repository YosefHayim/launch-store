/**
 * EC2 Mac cost model — the figures the lifecycle UX is built on.
 *
 * Every number here was verified against AWS's own published pricing and EC2 Mac docs: the
 * Dedicated Host has a hard 24-hour minimum allocation (Apple license), bills per second after that,
 * and — critically — *stopping the instance does not stop the bill; only releasing the host does*.
 * Launch's whole cost UX (typed consent, the live banner, paid-window reuse, auto-release near the
 * 24h mark) exists to make the only real saving — batching builds into the one paid window — automatic.
 *
 * Pure functions, no I/O, so they're unit-tested directly. `now` is injectable for deterministic tests.
 */

/** `mac2.metal` (M1) / `mac2-m2.metal` (M2) on-demand rate, USD per hour (verified ≈ $0.65/hr). */
export const EC2_MAC_HOURLY_USD = 0.65;

/** Apple-license minimum allocation before the Dedicated Host may be released, in hours. */
export const MIN_ALLOCATION_HOURS = 24;

/**
 * When Launch schedules an automatic release, in hours after allocation. Just under the 24h mark so a
 * forgotten host can never roll into a second paid day, with a little slack for the release call.
 */
export const AUTO_RELEASE_HOURS = 23.5;

const HOUR_MS = 60 * 60 * 1000;

/** The unavoidable floor you pay the moment you allocate, regardless of how many builds you run. */
export const MINIMUM_CHARGE_USD = EC2_MAC_HOURLY_USD * MIN_ALLOCATION_HOURS;

/** Accrued cost in USD for a host that has been allocated for `ms` milliseconds (per-second billing). */
export function costForDurationUsd(ms: number): number {
  return Math.max(0, ms / HOUR_MS) * EC2_MAC_HOURLY_USD;
}

/** ISO-8601 instant the Dedicated Host may first be released (allocatedAt + 24h). */
export function releasableAt(allocatedAtIso: string): string {
  return new Date(new Date(allocatedAtIso).getTime() + MIN_ALLOCATION_HOURS * HOUR_MS).toISOString();
}

/** ISO-8601 instant Launch schedules the automatic release (allocatedAt + ~23.5h). */
export function autoReleaseAt(allocatedAtIso: string): string {
  return new Date(new Date(allocatedAtIso).getTime() + AUTO_RELEASE_HOURS * HOUR_MS).toISOString();
}

/** Whether the 24h minimum has elapsed, so AWS will let the host be released without further commitment. */
export function isReleasable(allocatedAtIso: string, now: number = Date.now()): boolean {
  return now >= new Date(releasableAt(allocatedAtIso)).getTime();
}

/** Round a USD amount to cents for display. */
export function usd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** Format a duration in `Hh MMm` for the cost banner / status. */
export function formatAge(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
}

/**
 * The one-time, typed-consent text shown before the first billable allocation. States the floor, that
 * stopping ≠ not billing, and that Savings Plans only help constant usage — so the user opts in with
 * eyes open, per decision 1/3.
 */
export function consentMessage(): string {
  return [
    `Allocating an AWS EC2 Mac costs about ${usd(MINIMUM_CHARGE_USD)} minimum:`,
    `AWS bills a Dedicated Host with a hard ${MIN_ALLOCATION_HOURS}h minimum (Apple's license), then per second.`,
    "Stopping the instance does NOT stop the bill — only releasing the host does, and not before the 24h mark.",
    "Launch reuses this one paid window for every build you run in it, then auto-releases near 24h.",
    "Proceed and allocate a cloud Mac in your own AWS account?",
  ].join("\n");
}

/** One-line live-cost banner shown above commands while a host is up. */
export function costBanner(handle: { instanceId?: string; allocatedAt: string }, now: number = Date.now()): string {
  const ageMs = now - new Date(handle.allocatedAt).getTime();
  const id = handle.instanceId ?? "remote host";
  const release = new Date(releasableAt(handle.allocatedAt));
  const releaseLabel = `${release.getHours().toString().padStart(2, "0")}:${release.getMinutes().toString().padStart(2, "0")}`;
  return `host ${id} up ${formatAge(ageMs)}, ~${usd(costForDurationUsd(ageMs))} so far, releasable after ${releaseLabel}`;
}

import { describe, expect, it } from 'vitest';
import {
  AUTO_RELEASE_HOURS,
  EC2_MAC_HOURLY_USD,
  MINIMUM_CHARGE_USD,
  MIN_ALLOCATION_HOURS,
  autoReleaseAt,
  consentMessage,
  costBanner,
  costForDurationUsd,
  formatAge,
  isReleasable,
  releasableAt,
  usd,
} from './cost.ts';
const HOUR_MS = 60 * 60 * 1000;
const allocatedAt = '2026-06-14T00:00:00.000Z';
function describeEC2MacCostModelVerifiedAWSFigures() {
  function encodesTheVerified24hFloorAtTheOnDemandRate() {
    expect(EC2_MAC_HOURLY_USD).toBe(0.65);
    expect(MIN_ALLOCATION_HOURS).toBe(24);
    expect(MINIMUM_CHARGE_USD).toBeCloseTo(15.6, 5);
  }

  it(
    'encodes the verified 24h floor at the on-demand rate',
    encodesTheVerified24hFloorAtTheOnDemandRate,
  );
  function autoReleasesJustUnderThe24hMarkNeverOver() {
    expect(AUTO_RELEASE_HOURS).toBeLessThan(MIN_ALLOCATION_HOURS);
  }

  it('auto-releases just under the 24h mark, never over', autoReleasesJustUnderThe24hMarkNeverOver);
  function accruesCostPerElapsedHourPerSecondBilling() {
    expect(costForDurationUsd(0)).toBe(0);
    expect(costForDurationUsd(HOUR_MS)).toBeCloseTo(0.65, 5);
    expect(costForDurationUsd(3 * HOUR_MS)).toBeCloseTo(1.95, 5);
    expect(costForDurationUsd(-1000)).toBe(0); // clamps negatives
  }

  it(
    'accrues cost per elapsed hour (per-second billing)',
    accruesCostPerElapsedHourPerSecondBilling,
  );
  function computesReleasableAutoReleaseInstantsFromAllocation() {
    expect(releasableAt(allocatedAt)).toBe('2026-06-15T00:00:00.000Z');
    expect(autoReleaseAt(allocatedAt)).toBe('2026-06-14T23:30:00.000Z');
  }

  it(
    'computes releasable/auto-release instants from allocation',
    computesReleasableAutoReleaseInstantsFromAllocation,
  );
  function knowsWhenThe24hMinimumHasElapsed() {
    const justBefore = new Date(allocatedAt).getTime() + 23 * HOUR_MS;
    const justAfter = new Date(allocatedAt).getTime() + 25 * HOUR_MS;
    expect(isReleasable(allocatedAt, justBefore)).toBe(false);
    expect(isReleasable(allocatedAt, justAfter)).toBe(true);
  }

  it('knows when the 24h minimum has elapsed', knowsWhenThe24hMinimumHasElapsed);
  function formatsMoneyAndAgeForTheBanner() {
    expect(usd(15.6)).toBe('$15.60');
    const age = formatAge(0);
    expect(age).toBe('0h 00m');
    expect(formatAge(3 * HOUR_MS + 12 * 60 * 1000)).toBe('3h 12m');
  }

  it('formats money and age for the banner', formatsMoneyAndAgeForTheBanner);
  function statesTheFloorTheStopFreeRuleAndReuseInTheConsentPiece() {
    const message = consentMessage();
    expect(message).toContain('$15.60');
    expect(message).toMatch(/24h/);
    expect(message).toMatch(/Stopping the instance does NOT stop the bill/i);
  }

  it(
    'states the floor, the stop!=free rule, and reuse in the consent text',
    statesTheFloorTheStopFreeRuleAndReuseInTheConsentPiece,
  );
  function rendersALiveCostBannerFromAHandle() {
    const now = new Date(allocatedAt).getTime() + 2 * HOUR_MS;
    const banner = costBanner({ instanceId: 'i-123', allocatedAt }, now);
    expect(banner).toContain('i-123');
    expect(banner).toContain('up 2h 00m');
    expect(banner).toContain('$1.30');
  }

  it('renders a live cost banner from a handle', rendersALiveCostBannerFromAHandle);
}

describe('EC2 Mac cost model (verified AWS figures)', describeEC2MacCostModelVerifiedAWSFigures);

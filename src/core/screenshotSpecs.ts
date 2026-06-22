/**
 * The canonical store screenshot **dimension** truth — what pixel sizes the App Store and Google Play
 * accept per device slot — plus the pure validators that gate a screenshot against them.
 *
 * Launch held no dimension spec before this: `core/screenshotAssets.ts` `KNOWN_DISPLAY_TYPES` is a
 * *labels-only* table, and the width/height in `apple/ascClient.ts` is read back off already-uploaded
 * shots, not a requirement. This module fills that gap so two callers can guarantee store-valid output:
 *
 * 1. **`launch plan screenshots`** validates the user's hand-made screenshots against the *full* accepted
 *    set and surfaces an off-spec file as an advisory finding — catching a wrong-sized image before the
 *    store rejects the submission. Tolerant by design: it only flags a file it could measure whose slot
 *    is known and whose pixels match no accepted resolution.
 * 2. **`launch ai screenshots`** (the genshot client) requests the single {@link AppleScreenshotSpec.canonical}
 *    size per slot, then hard-gates what genshot returns against it — so a backend that ignored the
 *    requested size is caught locally rather than uploaded.
 *
 * The two stores need two *shapes* of rule (the reason this is one module, not two): Apple fixes an exact
 * per-slot pixel enum (and a slot accepts several resolutions as hardware turns over — encoded as the
 * `accepted` union so a valid shot is never falsely flagged), while Play enforces a *constraint* — each
 * side within a range, the longer no more than twice the shorter — with no per-device pixel table.
 *
 * Sources: Apple "Screenshot specifications" (App Store Connect Help) and Google Play Console "Add
 * preview assets" help. Apple's slot constants are keyed to the same `screenshotDisplayType` values
 * Launch already uses as folder names; an unknown slot validates as OK (Apple's enum lags new hardware —
 * never reject what we can't authoritatively check).
 */

import type { Platform } from "./types.js";
import { imageSize } from "./imageSize.js";

/**
 * Whether a slot's `accepted` pixel pairs are orientation-locked. `both` (iPhone/iPad) also accepts the
 * width/height swap of each pair, so a landscape screenshot of a portrait pair passes; `fixed`
 * (Mac/TV/Vision Pro/Watch) accepts only the listed orientation.
 */
export type ScreenshotOrientation = "both" | "fixed";

/**
 * One Apple display slot's dimension rule. `canonical` is the single size `launch ai screenshots` asks
 * genshot to produce (the current, universally-accepted resolution for the slot); `accepted` is the full
 * union of every resolution App Store Connect takes for it, used to validate arbitrary hand-made files
 * without false positives. All pairs are written `[width, height]` in the slot's native orientation.
 */
export interface AppleScreenshotSpec {
  /** The size to request from genshot and hard-gate against — the slot's primary current resolution. */
  canonical: readonly [number, number];
  /** Every `[width, height]` App Store Connect accepts for this slot (orientation per {@link orientation}). */
  accepted: readonly (readonly [number, number])[];
  /** Whether the width/height swap of each accepted pair is also valid (portrait⇄landscape). */
  orientation: ScreenshotOrientation;
}

/**
 * App Store `screenshotDisplayType` → its dimension rule. Keyed to the same constants
 * `core/screenshotAssets.ts` uses as the second-level folder name, so a file discovered under
 * `screenshots/<locale>/<DISPLAY_TYPE>/` validates against the matching slot. iMessage slots mirror their
 * base device. A slot absent here is treated as valid (see module header — lagging-enum tolerance).
 */
export const APPLE_SCREENSHOT_SPECS: Readonly<Record<string, AppleScreenshotSpec>> = {
  APP_IPHONE_67: {
    canonical: [1290, 2796],
    accepted: [
      [1290, 2796],
      [1284, 2778],
      [1260, 2736],
      [1320, 2868],
    ],
    orientation: "both",
  },
  APP_IPHONE_65: {
    canonical: [1242, 2688],
    accepted: [
      [1242, 2688],
      [1284, 2778],
    ],
    orientation: "both",
  },
  APP_IPHONE_61: {
    canonical: [1170, 2532],
    accepted: [
      [1170, 2532],
      [1125, 2436],
      [1179, 2556],
      [1080, 2340],
      [1206, 2622],
    ],
    orientation: "both",
  },
  APP_IPHONE_58: {
    canonical: [1125, 2436],
    accepted: [
      [1125, 2436],
      [1170, 2532],
    ],
    orientation: "both",
  },
  APP_IPHONE_55: { canonical: [1242, 2208], accepted: [[1242, 2208]], orientation: "both" },
  APP_IPHONE_47: { canonical: [750, 1334], accepted: [[750, 1334]], orientation: "both" },
  APP_IPHONE_40: {
    canonical: [640, 1136],
    accepted: [
      [640, 1136],
      [640, 1096],
    ],
    orientation: "both",
  },
  APP_IPHONE_35: {
    canonical: [640, 960],
    accepted: [
      [640, 960],
      [640, 920],
    ],
    orientation: "both",
  },
  APP_IPAD_PRO_3GEN_129: {
    canonical: [2048, 2732],
    accepted: [
      [2048, 2732],
      [2064, 2752],
    ],
    orientation: "both",
  },
  APP_IPAD_PRO_3GEN_11: {
    canonical: [1668, 2388],
    accepted: [
      [1668, 2388],
      [1668, 2420],
      [1488, 2266],
      [1640, 2360],
    ],
    orientation: "both",
  },
  APP_IPAD_PRO_129: { canonical: [2048, 2732], accepted: [[2048, 2732]], orientation: "both" },
  APP_IPAD_105: { canonical: [1668, 2224], accepted: [[1668, 2224]], orientation: "both" },
  APP_IPAD_97: {
    canonical: [1536, 2048],
    accepted: [
      [1536, 2048],
      [768, 1024],
    ],
    orientation: "both",
  },
  APP_DESKTOP: {
    canonical: [1280, 800],
    accepted: [
      [1280, 800],
      [1440, 900],
      [2560, 1600],
      [2880, 1800],
    ],
    orientation: "fixed",
  },
  APP_APPLE_TV: {
    canonical: [1920, 1080],
    accepted: [
      [1920, 1080],
      [3840, 2160],
    ],
    orientation: "fixed",
  },
  APP_APPLE_VISION_PRO: { canonical: [3840, 2160], accepted: [[3840, 2160]], orientation: "fixed" },
  APP_WATCH_ULTRA: {
    canonical: [410, 502],
    accepted: [
      [410, 502],
      [422, 514],
    ],
    orientation: "fixed",
  },
  APP_WATCH_SERIES_7: {
    canonical: [396, 484],
    accepted: [
      [396, 484],
      [416, 496],
    ],
    orientation: "fixed",
  },
  APP_WATCH_SERIES_4: { canonical: [368, 448], accepted: [[368, 448]], orientation: "fixed" },
  APP_WATCH_SERIES_3: { canonical: [312, 390], accepted: [[312, 390]], orientation: "fixed" },
  IMESSAGE_APP_IPHONE_67: {
    canonical: [1290, 2796],
    accepted: [
      [1290, 2796],
      [1284, 2778],
      [1260, 2736],
      [1320, 2868],
    ],
    orientation: "both",
  },
  IMESSAGE_APP_IPHONE_65: {
    canonical: [1242, 2688],
    accepted: [
      [1242, 2688],
      [1284, 2778],
    ],
    orientation: "both",
  },
  IMESSAGE_APP_IPHONE_58: {
    canonical: [1125, 2436],
    accepted: [
      [1125, 2436],
      [1170, 2532],
    ],
    orientation: "both",
  },
  IMESSAGE_APP_IPAD_PRO_3GEN_129: {
    canonical: [2048, 2732],
    accepted: [
      [2048, 2732],
      [2064, 2752],
    ],
    orientation: "both",
  },
};

/**
 * The modern base set `launch ai screenshots` targets by default when the user names no `--device-types`:
 * the 6.7" iPhone and 12.9"/13" iPad, the two slots App Store Connect currently requires (Apple scales the
 * rest from them).
 */
export const DEFAULT_APPLE_DISPLAY_TYPES: readonly string[] = ["APP_IPHONE_67", "APP_IPAD_PRO_3GEN_129"];

/**
 * Google Play's screenshot constraint (phones, tablets, Chromebooks): each side must fall in
 * `[minSide, maxSide]` px and the longer side may be at most `maxAspectMultiple`× the shorter. Play
 * publishes no per-device pixel enum, so this single rule validates every Play form factor.
 */
export const PLAY_SCREENSHOT_CONSTRAINTS = { minSide: 320, maxSide: 3840, maxAspectMultiple: 2 } as const;

/** A Play form factor `launch ai screenshots` can target — Play groups screenshots by these, not by device. */
export type PlayFormFactor = "phone" | "sevenInchTablet" | "tenInchTablet";

/**
 * The size to request from genshot per Play form factor — 9:16 portrait, each within
 * {@link PLAY_SCREENSHOT_CONSTRAINTS} and at/above Play's recommended 1080px short side for crisp display.
 * Play accepts a wide range, so these are sensible defaults, not the only valid sizes.
 */
export const PLAY_FORM_FACTOR_DIMENSIONS: Readonly<Record<PlayFormFactor, readonly [number, number]>> = {
  phone: [1080, 1920],
  sevenInchTablet: [1206, 2144],
  tenInchTablet: [1600, 2560],
};

/** The Play form factors `launch ai screenshots` targets by default — phone only, the one Play requires to publish. */
export const DEFAULT_PLAY_FORM_FACTORS: readonly PlayFormFactor[] = ["phone"];

/**
 * Result of checking one screenshot's pixel dimensions: `ok`, or a failure carrying a human-readable
 * `reason` (the expected sizes and what was found) for an advisory finding or a hard-gate error.
 */
export type DimensionVerdict = { ok: true } | { ok: false; reason: string };

/** Format a `[w, h]` pair as `w×h` for a verdict message. */
function fmt(pair: readonly [number, number]): string {
  return `${pair[0]}×${pair[1]}`;
}

/**
 * Validate pixel dimensions against an Apple display slot. An unknown slot passes (we don't reject what
 * Apple's lagging enum doesn't let us authoritatively check); a known slot passes when the pair — or, for
 * an orientation-`both` slot, its swap — matches an accepted resolution, and fails with the accepted list
 * otherwise.
 */
export function validateAppleDimensions(displayType: string, width: number, height: number): DimensionVerdict {
  const spec = APPLE_SCREENSHOT_SPECS[displayType];
  if (!spec) return { ok: true };
  const matches = spec.accepted.some(
    ([w, h]) => (width === w && height === h) || (spec.orientation === "both" && width === h && height === w),
  );
  if (matches) return { ok: true };
  const expected = spec.accepted.map(fmt).join(", ");
  return { ok: false, reason: `${fmt([width, height])} is not a valid ${displayType} size (expected ${expected})` };
}

/**
 * Validate pixel dimensions against Google Play's universal constraint — each side in range and the longer
 * side at most twice the shorter. Returns a pointed reason naming the rule a screenshot broke.
 */
export function validatePlayDimensions(width: number, height: number): DimensionVerdict {
  const { minSide, maxSide, maxAspectMultiple } = PLAY_SCREENSHOT_CONSTRAINTS;
  const shorter = Math.min(width, height);
  const longer = Math.max(width, height);
  if (shorter < minSide || longer > maxSide) {
    return { ok: false, reason: `${fmt([width, height])} is outside Play's ${minSide}–${maxSide}px per-side range` };
  }
  if (longer > shorter * maxAspectMultiple) {
    return {
      ok: false,
      reason: `${fmt([width, height])} is too elongated for Play (longest side must be ≤ ${maxAspectMultiple}× the shortest)`,
    };
  }
  return { ok: true };
}

/**
 * The canonical size to request/hard-gate for one target, or `undefined` for an unknown Apple slot. For
 * iOS the target is the `screenshotDisplayType`; for Android it's a {@link PlayFormFactor}.
 */
export function canonicalDimensions(platform: Platform, target: string): readonly [number, number] | undefined {
  if (platform === "ios") return APPLE_SCREENSHOT_SPECS[target]?.canonical;
  return PLAY_FORM_FACTOR_DIMENSIONS[target as PlayFormFactor];
}

/**
 * The outcome of measuring and validating a screenshot file. `measured: false` means the pixels couldn't
 * be read (missing file or unsupported format) — the caller decides whether that's benign (an advisory
 * pass skips it) or fatal (a hard-gate rejects it); `measured: true` carries the verdict and the size read.
 */
export type FileDimensionCheck =
  | { measured: false }
  | { measured: true; width: number; height: number; verdict: DimensionVerdict };

/**
 * Measure a screenshot file and validate it for the given platform/target in one step — the bridge from
 * the on-disk file to the pure validators, used by both the `plan` advisory pass and the genshot
 * hard-gate. iOS validates against the Apple slot; Android validates against Play's constraint
 * (the `target` form factor doesn't change Play's rule, so it's not consulted).
 */
export function checkScreenshotFile(platform: Platform, target: string, path: string): FileDimensionCheck {
  const size = imageSize(path);
  if (!size) return { measured: false };
  const verdict =
    platform === "ios"
      ? validateAppleDimensions(target, size.width, size.height)
      : validatePlayDimensions(size.width, size.height);
  return { measured: true, width: size.width, height: size.height, verdict };
}

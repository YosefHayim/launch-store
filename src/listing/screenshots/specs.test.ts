import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalDimensions,
  checkScreenshotFile,
  validateAppleDimensions,
  validatePlayDimensions,
} from './specs.ts';
const tmpDirs: string[] = [];

function cleanup() {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

afterEach(cleanup);

/** Write a minimal valid PNG of the given pixel size to disk and return its path. */
function writePng(width: number, height: number): string {
  const systemTemporaryDirectory = tmpdir();
  const launchSpecsPath = join(systemTemporaryDirectory, 'launch-specs-');
  const dir = mkdtempSync(launchSpecsPath);

  tmpDirs.push(dir);

  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(16);

  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);

  const path = join(dir, 'shot.png');
  const concatenated = Buffer.concat([head, ihdr]);

  writeFileSync(path, concatenated);

  return path;
}

function describeValidateAppleDimensions() {
  function acceptsTheCanonicalPortraitSizeForAKnownSlot() {
    const appleDimensions = validateAppleDimensions('APP_IPHONE_67', 1290, 2796);
    expect(appleDimensions).toEqual({ ok: true });
  }

  it(
    'accepts the canonical portrait size for a known slot',
    acceptsTheCanonicalPortraitSizeForAKnownSlot,
  );

  function acceptsANonCanonicalButListedResolutionForTheSlot() {
    const appleDimensions = validateAppleDimensions('APP_IPHONE_67', 1284, 2778);
    expect(appleDimensions).toEqual({ ok: true });
  }

  it(
    'accepts a non-canonical-but-listed resolution for the slot',
    acceptsANonCanonicalButListedResolutionForTheSlot,
  );

  function acceptsTheLandscapeSwapForAnOrientationBothSlot() {
    const appleDimensions = validateAppleDimensions('APP_IPHONE_67', 2796, 1290);
    expect(appleDimensions).toEqual({ ok: true });
  }

  it(
    'accepts the landscape swap for an orientation-both slot',
    acceptsTheLandscapeSwapForAnOrientationBothSlot,
  );

  function rejectsAnOffSpecSizeWithTheAcceptedListInTheReason() {
    const verdict = validateAppleDimensions('APP_IPHONE_67', 1080, 1920);

    expect(verdict.ok).toBe(false);

    if (verdict.ok) return;

    expect(verdict.reason).toContain('1290x2796');
  }

  it(
    'rejects an off-spec size with the accepted list in the reason',
    rejectsAnOffSpecSizeWithTheAcceptedListInTheReason,
  );

  function doesNOTSwapOrientationForAFixedSlotMacIsLandscapeOnly() {
    const appleDimensions = validateAppleDimensions('APP_DESKTOP', 1280, 800);
    expect(appleDimensions.ok).toBe(true);
    expect(validateAppleDimensions('APP_DESKTOP', 800, 1280).ok).toBe(false);
  }

  it(
    'does NOT swap orientation for a fixed slot (Mac is landscape-only)',
    doesNOTSwapOrientationForAFixedSlotMacIsLandscapeOnly,
  );

  function passesAnUnknownSlotAppleSEnumLagsNewHardwareNeverRejectWhatWeCanTCheck() {
    const appleDimensions = validateAppleDimensions('APP_IPHONE_69_FUTURE', 9999, 9999);
    expect(appleDimensions).toEqual({ ok: true });
  }

  it(
    "passes an unknown slot (Apple's enum lags new hardware - never reject what we can't check)",
    passesAnUnknownSlotAppleSEnumLagsNewHardwareNeverRejectWhatWeCanTCheck,
  );
}

describe('validateAppleDimensions', describeValidateAppleDimensions);

function describeValidatePlayDimensions() {
  function acceptsA916PhoneScreenshot() {
    const playDimensions = validatePlayDimensions(1080, 1920);
    expect(playDimensions).toEqual({ ok: true });
  }

  it('accepts a 9:16 phone screenshot', acceptsA916PhoneScreenshot);

  function rejectsASideBelowThe320pxFloor() {
    const playDimensions = validatePlayDimensions(200, 400);
    expect(playDimensions.ok).toBe(false);
  }

  it('rejects a side below the 320px floor', rejectsASideBelowThe320pxFloor);

  function rejectsASideAboveThe3840pxCeiling() {
    const playDimensions = validatePlayDimensions(4000, 2000);
    expect(playDimensions.ok).toBe(false);
  }

  it('rejects a side above the 3840px ceiling', rejectsASideAboveThe3840pxCeiling);

  function rejectsAnOverElongatedImageLongestSide2xShortest() {
    const verdict = validatePlayDimensions(500, 1200);

    expect(verdict.ok).toBe(false);

    if (verdict.ok) return;

    expect(verdict.reason).toContain('elongated');
  }

  it(
    'rejects an over-elongated image (longest side > 2x shortest)',
    rejectsAnOverElongatedImageLongestSide2xShortest,
  );
}

describe('validatePlayDimensions', describeValidatePlayDimensions);

function describeCanonicalDimensions() {
  function returnsTheAppleSlotSCanonicalSize() {
    expect(canonicalDimensions('ios', 'APP_IPAD_PRO_3GEN_129')).toEqual([2048, 2732]);
  }

  it("returns the Apple slot's canonical size", returnsTheAppleSlotSCanonicalSize);

  function returnsUndefinedForAnUnknownAppleSlot() {
    expect(canonicalDimensions('ios', 'NOPE')).toBeUndefined();
  }

  it('returns undefined for an unknown Apple slot', returnsUndefinedForAnUnknownAppleSlot);

  function returnsThePlayFormFactorSize() {
    expect(canonicalDimensions('android', 'phone')).toEqual([1080, 1920]);
  }

  it('returns the Play form-factor size', returnsThePlayFormFactorSize);

  function routesTheNewApplePlatformsToTheAppleSpecsNOTPlayMisrouteRegression() {
    // tvOS/macOS/visionOS must take the Apple branch; a `== "ios"` check would drop them into Play and
    // these slot ids don't exist there, so the bug would surface as `undefined`.
    expect(canonicalDimensions('tvos', 'APP_APPLE_TV')).toEqual([1920, 1080]);
    expect(canonicalDimensions('macos', 'APP_DESKTOP')).toEqual([1280, 800]);
    expect(canonicalDimensions('visionos', 'APP_APPLE_VISION_PRO')).toEqual([3840, 2160]);
  }

  it(
    'routes the new Apple platforms to the Apple specs, NOT Play (misroute regression)',
    routesTheNewApplePlatformsToTheAppleSpecsNOTPlayMisrouteRegression,
  );
}

describe('canonicalDimensions', describeCanonicalDimensions);

function describeCheckScreenshotFile() {
  async function measuresAndPassesAnInSpecIOSScreenshot() {
    const png = writePng(1290, 2796);
    const check = await checkScreenshotFile('ios', 'APP_IPHONE_67', png);
    expect(check).toEqual({ measured: true, width: 1290, height: 2796, verdict: { ok: true } });
  }

  it('measures and passes an in-spec iOS screenshot', measuresAndPassesAnInSpecIOSScreenshot);

  async function measuresAndFlagsAnOffSpecIOSScreenshot() {
    const png = writePng(1080, 1920);
    const check = await checkScreenshotFile('ios', 'APP_IPHONE_67', png);

    expect(check.measured).toBe(true);

    if (!check.measured) return;

    expect(check.verdict.ok).toBe(false);
  }

  it('measures and flags an off-spec iOS screenshot', measuresAndFlagsAnOffSpecIOSScreenshot);

  async function validatesAnAndroidScreenshotAgainstPlaySConstraint() {
    const png = writePng(1080, 1920);
    const check = await checkScreenshotFile('android', 'phone', png);
    expect(check.measured && check.verdict.ok).toBe(true);
  }

  it(
    "validates an Android screenshot against Play's constraint",
    validatesAnAndroidScreenshotAgainstPlaySConstraint,
  );

  async function reportsMeasuredFalseForAFileWhosePixelsCanTBeRead() {
    const systemTemporaryDirectory = tmpdir();
    const launchSpecsPath = join(systemTemporaryDirectory, 'launch-specs-');
    const dir = mkdtempSync(launchSpecsPath);

    tmpDirs.push(dir);

    const path = join(dir, 'not-an-image.png');

    writeFileSync(path, 'just some text, not a PNG');

    const screenshotFile = await checkScreenshotFile('ios', 'APP_IPHONE_67', path);

    expect(screenshotFile).toEqual({
      measured: false,
    });
  }

  it(
    "reports measured:false for a file whose pixels can't be read",
    reportsMeasuredFalseForAFileWhosePixelsCanTBeRead,
  );

  async function validatesATvOSScreenshotAgainstTheAppleAppleTVSpecNotPlay() {
    const png = writePng(1920, 1080);
    const check = await checkScreenshotFile('tvos', 'APP_APPLE_TV', png);
    expect(check.measured && check.verdict.ok).toBe(true);
  }

  it(
    'validates a tvOS screenshot against the Apple Apple-TV spec (not Play)',
    validatesATvOSScreenshotAgainstTheAppleAppleTVSpecNotPlay,
  );
}

describe('checkScreenshotFile', describeCheckScreenshotFile);

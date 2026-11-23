import { afterEach, describe, expect, it } from 'vitest';
import { resetLaunchEnvironment, useLaunchEnvironment } from '../services/platform/environment.ts';
import {
  buildListingPrompt,
  createAnthropicListingGenerator,
  parseDraftListing,
} from './generator.ts';

afterEach(function resetEnvironment() {
  resetLaunchEnvironment();
});

function thrownBy(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }

  return null;
}
function describeBuildListingPrompt() {
  function namesTheAppAndLocaleAndStatesTheCharacterLimits() {
    const listingPrompt = buildListingPrompt({ locale: 'en-US', appName: 'Focus Timer' });

    expect(listingPrompt).toContain('Focus Timer');
    expect(listingPrompt).toContain('en-US');
    expect(listingPrompt).toContain('30 characters');
    expect(listingPrompt).toContain('100 characters');
  }

  it(
    'names the app and locale and states the character limits',
    namesTheAppAndLocaleAndStatesTheCharacterLimits,
  );

  function includesTheSeedMaterialWhenPresent() {
    const listingPrompt = buildListingPrompt({
      locale: 'en-US',
      appName: 'MyApp',
      about: 'A focus timer',
      keywords: ['focus', 'timer'],
      current: { subtitle: 'Old subtitle' },
    });

    expect(listingPrompt).toContain('A focus timer');
    expect(listingPrompt).toContain('focus, timer');
    expect(listingPrompt).toContain('Old subtitle');
  }

  it('includes the seed material when present', includesTheSeedMaterialWhenPresent);
}

describe('buildListingPrompt', describeBuildListingPrompt);
function describeParseDraftListing() {
  function parsesAPlainJSONObject() {
    const listingDraft = parseDraftListing('{"title":"MyApp","keywords":["focus","timer"]}');
    expect(listingDraft).toEqual({ title: 'MyApp', keywords: ['focus', 'timer'] });
  }

  it('parses a plain JSON object', parsesAPlainJSONObject);

  function toleratesAJSONFence() {
    const listingDraft = parseDraftListing('```json\n{"subtitle":"Stay on task"}\n```');
    expect(listingDraft).toEqual({ subtitle: 'Stay on task' });
  }

  it('tolerates a JSON fence', toleratesAJSONFence);

  function acceptsCommaSeparatedKeywordsAsAString() {
    const listingDraft = parseDraftListing('{"keywords":"focus, timer , "}');
    expect(listingDraft.keywords).toEqual(['focus', 'timer']);
  }

  it('accepts comma-separated keywords as a string', acceptsCommaSeparatedKeywordsAsAString);

  function dropsBlankOptionalFields() {
    const listingDraft = parseDraftListing('{"title":"MyApp","description":"  "}');
    expect(listingDraft).toEqual({ title: 'MyApp' });
  }

  it('drops blank optional fields', dropsBlankOptionalFields);

  function failsOnInvalidJSON() {
    function parseInvalidJson(): void {
      parseDraftListing('not json');
    }

    expect(thrownBy(parseInvalidJson)).toMatchObject({
      _tag: 'ListingGenerationFailure',
      message: expect.stringMatching(/valid JSON/),
    });
  }

  it('fails on invalid JSON', failsOnInvalidJSON);

  function failsWhenNoUsableFieldIsPresent() {
    function parseEmptyListing(): void {
      parseDraftListing('{"unknown":"x"}');
    }

    expect(thrownBy(parseEmptyListing)).toMatchObject({
      _tag: 'ListingGenerationFailure',
      message: expect.stringMatching(/no usable/),
    });
  }

  it('fails when no usable field is present', failsWhenNoUsableFieldIsPresent);
}

describe('parseDraftListing', describeParseDraftListing);
function describeCreateAnthropicListingGenerator() {
  function labelsItselfWithTheSelectedModel() {
    useLaunchEnvironment({});
    const listingGenerator = createAnthropicListingGenerator({ model: 'claude-test' });
    expect(listingGenerator.name).toBe('anthropic:claude-test');
  }

  it('labels itself with the selected model', labelsItselfWithTheSelectedModel);

  async function failsWithAnActionableMessageWhenNoAPIKeyIsConfigured() {
    useLaunchEnvironment({});

    const listingGenerator = createAnthropicListingGenerator();

    await expect(
      listingGenerator.generate({ locale: 'en-US', appName: 'MyApp' }),
    ).rejects.toMatchObject({
      _tag: 'ListingGenerationFailure',
      message: expect.stringMatching(/ANTHROPIC_API_KEY/),
    });
  }

  it(
    'fails with an actionable message when no API key is configured',
    failsWithAnActionableMessageWhenNoAPIKeyIsConfigured,
  );
}

describe('createAnthropicListingGenerator', describeCreateAnthropicListingGenerator);

import { NodeHttpClient } from '@effect/platform-node';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { makeLaunchEnvironmentTest } from '../services/environment.js';
import {
  buildListingPrompt,
  createAnthropicListingGenerator,
  parseDraftListing,
} from './generator.js';

const parseDraft = (completionText: string) => Effect.runSync(parseDraftListing(completionText));

describe('buildListingPrompt', () => {
  it('names the app and locale and states the character limits', () => {
    const listingPrompt = buildListingPrompt({ locale: 'en-US', appName: 'Focus Timer' });
    expect(listingPrompt).toContain('Focus Timer');
    expect(listingPrompt).toContain('en-US');
    expect(listingPrompt).toContain('30 characters');
    expect(listingPrompt).toContain('100 characters');
  });

  it('includes the seed material when present', () => {
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
  });
});

describe('parseDraftListing', () => {
  it('parses a plain JSON object', () => {
    const listingDraft = parseDraft('{"title":"MyApp","keywords":["focus","timer"]}');
    expect(listingDraft).toEqual({ title: 'MyApp', keywords: ['focus', 'timer'] });
  });

  it('tolerates a JSON fence', () => {
    const listingDraft = parseDraft('```json\n{"subtitle":"Stay on task"}\n```');
    expect(listingDraft).toEqual({ subtitle: 'Stay on task' });
  });

  it('accepts comma-separated keywords as a string', () => {
    const listingDraft = parseDraft('{"keywords":"focus, timer , "}');
    expect(listingDraft.keywords).toEqual(['focus', 'timer']);
  });

  it('drops blank optional fields', () => {
    const listingDraft = parseDraft('{"title":"MyApp","description":"  "}');
    expect(listingDraft).toEqual({ title: 'MyApp' });
  });

  it('fails on invalid JSON', () => {
    expect(() => parseDraft('not json')).toThrow(/valid JSON/);
  });

  it('fails when no usable field is present', () => {
    expect(() => parseDraft('{"unknown":"x"}')).toThrow(/no usable/);
  });
});

describe('createAnthropicListingGenerator', () => {
  it('labels itself with the selected model', async () => {
    const listingGenerator = await Effect.runPromise(
      createAnthropicListingGenerator({ model: 'claude-test' }).pipe(
        Effect.provide(makeLaunchEnvironmentTest({})),
      ),
    );
    expect(listingGenerator.name).toBe('anthropic:claude-test');
  });

  it('fails with an actionable message when no API key is configured', async () => {
    const listingGenerator = await Effect.runPromise(
      createAnthropicListingGenerator().pipe(Effect.provide(makeLaunchEnvironmentTest({}))),
    );
    await expect(
      Effect.runPromise(
        listingGenerator
          .generate({ locale: 'en-US', appName: 'MyApp' })
          .pipe(Effect.provide(NodeHttpClient.layer)),
      ),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

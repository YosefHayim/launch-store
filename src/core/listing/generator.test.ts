import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildListingPrompt,
  createAnthropicListingGenerator,
  parseDraftListing,
} from './generator.js';

describe('buildListingPrompt', () => {
  it('names the app and locale and states the character limits', () => {
    const prompt = buildListingPrompt({ locale: 'en-US', appName: 'Focus Timer' });
    expect(prompt).toContain('Focus Timer');
    expect(prompt).toContain('en-US');
    expect(prompt).toContain('30 characters');
    expect(prompt).toContain('100 characters');
  });

  it('includes the seed material when present', () => {
    const prompt = buildListingPrompt({
      locale: 'en-US',
      appName: 'MyApp',
      about: 'A focus timer',
      keywords: ['focus', 'timer'],
      current: { subtitle: 'Old subtitle' },
    });
    expect(prompt).toContain('A focus timer');
    expect(prompt).toContain('focus, timer');
    expect(prompt).toContain('Old subtitle');
  });
});

describe('parseDraftListing', () => {
  it('parses a plain JSON object', () => {
    const draft = parseDraftListing('{"title":"MyApp","keywords":["focus","timer"]}');
    expect(draft).toEqual({ title: 'MyApp', keywords: ['focus', 'timer'] });
  });

  it('tolerates a ```json fence', () => {
    const draft = parseDraftListing('```json\n{"subtitle":"Stay on task"}\n```');
    expect(draft).toEqual({ subtitle: 'Stay on task' });
  });

  it('accepts comma-separated keywords as a string', () => {
    const draft = parseDraftListing('{"keywords":"focus, timer , "}');
    expect(draft.keywords).toEqual(['focus', 'timer']);
  });

  it('drops non-string fields and blanks', () => {
    const draft = parseDraftListing('{"title":"MyApp","subtitle":42,"description":"  "}');
    expect(draft).toEqual({ title: 'MyApp' });
  });

  it('throws on invalid JSON', () => {
    expect(() => parseDraftListing('not json')).toThrow(/valid JSON/);
  });

  it('throws when no usable field is present', () => {
    expect(() => parseDraftListing('{"unknown":"x"}')).toThrow(/no usable/);
  });
});

describe('createAnthropicListingGenerator', () => {
  const original = process.env['ANTHROPIC_API_KEY'];
  beforeEach(() => {
    delete process.env['ANTHROPIC_API_KEY'];
  });
  afterEach(() => {
    if (original === undefined) delete process.env['ANTHROPIC_API_KEY'];
    else process.env['ANTHROPIC_API_KEY'] = original;
  });

  it('labels itself with the resolved model', () => {
    expect(createAnthropicListingGenerator({ model: 'claude-test' }).name).toBe(
      'anthropic:claude-test',
    );
  });

  it('throws an actionable error when no API key is available', async () => {
    const generator = createAnthropicListingGenerator();
    await expect(generator.generate({ locale: 'en-US', appName: 'MyApp' })).rejects.toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });
});

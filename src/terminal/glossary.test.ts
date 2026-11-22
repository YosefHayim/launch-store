import { describe, expect, it } from 'vitest';
import { explainTopic, isGlossaryTopic, listTopics } from './glossary.ts';
describe('glossary - the single source for --explain and docs', () => {
  it('returns non-empty teaching text for every topic', () => {
    for (const topic of listTopics()) {
      const text = explainTopic(topic);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/TODO/i);
    }
  });
  it('narrows known strings and rejects unknown ones', () => {
    expect(isGlossaryTopic('csr')).toBe(true);
    expect(isGlossaryTopic('app-record')).toBe(true);
    expect(isGlossaryTopic('not-a-topic')).toBe(false);
    expect(isGlossaryTopic('')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { explainTopic, isGlossaryTopic, listTopics } from './glossary.ts';
function describeGlossaryTheSinglePieceForExplainAndDocs() {
  function returnsNonEmptyTeachingPieceForEveryTopic() {
    for (const topic of listTopics()) {
      const text = explainTopic(topic);
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/TODO/i);
    }
  }

  it('returns non-empty teaching text for every topic', returnsNonEmptyTeachingPieceForEveryTopic);

  function narrowsKnownStringsAndRejectsUnknownOnes() {
    expect(isGlossaryTopic('csr')).toBe(true);
    expect(isGlossaryTopic('app-record')).toBe(true);
    expect(isGlossaryTopic('not-a-topic')).toBe(false);
    expect(isGlossaryTopic('')).toBe(false);
  }

  it('narrows known strings and rejects unknown ones', narrowsKnownStringsAndRejectsUnknownOnes);
}

describe(
  'glossary - the single source for --explain and docs',
  describeGlossaryTheSinglePieceForExplainAndDocs,
);

import { describe, expect, it } from 'vitest';
import { explainTopic, isExplainTerm, listTopics } from './explain-terms.ts';

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
    expect(isExplainTerm('csr')).toBe(true);
    expect(isExplainTerm('app-record')).toBe(true);
    expect(isExplainTerm('not-a-topic')).toBe(false);
    expect(isExplainTerm('')).toBe(false);
  }

  it('narrows known strings and rejects unknown ones', narrowsKnownStringsAndRejectsUnknownOnes);
}

describe(
  'explain terms the explain command prints',
  describeGlossaryTheSinglePieceForExplainAndDocs,
);

import { describe, expect, it } from 'vitest';
import { isGlossaryTopic } from './glossary.js';
import { PIPELINE_PHASES } from './phases.js';
import { tourPhases, tourTopics } from './tour.js';

describe('tour — the first-run walkthrough', () => {
  it('covers exactly the pipeline phases, in order', () => {
    // Drift guard: if a phase is added to the pipeline spine, it must be narrated by the tour too.
    expect(tourPhases()).toEqual([...PIPELINE_PHASES]);
  });

  it('only references real glossary topics', () => {
    // Each step's teaching block is pulled from the glossary at render time; an unknown topic would
    // silently render nothing. Assert every topic the tour names is a real term.
    for (const topic of tourTopics()) {
      expect(isGlossaryTopic(topic)).toBe(true);
    }
  });
});

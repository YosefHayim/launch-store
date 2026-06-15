---
name: add-a-glossary-topic
description: Use when adding teaching text for a concept or step in launch-store — add it to the single glossary source that feeds both `launch explain` and the `--explain` step expansions.
---

# Add a glossary topic

## Use this when

- adding a `launch explain` topic
- adding teaching text for a new concept, step, or store term

## Steps

1. Add the topic to `src/core/glossary.ts` — the single source for teaching text. It feeds both `launch explain` and the `--explain` step expansions; never duplicate the strings elsewhere.
2. Bump the topic count in `src/core/glossary.test.ts` (`expect(topics.length).toBe(N)`) by the number of topics you added, and add a `toContain(...)` assertion per new topic.
3. Run the gate.

The `toBe(N)` count is a known merge hotspot: if a concurrent PR also added a topic, the count collides. On rebase, **sum** both additions rather than taking one side, and keep both topics.

See [AGENTS.md](../../../AGENTS.md).

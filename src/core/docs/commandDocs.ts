/**
 * Pure rendering + counting behind `npm run docs:gen`, split by output target into ./commandDocs/*.ts
 * and re-exported here so `import { … } from "./commandDocs.js"` is unchanged for the script and tests.
 *
 * The I/O half lives in `scripts/gen-docs.ts` — mirroring how `scripts/gen-asc-types.ts` keeps its
 * tested logic in `src/core/asc/specPatch.ts`. This module turns a plain description of the `launch`
 * command tree ({@link CommandSpec}) plus a few repo-wide counts ({@link DocStats}) into the two
 * committed, generated docs: `docs/commands.md` and `llms.txt`, plus the generated README regions.
 * Keeping the command surface defined in `src/cli` as the single source those docs derive from is what
 * stops the AI-facing and human-facing markdown from drifting out of sync with the real CLI.
 *
 * Modules: types (the input contract) · content (the canonical copy) · common (shared helpers) ·
 * commandReference (`docs/commands.md`) · llmsTxt (`llms.txt`) · readme (the generated README regions).
 */

export * from '../types.js';
export * from './commandDocs/content.js';
export * from './commandDocs/common.js';
export * from './commandDocs/commandReference.js';
export * from './commandDocs/llmsTxt.js';
export * from './commandDocs/readme.js';

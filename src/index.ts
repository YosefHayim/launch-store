/**
 * Public API of the `relaybuild` package — what a user's `relay.config.ts` imports.
 *
 * Re-exports only: the `defineConfig` helper for authoring a typed config, plus the config-shape
 * types so editors give completion and type-checking. The CLI itself is the `relay` bin; this entry
 * exists so `import { defineConfig } from "relaybuild"` resolves in a consumer's config file.
 */

export { defineConfig } from "./core/config.js";
export type { RelayConfigInput } from "./core/config.js";
export type { RelayConfig, BuildProfile } from "./core/types.js";

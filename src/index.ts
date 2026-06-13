/**
 * Public API of the `launch-store` package — what a user's `launch.config.ts` imports.
 *
 * Re-exports only: the `defineConfig` helper for authoring a typed config, plus the config-shape
 * types so editors give completion and type-checking. The CLI itself is the `launch` bin; this entry
 * exists so `import { defineConfig } from "launch-store"` resolves in a consumer's config file.
 */

export { defineConfig } from "./core/config.js";
export type { LaunchConfigInput } from "./core/config.js";
export type { LaunchConfig, BuildProfile } from "./core/types.js";

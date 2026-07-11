# ADR 0008 — Adopt **zod** as the config single source of truth

- **Status:** Superseded by [ADR 0013](./0013-effect-schema-config-ssot.md) — historical context only.
  — 2026-07-07
- **Context:** the config surface today is a hand-written `interface` + a hand-rolled validator + a
  generated JSON Schema — three artifacts kept in sync by hand. This ADR records the decision to fold them
  into one zod schema, and the tradeoff it accepts.

## Context

`launch.config.ts` is the product's whole contract with the user, and its shape is currently expressed
**three times**:

- the TypeScript **type** — hand-written interfaces in `src/core/types/config.ts` (`LaunchConfig`,
  `SubmitByPlatform`, the profile/release/OTA sub-shapes);
- the **validator** — hand-rolled `validateConfig` (`src/core/configSchema.ts`) + the cross-field
  `configSemantics` checks, run at load time against
- the **JSON Schema** — `schema/launch.config.schema.json`, generated from the type by
  `ts-json-schema-generator` and shipped for editor autocomplete on `launch.config.ts`.

This was a deliberate lean-dependency choice: `src/core/jsonSchema.ts` says as much — _"Why hand-rolled
instead of `ajv`: it keeps Launch's runtime dependency list lean"_ — and a $0 self-hosted CLI treats a
fast, small install as part of the pitch (5 runtime deps today). The cost is drift risk: a new config
field must be added to the interface, taught to the hand-rolled validator, and re-generated into the
schema, and nothing but review keeps the three honest. As the config surface grows (per-platform submit,
release trains, OTA channels, the store-object families), that three-way hand-sync is the fragile seam.

## Decision

Make a **zod v4** schema the single source of truth for the config surface:

```ts
// src/core/types/config.ts
export const LaunchConfigSchema = z.object({
  app: z.string(),
  submit: SubmitSchema, // z.union([z.string(), SubmitByPlatformSchema])
  /* … */
});
export type LaunchConfig = z.infer<typeof LaunchConfigSchema>; // the type is inferred, not hand-written
```

- **Type** = `z.infer<typeof LaunchConfigSchema>` — no hand-written config interface to drift.
- **Validation** = `LaunchConfigSchema.parse(loaded)` at the boundary (the jiti-loaded config), then the
  existing `configSemantics(config)` for cross-field rules zod can't express. `validateConfig`'s hand-rolled
  structural pass retires.
- **JSON Schema** = generated **from** zod (`z.toJSONSchema(LaunchConfigSchema)`), replacing the
  `ts-json-schema-generator` step. `schema/launch.config.schema.json` stays byte-shipped for editors; the
  generator script (`scripts/gen-*.ts`) points at zod.

Scope is the **config surface only**. Every other domain shape stays a hand-written `interface` in the
`src/core/types/` barrel (see `CODE-STYLE.md` → _Types live in one home_); zod is not adopted repo-wide.

### Why zod (over keeping hand-rolled, or ajv)

- One artifact instead of three — the type, the validator, and the JSON Schema all fall out of the schema,
  so a new field is added once. This is the drift the hand-rolled path can't structurally prevent.
- zod's parse errors are already user-shaped (path + message), which suits the boundary where a user's
  `launch.config.ts` is wrong — the exact surface `validateConfig` exists to serve.
- `ajv` would validate but not type; keeping the hand-rolled path preserves lean-install but loses the
  single-source win the growing config surface now needs.

## Consequences

- **+** A config field is defined once; type, boundary validation, and editor JSON Schema stay in lockstep
  by construction. `configSemantics` shrinks to only the genuinely cross-field rules.
- **+** Better boundary errors for a malformed `launch.config.ts` with no extra hand-rolled formatting.
- **−** Adds `zod` as the **6th runtime dependency**, reversing the explicit lean-dependency stance in
  `jsonSchema.ts`. Mitigation: use `zod/mini` (tree-shakeable) on the import path that ships, and keep zod
  confined to the config surface so the footprint is bounded. The `jsonSchema.ts` lean-deps note is updated
  to reference this ADR rather than contradict it.
- **−** A real migration: `types/config.ts` becomes schemas, `configSchema.ts`/`validateConfig` retires,
  the schema-generation script is rewired, and the pipeline's config-load call switches to `.parse`. It's
  staged (config types → validator → generator), guarded by the existing config tests, and lands as its own
  change — not a big-bang.
- **−** Two validation styles coexist during the migration (zod at the config boundary, hand-rolled
  elsewhere until each surface moves). `CODE-STYLE.md` marks the rule **_migration_** so new config work
  goes zod-first while old code is converted opportunistically (`deslop`).

## Out of scope

- Repo-wide zod adoption — non-config domain shapes stay hand-written interfaces in the barrel.
- The other five runtime deps (`@clack/prompts`, `chalk`, `commander`, `jiti`, `jose`) — audited healthy
  and current; unchanged.
- Runtime validation of **API responses** (ASC/Play wire types) — those keep mirroring the vendor API as
  interfaces (see ADR 0006 lineage and `CODE-STYLE.md` → tier 1); validating them is a separate question.

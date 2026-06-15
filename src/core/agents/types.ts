/**
 * The typed source of truth for Launch's cross-agent integration files.
 *
 * One registry ({@link import("./registry.js")}) describes what every coding agent should know about
 * Launch; the renderers ({@link import("./render.js")}) turn it into each agent's NATIVE primitive —
 * Claude Skills (`.claude/skills/<id>/SKILL.md`), Cursor Project Rules (`.cursor/rules/*.mdc`), and the
 * Codex/`AGENTS.md` convention — and the validator ({@link import("./validate.js")}) checks every command
 * a skill names still exists in the live `launch` program, so a renamed or removed command fails the
 * build instead of silently rotting a recipe. This file defines the shapes all three share.
 *
 * Two audiences live here. {@link ConsumerSkill}s teach an agent to DRIVE Launch inside a user's own
 * Expo / React Native app (scaffolded into their repo by `launch agents init`); {@link ContributorRule}s
 * teach an agent to WORK ON the launch-store codebase (committed here, generated beside the other docs).
 */

/** Which coding agent a generated artifact targets. */
export type AgentTarget = "claude" | "cursor" | "codex";

/**
 * One command in a skill's recipe, split so the validator can tell a real (sub)command from its
 * arguments. `path` is the exact command words after `launch` that MUST resolve in the live program
 * (e.g. `["metadata", "pull"]`, or just `["creds"]`); `args` are the positional values/action words that
 * follow (e.g. `["set-key"]`, `["ios"]`) and are NOT checked as commands. The rendered line is
 * `launch <path…> <args…>`. Splitting this way lets {@link import("./validate.js").findUnknownCommands}
 * catch both a renamed top-level command and a renamed subcommand, while leaving action words like
 * `creds set-key` (where `set-key` is an argument, not a subcommand) correctly unvalidated.
 */
export interface SkillStep {
  /** the exact (sub)command path after `launch`, validated against the live program. */
  path: string[];
  /** values, action words, or an illustrative flag that follow — rendered verbatim, never validated. */
  args?: string[];
  /** why this step exists, in one line — rendered beside the command. */
  note: string;
}

/**
 * A consumer-facing, task-scoped skill: one coherent thing an agent gets asked to do with Launch
 * ("ship to TestFlight", "publish an OTA update"). The {@link description} is the trigger an agent
 * matches on (Claude's skill `description`, Cursor's rule `description`), so it is written in the third
 * person and leads with the intent. `id` doubles as the file stem (`.claude/skills/<id>/SKILL.md`,
 * `.cursor/rules/<id>.mdc`).
 */
export interface ConsumerSkill {
  /** kebab-case id and file stem, e.g. `launch-ship`. */
  id: string;
  /** human title for the skill heading, e.g. `Ship to TestFlight / Play`. */
  title: string;
  /** third-person, intent-first triggering description an agent matches on to reach for this skill. */
  description: string;
  /** intent phrases the skill should fire on, rendered into the "Use this when…" list. */
  triggers: string[];
  /** the ordered happy-path recipe; every step's `path` is validated against the live program. */
  steps: SkillStep[];
  /** curated workflow prose (markdown) — the heart of the skill body, after the recipe. */
  body: string;
  /** skill-specific guardrails (e.g. release confirmation) layered on top of the base context's rails. */
  cautions?: string[];
  /**
   * The fuller command catalog for a LARGE skill, emitted as a bundled `reference.md` for Claude
   * (progressive disclosure) and flattened inline for Cursor / Codex. Omitted for small skills, which
   * stay self-contained. Each entry is a validated {@link SkillStep}, so the reference can't rot either.
   */
  reference?: {
    /** one-line lead-in for the reference section. */
    intro: string;
    /** the catalog, each command validated against the live program. */
    commands: SkillStep[];
  };
}

/** One row of the EAS → Launch command map shown in the always-on base context. */
export interface CommandMapRow {
  /** the Expo EAS command a user already knows. */
  eas: string;
  /** the Launch equivalent. */
  launch: string;
  /** the one-line nuance worth stating beside the mapping. */
  note: string;
}

/**
 * The autonomy boundary an agent is given when driving Launch: which commands it may run unattended,
 * and which irreversible ones demand explicit human confirmation first. Mirrors Launch's own
 * plan → confirm → apply ethos so an over-eager agent can't publish to production with `--yes`.
 */
export interface Guardrail {
  /** commands safe to run unattended (idempotent, reversible, or read-only) — `--yes` is allowed here. */
  free: string[];
  /** irreversible / outward-facing actions the agent must pause and get a human to confirm. */
  confirm: string[];
}

/**
 * The always-on base context: what every agent should know about a repo that ships with Launch,
 * regardless of the specific task. Rendered into the Cursor base rule (`alwaysApply`), the `AGENTS.md`
 * Launch section (which Codex always loads and a consumer's `CLAUDE.md` imports), so the agent always
 * knows Launch is present, how its commands map from EAS, and where the guardrails are.
 */
export interface BaseContext {
  /** what Launch is and the pipeline order, in a few sentences. */
  intro: string;
  /** the EAS → Launch command map an Expo user can lean on. */
  commandMap: CommandMapRow[];
  /** the safety rails (keychain secrets, `--explain`, config-as-source-of-truth, iOS needs a Mac). */
  rails: string[];
  /** the autonomy boundary for irreversible actions. */
  guardrail: Guardrail;
  /** the one-time bootstrap (install + verify) before any recipe runs. */
  bootstrap: string[];
}

/**
 * A contributor-facing Cursor rule for working ON the launch-store codebase. `AGENTS.md` stays the
 * canonical prose; these add what a flat file can't — PATH-triggered guidance Cursor attaches only when
 * the relevant files are open (e.g. the provider-registration rule when editing `src/providers/**`). The
 * base rule (`alwaysApply`, empty `globs`) simply points Cursor at `AGENTS.md`.
 */
export interface ContributorRule {
  /** file stem under `.cursor/rules/`, e.g. `providers` → `.cursor/rules/providers.mdc`. */
  file: string;
  /** the rule's Cursor `description` (used when agent-requested). */
  description: string;
  /** auto-attach globs; empty for the always-on base rule. */
  globs: string[];
  /** whether Cursor always applies this rule (true only for the base rule). */
  alwaysApply: boolean;
  /** the rule body (markdown) — short, and deferring to `AGENTS.md` for the full conventions. */
  body: string;
}

/**
 * A rendered artifact: a path relative to the repo it is written into, plus the full file contents.
 * Consumer files are written into a user's repo by `launch agents init`; contributor files are written
 * here under `.cursor/rules/` by `npm run docs:gen` and gated by `docs:check`.
 */
export interface GeneratedAgentFile {
  /** path relative to the target repo root, e.g. `.claude/skills/launch-ship/SKILL.md`. */
  path: string;
  /** the file contents, ready to write (already tidy markdown — no formatter pass needed). */
  body: string;
}

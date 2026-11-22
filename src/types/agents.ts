/**
 * One command in a skill's recipe, split so the validator can tell a real (sub)command from its
 * arguments. `path` is the exact command words after `launch` that MUST resolve in the live program
 * (e.g. `["metadata", "pull"]`, or just `["creds"]`); `args` are the positional values/action words that
 * follow (e.g. `["set-key"]`, `["ios"]`) and are NOT checked as commands. The rendered line is
 * `launch <path...> <args...>`. Splitting this way lets {@link import("../agents/validate.ts").findUnknownCommands}
 * catch both a renamed top-level command and a renamed subcommand, while leaving action words like
 * `creds set-key` (where `set-key` is an argument, not a subcommand) correctly unvalidated.
 */
export type SkillStep = Readonly<{
  path: readonly string[];
  args?: readonly string[];
  note: string;
}>;
/**
 * A consumer-facing, task-scoped skill: one coherent thing an agent gets asked to do with Launch
 * ("ship to TestFlight", "publish an OTA update"). The {@link description} is the trigger an agent
 * matches on (Claude's skill `description`, Cursor's rule `description`), so it is written in the third
 * person and leads with the intent. `id` doubles as the file stem (`.claude/skills/<id>/SKILL.md`,
 * `.cursor/rules/<id>.mdc`).
 */
export type ConsumerSkill = Readonly<{
  id: string;
  title: string;
  description: string;
  triggers: readonly string[];
  steps: readonly SkillStep[];
  body: string;
  cautions?: readonly string[];
  reference?: Readonly<{
    /** one-line lead-in for the reference section. */
    intro: string;
    /** the catalog, each command validated against the live program. */
    commands: readonly SkillStep[];
  }>;
}>;
/** One row of the EAS -> Launch command map shown in the always-on base context. */
type CommandMapRow = Readonly<{
  eas: string;
  launch: string;
  note: string;
}>;
/**
 * The autonomy boundary an agent is given when driving Launch: which commands it may run unattended,
 * and which irreversible ones demand explicit human confirmation first. Mirrors Launch's own
 * plan -> confirm -> apply ethos so an over-eager agent can't publish to production with `--yes`.
 */
type Guardrail = Readonly<{
  free: readonly string[];
  confirm: readonly string[];
}>;
/**
 * The always-on base context: what every agent should know about a repo that ships with Launch,
 * regardless of the specific task. Rendered into the Cursor base rule (`alwaysApply`), the `AGENTS.md`
 * Launch section (which Codex always loads and a consumer's `CLAUDE.md` imports), so the agent always
 * knows Launch is present, how its commands map from EAS, and where the guardrails are.
 */
export type BaseContext = Readonly<{
  intro: string;
  commandMap: readonly CommandMapRow[];
  rails: readonly string[];
  guardrail: Guardrail;
  bootstrap: readonly string[];
}>;
/**
 * A contributor-facing, task-scoped skill for working ON the launch-store codebase.
 * The committed copy lives at `.claude/skills/<id>/SKILL.md`.
 *
 * Unlike a {@link ConsumerSkill}, the `steps` are free-form markdown (npm scripts, file edits, prose) - a
 * contributor recipe describes the repo's own workflow, not the `launch` CLI surface, so there is no live
 * program command to validate them against (and {@link import("../agents/validate.ts").findUnknownCommands} only
 * walks {@link ConsumerSkill}s). `AGENTS.md` stays the canonical prose; these add Claude-native, intent-
 * triggered task recipes on top of it.
 */
export type ContributorSkill = Readonly<{
  id: string;
  title: string;
  description: string;
  triggers: readonly string[];
  steps: readonly string[];
  body: string;
  cautions?: readonly string[];
}>;
/**
 * A rendered artifact: a path relative to the repo it is written into, plus the full file contents.
 * Consumer files are written into a user's repo by `launch agents init`. Contributor files live
 * under `.claude/skills/`.
 */
export type GeneratedAgentFile = Readonly<{
  path: string;
  body: string;
}>;

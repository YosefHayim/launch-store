/**
 * `launch completion <bash|zsh|fish>` and `launch completion install` — tab-completion for the whole CLI.
 *
 * The discoverability on-ramp for a 59-command surface: `launch <Tab>` lists the commands, and the daily
 * user stops typoing app handles and flags. Thin commander wiring only — it prints the script
 * {@link completionScript} generates, hands install to {@link installCompletion}, and routes the hidden
 * `__complete` callback to {@link resolveCompletions}. All script generation, rc-file editing, and dynamic
 * value resolution live in `core/completion.ts`; no domain logic lives here.
 */

import type { Command } from "commander";
import { createLogger } from "../../core/logger.js";
import {
  COMPLETE_SUBCOMMAND,
  SHELLS,
  completionScript,
  detectShell,
  installCompletion,
  parseShell,
  resolveCompletions,
} from "../../core/completion.js";

/** Attach the `completion` command group (print, install, and the hidden `__complete` callback) to the program. */
export function registerCompletionCommand(program: Command): void {
  const completion = program
    .command("completion")
    .description("shell tab-completion for commands, flags, app handles, profiles, surfaces, and snapshots");

  completion
    .command("install")
    .description("wire completion into your shell's rc file (idempotent), or print the manual step")
    .option("-s, --shell <shell>", `shell to wire up: ${SHELLS.join(" | ")} (default: $SHELL)`)
    .action((options: { shell?: string }) => {
      const log = createLogger(false);
      const result = installCompletion(options.shell !== undefined ? { shell: parseShell(options.shell) } : {});
      if (result.status === "manual") {
        log.warn(`Could not edit ${result.rcFile} — its directory doesn't exist yet.`);
        log.tip(`Add this line to your ${result.shell} config, then restart your shell: ${result.line}`);
        return;
      }
      log.step("completion", `${result.updated ? "updated" : "installed"} for ${result.shell} in ${result.rcFile}`);
      log.tip("Restart your shell (or source the rc file) to activate it.");
    });

  completion
    .argument("[shell]", `print the completion script: ${SHELLS.join(" | ")} (default: $SHELL)`)
    .action((shell: string | undefined) => {
      const resolved = shell !== undefined ? parseShell(shell) : detectShell();
      if (!resolved) {
        throw new Error(`Could not detect your shell. Pass one explicitly: launch completion ${SHELLS.join("|")}.`);
      }
      process.stdout.write(completionScript(resolved));
    });

  completion
    .command(`${COMPLETE_SUBCOMMAND} [words...]`, { hidden: true })
    .description("internal: emit completion candidates for the words typed so far")
    .action(async (words: string[]) => {
      const candidates = await resolveCompletions(words, program);
      process.stdout.write(`${candidates.join("\n")}\n`);
    });
}

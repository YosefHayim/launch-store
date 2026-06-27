#!/usr/bin/env node
/**
 * Launch CLI entry point.
 *
 * Registers the built-in providers, then boots the command tree assembled in {@link buildProgram} and
 * lets commander dispatch. The command surface itself lives in {@link import("./program.js")} so the
 * docs generator can introspect it without launching the CLI; this file owns only the runtime boot.
 */

import { registerBuiltins } from '../providers/index.js';
import { migrateLegacyAccounts } from '../core/accounts.js';
import { runAutoUpgrade } from '../core/updateCheck.js';
import { buildProgram, readVersion } from './program.js';

/**
 * Boot the CLI: register providers, silently self-upgrade (guarded/throttled — usually an instant
 * no-op), then let commander dispatch. With no subcommand it falls through to the banner + wizard;
 * with a subcommand it runs that command. Both the upgrade and the banner degrade to no-ops in CI,
 * when piped, and for agents, so scripts are unaffected.
 */
async function main(): Promise<void> {
  registerBuiltins();
  await runAutoUpgrade(readVersion());
  // One-time, near-instant no-op after the first post-upgrade run: moves a pre-multi-account key into
  // the registry. Best-effort — a hiccup must not block the CLI; commands re-attempt it on next run.
  await migrateLegacyAccounts().catch(() => undefined);
  await buildProgram().parseAsync(process.argv);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

/**
 * `launch open [target]` — deep-link the current app's relevant web console page in the browser.
 *
 * The connective tissue between Launch's read-only diagnostics (`audit`, `status`, `iap doctor`, `store
 * doctor`) and the irreducible UI steps that fix them: those checks tell you *what's* wrong, `launch open`
 * jumps you to the *page* where you fix it. Thin commander wiring only — it parses the target/flags and
 * hands them to `core/consoleLinks.ts`, which owns target/platform parsing, app selection, the App Store
 * Connect id lookup, URL building, and the cross-platform opener. No domain logic lives here.
 */

import type { Command } from 'commander';
import {
  OPEN_TARGETS,
  openUrl,
  resolveOpenUrl,
  type OpenUrlOptions,
} from '../../core/consoleLinks.js';

/** Attach the top-level `open` command to the program. */
export function registerOpenCommand(program: Command): void {
  program
    .command('open')
    .description("deep-link the app's App Store Connect / Play Console page in your browser")
    .argument('[target]', `what to open: ${OPEN_TARGETS.join(' | ')} (default: asc)`)
    .option(
      '--platform <platform>',
      'ios/tvos/macos/visionos (App Store Connect) or android (Play Console)',
    )
    .option('-a, --app <name>', 'app handle to open (default: the first app for the platform)')
    .action(async (target: string | undefined, options: OpenUrlOptions) => {
      const url = await resolveOpenUrl(target, options);
      console.log(`Opening ${url}`);
      await openUrl(url);
    });
}

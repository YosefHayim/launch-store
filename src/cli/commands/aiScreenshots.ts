import type { Command } from 'commander';
import {
  aiScreenshotsCommandProgram,
  type AiScreenshotsInput,
} from '@core/listing/aiScreenshotsCommand.js';
import { aiGroup } from './ai.js';
import { runCliProgram } from '../runCliProgram.js';

/** Attach the `ai screenshots` subcommand. */
export const registerAiScreenshotsCommand = (program: Command): void => {
  const aiCommand = aiGroup(program);
  aiCommand
    .command('screenshots')
    .description(
      'enhance your real screenshots into store-ready ones with genshot (review with `launch plan screenshots`)',
    )
    .option('-a, --app <name>', "app handle (auto-selected if there's only one)")
    .option('--brief <text>', 'a short description of the app to steer the enhancement')
    .option(
      '--locale <list>',
      'comma-separated locales (default: the locales of your source screenshots, else en-US)',
    )
    .option('--platform <p>', 'ios, android, or all (default)', 'all')
    .option(
      '--in <dir>',
      'directory of real source screenshots to enhance (default: <app>/screenshots)',
    )
    .option(
      '--captions <list>',
      'comma-separated captions, one per shot (omit to let genshot write them)',
    )
    .option(
      '--device-types <list>',
      'comma-separated target slots (default: the modern iPhone/iPad + Play phone set)',
    )
    .option('--out <dir>', 'where to promote approved screenshots (default: <app>/screenshots)')
    .option('--genshot-bin <path>', 'path to the genshot CLI (default: genshot on PATH)')
    .option('--dry-run', 'enhance and preview, but promote nothing', false)
    .option('-y, --yes', 'skip the confirmation prompt (for CI)', false)
    .action((commandOptions: AiScreenshotsInput) =>
      runCliProgram(aiScreenshotsCommandProgram(commandOptions)),
    );
};

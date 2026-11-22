import type { Command } from '../cli/command.ts';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLaunchFileScaffold } from '../define-launch-file.ts';
import { pathExists } from '../path-exists.ts';
import { Prompts } from '../prompts.ts';

export class SetupCommand {
  constructor(private readonly prompts = new Prompts()) {}

  register(program: Command): void {
    program
      .command('init')
      .description('scaffold launch.config.ts into the current directory')
      .action(this.run);
  }

  run = async (): Promise<void> => {
    const launchFilePath = join(process.cwd(), 'launch.config.ts');
    const exists = await pathExists(launchFilePath);

    if (exists == false) {
      await writeFile(launchFilePath, createLaunchFileScaffold());
      console.log('Wrote launch.config.ts');
      return;
    }

    const isInteractive = this.prompts.isInteractive();

    if (isInteractive == false) {
      throw new Error('launch.config.ts already exists. Pass a terminal to overwrite it.');
    }

    const isConfirmed = await this.prompts.confirm('Overwrite launch.config.ts?');

    if (isConfirmed == false) {
      console.log('Left launch.config.ts untouched.');
      return;
    }

    await writeFile(launchFilePath, createLaunchFileScaffold());
    console.log('Wrote launch.config.ts');
  };
}

import type { Command } from '../cli/command.ts';
import { BuildPipeline, type ShipBuild } from './build-pipeline.ts';

interface BuildFlags {
  profile: string;
  dryRun: boolean;
  json: boolean;
  submit: boolean;
}

export class BuildCommand {
  constructor(private readonly pipeline = new BuildPipeline()) {}

  register(program: Command): void {
    program
      .command('build')
      .description('build locally and upload to the testing track (--no-submit to build only)')
      .argument('<platform>', 'ios or android')
      .option('-p, --profile <name>', 'build profile', 'production')
      .option('--dry-run', 'print the plan and change nothing', false)
      .option('--json', 'print one JSON object', false)
      .option('--no-submit', 'build only; do not upload')
      .action(this.run);
  }

  run = async (platformArgument: string, flags: BuildFlags): Promise<void> => {
    const platform = shipPlatform(platformArgument);
    const shipBuild: ShipBuild = {
      platform,
      profileName: flags.profile,
      isDryRun: flags.dryRun,
      workspaceDirectory: process.cwd(),
      shouldSubmit: flags.submit,
    };
    const binaryPath = await this.pipeline.run(shipBuild);
    const isDryRun = binaryPath == null;

    if (isDryRun) {
      this.printDryRun(flags.json);
      return;
    }

    const hasJson = flags.json == true;

    if (hasJson) {
      console.log(JSON.stringify({ binaryPath }));
      return;
    }

    console.log(binaryPath);
  };

  private printDryRun(hasJson: boolean): void {
    if (hasJson) {
      console.log(JSON.stringify({ binaryPath: null }));
      return;
    }

    console.log('Dry run');
  }
}

function shipPlatform(platformArgument: string): 'ios' | 'android' {
  const isIos = platformArgument == 'ios';

  if (isIos) {
    return 'ios';
  }

  const isAndroid = platformArgument == 'android';

  if (isAndroid) {
    return 'android';
  }

  throw new Error(
    `The ship path builds ios and android. ${platformArgument} stays on a later command.`,
  );
}

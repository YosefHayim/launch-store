import type { Command } from 'commander';
import { AppRelease } from '@/app-release.js';

interface ReleaseFlags {
  yes: boolean;
}

export class ReleaseCommand {
  constructor(private readonly appRelease = new AppRelease()) {}

  register(program: Command): void {
    program
      .command('release')
      .description('publish the tested build to the public store')
      .argument('<platform>', 'ios or android')
      .option('-y, --yes', 'publish without a prompt', false)
      .action(this.run);
  }

  run = async (platformArgument: string, flags: ReleaseFlags): Promise<void> => {
    const isSupported = isShipPlatform(platformArgument);

    if (isSupported == false) {
      throw new Error(
        `The ship path releases ios and android. ${platformArgument} stays on a later command.`,
      );
    }

    await this.appRelease.publish(flags.yes);
  };
}

function isShipPlatform(platformArgument: string): boolean {
  const isIos = platformArgument == 'ios';

  if (isIos) {
    return true;
  }

  return platformArgument == 'android';
}

import { Prompts } from '@/prompts.js';

export class AppRelease {
  constructor(private readonly prompts = new Prompts()) {}

  async publish(hasYes: boolean): Promise<void> {
    if (hasYes) {
      await this.publishNow();
      return;
    }

    const isInteractive = this.prompts.isInteractive();

    if (isInteractive == false) {
      throw new Error('Pass --yes to release without a terminal');
    }

    const isConfirmed = await this.prompts.confirm('Publish this version to the store?');

    if (isConfirmed == false) {
      return;
    }

    await this.publishNow();
  }

  private async publishNow(): Promise<void> {
    throw new Error(
      'Choosing the store version and sending it live is the next slice. The confirm gate is in place.',
    );
  }
}

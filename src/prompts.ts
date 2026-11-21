import { confirm as askConfirm, isCancel } from '@clack/prompts';
import { stdin, stdout } from 'node:process';

export class Prompts {
  isInteractive(): boolean {
    const isInputTerminal = stdin.isTTY == true;

    if (isInputTerminal == false) {
      return false;
    }

    return stdout.isTTY == true;
  }

  async confirm(message: string): Promise<boolean> {
    const answer = await askConfirm({ message });
    const isDeclined = isCancel(answer);

    if (isDeclined) {
      return false;
    }

    return answer == true;
  }
}

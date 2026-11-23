// Builds the Launch commands and parses the arguments the user passed.

import { buildProgram } from './cli/program.ts';

export class Program {
  async parse(launchVersion: string): Promise<void> {
    const program = buildProgram(launchVersion);

    program.exitOverride();
    await program.parseAsync(process.argv);
  }
}

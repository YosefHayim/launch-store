import { buildProgram } from '@/cli/program.js';

export class Program {
  parse = async (launchVersion: string): Promise<void> => {
    const program = buildProgram(launchVersion);

    program.exitOverride();
    await program.parseAsync(process.argv);
  };
}

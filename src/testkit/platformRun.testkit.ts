export async function runOnNodePlatform<ProgramAnswer>(
  program: Promise<ProgramAnswer>,
): Promise<ProgramAnswer> {
  return program;
}

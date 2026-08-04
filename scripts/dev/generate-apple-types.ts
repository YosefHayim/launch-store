import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Schema } from 'effect';
import openapiTs, { astToString } from 'openapi-typescript';
import { ASC_SPEC_URL, generatedHeader, pickSpecEntry } from '@apple/generated/specPatch.ts';

const AppleSpecMetadata = Schema.Struct({
  openapi: Schema.String,
  info: Schema.Struct({ version: Schema.String }),
});
const executeFile = promisify(execFile);
const outputPath = fileURLToPath(new URL('../../src/apple/generated/schema.ts', import.meta.url));

const main = async (): Promise<void> => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'asc-spec-'));
  try {
    process.stdout.write(`Downloading ${ASC_SPEC_URL}\n`);
    const specDownload = await fetch(ASC_SPEC_URL);
    if (!specDownload.ok) {
      throw new Error(`spec download failed: ${specDownload.status} ${specDownload.statusText}`);
    }

    const archivePath = join(temporaryDirectory, 'spec.zip');
    await writeFile(archivePath, Buffer.from(await specDownload.arrayBuffer()));
    const extractedDirectory = join(temporaryDirectory, 'out');
    await executeFile('unzip', ['-o', '-q', archivePath, '-d', extractedDirectory]);
    const specEntry = pickSpecEntry(await readdir(extractedDirectory, { recursive: true }));
    if (!specEntry) {
      throw new Error(`no spec file found in the archive at ${ASC_SPEC_URL}`);
    }

    const specText = await readFile(join(extractedDirectory, specEntry), 'utf8');
    const specMetadata = Schema.decodeUnknownSync(AppleSpecMetadata)(JSON.parse(specText));
    process.stdout.write(
      `Generating types from OpenAPI ${specMetadata.openapi}, spec version ${specMetadata.info.version}\n`,
    );
    const generatedTypes = astToString(await openapiTs(specText));
    await writeFile(outputPath, generatedHeader(specMetadata) + generatedTypes);
    process.stdout.write(`Wrote ${outputPath}\n`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
};

await main();

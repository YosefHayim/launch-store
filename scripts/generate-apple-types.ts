import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTypeScript, { astToString } from 'openapi-typescript';
import { ASC_SPEC_URL, generatedHeader, pickSpecEntry } from '../src/generated/apple/specPatch.js';

const schemaPath = fileURLToPath(new URL('../src/generated/apple/schema.ts', import.meta.url));

interface AppleSpecVersion {
  openapi: string;
  info: { version: string };
}

interface LooseAppleSpec {
  openapi?: unknown;
  info?: { version?: unknown };
}

function readSpecVersion(specText: string): AppleSpecVersion {
  const parsed: unknown = JSON.parse(specText);
  const isNotAnObject = typeof parsed != 'object';

  if (isNotAnObject) {
    throw new Error('The App Store Connect spec is not a JSON object');
  }

  const isEmpty = parsed == null;

  if (isEmpty) {
    throw new Error('The App Store Connect spec is not a JSON object');
  }

  const spec = parsed as LooseAppleSpec;
  const openapi = spec.openapi;
  const isOpenApiMissing = typeof openapi != 'string';

  if (isOpenApiMissing) {
    throw new Error('The App Store Connect spec is missing openapi');
  }

  const info = spec.info;
  const isInfoMissing = info == null;

  if (isInfoMissing) {
    throw new Error('The App Store Connect spec is missing info.version');
  }

  const version = info.version;
  const isVersionMissing = typeof version != 'string';

  if (isVersionMissing) {
    throw new Error('The App Store Connect spec is missing info.version');
  }

  return { openapi, info: { version } };
}

async function main(): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'asc-spec-'));

  try {
    process.stdout.write(`Downloading ${ASC_SPEC_URL}\n`);
    const specDownload = await fetch(ASC_SPEC_URL);
    const isDownloadFailed = specDownload.ok == false;

    if (isDownloadFailed) {
      throw new Error(`Could not download the App Store Connect spec (${specDownload.status})`);
    }

    const archivePath = join(temporaryDirectory, 'spec.zip');
    const archiveBytes = Buffer.from(await specDownload.arrayBuffer());
    await writeFile(archivePath, archiveBytes);

    const extractedDirectory = join(temporaryDirectory, 'out');
    execFileSync('unzip', ['-o', '-q', archivePath, '-d', extractedDirectory]);

    const archiveEntries = await readdir(extractedDirectory, {
      recursive: true,
      encoding: 'utf8',
    });
    const specEntry = pickSpecEntry(archiveEntries);
    const isSpecMissing = specEntry == null;

    if (isSpecMissing) {
      throw new Error(`No spec file found in the archive at ${ASC_SPEC_URL}`);
    }

    const specText = await readFile(join(extractedDirectory, specEntry), 'utf8');
    const specVersion = readSpecVersion(specText);
    process.stdout.write(
      `Generating types from OpenAPI ${specVersion.openapi}, spec version ${specVersion.info.version}\n`,
    );

    const generatedSyntax = await openapiTypeScript(specText);
    const generatedTypes = astToString(generatedSyntax);
    await writeFile(schemaPath, generatedHeader(specVersion) + generatedTypes);
    process.stdout.write(`Wrote ${schemaPath}\n`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

await main();

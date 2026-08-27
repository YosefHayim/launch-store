import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureCommandOutput, provideNodeCommandServices } from '../core/services/exec.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'cli', 'index.js');
const GENERATION_ID = 'generation-e2e-427';
let workDirectory: string;
let fakeGenshotPath: string;
let promotedDirectory: string;

/** Encode the minimum PNG header Launch needs to measure an iPhone 6.7-inch screenshot. */
const pngBytes = (): Buffer => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const imageHeader = Buffer.alloc(16);
  imageHeader.writeUInt32BE(13, 0);
  imageHeader.write('IHDR', 4, 'ascii');
  imageHeader.writeUInt32BE(1290, 8);
  imageHeader.writeUInt32BE(2796, 12);
  return Buffer.concat([signature, imageHeader]);
};

/** Drive the compiled Launch CLI from the hermetic app fixture. */
const launch = (...commandArguments: string[]): Promise<string> =>
  Effect.runPromise(
    provideNodeCommandServices(
      captureCommandOutput('node', [CLI, ...commandArguments], {
        workingDirectory: workDirectory,
      }),
    ),
  );

beforeAll(() => {
  expect(existsSync(CLI), 'Run `pnpm build` before the e2e suite.').toBe(true);
  workDirectory = mkdtempSync(join(tmpdir(), 'launch-ai-screenshots-e2e-'));
  promotedDirectory = join(workDirectory, 'promoted');
  const sourceDirectory = join(workDirectory, 'screenshots', 'en-US', 'APP_IPHONE_67');
  mkdirSync(sourceDirectory, { recursive: true });
  writeFileSync(
    join(workDirectory, 'app.json'),
    `${JSON.stringify({ expo: { name: 'Manifest fixture', slug: 'manifest-fixture' } })}\n`,
  );
  writeFileSync(join(sourceDirectory, 'source.png'), pngBytes());
  fakeGenshotPath = join(workDirectory, 'fake-genshot.mjs');
  writeFileSync(
    fakeGenshotPath,
    `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const commandArguments = process.argv.slice(2);
const outputFlagIndex = commandArguments.indexOf('--out');
if (outputFlagIndex < 0) throw new Error('missing --out');
const outputDirectory = commandArguments[outputFlagIndex + 1];
mkdirSync(outputDirectory, { recursive: true });
const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const imageHeader = Buffer.alloc(16);
imageHeader.writeUInt32BE(13, 0);
imageHeader.write('IHDR', 4, 'ascii');
imageHeader.writeUInt32BE(1290, 8);
imageHeader.writeUInt32BE(2796, 12);
writeFileSync(join(outputDirectory, 'panel-1.png'), Buffer.concat([signature, imageHeader]));
writeFileSync(join(outputDirectory, 'genshot-generation.json'), JSON.stringify({
  schemaVersion: 1,
  generationId: '${GENERATION_ID}',
  status: 'succeeded',
  targetStore: 'app_store',
  targetImageType: 'store_screenshot',
  requestedImageCount: 1,
  deliveredImageCount: 1,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:01:00.000Z',
  generatedImages: [{
    generatedImageId: 'generated-image-e2e-427',
    imageNumber: 1,
    status: 'delivered',
    file: 'panel-1.png',
  }],
}, null, 2) + '\\n');
console.log('Generation ID: ${GENERATION_ID}');
`,
  );
  chmodSync(fakeGenshotPath, 0o755);
});

afterAll(() => {
  rmSync(workDirectory, { recursive: true, force: true });
});

describe('launch ai screenshots - compiled CLI', () => {
  it('promotes an image and retained manifest while naming the Generation ID', async () => {
    const commandOutput = await launch(
      'ai',
      'screenshots',
      '--app',
      'manifest-fixture',
      '--platform',
      'ios',
      '--locale',
      'en-US',
      '--device-types',
      'APP_IPHONE_67',
      '--out',
      promotedDirectory,
      '--genshot-bin',
      fakeGenshotPath,
      '--yes',
    );
    const targetDirectory = join(promotedDirectory, 'en-US', 'APP_IPHONE_67');
    const retainedManifestPath = join(targetDirectory, `genshot-generation-${GENERATION_ID}.json`);
    expect(existsSync(join(targetDirectory, 'panel-1.png'))).toBe(true);
    expect(existsSync(retainedManifestPath)).toBe(true);
    expect(JSON.parse(readFileSync(retainedManifestPath, 'utf8')).generationId).toBe(GENERATION_ID);
    expect(commandOutput).toMatch(new RegExp(`Genshot Generation ID: ${GENERATION_ID}`));
    expect(commandOutput).toMatch(new RegExp(`Retained Genshot Generation ID ${GENERATION_ID}`));
  });
});

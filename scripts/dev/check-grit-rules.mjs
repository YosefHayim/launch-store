#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const biomeExecutable = fileURLToPath(
  new URL('../../node_modules/@biomejs/biome/bin/biome', import.meta.url),
);
const plantedSource = [
  'const selectedStore = configuredStore ?? defaultStore;',
  'const storeName = configuredStore || defaultStore;',
].join('\n');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'launch-grit-'));
const fixturePath = join(temporaryDirectory, 'style-rule-fixture.mjs');
let biomeCheck;
try {
  writeFileSync(fixturePath, plantedSource, 'utf8');
  biomeCheck = spawnSync(
    biomeExecutable,
    [
      'lint',
      '--config-path',
      join(repositoryRoot, 'biome.json'),
      '--diagnostic-level=error',
      fixturePath,
    ],
    { encoding: 'utf8' },
  );
} finally {
  unlinkSync(fixturePath);
  rmdirSync(temporaryDirectory);
}
const diagnosticText = `${biomeCheck.stdout}${biomeCheck.stderr}`;
const expectedDiagnostics = [
  'Decode absence at the owning boundary',
  'Use an explicit domain branch instead of logical-or fallback',
];
const missingDiagnostics = expectedDiagnostics.filter(
  (expectedDiagnostic) => !diagnosticText.includes(expectedDiagnostic),
);
if ([biomeCheck.status === 0, missingDiagnostics.length > 0].includes(true)) {
  process.stderr.write(diagnosticText);
  process.stderr.write(`Grit self-test missed: ${missingDiagnostics.join(', ')}\n`);
  process.exit(1);
}
process.stdout.write('Grit self-test passed 2 planted violation(s).\n');

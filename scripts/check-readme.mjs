import { readFileSync } from 'node:fs';

const readme = readFileSync('README.md', 'utf8');
const commands = [
  'launch init',
  'launch credentials',
  'launch build ios',
  'launch build android',
  'launch release ios',
  'launch release android',
  'launch plan',
  'launch sync',
  'launch adopt',
];
const missing = commands.filter(function isMissing(command) {
  return !readme.includes(command);
});

if (missing.length > 0) {
  console.error(`README.md is missing: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('[OK] README lists the launch commands');

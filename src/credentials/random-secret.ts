// Makes a random hex secret for a credential Launch generates on this machine.

import { randomBytes } from 'node:crypto';

export function randomHexSecret(byteCount: number): string {
  return randomBytes(byteCount).toString('hex');
}

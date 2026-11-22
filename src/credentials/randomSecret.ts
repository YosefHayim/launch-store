import { randomBytes } from 'node:crypto';

export function randomHexSecret(byteCount: number): string {
  return randomBytes(byteCount).toString('hex');
}

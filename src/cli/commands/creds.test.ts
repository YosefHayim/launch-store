/**
 * Tests for the `creds` command's pure helpers. {@link isInDiscoveryDir} gates the offer to delete an
 * imported key's plaintext source (issue #4): only keys sitting in a scanned "dumping ground" are
 * offered for removal, never a key the user deliberately placed elsewhere.
 */

import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isInDiscoveryDir } from './creds.js';

describe('isInDiscoveryDir — only offer to delete keys from scanned dumping grounds (issue #4)', () => {
  it('matches a key sitting directly in ~/Downloads', () => {
    expect(isInDiscoveryDir(join(homedir(), 'Downloads', 'AuthKey_ABC123.p8'))).toBe(true);
  });

  it('matches a service-account JSON in the current working directory', () => {
    expect(isInDiscoveryDir(join(process.cwd(), 'service-account.json'))).toBe(true);
  });

  it('leaves a deliberately-placed key (outside the scanned dirs) untouched', () => {
    expect(isInDiscoveryDir(join(homedir(), 'vault', 'AuthKey_ABC123.p8'))).toBe(false);
  });

  it('does not match a key one level deeper than a discovery dir', () => {
    expect(isInDiscoveryDir(join(homedir(), 'Downloads', 'keys', 'AuthKey.p8'))).toBe(false);
  });
});

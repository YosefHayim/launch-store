import { describe, expect, it } from 'vitest';

import launchFile from './fixture/launch.config.js';
import { printLaunchFile, readLaunchFile } from './launch-file.js';
import { loadLaunchFile } from './load-launch-file.js';

describe('readLaunchFile', () => {
  it('reads the fixture', async () => {
    const loaded = await loadLaunchFile('src/config/fixture/launch.config.ts');

    expect(launchFile.apps[0]?.name).toBe('My App');
    expect(loaded.apps[0]?.name).toBe('My App');
  });

  it('rejects an empty app list', () => {
    expect(() => readLaunchFile({ apps: [] })).toThrow('at least one app');
  });
});

describe('printLaunchFile', () => {
  it('prints a file defineConfig can read again', () => {
    const launchFile = readLaunchFile({
      apps: [
        {
          name: 'My App',
          projectPath: '.',
          ios: null,
          android: { packageName: 'com.example.app', version: '1.0.0', track: 'internal' },
        },
      ],
    });
    const printed = printLaunchFile(launchFile);

    expect(printed).toContain('"My App"');
    expect(printed).toContain('ios: null');
  });
});

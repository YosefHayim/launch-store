import { describe, expect, it } from 'vitest';
import { configTemplate, detectAppRoot } from './config-scaffold.ts';
import type { AppDescriptor } from '../types/app.ts';
function app(dir: string): AppDescriptor {
  return { name: 'x', dir, configPath: `${dir}/app.json` };
}
function describeDetectAppRoot() {
  function returnsTheSingleSharedSubdirWhenEveryAppLivesUnderOne() {
    const appRoot = detectAppRoot([app('/repo/apps/a'), app('/repo/apps/b')], '/repo');
    expect(appRoot).toBe('./apps');
  }

  it(
    'returns the single shared subdir when every app lives under one',
    returnsTheSingleSharedSubdirWhenEveryAppLivesUnderOne,
  );
  function returnsNullWhenAnAppSitsAtTheRepoRoot() {
    const appRoot = detectAppRoot([app('/repo')], '/repo');
    expect(appRoot).toBeNull();
  }

  it('returns null when an app sits at the repo root', returnsNullWhenAnAppSitsAtTheRepoRoot);
  function returnsNullWhenAppsSpanMoreThanOneTopLevelSubdir() {
    const appRoot = detectAppRoot([app('/repo/apps/a'), app('/repo/packages/b')], '/repo');
    expect(appRoot).toBeNull();
  }

  it(
    'returns null when apps span more than one top-level subdir',
    returnsNullWhenAppsSpanMoreThanOneTopLevelSubdir,
  );
}

describe('detectAppRoot', describeDetectAppRoot);
function describePieceTemplate() {
  function writesTheBlankStarterWithACommentedAppRootsHintWhenNoRootOrExtrasAreGiven() {
    const template = configTemplate(null);
    expect(template).toContain('import { defineConfig } from "launch-store";');
    expect(template).toContain('// appRoots:');
    expect(template).not.toContain('products:');
    expect(template.trimEnd().endsWith('});')).toBe(true);
  }

  it(
    'writes the blank starter (with a commented appRoots hint) when no root or extras are given',
    writesTheBlankStarterWithACommentedAppRootsHintWhenNoRootOrExtrasAreGiven,
  );
  function injectsAnExtraSectionJustBeforeTheClosingCall() {
    const template = configTemplate('./apps', '  products: { foo: {} },');
    expect(template).toContain('appRoots: ["./apps"]');
    expect(template).toContain('  products: { foo: {} },');
    expect(template.indexOf('products: { foo: {} },')).toBeLessThan(template.lastIndexOf('});'));
  }

  it(
    'injects an extra section just before the closing call',
    injectsAnExtraSectionJustBeforeTheClosingCall,
  );
  function emitsAnArtifactDirLineOnlyWhenOneIsSupplied() {
    const template = configTemplate(null);
    expect(template).not.toContain('artifactDir:');
    const withDir = configTemplate(null, undefined, undefined, './.launch/artifacts');
    expect(withDir).toContain('artifactDir: "./.launch/artifacts",');
  }

  it(
    'emits an artifactDir line only when one is supplied',
    emitsAnArtifactDirLineOnlyWhenOneIsSupplied,
  );
}

describe('configTemplate', describePieceTemplate);

import { describe, expect, it } from 'vitest';
import { configTemplate, detectAppRoot } from './config-scaffold.ts';
import type { AppDescriptor } from '../types/app.ts';
const app = (dir: string): AppDescriptor => ({ name: 'x', dir, configPath: `${dir}/app.json` });
describe('detectAppRoot', () => {
  it('returns the single shared subdir when every app lives under one', () => {
    const appRoot = detectAppRoot([app('/repo/apps/a'), app('/repo/apps/b')], '/repo');
    expect(appRoot).toBe('./apps');
  });
  it('returns null when an app sits at the repo root', () => {
    const appRoot = detectAppRoot([app('/repo')], '/repo');
    expect(appRoot).toBeNull();
  });
  it('returns null when apps span more than one top-level subdir', () => {
    const appRoot = detectAppRoot([app('/repo/apps/a'), app('/repo/packages/b')], '/repo');
    expect(appRoot).toBeNull();
  });
});
describe('configTemplate', () => {
  it('writes the blank starter (with a commented appRoots hint) when no root or extras are given', () => {
    const template = configTemplate(null);
    expect(template).toContain('import { defineConfig } from "launch-store";');
    expect(template).toContain('// appRoots:');
    expect(template).not.toContain('products:');
    expect(template.trimEnd().endsWith('});')).toBe(true);
  });
  it('injects an extra section just before the closing call', () => {
    const template = configTemplate('./apps', '  products: { foo: {} },');
    expect(template).toContain('appRoots: ["./apps"]');
    expect(template).toContain('  products: { foo: {} },');
    expect(template.indexOf('products: { foo: {} },')).toBeLessThan(template.lastIndexOf('});'));
  });
  it('emits an artifactDir line only when one is supplied', () => {
    const template = configTemplate(null);
    expect(template).not.toContain('artifactDir:');
    const withDir = configTemplate(null, undefined, undefined, './.launch/artifacts');
    expect(withDir).toContain('artifactDir: "./.launch/artifacts",');
  });
});

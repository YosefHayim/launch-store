import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { parseSizeBudget, registerBuildCommand } from './build.js';

describe('parseSizeBudget — the per-run size-budget CLI boundary', () => {
  it('returns undefined when the flag is omitted (→ profile, then default)', () => {
    expect(parseSizeBudget(undefined)).toBeUndefined();
  });

  it('parses a positive MB number, including fractional values', () => {
    expect(parseSizeBudget('250')).toBe(250);
    expect(parseSizeBudget('199.5')).toBe(199.5);
  });

  it('rejects zero and negative budgets with a clear message', () => {
    expect(() => parseSizeBudget('0')).toThrow(/greater than 0/);
    expect(() => parseSizeBudget('-5')).toThrow(/greater than 0/);
  });

  it('rejects non-numeric input with a clear message', () => {
    expect(() => parseSizeBudget('big')).toThrow(/Invalid --size-budget "big"/);
  });
});

describe('registerBuildCommand — the size-budget flag and its alias', () => {
  function buildCommand() {
    const program = new Command();
    registerBuildCommand(program);
    const build = program.commands.find((command) => command.name() === 'build');
    expect(build).toBeDefined();
    return build;
  }

  it('exposes --size-budget and its --budget alias', () => {
    const flags = buildCommand()?.options.map((option) => option.long);
    expect(flags).toContain('--size-budget');
    expect(flags).toContain('--budget');
  });
});

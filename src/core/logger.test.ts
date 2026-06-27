/**
 * Tests for the logger's plain, non-TTY rendering. Under vitest stdout isn't a TTY, so every helper
 * takes its plain branch — exactly the path CI logs and pipes hit. We assert that path: the `box` and
 * `shipped` receipts, the `notice` checkpoint, the `step` label title-casing, and the `chip` highlight
 * (which collapses to the bare value off a TTY, with no escapes or padding leaking into captured logs).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger.js';

describe('logger plain (non-TTY) rendering', () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    vi.spyOn(console, 'log').mockImplementation((message?: string) => {
      lines.push(message ?? '');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("box prints the title then each row indented when output isn't a TTY", () => {
    createLogger(false).box('Synced', ['3 apps', '0 errors']);
    expect(lines).toContain('Synced');
    expect(lines).toContain('  3 apps');
    expect(lines).toContain('  0 errors');
  });

  it("shipped prints the Shipped title then each row indented when output isn't a TTY (no boat)", async () => {
    await createLogger(false).shipped([
      'pomedero 1.0.0 (42)',
      'download 47.2 MB · on disk 61.3 MB',
    ]);
    expect(lines).toContain('Shipped');
    expect(lines).toContain('  pomedero 1.0.0 (42)');
    expect(lines).toContain('  download 47.2 MB · on disk 61.3 MB');
  });

  it('notice prints a lead line followed by indented detail lines', () => {
    createLogger(false).notice('⬆ Upload to TestFlight', 'pomedero 1.0.0 (build 42)');
    expect(lines.some((line) => line.includes('⬆ Upload to TestFlight'))).toBe(true);
    expect(lines.some((line) => line.includes('pomedero 1.0.0 (build 42)'))).toBe(true);
  });

  it('step title-cases a plain lowercase label but leaves dotted/cased identifiers verbatim', () => {
    const log = createLogger(false);
    log.step('native project', 'using existing ios/');
    log.step('com.loopi.pomedero', 'already in sync');
    expect(lines.some((line) => line.includes('Native Project'))).toBe(true);
    expect(lines.some((line) => line.includes('com.loopi.pomedero'))).toBe(true);
    expect(lines.some((line) => line.includes('Com.loopi.pomedero'))).toBe(false);
  });

  it('chip collapses to the bare value off a TTY — no escapes or padding in captured logs', () => {
    expect(createLogger(false).chip('29.7 MB')).toBe('29.7 MB');
  });
});

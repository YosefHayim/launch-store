import { describe, expect, it } from 'vitest';
import { UTF8_LOCALE, isUtf8ShellLocale, mergeChildEnv, shellLocaleDoctorCheck } from './locale.js';

describe('mergeChildEnv', () => {
  it('forces UTF-8 locale over broken shell defaults', () => {
    const env = mergeChildEnv();
    expect(env['LANG']).toBe(UTF8_LOCALE.LANG);
    expect(env['LANGUAGE']).toBe(UTF8_LOCALE.LANGUAGE);
    expect(env['LC_ALL']).toBe(UTF8_LOCALE.LC_ALL);
  });

  it('lets explicit caller env override the UTF-8 defaults', () => {
    const env = mergeChildEnv({ LC_ALL: 'fr_FR.UTF-8' });
    expect(env['LC_ALL']).toBe('fr_FR.UTF-8');
  });
});

describe('isUtf8ShellLocale', () => {
  it('accepts common UTF-8 spellings', () => {
    expect(isUtf8ShellLocale({ LANG: 'en_US.UTF-8' })).toBe(true);
    expect(isUtf8ShellLocale({ LC_ALL: 'C.UTF-8' })).toBe(true);
    expect(isUtf8ShellLocale({ LANGUAGE: 'en_US.utf8' })).toBe(true);
  });

  it('rejects US-ASCII and unset locale', () => {
    expect(isUtf8ShellLocale({ LANG: 'C' })).toBe(false);
    expect(isUtf8ShellLocale({ LC_ALL: 'US-ASCII' })).toBe(false);
    expect(isUtf8ShellLocale({})).toBe(false);
  });

  it('prefers LC_ALL over LANG', () => {
    expect(isUtf8ShellLocale({ LC_ALL: 'US-ASCII', LANG: 'en_US.UTF-8' })).toBe(false);
    expect(isUtf8ShellLocale({ LC_ALL: 'en_US.UTF-8', LANG: 'C' })).toBe(true);
  });
});

describe('shellLocaleDoctorCheck', () => {
  it('reports ok when the shell is UTF-8', () => {
    expect(shellLocaleDoctorCheck({ LANG: 'en_US.UTF-8' })).toEqual({
      status: 'ok',
      title: 'Shell locale (en_US.UTF-8)',
    });
  });

  it('reports info with a fix hint when the shell is not UTF-8', () => {
    const check = shellLocaleDoctorCheck({ LANG: 'C' });
    expect(check.status).toBe('info');
    expect(check.title).toBe('Shell locale (C)');
    expect(check.hint).toContain('Launch sets UTF-8');
  });
});

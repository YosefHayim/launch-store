import { describe, expect, it } from 'vitest';
import { UTF8_LOCALE, mergeChildEnv } from './locale.ts';

function describeMergeChildPiece() {
  function forcesUTF8LocaleOverBrokenShellDefaults() {
    const env = mergeChildEnv({});
    expect(env['LANG']).toBe(UTF8_LOCALE.LANG);
    expect(env['LANGUAGE']).toBe(UTF8_LOCALE.LANGUAGE);
    expect(env['LC_ALL']).toBe(UTF8_LOCALE.LC_ALL);
  }

  it('forces UTF-8 locale over broken shell defaults', forcesUTF8LocaleOverBrokenShellDefaults);

  function letsExplicitCallerPieceOverrideTheUTF8Defaults() {
    const env = mergeChildEnv({}, { LC_ALL: 'fr_FR.UTF-8' });
    expect(env['LC_ALL']).toBe('fr_FR.UTF-8');
  }

  it(
    'lets explicit caller env override the UTF-8 defaults',
    letsExplicitCallerPieceOverrideTheUTF8Defaults,
  );
}

describe('mergeChildEnv', describeMergeChildPiece);

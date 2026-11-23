import { describe, expect, it } from 'vitest';
import { makeLogRedactor, redactLine, redactText } from './redact.ts';

function describeRedactLine() {
  function masksSecretLookingAssignmentsButLeavesPublishableOnes() {
    expect(redactLine('API_TOKEN=abc123')).toBe('API_TOKEN=***');
    expect(redactLine('ANDROID_KEYSTORE_PASSWORD: testpass1')).toBe(
      'ANDROID_KEYSTORE_PASSWORD: ***',
    );
    expect(redactLine('signing.store.password=testpass2')).toBe('signing.store.password=***');
    // a _KEY qualified as public is shippable, so it stays visible
    expect(redactLine('EXPO_PUBLIC_API_KEY=pk_live_visible')).toBe(
      'EXPO_PUBLIC_API_KEY=pk_live_visible',
    );
    expect(redactLine('BUILD_NUMBER=42')).toBe('BUILD_NUMBER=42');
  }

  it(
    'masks secret-looking assignments but leaves publishable ones',
    masksSecretLookingAssignmentsButLeavesPublishableOnes,
  );

  function stripsJWTsBearerTokensAndAWSAccessKeys() {
    expect(redactLine('auth eyJhbGciOi.eyJpayload1.sigsigsig done')).toContain('[redacted-jwt]');
    expect(redactLine('Authorization: Bearer abc.def-ghi')).toBe('Authorization: Bearer ***');
    expect(redactLine('using AKIAIOSFODNN7EXAMPLE here')).toContain('[redacted-aws-key]');
  }

  it('strips JWTs, bearer tokens, and AWS access keys', stripsJWTsBearerTokensAndAWSAccessKeys);

  function leavesOrdinaryBuildPieceUntouched() {
    expect(redactLine('▸ Compiling main.m')).toBe('▸ Compiling main.m');
    expect(redactLine('> Task :app:bundleRelease')).toBe('> Task :app:bundleRelease');
  }

  it('leaves ordinary build output untouched', leavesOrdinaryBuildPieceUntouched);
}

describe('redactLine', describeRedactLine);

function describeRedactPiece() {
  function removesMultiLinePEMKeyBlocksWhileKeepingSurroundingLines() {
    // The PEM fences are assembled at runtime so no scannable private-key literal lives in this file;
    // the body is obvious filler, not a real DER prefix. redactText still sees a valid block to strip.
    function fence(edge: 'BEGIN' | 'END'): string {
      return ['-----', edge, ' PRIVATE KEY-----'].join('');
    }

    const log = [
      'before the key',
      fence('BEGIN'),
      'AAAAfakekeybodyAAAA',
      'BBBBfakekeybodyBBBB',
      fence('END'),
      'after the key',
    ].join('\n');
    const out = redactText(log);

    expect(out).toContain('before the key');
    expect(out).toContain('after the key');
    expect(out).toContain('[redacted-key-material]');
    expect(out).not.toContain('AAAAfakekeybodyAAAA');
  }

  it(
    'removes multi-line PEM key blocks while keeping surrounding lines',
    removesMultiLinePEMKeyBlocksWhileKeepingSurroundingLines,
  );
}

describe('redactText', describeRedactPiece);

function describeMakeLogRedactor() {
  function showsTheErrorLinesThatFollowAPEMBlockThatNeverCloses() {
    const redactOutputLine = makeLogRedactor();

    function redactLine(line: string) {
      return redactOutputLine(line);
    }

    const redactedLines = [
      '-----BEGIN PRIVATE KEY-----',
      'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
      'a1b2c3d4e5f6',
      'error: signing failed',
    ].map(redactLine);

    expect(redactedLines).toEqual([
      '[redacted-key-material]',
      '[redacted-key-material]',
      '[redacted-key-material]',
      'error: signing failed',
    ]);
  }

  it(
    'shows the error lines that follow a PEM block that never closes',
    showsTheErrorLinesThatFollowAPEMBlockThatNeverCloses,
  );
}

describe('makeLogRedactor', describeMakeLogRedactor);

function describeStructuredAndStreamedSecrets() {
  function masksJSONPropertiesIncludingQuotedSecretValues() {
    expect(redactLine('{"private_key":"dummy-private-key"}')).not.toContain('dummy-private-key');
    expect(redactLine('{"password":"dummy\\"rest-of-password"}')).not.toContain('rest-of-password');
  }

  it(
    'masks JSON properties including quoted secret values',
    masksJSONPropertiesIncludingQuotedSecretValues,
  );

  function masksConnectionStringsAndProviderTokens() {
    expect(redactLine('DATABASE_URL=postgres://app:dummy-pass@db.example/app')).toBe(
      'DATABASE_URL=***',
    );
    expect(redactLine('see postgres://app:dummy-pass@db.example/app later')).not.toContain(
      'dummy-pass',
    );
    expect(redactLine('key sk-ant-dummykeyvalue1234')).toContain('[redacted-api-key]');
    expect(redactLine('ghp_dummytokenvalue1234567890')).toContain('[redacted-github-token]');
    expect(redactLine('AIzaSyDummyGoogleKeyValue1234567')).toContain('[redacted-google-key]');
    expect(redactLine('ya29.dummy-google-access-token')).toContain('[redacted-google-token]');
  }

  it('masks connection strings and provider tokens', masksConnectionStringsAndProviderTokens);
}

describe('structured and streamed secrets', describeStructuredAndStreamedSecrets);

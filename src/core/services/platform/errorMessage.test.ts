import { describe, expect, it } from 'vitest';
import { errorMessage, hasMessage } from './errorMessage.js';
describe('errorMessage', () => {
  it("returns an Error's message verbatim", () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });
  it('returns the message of an Error subclass', () => {
    class HttpError extends Error {}
    expect(errorMessage(new HttpError('404 not found'))).toBe('404 not found');
  });
  it('coerces a thrown string to itself', () => {
    expect(errorMessage('plain string')).toBe('plain string');
  });
  it('coerces non-Error thrown values with String()', () => {
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
    expect(errorMessage({ code: 'X' })).toBe('[object Object]');
  });
});
describe('hasMessage', () => {
  it('accepts an Error and a tagged failure with a message', () => {
    expect(hasMessage(new Error('boom'))).toBe(true);
    expect(hasMessage({ _tag: 'ProviderInputFailure', message: 'S3 read failed' })).toBe(true);
  });
  it('rejects values without a string message', () => {
    expect(hasMessage({ message: 42 })).toBe(false);
    expect(hasMessage({ code: 'X' })).toBe(false);
    expect(hasMessage(null)).toBe(false);
    expect(hasMessage('boom')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { errorMessage } from './errorMessage.js';

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

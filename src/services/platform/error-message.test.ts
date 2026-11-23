import { describe, expect, it } from 'vitest';
import { errorMessage, hasMessage } from './error-message.ts';

function describeErrorMessage() {
  function returnsAnErrorSMessageVerbatim() {
    const failureMessage = errorMessage(new Error('boom'));
    expect(failureMessage).toBe('boom');
  }

  it("returns an Error's message verbatim", returnsAnErrorSMessageVerbatim);

  function returnsTheMessageOfAnErrorSubclass() {
    class HttpError extends Error {}
    const failureMessage = errorMessage(new HttpError('404 not found'));
    expect(failureMessage).toBe('404 not found');
  }

  it('returns the message of an Error subclass', returnsTheMessageOfAnErrorSubclass);

  function coercesAThrownStringToItself() {
    const failureMessage = errorMessage('plain string');
    expect(failureMessage).toBe('plain string');
  }

  it('coerces a thrown string to itself', coercesAThrownStringToItself);

  function coercesNonErrorThrownValuesWithString() {
    const failureMessage = errorMessage(42);

    expect(failureMessage).toBe('42');
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('undefined');
    expect(errorMessage({ code: 'X' })).toBe('[object Object]');
  }

  it('coerces non-Error thrown values with String()', coercesNonErrorThrownValuesWithString);
}

describe('errorMessage', describeErrorMessage);

function describeHasMessage() {
  function acceptsAnErrorAndATaggedFailureWithAMessage() {
    expect(hasMessage(new Error('boom'))).toBe(true);
    expect(hasMessage({ _tag: 'ProviderInputFailure', message: 'S3 read failed' })).toBe(true);
  }

  it(
    'accepts an Error and a tagged failure with a message',
    acceptsAnErrorAndATaggedFailureWithAMessage,
  );

  function rejectsValuesWithoutAStringMessage() {
    expect(hasMessage({ message: 42 })).toBe(false);
    expect(hasMessage({ code: 'X' })).toBe(false);
    expect(hasMessage(null)).toBe(false);
    expect(hasMessage('boom')).toBe(false);
  }

  it('rejects values without a string message', rejectsValuesWithoutAStringMessage);
}

describe('hasMessage', describeHasMessage);

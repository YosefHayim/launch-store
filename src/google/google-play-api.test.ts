import { describe, expect, it } from 'vitest';

import { GooglePlayApi } from './google-play-api.js';

function recordGoogleCall(recordedPaths: string[], path: string[]): object {
  function callGoogle(): Promise<{ data: { reviews: [] } }> {
    recordedPaths.push(path.join('.'));
    return Promise.resolve({ data: { reviews: [] } });
  }

  return new Proxy(callGoogle, {
    get(receiver, propertyName) {
      if (propertyName === 'then') {
        return undefined;
      }

      const member = Reflect.get(receiver, propertyName);
      const isFunction = typeof member === 'function';

      if (isFunction) {
        return member;
      }

      return recordGoogleCall(recordedPaths, [...path, String(propertyName)]);
    },
  });
}

function methodNames(prototype: object): string[] {
  return Object.getOwnPropertyNames(prototype).filter((name) => name !== 'constructor');
}

describe('Google Play API', () => {
  it('exposes every Android Publisher method the installed client declares', () => {
    const names = methodNames(GooglePlayApi.prototype);

    expect(names).toHaveLength(145);
    expect(names).toContain('listReviews');
  });

  it('lists reviews through the official client path', async () => {
    const recordedPaths: string[] = [];
    const api = new GooglePlayApi('{}', recordGoogleCall(recordedPaths, []) as never);
    const listedReviews = await api.listReviews({ packageName: 'com.example.app' });

    expect(recordedPaths).toEqual(['reviews.list']);
    expect(listedReviews).toEqual({ reviews: [] });
  });
});

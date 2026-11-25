import { describe, expect, it } from 'vitest';

import { PlayReportingApi } from './play-reporting-api.js';

function recordGoogleCall(recordedPaths: string[], path: string[]): object {
  function callGoogle(): Promise<{ data: { apps: [] } }> {
    recordedPaths.push(path.join('.'));
    return Promise.resolve({ data: { apps: [] } });
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

describe('Play reporting API', () => {
  it('exposes every Play Developer Reporting v1beta1 method', () => {
    const names = methodNames(PlayReportingApi.prototype);

    expect(names).toHaveLength(25);
    expect(names).toContain('searchApps');
    expect(names).toContain('searchVitalsErrorsReports');
    expect(names).toContain('listAnomalies');
  });

  it('searches apps through the official client path', async () => {
    const recordedPaths: string[] = [];
    const api = new PlayReportingApi('{}', recordGoogleCall(recordedPaths, []) as never);
    const foundApps = await api.searchApps({ pageSize: 10 });

    expect(recordedPaths).toEqual(['apps.search']);
    expect(foundApps).toEqual({ apps: [] });
  });
});

import { describe, expect, it } from 'vitest';
import { AppStoreConnectApi } from './appStoreConnectApi.js';
import { AppStoreConnectClient } from './ascClient.js';

type RecordedAppleCall = {
  kind: 'json' | 'text' | 'bytes';
  method: string;
  url: string;
  accept: string | null;
};

class RecordingApple extends AppStoreConnectClient {
  readonly calls: RecordedAppleCall[] = [];

  constructor() {
    super({ keyId: 'KEY', issuerId: 'ISSUER', p8: 'not-a-key' });
  }

  override async sendJson<Document>(method: string, pathOrUrl: string): Promise<Document> {
    this.calls.push({ kind: 'json', method, url: pathOrUrl, accept: null });
    return {} as Document;
  }

  override async sendText(method: string, pathOrUrl: string, accept: string): Promise<string> {
    this.calls.push({ kind: 'text', method, url: pathOrUrl, accept });
    return '';
  }

  override async sendBytes(method: string, pathOrUrl: string, accept: string): Promise<Buffer> {
    this.calls.push({ kind: 'bytes', method, url: pathOrUrl, accept });
    return Buffer.from('gzip');
  }
}

const methodNames = (prototype: object): string[] => {
  return Object.getOwnPropertyNames(prototype).filter((name) => name !== 'constructor');
};

describe('App Store Connect API', () => {
  it('exposes one method for every OpenAPI operation in spec 4.6.1', () => {
    const names = methodNames(AppStoreConnectApi.prototype);

    expect(names).toHaveLength(1342);
    expect(names).toContain('listApps');
    expect(names).toContain('listFinanceReports');
    expect(names).toContain('listNominations');
    expect(names).toContain('createAccessibilityDeclarations');
    expect(names).toContain('createRetentionMessages');
  });

  it('lists apps with a bracket filter on the absolute collection URL', async () => {
    const apple = new RecordingApple();
    const api = new AppStoreConnectApi(apple);

    await api.listApps({ 'filter[bundleId]': ['com.example.app'] });

    expect(apple.calls).toEqual([
      {
        kind: 'json',
        method: 'GET',
        url: 'https://api.appstoreconnect.apple.com/v1/apps?filter[bundleId]=com.example.app',
        accept: null,
      },
    ]);
  });

  it('downloads finance reports as gzip bytes', async () => {
    const apple = new RecordingApple();
    const api = new AppStoreConnectApi(apple);

    const reportBytes = await api.listFinanceReports({
      'filter[vendorNumber]': ['123456'],
      'filter[reportType]': ['FINANCIAL'],
      'filter[regionCode]': ['US'],
      'filter[reportDate]': ['2026-01'],
    });

    expect(reportBytes.equals(Buffer.from('gzip'))).toBe(true);
    expect(apple.calls).toEqual([
      {
        kind: 'bytes',
        method: 'GET',
        url: 'https://api.appstoreconnect.apple.com/v1/financeReports?filter[vendorNumber]=123456&filter[reportType]=FINANCIAL&filter[regionCode]=US&filter[reportDate]=2026-01',
        accept: 'application/a-gzip',
      },
    ]);
  });

  it('reads one-time offer codes as CSV and deletes with no body', async () => {
    const apple = new RecordingApple();
    const api = new AppStoreConnectApi(apple);

    const codes = await api.getInAppPurchaseOfferCodeOneTimeUseCodesValues('code/1');
    const removed = await api.deleteAccessibilityDeclarations('decl/1');

    expect(codes).toBe('');
    expect(removed).toBeUndefined();
    expect(apple.calls).toEqual([
      {
        kind: 'text',
        method: 'GET',
        url: 'https://api.appstoreconnect.apple.com/v1/inAppPurchaseOfferCodeOneTimeUseCodes/code%2F1/values',
        accept: 'text/csv',
      },
      {
        kind: 'json',
        method: 'DELETE',
        url: 'https://api.appstoreconnect.apple.com/v1/accessibilityDeclarations/decl%2F1',
        accept: null,
      },
    ]);
  });
});

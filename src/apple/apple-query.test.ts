import { describe, expect, it } from 'vitest';
import { appleDocumentationUrl, appleRequestUrl, writeAppleQuery } from './apple-query.js';

describe('apple query', () => {
  it('keeps filter brackets and joins array fields with commas', () => {
    const queryText = writeAppleQuery({
      'filter[bundleId]': ['com.example.app', 'com.example.other'],
      limit: 200,
      include: 'appInfos',
    });

    expect(queryText).toBe(
      'filter[bundleId]=com.example.app%2Ccom.example.other&limit=200&include=appInfos',
    );
  });

  it('drops empty lists and missing fields', () => {
    expect(writeAppleQuery({ limit: undefined, include: [] })).toBe('');
    expect(writeAppleQuery(undefined)).toBe('');
  });

  it('fills the resource id and documents the operation', () => {
    expect(appleRequestUrl('/v1/apps/{id}', 'app/1', undefined)).toBe(
      'https://api.appstoreconnect.apple.com/v1/apps/app%2F1',
    );
    expect(appleDocumentationUrl('GET', '/v1/appStoreVersions/{id}')).toBe(
      'https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_',
    );
  });
});

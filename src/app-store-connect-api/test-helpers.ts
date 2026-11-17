import { generateKeyPairSync } from 'node:crypto';
import { Schema } from 'effect';
import type { AscKey } from '@core/types/credentials.js';
import { expectDefined } from '@testkit/assertions.testkit.js';

export const makeKey = (): AscKey => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    keyId: 'KEY123',
    issuerId: 'issuer-uuid',
    p8: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
};
export const fakeResponse = (
  status: number,
  responseText: string,
  headers: Record<string, string> = {},
): Response => {
  let responseBody: string | null = responseText;
  if (status === 204) responseBody = null;
  return new Response(responseBody, { status, headers });
};
export const fakeBinaryResponse = (
  status: number,
  bytes: string,
  errorResponseText = '',
): Response => {
  let responseBody = errorResponseText;
  if (status >= 200 && status < 300) responseBody = bytes;
  return new Response(responseBody, { status });
};
export const readRequestDocument = (requestInit: RequestInit): unknown => {
  if (typeof requestInit.body !== 'string') throw new Error('expected a JSON request body');
  return Schema.decodeUnknownSync(Schema.parseJson())(requestInit.body);
};
export const requestHeaders = (requestInit: RequestInit): Headers =>
  new Headers(requestInit.headers);
export const documentValueAt = (document: unknown, path: readonly (number | string)[]): unknown => {
  let currentValue = document;
  for (const pathPart of path) {
    if (typeof pathPart === 'number') {
      if (!Array.isArray(currentValue)) throw new Error('expected a JSON array');
      currentValue = currentValue[pathPart];
      continue;
    }
    if (typeof currentValue !== 'object') throw new Error('expected a JSON object');
    if (currentValue === null) throw new Error('expected a JSON object');
    currentValue = Reflect.get(currentValue, pathPart);
  }
  return currentValue;
};
export const numberClaim = (claims: Record<string, unknown>, claimName: string): number => {
  const claim = claims[claimName];
  if (typeof claim !== 'number') throw new Error(`expected numeric JWT claim ${claimName}`);
  return claim;
};
const JwtPartSchema = Schema.parseJson(
  Schema.Record({ key: Schema.String, value: Schema.Unknown }),
);
export const decodeJwt = (
  token: string,
): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
} => {
  const [header, jwtClaims] = token.split('.');
  return {
    header: Schema.decodeUnknownSync(JwtPartSchema)(
      Buffer.from(expectDefined(header, 'JWT header'), 'base64url').toString(),
    ),
    payload: Schema.decodeUnknownSync(JwtPartSchema)(
      Buffer.from(expectDefined(jwtClaims, 'JWT payload'), 'base64url').toString(),
    ),
  };
};

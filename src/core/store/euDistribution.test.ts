import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { AlternativeDistributionDomainResource } from '../types/appleCatalog.js';
import { summarize } from './reconcile.js';
import {
  type AscEuDistributionApi,
  parseEuDistributionConfig,
  reconcileEuDistributionDomains,
} from './euDistribution.js';
import type { EuDistributionConfig } from '../types/storeSurface.js';
/** A hand-rolled {@link AscEuDistributionApi} - no network - serving `existing` and recording creates. */
const makeApi = (
  existing: AlternativeDistributionDomainResource[],
): {
  api: AscEuDistributionApi;
  created: {
    domain: string;
    referenceName: string;
  }[];
} => {
  const created: {
    domain: string;
    referenceName: string;
  }[] = [];
  const api: AscEuDistributionApi = {
    listAlternativeDistributionDomains: () => Effect.succeed(existing),
    createAlternativeDistributionDomain: (domain, referenceName) => {
      created.push({ domain, referenceName });
      return Effect.void;
    },
  };
  return { api, created };
};
/** Execute the EU-distribution reconciler at the test boundary. */
const runReconcile = (api: AscEuDistributionApi, config: EuDistributionConfig, dryRun: boolean) =>
  Effect.runPromise(reconcileEuDistributionDomains(api, config, dryRun));
const CONFIG: EuDistributionConfig = {
  domains: [
    { domain: 'downloads.acme.com', referenceName: 'Acme Downloads' },
    { domain: 'cdn.acme.com', referenceName: 'Acme CDN' },
  ],
};
const decodeEuDistributionConfig = (rawDocument: unknown) =>
  Effect.runSync(parseEuDistributionConfig(rawDocument));
describe('parseEuDistributionConfig', () => {
  it('parses an array of domains', () => {
    expect(decodeEuDistributionConfig(CONFIG)).toEqual(CONFIG);
  });
  it('rejects a non-object document, an array, and a missing/empty domains list', () => {
    expect(() => decodeEuDistributionConfig('nope')).toThrow(/must be a JSON object/);
    expect(() => decodeEuDistributionConfig([])).toThrow(/must be a JSON object/);
    expect(() => decodeEuDistributionConfig({})).toThrow(/domains/);
    expect(() => decodeEuDistributionConfig({ domains: [] })).toThrow(/non-empty/);
    expect(() => decodeEuDistributionConfig({ domains: {} })).toThrow(/domains/);
  });
  it('rejects a domain entry missing domain or referenceName', () => {
    expect(() => decodeEuDistributionConfig({ domains: [{ referenceName: 'x' }] })).toThrow(
      /domain/,
    );
    expect(() => decodeEuDistributionConfig({ domains: [{ domain: 'x' }] })).toThrow(
      /referenceName/,
    );
  });
});
describe('reconcileEuDistributionDomains', () => {
  it("creates only the domains Apple doesn't already have", async () => {
    const { api, created } = makeApi([{ id: 'd1', domain: 'downloads.acme.com' }]);
    const actions = await runReconcile(api, CONFIG, false);
    expect(created).toEqual([{ domain: 'cdn.acme.com', referenceName: 'Acme CDN' }]);
    expect(summarize(actions)).toEqual({ applied: 1, failed: 0, skipped: 0 });
    expect(actions[0]?.description).toBe('authorize distribution domain cdn.acme.com (Acme CDN)');
  });
  it('makes no changes when every domain is already authorized', async () => {
    const { api, created } = makeApi([
      { id: 'd1', domain: 'downloads.acme.com' },
      { id: 'd2', domain: 'cdn.acme.com' },
    ]);
    const actions = await runReconcile(api, CONFIG, false);
    expect(actions).toHaveLength(0);
    expect(created).toHaveLength(0);
  });
  it('plans but does not create on a dry-run', async () => {
    const { api, created } = makeApi([]);
    const actions = await runReconcile(api, CONFIG, true);
    expect(created).toHaveLength(0);
    expect(actions.map((action) => action.status)).toEqual(['planned', 'planned']);
  });
  it('captures a failed create without aborting the rest of the walk', async () => {
    const { api } = makeApi([]);
    api.createAlternativeDistributionDomain = (domain) => {
      if (domain === 'downloads.acme.com') return Effect.fail(new Error('invalid domain'));
      return Effect.void;
    };
    const actions = await runReconcile(api, CONFIG, false);
    const summary = summarize(actions);
    expect(summary).toEqual({ applied: 1, failed: 1, skipped: 0 });
    expect(actions.find((action) => action.status === 'failed')?.error).toBe('invalid domain');
  });
});

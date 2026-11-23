import { describe, expect, it } from 'vitest';
import type { AlternativeDistributionDomainResource } from '@/types/apple-catalog.js';
import { summarize } from '../shared/reconcile.ts';
import {
  type AscEuDistributionApi,
  parseEuDistributionConfig,
  reconcileEuDistributionDomains,
} from './eu-distribution.ts';
import type { EuDistributionConfig } from '@/types/store-surface.js';
import type { ActionStatus } from '@/types/reconcile.js';

/** A hand-rolled {@link AscEuDistributionApi} - no network - serving `existing` and recording creates. */
function makeApi(existing: AlternativeDistributionDomainResource[]): {
  api: AscEuDistributionApi;
  created: {
    domain: string;
    referenceName: string;
  }[];
} {
  const created: {
    domain: string;
    referenceName: string;
  }[] = [];
  const api: AscEuDistributionApi = {
    listAlternativeDistributionDomains() {
      return Promise.resolve(existing);
    },
    createAlternativeDistributionDomain(domain, referenceName) {
      created.push({ domain, referenceName });
      return Promise.resolve();
    },
  };

  return { api, created };
}

/** Execute the EU-distribution reconciler at the test boundary. */
function runReconcile(api: AscEuDistributionApi, config: EuDistributionConfig, dryRun: boolean) {
  return reconcileEuDistributionDomains(api, config, dryRun);
}
const CONFIG: EuDistributionConfig = {
  domains: [
    { domain: 'downloads.acme.com', referenceName: 'Acme Downloads' },
    { domain: 'cdn.acme.com', referenceName: 'Acme CDN' },
  ],
};

function decodeEuDistributionConfig(rawDocument: unknown) {
  return parseEuDistributionConfig(rawDocument);
}

function describeParseEuDistributionPiece() {
  function parsesAnArrayOfDomains() {
    const decodeEuDistribution = decodeEuDistributionConfig(CONFIG);
    expect(decodeEuDistribution).toEqual(CONFIG);
  }

  it('parses an array of domains', parsesAnArrayOfDomains);

  function rejectsANonObjectDocumentAnArrayAndAMissingEmptyDomainsList() {
    function callDecodeEuDistributionPiece() {
      return decodeEuDistributionConfig('nope');
    }

    expect(callDecodeEuDistributionPiece).toThrow(/must be a JSON object/);

    function callDecodeEuDistributionPiece2() {
      return decodeEuDistributionConfig([]);
    }

    expect(callDecodeEuDistributionPiece2).toThrow(/must be a JSON object/);

    function callDecodeEuDistributionPiece3() {
      return decodeEuDistributionConfig({});
    }

    expect(callDecodeEuDistributionPiece3).toThrow(/domains/);

    function callDecodeEuDistributionPiece4() {
      return decodeEuDistributionConfig({ domains: [] });
    }

    expect(callDecodeEuDistributionPiece4).toThrow(/non-empty/);

    function callDecodeEuDistributionPiece5() {
      return decodeEuDistributionConfig({ domains: {} });
    }

    expect(callDecodeEuDistributionPiece5).toThrow(/domains/);
  }

  it(
    'rejects a non-object document, an array, and a missing/empty domains list',
    rejectsANonObjectDocumentAnArrayAndAMissingEmptyDomainsList,
  );

  function rejectsADomainPieceMissingDomainOrReferenceName() {
    function callDecodeEuDistributionPiece6() {
      return decodeEuDistributionConfig({ domains: [{ referenceName: 'x' }] });
    }

    expect(callDecodeEuDistributionPiece6).toThrow(/domain/);

    function callDecodeEuDistributionPiece7() {
      return decodeEuDistributionConfig({ domains: [{ domain: 'x' }] });
    }

    expect(callDecodeEuDistributionPiece7).toThrow(/referenceName/);
  }

  it(
    'rejects a domain entry missing domain or referenceName',
    rejectsADomainPieceMissingDomainOrReferenceName,
  );
}

describe('parseEuDistributionConfig', describeParseEuDistributionPiece);

function describeReconcileEuDistributionDomains() {
  async function createsOnlyTheDomainsAppleDoesnTAlreadyHave() {
    const { api, created } = makeApi([{ id: 'd1', domain: 'downloads.acme.com' }]);
    const actions = await runReconcile(api, CONFIG, false);

    expect(created).toEqual([{ domain: 'cdn.acme.com', referenceName: 'Acme CDN' }]);
    expect(summarize(actions)).toEqual({ applied: 1, failed: 0, skipped: 0 });
    expect(actions[0]?.description).toBe('authorize distribution domain cdn.acme.com (Acme CDN)');
  }

  it(
    "creates only the domains Apple doesn't already have",
    createsOnlyTheDomainsAppleDoesnTAlreadyHave,
  );

  async function makesNoChangesWhenEveryDomainIsAlreadyAuthorized() {
    const { api, created } = makeApi([
      { id: 'd1', domain: 'downloads.acme.com' },
      { id: 'd2', domain: 'cdn.acme.com' },
    ]);
    const actions = await runReconcile(api, CONFIG, false);

    expect(actions).toHaveLength(0);
    expect(created).toHaveLength(0);
  }

  it(
    'makes no changes when every domain is already authorized',
    makesNoChangesWhenEveryDomainIsAlreadyAuthorized,
  );

  async function plansButDoesNotCreateOnADryRun() {
    const { api, created } = makeApi([]);
    const actions = await runReconcile(api, CONFIG, true);

    expect(created).toHaveLength(0);

    function readStatus(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status;
    }

    expect(actions.map(readStatus)).toEqual(['planned', 'planned']);
  }

  it('plans but does not create on a dry-run', plansButDoesNotCreateOnADryRun);

  async function capturesAFailedCreateWithoutAbortingTheRestOfTheWalk() {
    const { api } = makeApi([]);

    function runDomain(domain: string) {
      if (domain == 'downloads.acme.com') return Promise.reject(new Error('invalid domain'));

      return Promise.resolve();
    }

    api.createAlternativeDistributionDomain = runDomain;

    const actions = await runReconcile(api, CONFIG, false);
    const summary = summarize(actions);

    expect(summary).toEqual({ applied: 1, failed: 1, skipped: 0 });

    function isFailedAction(action: {
      readonly description: string;
      readonly destructive: boolean;
      status: ActionStatus;
      error?: string;
    }) {
      return action.status == 'failed';
    }

    expect(actions.find(isFailedAction)?.error).toBe('invalid domain');
  }

  it(
    'captures a failed create without aborting the rest of the walk',
    capturesAFailedCreateWithoutAbortingTheRestOfTheWalk,
  );
}

describe('reconcileEuDistributionDomains', describeReconcileEuDistributionDomains);

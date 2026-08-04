import { Effect, Schema } from 'effect';
import type { AlternativeDistributionDomainResource } from '../types/appleCatalog.js';
import { plan, type ReconcileContext } from './reconcile.js';
import { errorMessage } from '../services/errorMessage.js';
import type { PlannedAction } from '../types/reconcile.js';
import type { EuDistributionConfig } from '../types/storeSurface.js';
import {
  decodeStoreSurfaceConfig,
  loadStoreSurfaceConfig,
  type StoreSurfaceConfigFailure,
} from './surfaceConfig.js';

const EuDistributionDomainSchema = Schema.mutable(
  Schema.Struct({
    domain: Schema.String.pipe(
      Schema.nonEmptyString({
        message: () => 'eu-distribution.config.json: domain must be a non-empty string.',
      }),
    ),
    referenceName: Schema.String.pipe(
      Schema.nonEmptyString({
        message: () => 'eu-distribution.config.json: referenceName must be a non-empty string.',
      }),
    ),
  }),
);

export const EuDistributionConfigSchema = Schema.mutable(
  Schema.Struct({
    domains: Schema.mutable(Schema.Array(EuDistributionDomainSchema)).pipe(
      Schema.minItems(1, {
        message: () => 'eu-distribution.config.json must declare a non-empty "domains" array.',
      }),
    ),
  }),
);

const EuDistributionConfigSpec = {
  documentName: 'eu-distribution.config.json',
  displayName: 'EU distribution config',
  missingMessage: (configPath: string) =>
    `No EU distribution config at ${configPath}. Create one (see \`launch eu-distribution --help\`) or pass --config.`,
  schema: EuDistributionConfigSchema,
};
/**
 * The exact slice of {@link AppStoreConnectClient} the domain reconciler depends on. Declaring it here
 * (rather than taking the concrete client) keeps the diff logic unit-testable with a hand-rolled fake;
 * `AppStoreConnectClient` satisfies it structurally, mirroring {@link AscReleaseApi} in `releaseAttrs.ts`.
 */
export type AscEuDistributionApi = {
  listAlternativeDistributionDomains(): Effect.Effect<
    AlternativeDistributionDomainResource[],
    unknown
  >;
  createAlternativeDistributionDomain(
    domain: string,
    referenceName: string,
  ): Effect.Effect<void, unknown>;
};
/**
 * Reconcile the team's authorized distribution domains: create each declared domain Apple doesn't already
 * have (matched on `domain`), leaving undeclared ones untouched. Every write is captured per-action so a
 * single failure never aborts the run.
 */
export const reconcileEuDistributionDomains = (
  api: AscEuDistributionApi,
  config: EuDistributionConfig,
  dryRun: boolean,
): Effect.Effect<PlannedAction[], unknown> =>
  Effect.gen(function* () {
    const reconcileContext: ReconcileContext = { actions: [], dryRun };
    const domains = yield* api.listAlternativeDistributionDomains();
    const existing = new Set(
      domains.flatMap((entry) => {
        if (entry.domain) return [entry.domain];
        return [];
      }),
    );
    for (const { domain, referenceName } of config.domains) {
      if (existing.has(domain)) continue;
      const action = plan(
        reconcileContext,
        `authorize distribution domain ${domain} (${referenceName})`,
      );
      if (!dryRun)
        yield* api.createAlternativeDistributionDomain(domain, referenceName).pipe(
          Effect.match({
            onFailure: (writeFailure) => {
              action.status = 'failed';
              action.error = errorMessage(writeFailure);
            },
            onSuccess: () => {
              action.status = 'applied';
            },
          }),
        );
    }
    return reconcileContext.actions;
  });
/** Decode an untrusted EU distribution config document. */
export const parseEuDistributionConfig = (
  rawDocument: unknown,
): Effect.Effect<EuDistributionConfig, StoreSurfaceConfigFailure> =>
  decodeStoreSurfaceConfig(rawDocument, EuDistributionConfigSpec);

/** Read and decode eu-distribution.config.json through Effect Platform. */
export const loadEuDistributionConfig = (configPath: string) =>
  loadStoreSurfaceConfig(configPath, EuDistributionConfigSpec);

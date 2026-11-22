import type { AlternativeDistributionDomainResource } from '../../types/apple-catalog.ts';
import { plan, type ReconcileContext } from '../shared/reconcile.ts';
import { errorMessage } from '../../services/platform/error-message.ts';
import type { PlannedAction } from '../../types/reconcile.ts';
import type {
  EuDistributionConfig,
  EuDistributionDomainConfig,
} from '../../types/store-surface.ts';
import { decodeStoreSurfaceConfig, loadStoreSurfaceConfig } from '../shared/surface-config.ts';
import { readPlainObject } from '../../services/platform/plain-object.ts';

const EU_DISTRIBUTION_DOCUMENT_NAME = 'eu-distribution.config.json';

function readRequiredText(record: Record<string, unknown>, fieldName: string): string {
  const field = record[fieldName];
  const isText = typeof field == 'string';

  if (isText == false) {
    throw new Error(`${EU_DISTRIBUTION_DOCUMENT_NAME}: ${fieldName} must be a non-empty string.`);
  }

  const isEmpty = field.length == 0;

  if (isEmpty) {
    throw new Error(`${EU_DISTRIBUTION_DOCUMENT_NAME}: ${fieldName} must be a non-empty string.`);
  }

  return field;
}

function readDomain(entry: unknown): EuDistributionDomainConfig {
  const entryObject = readPlainObject(entry);

  if (entryObject == null) {
    throw new Error(`${EU_DISTRIBUTION_DOCUMENT_NAME}: domains entries must be JSON objects.`);
  }

  return {
    domain: readRequiredText(entryObject, 'domain'),
    referenceName: readRequiredText(entryObject, 'referenceName'),
  };
}

function decodeEuDistributionDocument(rawDocument: unknown): EuDistributionConfig {
  const documentRecord = rawDocument as Record<string, unknown>;
  const domainsField = documentRecord['domains'];
  const hasDomains = Object.hasOwn(documentRecord, 'domains');

  if (hasDomains == false) {
    throw new Error(`${EU_DISTRIBUTION_DOCUMENT_NAME} must declare a non-empty "domains" array.`);
  }

  const isDomainList = Array.isArray(domainsField);

  if (isDomainList == false) {
    throw new Error(`${EU_DISTRIBUTION_DOCUMENT_NAME}: domains must be an array.`);
  }

  const isEmpty = domainsField.length == 0;

  if (isEmpty) {
    throw new Error(`${EU_DISTRIBUTION_DOCUMENT_NAME} must declare a non-empty "domains" array.`);
  }

  const domains: EuDistributionDomainConfig[] = [];

  for (const entry of domainsField) {
    const domain = readDomain(entry);
    domains.push(domain);
  }

  return { domains };
}

function missingEuDistributionMessage(configPath: string): string {
  return `No EU distribution config at ${configPath}. Create one (see \`launch eu-distribution --help\`) or pass --config.`;
}

const euDistributionConfigSpec = {
  documentName: EU_DISTRIBUTION_DOCUMENT_NAME,
  displayName: 'EU distribution config',
  missingMessage: missingEuDistributionMessage,
  decodeDocument: decodeEuDistributionDocument,
};

/**
 * The exact slice of App Store Connect the domain reconciler depends on. Declaring it here
 * (rather than taking the concrete client) keeps the diff logic unit-testable with a hand-rolled fake.
 */
export type AscEuDistributionApi = {
  listAlternativeDistributionDomains(): Promise<AlternativeDistributionDomainResource[]>;
  createAlternativeDistributionDomain(domain: string, referenceName: string): Promise<void>;
};

/**
 * Reconcile the team's authorized distribution domains: create each declared domain Apple doesn't already
 * have (matched on `domain`), leaving undeclared ones untouched. Every write is captured per-action so a
 * single failure never aborts the run.
 */
export async function reconcileEuDistributionDomains(
  api: AscEuDistributionApi,
  config: EuDistributionConfig,
  dryRun: boolean,
): Promise<PlannedAction[]> {
  const reconcileContext: ReconcileContext = { actions: [], dryRun };
  const domains = await api.listAlternativeDistributionDomains();
  const existing = new Set<string>();

  for (const entry of domains) {
    const domainName = entry.domain;
    const hasDomain = domainName != null;

    if (hasDomain == false) {
      continue;
    }

    const isEmptyDomain = domainName.length == 0;

    if (isEmptyDomain) {
      continue;
    }

    existing.add(domainName);
  }

  for (const declaredDomain of config.domains) {
    const alreadyAuthorized = existing.has(declaredDomain.domain);

    if (alreadyAuthorized) {
      continue;
    }

    const action = plan(
      reconcileContext,
      `authorize distribution domain ${declaredDomain.domain} (${declaredDomain.referenceName})`,
    );
    const isDryRun = dryRun == true;

    if (isDryRun) {
      continue;
    }

    try {
      await api.createAlternativeDistributionDomain(
        declaredDomain.domain,
        declaredDomain.referenceName,
      );
      action.status = 'applied';
    } catch (writeFailure) {
      action.status = 'failed';
      action.error = errorMessage(writeFailure);
    }
  }

  return reconcileContext.actions;
}

/** Decode an untrusted EU distribution config document. */
export function parseEuDistributionConfig(rawDocument: unknown): EuDistributionConfig {
  return decodeStoreSurfaceConfig(rawDocument, euDistributionConfigSpec);
}

/** Read and decode eu-distribution.config.json. */
export function loadEuDistributionConfig(configPath: string): Promise<EuDistributionConfig> {
  return loadStoreSurfaceConfig(configPath, euDistributionConfigSpec);
}

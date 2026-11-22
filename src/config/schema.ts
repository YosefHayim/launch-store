import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deprecatedAgeRatingVerdict, type AgeRatingValue } from '../types/apple-catalog.ts';
import {
  DEFAULT_BUILD_ENGINE,
  DEFAULT_CREDENTIALS_PROVIDER,
  DEFAULT_STORAGE_PROVIDER,
  DEFAULT_SUBMITTER,
  type LaunchConfig,
} from '../types/config.ts';
import { type JsonSchema, type SchemaViolation, validate } from './json-schema.ts';

const SCHEMA_PATH = fileURLToPath(
  new URL('../../schema/launch.config.schema.json', import.meta.url),
);

const PRODUCT_ID_PATTERN_MESSAGE =
  'productId may contain only letters, digits, underscores, and periods.';

let cachedSchema: JsonSchema | null = null;

function isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate == null) {
    return false;
  }

  if (typeof candidate != 'object') {
    return false;
  }

  return Array.isArray(candidate) == false;
}

/** Load and cache the committed JSON Schema. The file is immutable at runtime. */
export function loadPublishedConfigSchema(): JsonSchema {
  const rememberedSchema = cachedSchema;

  if (rememberedSchema != null) {
    return rememberedSchema;
  }

  const schemaText = readFileSync(SCHEMA_PATH, 'utf8');
  const loadedSchema = JSON.parse(schemaText) as JsonSchema;
  cachedSchema = loadedSchema;

  return loadedSchema;
}

function rewriteProductIdMessage(violation: SchemaViolation): SchemaViolation {
  const isProductId = violation.path.endsWith('productId');

  if (isProductId == false) {
    return violation;
  }

  const isPatternMiss = violation.message.startsWith('expected a string matching');

  if (isPatternMiss == false) {
    return violation;
  }

  return { path: violation.path, message: PRODUCT_ID_PATTERN_MESSAGE };
}

function readAgeRatingAnswers(
  candidate: Record<string, unknown>,
): Readonly<Record<string, AgeRatingValue>> | null {
  const answers: Record<string, AgeRatingValue> = {};

  for (const [attributeName, answer] of Object.entries(candidate)) {
    if (typeof answer == 'string') {
      answers[attributeName] = answer;
      continue;
    }

    if (typeof answer != 'boolean') {
      return null;
    }

    answers[attributeName] = answer;
  }

  return answers;
}

function ageRatingPath(bundleId: string): string {
  const isPlainName = /^[A-Za-z_$][\w$]*$/.test(bundleId);

  if (isPlainName) {
    return `releaseAttributes.${bundleId}.ageRating`;
  }

  return `releaseAttributes[${JSON.stringify(bundleId)}].ageRating`;
}

function verdictFor(bundleId: string, ageRating: Record<string, unknown>): SchemaViolation | null {
  const answers = readAgeRatingAnswers(ageRating);

  if (answers == null) {
    return null;
  }

  const verdict = deprecatedAgeRatingVerdict(answers);
  const isAllowed = verdict == true;

  if (isAllowed) {
    return null;
  }

  return { path: ageRatingPath(bundleId), message: verdict };
}

function ageRatingFromAttributes(
  bundleId: string,
  attributes: Record<string, unknown>,
): SchemaViolation | null {
  const ageRating = attributes['ageRating'];

  if (isPlainRecord(ageRating)) {
    return verdictFor(bundleId, ageRating);
  }

  return null;
}

function ageRatingViolation(bundleId: string, attributes: unknown): SchemaViolation | null {
  if (isPlainRecord(attributes)) {
    return ageRatingFromAttributes(bundleId, attributes);
  }

  return null;
}

function collectAgeRatingViolations(releaseAttributes: Record<string, unknown>): SchemaViolation[] {
  const violations: SchemaViolation[] = [];

  for (const [bundleId, attributes] of Object.entries(releaseAttributes)) {
    const violation = ageRatingViolation(bundleId, attributes);

    if (violation != null) {
      violations.push(violation);
    }
  }

  return violations;
}

function ageRatingViolations(candidateConfig: unknown): SchemaViolation[] {
  if (isPlainRecord(candidateConfig)) {
    return ageRatingViolationsIn(candidateConfig);
  }

  return [];
}

function ageRatingViolationsIn(candidateConfig: Record<string, unknown>): SchemaViolation[] {
  const releaseAttributes = candidateConfig['releaseAttributes'];

  if (isPlainRecord(releaseAttributes)) {
    return collectAgeRatingViolations(releaseAttributes);
  }

  return [];
}

function stringField(candidateConfig: Record<string, unknown>, fieldName: string): string | null {
  const field = candidateConfig[fieldName];

  if (typeof field == 'string') {
    return field;
  }

  return null;
}

function withProviderDefaults(candidateConfig: Record<string, unknown>): LaunchConfig {
  let credentials = DEFAULT_CREDENTIALS_PROVIDER;
  const givenCredentials = stringField(candidateConfig, 'credentials');

  if (givenCredentials != null) {
    credentials = givenCredentials;
  }

  let storage = DEFAULT_STORAGE_PROVIDER;
  const givenStorage = stringField(candidateConfig, 'storage');

  if (givenStorage != null) {
    storage = givenStorage;
  }

  let buildEngine = DEFAULT_BUILD_ENGINE;
  const givenBuildEngine = stringField(candidateConfig, 'buildEngine');

  if (givenBuildEngine != null) {
    buildEngine = givenBuildEngine;
  }

  let submit: LaunchConfig['submit'] = DEFAULT_SUBMITTER;
  const givenSubmit = candidateConfig['submit'];

  if (typeof givenSubmit == 'string') {
    submit = givenSubmit;
  }

  if (isPlainRecord(givenSubmit)) {
    submit = givenSubmit as LaunchConfig['submit'];
  }

  return {
    ...candidateConfig,
    credentials,
    storage,
    buildEngine,
    submit,
  } as LaunchConfig;
}

/** Structural checks plus the age-rating deprecation filter. Empty when the config is valid. */
export function validateLaunchConfig(candidateConfig: unknown): SchemaViolation[] {
  const publishedSchema = loadPublishedConfigSchema();
  const structuralViolations = validate(candidateConfig, publishedSchema).map(
    rewriteProductIdMessage,
  );

  return [...structuralViolations, ...ageRatingViolations(candidateConfig)];
}

/** Parse a launch config, filling provider defaults. Throws the first violation message. */
export function parseLaunchConfig(candidateConfig: unknown): LaunchConfig {
  const violations = validateLaunchConfig(candidateConfig);
  const firstViolation = violations[0];

  if (firstViolation != null) {
    throw new Error(firstViolation.message);
  }

  if (isPlainRecord(candidateConfig)) {
    return withProviderDefaults(candidateConfig);
  }

  throw new Error('launch config must be an object');
}

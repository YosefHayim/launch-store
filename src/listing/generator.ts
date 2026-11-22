import { readLaunchEnvironment } from '../services/platform/environment.ts';
import { hasMessage } from '../services/platform/error-message.ts';
import type { DraftListing, ListingBrief } from '../types/listing.ts';
import type { MutableDeep } from '../types/mutable.ts';
import { APPLE_LIMITS, serializeKeywords } from './apply.ts';
import { readPlainObject } from '../services/platform/plain-object.ts';
import { isFailureTag } from '../services/platform/tagged-failure.ts';

/** Anthropic listing generation or decoding failed. */
interface ListingGenerationFailure {
  readonly _tag: 'ListingGenerationFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}

interface GeneratedListing {
  title?: string;
  subtitle?: string;
  description?: string;
  promotionalText?: string;
  keywords?: readonly string[] | string;
}

interface ListingCopyGenerator {
  readonly name: string;
  generate(brief: ListingBrief): Promise<DraftListing>;
}

/** Normalize a generator dependency failure. */
function generationFailure(
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): ListingGenerationFailure {
  let message = `${operation} failed.`;

  if (hasMessage(cause)) {
    message = cause.message;
  }

  if (explicitMessage != null) {
    message = explicitMessage;
  }

  return { _tag: 'ListingGenerationFailure', operation, message, cause };
}

/** Build the instruction sent for one locale. */
export const buildListingPrompt = (listingBrief: ListingBrief): string => {
  const promptLines = [
    `You are an App Store optimization expert writing the ${listingBrief.locale} App Store listing for an app called "${listingBrief.appName}".`,
    '',
    'Return ONLY a JSON object (no prose, no markdown fences) with these optional string fields:',
    `- "title": app name shown on the product page, at most ${APPLE_LIMITS.title} characters.`,
    `- "subtitle": one punchy line under the title, at most ${APPLE_LIMITS.subtitle} characters.`,
    `- "keywords": an array of search keywords; the comma-joined string must be at most ${APPLE_LIMITS.keywords} characters.`,
    `- "promotionalText": a short promo blurb, at most ${APPLE_LIMITS.promotionalText} characters.`,
    `- "description": the full marketing description, at most ${APPLE_LIMITS.description} characters.`,
    '',
    `Write natural, compelling copy in the ${listingBrief.locale} locale. Respect every character limit exactly.`,
  ];
  if (listingBrief.about != null) promptLines.push('', `What the app does: ${listingBrief.about}`);
  if (listingBrief.keywords != null && listingBrief.keywords.length > 0)
    promptLines.push('', `Themes to weave in: ${serializeKeywords(listingBrief.keywords)}`);
  if (listingBrief.current != null && Object.keys(listingBrief.current).length > 0) {
    const serialized = JSON.stringify(listingBrief.current, null, 2);
    promptLines.push('', 'Improve on the current listing (do not copy it verbatim):', serialized);
  }
  return promptLines.join('\n');
};

/** Remove an optional JSON Markdown fence from model text. */
const stripJsonFence = (completionText: string): string => {
  const trimmedText = completionText.trim();
  const fencedMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmedText);
  const fencedJson = fencedMatch?.[1];
  if (fencedJson == null) return trimmedText;
  return fencedJson;
};

/** Keep one non-blank generated text field. */
const normalizeGeneratedText = (generatedText: string | undefined): string | undefined => {
  if (generatedText == null) return undefined;
  const trimmedText = generatedText.trim();
  if (trimmedText.length == 0) return undefined;
  return trimmedText;
};

/** Normalize generated keywords from the two accepted vendor shapes. */
const normalizeGeneratedKeywords = (
  generatedKeywords: readonly string[] | string | undefined,
): string[] | undefined => {
  if (generatedKeywords == null) return undefined;
  let keywordCandidates: readonly string[];
  if (typeof generatedKeywords == 'string') keywordCandidates = generatedKeywords.split(',');
  else keywordCandidates = generatedKeywords;
  const normalizedKeywords = keywordCandidates
    .map((keywordCandidate) => keywordCandidate.trim())
    .filter((keywordCandidate) => keywordCandidate.length > 0);
  if (normalizedKeywords.length == 0) return undefined;
  return normalizedKeywords;
};

function readOptionalGeneratedText(
  record: Record<string, unknown>,
  fieldName: string,
): string | undefined {
  if (Object.hasOwn(record, fieldName) == false) {
    return undefined;
  }

  const field = record[fieldName];

  if (field == null) {
    return undefined;
  }

  if (typeof field != 'string') {
    throw invalidListingCopy(field);
  }

  return field;
}

function readGeneratedKeywords(
  record: Record<string, unknown>,
): readonly string[] | string | undefined {
  if (Object.hasOwn(record, 'keywords') == false) {
    return undefined;
  }

  const field = record['keywords'];

  if (field == null) {
    return undefined;
  }

  if (typeof field == 'string') {
    return field;
  }

  if (Array.isArray(field) == false) {
    throw invalidListingCopy(field);
  }

  const keywords: string[] = [];

  for (const keyword of field) {
    if (typeof keyword != 'string') {
      throw invalidListingCopy(keyword);
    }

    keywords.push(keyword);
  }

  return keywords;
}

function readGeneratedListing(parsed: Record<string, unknown>): GeneratedListing {
  const title = readOptionalGeneratedText(parsed, 'title');
  const subtitle = readOptionalGeneratedText(parsed, 'subtitle');
  const description = readOptionalGeneratedText(parsed, 'description');
  const promotionalText = readOptionalGeneratedText(parsed, 'promotionalText');
  const keywords = readGeneratedKeywords(parsed);
  const generatedListing: GeneratedListing = {};

  if (title != null) {
    generatedListing.title = title;
  }

  if (subtitle != null) {
    generatedListing.subtitle = subtitle;
  }

  if (description != null) {
    generatedListing.description = description;
  }

  if (promotionalText != null) {
    generatedListing.promotionalText = promotionalText;
  }

  if (keywords != null) {
    generatedListing.keywords = keywords;
  }

  return generatedListing;
}

function draftFromGenerated(generatedListing: GeneratedListing): DraftListing {
  const listingDraft: MutableDeep<DraftListing> = {};
  const title = normalizeGeneratedText(generatedListing.title);
  const subtitle = normalizeGeneratedText(generatedListing.subtitle);
  const description = normalizeGeneratedText(generatedListing.description);
  const promotionalText = normalizeGeneratedText(generatedListing.promotionalText);
  const keywords = normalizeGeneratedKeywords(generatedListing.keywords);

  if (title != null) {
    listingDraft.title = title;
  }

  if (subtitle != null) {
    listingDraft.subtitle = subtitle;
  }

  if (description != null) {
    listingDraft.description = description;
  }

  if (promotionalText != null) {
    listingDraft.promotionalText = promotionalText;
  }

  if (keywords != null) {
    listingDraft.keywords = keywords;
  }

  return listingDraft;
}

function invalidListingCopy(cause: unknown): ListingGenerationFailure {
  return generationFailure(
    'decode listing completion',
    cause,
    'The model did not return valid JSON listing copy.',
  );
}

/** Decode model text into a usable listing draft. */
export function parseDraftListing(completionText: string): DraftListing {
  let parsed: unknown;

  try {
    const stripFence = stripJsonFence(completionText);
    parsed = JSON.parse(stripFence);
  } catch (cause) {
    throw invalidListingCopy(cause);
  }

  const parsedObject = readPlainObject(parsed);

  if (parsedObject == null) {
    throw invalidListingCopy(parsed);
  }

  const generatedListing = readGeneratedListing(parsedObject);
  const listingDraft = draftFromGenerated(generatedListing);
  const hasUsableFields = Object.keys(listingDraft).length > 0;

  if (hasUsableFields == false) {
    throw generationFailure(
      'decode listing completion',
      completionText,
      'The model returned no usable listing fields.',
    );
  }

  return listingDraft;
}

function readTextBlock(contentBlock: unknown): string {
  const contentBlockObject = readPlainObject(contentBlock);

  if (contentBlockObject == null) {
    throw generationFailure('generate Anthropic listing', contentBlock);
  }

  if (contentBlockObject['type'] != 'text') {
    return '';
  }

  if (typeof contentBlockObject['text'] != 'string') {
    return '';
  }

  return contentBlockObject['text'];
}

/** Join the text blocks from a decoded Anthropic message. */
function readCompletionText(anthropicMessage: unknown): string {
  const anthropicMessageObject = readPlainObject(anthropicMessage);

  if (anthropicMessageObject == null) {
    throw generationFailure(
      'read Anthropic completion',
      anthropicMessage,
      'Anthropic returned an empty completion.',
    );
  }

  if (Array.isArray(anthropicMessageObject['content']) == false) {
    throw generationFailure(
      'read Anthropic completion',
      anthropicMessageObject,
      'Anthropic returned an empty completion.',
    );
  }

  let completionText = '';

  for (const contentBlock of anthropicMessageObject['content']) {
    const blockText = readTextBlock(contentBlock);
    completionText = `${completionText}${blockText}`;
  }

  if (completionText.length == 0) {
    throw generationFailure(
      'read Anthropic completion',
      anthropicMessageObject,
      'Anthropic returned an empty completion.',
    );
  }

  return completionText;
}

function pickApiKey(
  requestedApiKey: string | undefined,
  environmentApiKey: string | undefined,
): string | null {
  let apiKey = environmentApiKey;

  if (requestedApiKey != null) {
    apiKey = requestedApiKey;
  }

  if (apiKey == null) {
    return null;
  }

  if (apiKey == '') {
    return null;
  }

  return apiKey;
}

function isFailedStatus(status: number): boolean {
  if (status < 200) {
    return true;
  }

  return status >= 300;
}

async function failAnthropicStatus(anthropicReply: Response): Promise<never> {
  try {
    const replyText = await anthropicReply.text();
    const failureDetail = replyText.slice(0, 300);

    throw generationFailure(
      'request Anthropic listing',
      anthropicReply.status,
      `Anthropic API error ${anthropicReply.status}: ${failureDetail}`,
    );
  } catch (cause) {
    if (isFailureTag(cause, 'ListingGenerationFailure')) {
      throw cause;
    }

    throw generationFailure('generate Anthropic listing', cause);
  }
}

async function requestAnthropicListing(
  apiKey: string,
  model: string,
  listingBrief: ListingBrief,
): Promise<DraftListing> {
  const maxTokens = 1024;
  const requestDocument = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: buildListingPrompt(listingBrief) }],
  };

  let anthropicReply: Response;

  try {
    const serialized = JSON.stringify(requestDocument);
    anthropicReply = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: serialized,
    });
  } catch (cause) {
    throw generationFailure('generate Anthropic listing', cause);
  }

  const requestFailed = isFailedStatus(anthropicReply.status);

  if (requestFailed) {
    return failAnthropicStatus(anthropicReply);
  }

  let replyText: string;

  try {
    replyText = await anthropicReply.text();
  } catch (cause) {
    throw generationFailure('generate Anthropic listing', cause);
  }

  let anthropicMessage: unknown;

  try {
    anthropicMessage = JSON.parse(replyText);
  } catch (cause) {
    throw generationFailure('generate Anthropic listing', cause);
  }

  const completionText = readCompletionText(anthropicMessage);

  return parseDraftListing(completionText);
}

/** Create the Anthropic listing generator from the shared environment service. */
export function createAnthropicListingGenerator(
  options: { model?: string; apiKey?: string } = {},
): ListingCopyGenerator {
  const launchEnvironment = readLaunchEnvironment();
  let model = 'claude-sonnet-4-6';

  if (launchEnvironment.values.aiModel != null) {
    model = launchEnvironment.values.aiModel;
  }

  if (options.model != null) {
    model = options.model;
  }

  async function generate(listingBrief: ListingBrief): Promise<DraftListing> {
    try {
      const apiKey = pickApiKey(options.apiKey, launchEnvironment.values.anthropicApiKey);

      if (apiKey == null) {
        throw generationFailure(
          'authenticate Anthropic request',
          'missing-api-key',
          'Set ANTHROPIC_API_KEY to generate listing copy (create a key at https://console.anthropic.com/).',
        );
      }

      return await requestAnthropicListing(apiKey, model, listingBrief);
    } catch (cause) {
      if (isFailureTag(cause, 'ListingGenerationFailure')) {
        throw cause;
      }

      throw generationFailure('generate Anthropic listing', cause);
    }
  }

  return { name: `anthropic:${model}`, generate };
}

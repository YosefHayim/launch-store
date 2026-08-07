import { HttpClient, HttpClientRequest, HttpClientResponse } from '@effect/platform';
import { Data, Effect, Redacted, Schema } from 'effect';
import { LaunchEnvironment, type LaunchEnvironmentService } from '../services/environment.js';
import type { DraftListing, ListingBrief, ListingGenerator } from '../types/listing.js';
import { APPLE_LIMITS, serializeKeywords } from './apply.js';
import type { MutableDeep } from '../types/mutable.js';

const GeneratedListingSchema = Schema.Struct({
  title: Schema.optionalWith(Schema.String, { exact: true }),
  subtitle: Schema.optionalWith(Schema.String, { exact: true }),
  description: Schema.optionalWith(Schema.String, { exact: true }),
  promotionalText: Schema.optionalWith(Schema.String, { exact: true }),
  keywords: Schema.optionalWith(Schema.Union(Schema.Array(Schema.String), Schema.String), {
    exact: true,
  }),
});

const AnthropicMessageSchema = Schema.Struct({
  content: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      text: Schema.optionalWith(Schema.String, { exact: true }),
    }),
  ),
});

const AnthropicRequestSchema = Schema.Struct({
  model: Schema.String,
  max_tokens: Schema.Number,
  messages: Schema.Array(
    Schema.Struct({
      role: Schema.Literal('user'),
      content: Schema.String,
    }),
  ),
});

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Anthropic listing generation or decoding failed. */
export type ListingGenerationFailure = Readonly<{
  readonly _tag: 'ListingGenerationFailure';
  readonly operation: string;
  readonly message: string;
  readonly cause: unknown;
}>;

export const makeListingGenerationFailure = Data.tagged<ListingGenerationFailure>(
  'ListingGenerationFailure',
);

export const ListingGenerationFailureSchema: Schema.Schema<ListingGenerationFailure> =
  Schema.Struct({
    _tag: Schema.Literal('ListingGenerationFailure'),
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Unknown,
  });

/** Normalize a generator dependency failure. */
const generationFailure = (
  operation: string,
  cause: unknown,
  explicitMessage?: string,
): ListingGenerationFailure => {
  let message = `${operation} failed.`;
  if (cause instanceof Error) message = cause.message;
  if (explicitMessage !== undefined) message = explicitMessage;
  return makeListingGenerationFailure({ operation, message, cause });
};

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
  if (listingBrief.about !== undefined)
    promptLines.push('', `What the app does: ${listingBrief.about}`);
  if (listingBrief.keywords !== undefined && listingBrief.keywords.length > 0)
    promptLines.push('', `Themes to weave in: ${serializeKeywords(listingBrief.keywords)}`);
  if (listingBrief.current !== undefined && Object.keys(listingBrief.current).length > 0) {
    promptLines.push(
      '',
      'Improve on the current listing (do not copy it verbatim):',
      JSON.stringify(listingBrief.current, null, 2),
    );
  }
  return promptLines.join('\n');
};

/** Remove an optional JSON Markdown fence from model text. */
const stripJsonFence = (completionText: string): string => {
  const trimmedText = completionText.trim();
  const fencedMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmedText);
  const fencedJson = fencedMatch?.[1];
  if (fencedJson === undefined) return trimmedText;
  return fencedJson;
};

/** Keep one non-blank generated text field. */
const normalizeGeneratedText = (generatedText: string | undefined): string | undefined => {
  if (generatedText === undefined) return undefined;
  const trimmedText = generatedText.trim();
  if (trimmedText.length === 0) return undefined;
  return trimmedText;
};

/** Normalize generated keywords from the two accepted vendor shapes. */
const normalizeGeneratedKeywords = (
  generatedKeywords: readonly string[] | string | undefined,
): string[] | undefined => {
  if (generatedKeywords === undefined) return undefined;
  let keywordCandidates: readonly string[];
  if (typeof generatedKeywords === 'string') keywordCandidates = generatedKeywords.split(',');
  else keywordCandidates = generatedKeywords;
  const normalizedKeywords = keywordCandidates
    .map((keywordCandidate) => keywordCandidate.trim())
    .filter((keywordCandidate) => keywordCandidate.length > 0);
  if (normalizedKeywords.length === 0) return undefined;
  return normalizedKeywords;
};

/** Decode model text into a usable listing draft. */
export const parseDraftListing = (
  completionText: string,
): Effect.Effect<DraftListing, ListingGenerationFailure> =>
  Schema.decodeUnknown(Schema.parseJson(GeneratedListingSchema))(
    stripJsonFence(completionText),
  ).pipe(
    Effect.map((generatedListing) => {
      const listingDraft: MutableDeep<DraftListing> = {};
      const title = normalizeGeneratedText(generatedListing.title);
      if (title !== undefined) listingDraft.title = title;
      const subtitle = normalizeGeneratedText(generatedListing.subtitle);
      if (subtitle !== undefined) listingDraft.subtitle = subtitle;
      const description = normalizeGeneratedText(generatedListing.description);
      if (description !== undefined) listingDraft.description = description;
      const promotionalText = normalizeGeneratedText(generatedListing.promotionalText);
      if (promotionalText !== undefined) listingDraft.promotionalText = promotionalText;
      const keywords = normalizeGeneratedKeywords(generatedListing.keywords);
      if (keywords !== undefined) listingDraft.keywords = keywords;
      return listingDraft;
    }),
    Effect.flatMap((listingDraft) => {
      if (Object.keys(listingDraft).length > 0) return Effect.succeed(listingDraft);
      return Effect.fail(
        generationFailure(
          'decode listing completion',
          completionText,
          'The model returned no usable listing fields.',
        ),
      );
    }),
    Effect.mapError((cause) => {
      if (Schema.is(ListingGenerationFailureSchema)(cause)) return cause;
      return generationFailure(
        'decode listing completion',
        cause,
        'The model did not return valid JSON listing copy.',
      );
    }),
  );

/** Join the text blocks from a decoded Anthropic message. */
const extractCompletionText = (
  anthropicMessage: Schema.Schema.Type<typeof AnthropicMessageSchema>,
): Effect.Effect<string, ListingGenerationFailure> => {
  const completionText = anthropicMessage.content
    .filter((contentBlock) => contentBlock.type === 'text')
    .map((contentBlock) => {
      if (contentBlock.text === undefined) return '';
      return contentBlock.text;
    })
    .join('');
  if (completionText.length > 0) return Effect.succeed(completionText);
  return Effect.fail(
    generationFailure(
      'read Anthropic completion',
      anthropicMessage,
      'Anthropic returned an empty completion.',
    ),
  );
};

/** Create the Anthropic listing generator from the shared environment service. */
export const createAnthropicListingGenerator = (
  options: Readonly<{ model?: string; apiKey?: string }> = {},
): Effect.Effect<ListingGenerator<HttpClient.HttpClient>, never, LaunchEnvironmentService> =>
  Effect.gen(function* () {
    const launchEnvironment = yield* LaunchEnvironment;
    let model = DEFAULT_MODEL;
    if (launchEnvironment.values.aiModel !== undefined) model = launchEnvironment.values.aiModel;
    if (options.model !== undefined) model = options.model;
    return {
      name: `anthropic:${model}`,
      generate: (listingBrief) =>
        Effect.gen(function* () {
          let apiKey: string | undefined;
          if (launchEnvironment.values.anthropicApiKey !== undefined)
            apiKey = Redacted.value(launchEnvironment.values.anthropicApiKey);
          if (options.apiKey !== undefined) apiKey = options.apiKey;
          let apiKeyMissing = false;
          if (apiKey === undefined) apiKeyMissing = true;
          else if (apiKey.length === 0) apiKeyMissing = true;
          if (apiKeyMissing) {
            return yield* Effect.fail(
              generationFailure(
                'authenticate Anthropic request',
                'missing-api-key',
                'Set ANTHROPIC_API_KEY to generate listing copy (create a key at https://console.anthropic.com/).',
              ),
            );
          }
          const requestDocument: Schema.Schema.Type<typeof AnthropicRequestSchema> = {
            model,
            max_tokens: 1024,
            messages: [{ role: 'user', content: buildListingPrompt(listingBrief) }],
          };
          const anthropicRequest = yield* HttpClientRequest.post(ANTHROPIC_ENDPOINT).pipe(
            HttpClientRequest.setHeaders({
              'x-api-key': apiKey,
              'anthropic-version': ANTHROPIC_VERSION,
            }),
            HttpClientRequest.schemaBodyJson(AnthropicRequestSchema)(requestDocument),
          );
          const httpClient = yield* HttpClient.HttpClient;
          const anthropicReply = yield* httpClient.execute(anthropicRequest);
          let requestFailed = anthropicReply.status < 200;
          if (anthropicReply.status >= 300) requestFailed = true;
          if (requestFailed) {
            const failureDetail = (yield* anthropicReply.text).slice(0, 300);
            return yield* Effect.fail(
              generationFailure(
                'request Anthropic listing',
                anthropicReply.status,
                `Anthropic API error ${anthropicReply.status}: ${failureDetail}`,
              ),
            );
          }
          const anthropicMessage =
            yield* HttpClientResponse.schemaBodyJson(AnthropicMessageSchema)(anthropicReply);
          const completionText = yield* extractCompletionText(anthropicMessage);
          return yield* parseDraftListing(completionText);
        }).pipe(
          Effect.mapError((cause) => {
            if (Schema.is(ListingGenerationFailureSchema)(cause)) return cause;
            return generationFailure('generate Anthropic listing', cause);
          }),
        ),
    } satisfies ListingGenerator<HttpClient.HttpClient>;
  });

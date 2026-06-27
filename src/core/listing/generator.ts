/**
 * The default {@link ListingGenerator}: Anthropic's Messages API, called over the global `fetch`
 * (Node ≥20) so there's **no SDK dependency** to install for a local-only user. The key comes from
 * `ANTHROPIC_API_KEY`; a missing key is an actionable error, not a stack trace.
 *
 * Why a seam + a fetch default (not the SDK): listing copy is the only place Launch talks to a model,
 * so pulling in `@anthropic-ai/sdk` for one POST would bloat every install. `fetch` keeps the core lean
 * and the {@link ListingGenerator} interface keeps the model swappable and the command testable with a
 * fake. `buildListingPrompt` and `parseDraftListing` are exported and pure so the prompt and the
 * response parsing are unit-tested without a network round-trip.
 */

import { asRecord } from '../json.js';
import { APPLE_LIMITS, serializeKeywords } from './apply.js';
import type { DraftListing, ListingBrief, ListingGenerator } from './types.js';

/** Anthropic Messages API endpoint. Centralized here per the repo's "no scattered URL strings" rule. */
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
/** Pinned Messages API version header (Anthropic dates its breaking changes). */
const ANTHROPIC_VERSION = '2023-06-01';
/** Default model; overridable via `--model` or `$LAUNCH_AI_MODEL`. */
const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Build the instruction prompt for one locale: the limits, the seed material, and a JSON-only contract. */
export function buildListingPrompt(brief: ListingBrief): string {
  const lines = [
    `You are an App Store optimization expert writing the ${brief.locale} App Store listing for an app called "${brief.appName}".`,
    '',
    'Return ONLY a JSON object (no prose, no markdown fences) with these optional string fields:',
    `- "title": app name shown on the product page, at most ${APPLE_LIMITS.title} characters.`,
    `- "subtitle": one punchy line under the title, at most ${APPLE_LIMITS.subtitle} characters.`,
    `- "keywords": an array of search keywords; the comma-joined string must be at most ${APPLE_LIMITS.keywords} characters.`,
    `- "promotionalText": a short promo blurb, at most ${APPLE_LIMITS.promotionalText} characters.`,
    `- "description": the full marketing description, at most ${APPLE_LIMITS.description} characters.`,
    '',
    `Write natural, compelling copy in the ${brief.locale} locale. Respect every character limit exactly.`,
  ];
  if (brief.about) lines.push('', `What the app does: ${brief.about}`);
  if (brief.keywords && brief.keywords.length > 0)
    lines.push('', `Themes to weave in: ${serializeKeywords(brief.keywords)}`);
  if (brief.current && Object.keys(brief.current).length > 0) {
    lines.push(
      '',
      'Improve on the current listing (do not copy it verbatim):',
      JSON.stringify(brief.current, null, 2),
    );
  }
  return lines.join('\n');
}

/** Strip an optional ```json … ``` fence so a fenced reply still parses. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

/** Read an optional trimmed string field from a parsed record, ignoring non-strings and blanks. */
function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Read keywords as either a string array or a comma-separated string, dropping blanks and non-strings. */
function readKeywords(value: unknown): string[] | undefined {
  const raw = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const keywords = raw.map((keyword) => keyword.trim()).filter(Boolean);
  return keywords.length > 0 ? keywords : undefined;
}

/**
 * Parse a model reply into a {@link DraftListing}: tolerate a JSON fence, keep only string-typed fields,
 * normalize keywords, and reject a reply with no usable fields so the failure is loud, not a silent
 * empty write. Pure and exported so the parsing contract is unit-tested.
 */
export function parseDraftListing(text: string): DraftListing {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    throw new Error('The model did not return valid JSON listing copy.');
  }
  const record = asRecord(parsed);
  if (!record) throw new Error('The model returned JSON that is not a listing object.');

  const draft: DraftListing = {};
  const title = readString(record, 'title');
  if (title !== undefined) draft.title = title;
  const subtitle = readString(record, 'subtitle');
  if (subtitle !== undefined) draft.subtitle = subtitle;
  const description = readString(record, 'description');
  if (description !== undefined) draft.description = description;
  const promotionalText = readString(record, 'promotionalText');
  if (promotionalText !== undefined) draft.promotionalText = promotionalText;
  const keywords = readKeywords(record['keywords']);
  if (keywords !== undefined) draft.keywords = keywords;

  if (Object.keys(draft).length === 0)
    throw new Error('The model returned no usable listing fields.');
  return draft;
}

/** Pull the concatenated text out of an Anthropic Messages response, narrowing the unknown payload. */
function extractText(payload: unknown): string {
  const content = asRecord(payload)?.['content'];
  if (!Array.isArray(content))
    throw new Error('Unexpected Anthropic response: missing content array.');
  const text = content
    .map((block) => asRecord(block))
    .filter((block): block is Record<string, unknown> => block?.['type'] === 'text')
    .map((block) => (typeof block['text'] === 'string' ? block['text'] : ''))
    .join('');
  if (!text) throw new Error('Anthropic returned an empty completion.');
  return text;
}

/**
 * Create the Anthropic-backed generator. The model resolves from `options.model`, then
 * `$LAUNCH_AI_MODEL`, then the pinned default; the key resolves at call time from `options.apiKey` or
 * `$ANTHROPIC_API_KEY` so constructing the generator never requires a key (only `generate` does).
 */
export function createAnthropicListingGenerator(
  options: { model?: string; apiKey?: string } = {},
): ListingGenerator {
  const model = options.model ?? process.env['LAUNCH_AI_MODEL'] ?? DEFAULT_MODEL;
  return {
    name: `anthropic:${model}`,
    async generate(brief: ListingBrief): Promise<DraftListing> {
      const apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'];
      if (!apiKey) {
        throw new Error(
          'Set ANTHROPIC_API_KEY to generate listing copy (create a key at https://console.anthropic.com/).',
        );
      }
      const response = await fetch(ANTHROPIC_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: buildListingPrompt(brief) }],
        }),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 300);
        throw new Error(`Anthropic API error ${response.status}: ${detail}`);
      }
      return parseDraftListing(extractText(await response.json()));
    },
  };
}

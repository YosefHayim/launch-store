/**
 * Best-effort redaction for persisted build logs.
 *
 * A local build log is the most shareable debugging artifact Launch produces — but a native build can
 * echo secrets (an env var assignment, a signing password passed to Gradle, an Authorization header).
 * This module scrubs the common shapes BEFORE the text touches disk (`core/buildLog.ts` writes the
 * redacted stream) so the file is safe to paste into an issue. It reuses the one secret-name heuristic
 * ({@link isSecretLookingName}) shared with the `.env` warning, so "what counts as a secret" is defined
 * in exactly one place.
 *
 * It is deliberately conservative — redaction is line-oriented and pattern-based, not a guarantee.
 * Multi-line key material (PEM blocks) is handled by {@link redactText}, which sees the whole document;
 * {@link redactLine} catches the single-line cases as each line streams in. Anything that doesn't match
 * a known shape passes through unchanged, so the log stays useful.
 */

import { homedir } from "node:os";
import { isSecretLookingName } from "./env.js";

/** The user's home directory, collapsed to `~` so absolute paths don't leak the account name. */
const HOME = homedir();

/** `NAME=value` / `NAME: value` — the value is masked when NAME looks secret (e.g. `API_TOKEN=…`). */
const ASSIGNMENT = /\b([A-Za-z][A-Za-z0-9_]*)(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/g;
/** A JWT (`eyJ…header.payload.signature`) — App Store Connect / service-account tokens take this form. */
const JWT = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g;
/** An `Authorization: Bearer <token>` value. */
const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;
/** An AWS access key id. */
const AWS_ACCESS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;
/** A PEM-encoded key/cert block, including its body — only matchable with the whole document in hand. */
const PEM_BLOCK = /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g;

/** The masked placeholder substituted for any redacted value. */
const MASK = "***";

/**
 * Redact one line of log text: collapse the home path to `~`, mask secret-looking `NAME=value`
 * assignments, and strip JWTs, bearer tokens, and AWS access keys. Pure and idempotent; an
 * already-redacted line is unchanged. Multi-line secrets are not visible here — see {@link redactText}.
 */
export function redactLine(line: string): string {
  let out = line;
  if (HOME.length > 1) out = out.split(HOME).join("~");
  out = out.replace(ASSIGNMENT, (match, name: string, sep: string) =>
    isSecretLookingName(name) ? `${name}${sep}${MASK}` : match,
  );
  out = out.replace(JWT, "[redacted-jwt]");
  out = out.replace(BEARER, `$1${MASK}`);
  out = out.replace(AWS_ACCESS_KEY, "[redacted-aws-key]");
  return out;
}

/**
 * Redact a whole log document: drop any PEM key/cert blocks first (they span lines, so they're only
 * visible with the full text), then apply {@link redactLine} to every remaining line. Used when reading
 * a persisted log back for `launch builds log` — a second pass over what was already scrubbed on write.
 */
export function redactText(text: string): string {
  return text.replace(PEM_BLOCK, "[redacted-key-material]").split("\n").map(redactLine).join("\n");
}

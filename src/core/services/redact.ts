import { homedir } from 'node:os';
import { isSecretLookingName } from '../config/env.js';
/** The user's home directory, collapsed to `~` so absolute paths don't leak the account name. */
const HOME = homedir();
/** `NAME=value` / `NAME: value` - the value is masked when NAME looks secret (e.g. `API_TOKEN=...`). */
// Raw row example: "assignment"-like input should match.
const ASSIGNMENT =
  /\b([A-Za-z][A-Za-z0-9_]*)(["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+)/g;
/** A JWT (`eyJ...header.payload.signature`) - App Store Connect / service-account tokens take this form. */
// Raw row example: JWT token segments should match.
const JWT = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g;
/** An `Authorization: Bearer <token>` value. */
// Raw row example: "Bearer eyJ..." auth header should match.
const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi;
/** An AWS access key id. */
// Raw row example: "aws access key"-like input should match.
const AWS_ACCESS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;
/** A PEM-encoded key/cert block, including its body - only matchable with the whole document in hand. */
// Raw row example: PEM block should match.
const PEM_BLOCK = /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g;
/** The masked placeholder substituted for any redacted value. */
const MASK = '***';
/**
 * Redact one line of log text: collapse the home path to `~`, mask secret-looking `NAME=value`
 * assignments, and strip JWTs, bearer tokens, and AWS access keys. Pure and idempotent; an
 * already-redacted line is unchanged. Multi-line secrets are not visible here - see {@link redactText}.
 */
export const redactLine = (line: string): string => {
  let out = line;
  if (HOME.length > 1) out = out.split(HOME).join('~');
  out = out.replace(ASSIGNMENT, (match, name: string, sep: string) => {
    if (isSecretLookingName(name)) return `${name}${sep}${MASK}`;
    return match;
  });
  out = out.replace(JWT, '[redacted-jwt]');
  out = out.replace(BEARER, `$1${MASK}`);
  out = out.replace(AWS_ACCESS_KEY, '[redacted-aws-key]');
  return out;
};
/**
 * Redact a whole log document: drop any PEM key/cert blocks first (they span lines, so they're only
 * visible with the full text), then apply {@link redactLine} to every remaining line. Used when reading
 * a persisted log back for `launch builds log` - a second pass over what was already scrubbed on write.
 */
export const redactText = (text: string): string => {
  return text.replace(PEM_BLOCK, '[redacted-key-material]').split('\n').map(redactLine).join('\n');
};

/** One base64 line of a PEM body, the key material itself. */
const PEM_BASE64_LINE = /^[A-Za-z0-9+/=]+$/;
/** The RFC 1421 header lines an encrypted PEM block can carry before its body. */
const PEM_HEADER_LINE = /^(Proc-Type|DEK-Info): /;
const isPemBodyLine = (line: string): boolean => {
  const isEmptyLine = line === '';
  if (isEmptyLine) return true;

  const isKeyMaterialLine = PEM_BASE64_LINE.test(line);
  if (isKeyMaterialLine) return true;

  return PEM_HEADER_LINE.test(line);
};

/**
 * Keep a PEM body off disk even when the child emits it over multiple chunks. A block that never
 * closes ends at the first line that is not key material, so later error lines still show.
 */
export const makeLogRedactor = (): ((line: string) => string) => {
  let withinPem = false;
  return (line) => {
    const isPemBegin = line.includes('-----BEGIN ');
    if (isPemBegin) {
      withinPem = !line.includes('-----END ');
      return '[redacted-key-material]';
    }

    const isPemEnd = line.includes('-----END ');
    if (withinPem && isPemEnd) {
      withinPem = false;
      return '[redacted-key-material]';
    }

    const isHiddenPemLine = withinPem && isPemBodyLine(line);
    if (isHiddenPemLine) return '[redacted-key-material]';

    withinPem = false;
    return redactLine(line);
  };
};

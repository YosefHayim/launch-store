import { homedir } from 'node:os';
import { isSecretLookingName } from '../../config/env.ts';
/** The user's home directory, collapsed to `~` so absolute paths don't leak the account name. */
const HOME = homedir();
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
  out = out.replace(
    /\b([A-Za-z][A-Za-z0-9_]*)(["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+)/g,
    (match, name: string, sep: string) => {
      if (isSecretLookingName(name)) return `${name}${sep}${MASK}`;
      return match;
    },
  );
  out = out.replace(
    /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
    '[redacted-jwt]',
  );
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, `$1${MASK}`);
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted-aws-key]');
  return out;
};
/**
 * Redact a whole log document: drop any PEM key/cert blocks first (they span lines, so they're only
 * visible with the full text), then apply {@link redactLine} to every remaining line. Used when reading
 * a persisted log back for `launch builds log` - a second pass over what was already scrubbed on write.
 */
export const redactText = (text: string): string => {
  return text
    .replace(
      /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g,
      '[redacted-key-material]',
    )
    .split('\n')
    .map(redactLine)
    .join('\n');
};
const isPemBodyLine = (line: string): boolean => {
  const isEmptyLine = line == '';
  if (isEmptyLine) return true;

  const isKeyMaterialLine = /^[A-Za-z0-9+/=]+$/.test(line);
  if (isKeyMaterialLine) return true;

  return /^(Proc-Type|DEK-Info): /.test(line);
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

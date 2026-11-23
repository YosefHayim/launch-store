import { homedir } from 'node:os';
import { isSecretLookingName } from '../../config/env.ts';
/** The user's home directory, collapsed to `~` so absolute paths don't leak the account name. */
const HOME = homedir();
/** The masked placeholder substituted for any redacted value. */
const MASK = '***';
/** Redact one line of log text */
export function redactLine(line: string): string {
  let out = line;
  if (HOME.length > 1) out = out.split(HOME).join('~');
  function replacePiece(match: string, name: string, sep: string) {
    if (isSecretLookingName(name)) return `${name}${sep}${MASK}`;
    return match;
  }

  out = out.replace(
    /\b([A-Za-z][A-Za-z0-9_]*)(["']?\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+)/g,
    replacePiece,
  );
  out = out.replace(
    /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
    '[redacted-jwt]',
  );
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, `$1${MASK}`);
  out = out.replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted-aws-key]');
  return out;
}
/** Redact a whole log document */
export function redactText(text: string): string {
  return text
    .replace(
      /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g,
      '[redacted-key-material]',
    )
    .split('\n')
    .map(redactLine)
    .join('\n');
}
function isPemBodyLine(line: string): boolean {
  const isEmptyLine = line == '';
  if (isEmptyLine) return true;

  const isKeyMaterialLine = /^[A-Za-z0-9+/=]+$/.test(line);
  if (isKeyMaterialLine) return true;

  return /^(Proc-Type|DEK-Info): /.test(line);
}

/** Keep a PEM body off disk even when the child emits it over multiple chunks. */
export function makeLogRedactor(): (line: string) => string {
  let withinPem = false;
  function runLine(line: string) {
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
  }

  return runLine;
}

// @ts-nocheck
const SECRET_FIELD_RE = /(?:token|secret|passw(?:or)?d|passphrase|credential|api[_-]?key|private[_-]?key|(?:^|[-_])key$|^auth$|(?:proxy[-_])?authorization$|(?:^|[-_])auth(?:[-_]|$)|^stdin$|^cookie$|^set[-_]?cookie$|^x-(?:auth|api|key|token|secret))/i;
const MAX_LOGGED_STRING = 2000;

const URL_CREDENTIAL_RE = /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)([^:@\s/]*):([^@\s/]+)@|(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)([^:@\s/]+)@/gi;
const BEARER_RE = /(?<![A-Za-z0-9_-])(Bearer|Basic|Token|ApiKey|Digest|OAuth|Negotiate|AWS4-HMAC-SHA256)\s+(?!\[REDACTED\])[^\s'",;|&<>\]}\\]+/gi;
const COOKIE_HEADER_RE = /\b((?:Set-)?Cookie\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\r\n]+)/gi;
const CLI_SECRET_FLAG_RE = /^--(?:[a-z0-9]+[-_])*(?:token|secret|passw(?:or)?d|passphrase|key|credential|(?:proxy[-_])?authorization|auth|cookie)$/i;
const CLI_SECRET_TEXT_RE = /((?:^|[\s;|&('"])--(?:[a-z0-9]+[-_])*(?:token|secret|passw(?:or)?d|passphrase|key|credential|(?:proxy[-_])?authorization|auth|cookie)(?:[ \t]+|=))(?:(\\")((?:[^\\]|\\(?!"))*)(?:\\"|$)|(")((?:[^"\\]|\\.)*)(?:"|$)|(\\')((?:[^\\]|\\(?!'))*)(?:\\'|$)|(')((?:[^'\\]|\\.)*)(?:'|$)|(?!-|\[REDACTED\]|[;|&()<>\r\n])(?:[^\s;|&()'"<>\\]|\\(?!["']))+)/gi;
const TELEMETRY_SECRET_RE = /(?<![A-Za-z0-9_-])((?:(?:[A-Za-z0-9]+[-_])*(?:token|secret|passw(?:or)?d|passphrase|credential|key|(?:proxy[-_])?authorization|set[-_]?cookie|cookie|auth)(?:[-_][A-Za-z0-9]+)*|x-(?:auth|api|key|token|secret)[^\s:=\\]*)(?:\\?['"])?\s*[:=]\s*(?:(?:Bearer|Basic|Token|ApiKey|Digest|OAuth|Negotiate|AWS4-HMAC-SHA256)\s+)?)(?:(\\")((?:[^\\]|\\(?!"))*)(?:\\"|$)|(")((?:[^"\\]|\\.)*)(?:"|$)|(\\')((?:[^\\]|\\(?!'))*)(?:\\'|$)|(')((?:[^'\\]|\\.)*)(?:'|$)|(\[REDACTED\]|[^\s'",}\]]+))/gi;

function truncateForLog(value: string): string {
  return value.length > MAX_LOGGED_STRING ? `${value.substring(0, MAX_LOGGED_STRING)}... [truncated]` : value;
}

function replaceSecretMatch(
  _m: string,
  prefix: string,
  edq?: string,
  _edv?: string,
  dq?: string,
  _dv?: string,
  esq?: string,
  _esv?: string,
  sq?: string,
): string {
  const quote = edq ?? dq ?? esq ?? sq;
  return quote !== undefined ? `${prefix}${quote}[REDACTED]${quote}` : `${prefix}[REDACTED]`;
}

/**
 * [INTENT]: Scrub URL credentials, auth headers, and secret key-value fields before writing logs/telemetry.
 */
export function redactTelemetryText(value: string): string {
  const bounded = value.length > MAX_LOGGED_STRING * 4 ? value.slice(0, MAX_LOGGED_STRING * 4) : value;
  const redacted = bounded
    .replace(URL_CREDENTIAL_RE, (_m, s1?: string, u1?: string, _p1?: string, s2?: string) => (
      s1 !== undefined ? `${s1}${u1 ?? ''}:[REDACTED]@` : `${s2 ?? ''}[REDACTED]@`
    ))
    .replace(COOKIE_HEADER_RE, '$1[REDACTED]')
    .replace(BEARER_RE, '$1 [REDACTED]')
    .replace(TELEMETRY_SECRET_RE, replaceSecretMatch)
    .replace(CLI_SECRET_TEXT_RE, replaceSecretMatch);
  return truncateForLog(redacted);
}

/**
 * [INTENT]: Redacted, size-bounded, cycle-safe deep copy of an arbitrary payload for issue logs.
 * [INVARIANT]: Never writes values of secret-like keys (env tokens, API keys), functions, or secret strings to disk.
 */
export function redactPayloadForLog(value: unknown, depth = 0, ancestors = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactTelemetryText(value);
  if (typeof value === 'bigint' || typeof value === 'symbol') return String(value);
  if (typeof value === 'function') return '[Function]';
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  if (value instanceof URL) return redactTelemetryText(value.href);
  if (Error.isError(value) || value instanceof Error) {
    return { name: value.name, message: redactTelemetryText(value.message) };
  }
  if (ancestors.has(value)) return '[Circular]';
  if (depth > 6) return '[depth-limit]';

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      let redactNext = false;
      return value.slice(0, 200).map((v) => {
        if (redactNext) {
          redactNext = false;
          if (typeof v === 'string' && !v.startsWith('-')) return '[REDACTED]';
        }
        if (typeof v === 'string' && CLI_SECRET_FLAG_RE.test(v)) redactNext = true;
        return redactPayloadForLog(v, depth + 1, ancestors);
      });
    }
    const out: Record<string, unknown> = {};
    Object.setPrototypeOf(out, null);
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_FIELD_RE.test(k) && v !== null && v !== undefined && v !== '' ? '[REDACTED]' : redactPayloadForLog(v, depth + 1, ancestors);
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
}

export function sanitizeLoggedIssuePayload(payload: unknown, extra?: Record<string, unknown>): { safePayload: unknown; internalStallBypass: boolean } {
  const safePayload = redactPayloadForLog(payload);
  const pre = extra?.['preInterceptorPayload'];
  const callerSentBypass =
    pre !== null &&
    pre !== undefined &&
    typeof pre === 'object' &&
    'bypassInterceptors' in pre &&
    pre.bypassInterceptors === true;
  if (
    safePayload !== null &&
    safePayload !== undefined &&
    typeof safePayload === 'object' &&
    !Array.isArray(safePayload) &&
    'bypassInterceptors' in safePayload &&
    safePayload.bypassInterceptors === true &&
    !callerSentBypass &&
    pre !== undefined
  ) {
    const cleaned: Record<string, unknown> = {};
    Object.setPrototypeOf(cleaned, null);
    for (const [k, v] of Object.entries(safePayload)) {
      if (k !== 'bypassInterceptors') {
        cleaned[k] = v;
      }
    }
    return { safePayload: cleaned, internalStallBypass: true };
  }
  return { safePayload, internalStallBypass: false };
}

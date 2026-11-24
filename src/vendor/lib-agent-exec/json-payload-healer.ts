// @ts-nocheck
import { tryPowershellObject } from './json-powershell-object.js';
import { tryParse, tryTokenAwareJson, stripTrailingCommasOutsideStrings } from './json-token-scan.js';

const KNOWN_PAYLOAD_KEYS = [
  'type', 'command', 'args', 'cwd', 'env', 'stdin', 'stdoutFile', 'stderrFile',
  'maxBuffer', 'truncateOutputLength', 'keepPayload', 'bypassInterceptors',
  'timeoutMs', 'stallTimeoutMs', 'expectJsonEnvelope', 'integrationContext',
  'templateOverride', 'onSuccess', 'onFailure', 'webhookMethod', 'webhookHeaders',
  'webhookPayloadTemplate', 'webhookTimeoutMs', 'target', 'scriptPath',
  'interpreter', 'code',
];

interface RepairChain {
  withoutTrailingCommas: () => unknown | undefined;
  withQuotedKeys: () => unknown | undefined;
  withSingleQuotes: () => unknown | undefined;
}

function stripMarkdownFence(trimmed: string): string {
  if (!trimmed.startsWith('```')) return trimmed;
  const body = trimmed.replace(/^```(?:json)?[ \t]*\r?\n?/i, '').trimEnd();
  return (body.endsWith('```') ? body.slice(0, -3) : body).trim();
}

function tryStripOuterQuotes(trimmed: string, depth: number): unknown | undefined {
  const singleQuoted = trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2;
  const doubleQuoted = trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2;
  if (!singleQuoted && !doubleQuoted) return undefined;
  const inner = trimmed.slice(1, -1).trim();
  return tryParse(inner) ?? (depth < 2 ? (tryHealJsonPayload(inner, depth + 1) ?? undefined) : undefined);
}

function tryUnescapeQuotes(trimmed: string): unknown | undefined {
  if (!trimmed.includes('\\"')) return undefined;
  return tryParse(trimmed.replace(/\\"/g, '"'));
}

function scanQuotedString(source: string, start: number, quote: string): { chunk: string; nextIdx: number } {
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    if (ch === quote) {
      return { chunk: source.slice(start, i + 1), nextIdx: i };
    }
    i += 1;
  }
  return { chunk: source.slice(start), nextIdx: source.length - 1 };
}

// [INVARIANT]: Only quote bare JS object keys outside quoted strings so embedded TS/Python syntax in `code` stays intact.
function quoteUnquotedObjectKeys(source: string): string {
  let out = '';
  let expectKey = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === undefined) continue;
    if (ch === '"' || ch === "'") {
      const scanned = scanQuotedString(source, i, ch);
      out += scanned.chunk;
      i = scanned.nextIdx;
      expectKey = false;
      continue;
    }
    if (ch === '{' || ch === ',') {
      expectKey = true;
      out += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      out += ch;
      continue;
    }
    if (expectKey) {
      const rest = source.slice(i);
      const keyMatch = /^([a-zA-Z0-9_]+)(\s*:)/.exec(rest);
      if (keyMatch?.[1] !== undefined && keyMatch[2] !== undefined) {
        out += `"${keyMatch[1]}"${keyMatch[2]}`;
        i += keyMatch[0].length - 1;
        expectKey = false;
        continue;
      }
      expectKey = false;
    }
    out += ch;
  }
  return out;
}

function decodeSingleQuotedInterior(raw: string): string {
  return raw.replace(/\\(.)/g, (_m, ch: string) => {
    switch (ch) {
      case '\\': return '\\';
      case "'": return "'";
      case '"': return '"';
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case 'b': return '\b';
      case 'f': return '\f';
      default: return `\\${ch}`;
    }
  });
}

function convertSingleQuotedTokens(source: string): string {
  return stripTrailingCommasOutsideStrings(
    source.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g, (match: string, _dq: string | undefined, sq: string | undefined) => (
      sq === undefined ? match : JSON.stringify(decodeSingleQuotedInterior(sq))
    ))
  );
}

// [INVARIANT]: Each repair strategy derives from the immutable comma-stripped string rather than mutating shared state across strategies.
function createRepairChain(trimmed: string): RepairChain {
  const commaStripped = stripTrailingCommasOutsideStrings(trimmed);
  const keyQuoted = quoteUnquotedObjectKeys(commaStripped);
  return {
    withoutTrailingCommas: () => tryParse(commaStripped),
    withQuotedKeys: () => tryParse(keyQuoted),
    withSingleQuotes: () => tryParse(convertSingleQuotedTokens(keyQuoted)) ?? tryParse(convertSingleQuotedTokens(commaStripped)),
  };
}

function healHexEscape(match: string, hex: string): string {
  return hex === '00' ? match : `\\u00${hex}`;
}

// [INVARIANT]: Never synthesize NUL bytes: '\0' and '\x00' are left for the invalid-backslash pass, which keeps them
// as literal backslash sequences (PayloadSchema rejects NULs).
function escapeStrayBackslashes(input: string): string {
  return input.replace(/\\(["\\/bfnrt]|u[0-9a-fA-F]{4})|\\/g, (match, validEscape) => (
    validEscape !== undefined ? match : '\\\\'
  ));
}

function healJsonStringInner(inner: string): string {
  return escapeStrayBackslashes(
    inner
      .replace(/\r\n/g, '\\n')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\n')
      .replace(/\t/g, '\\t')
      .replace(/\\\\|\\x([0-9a-fA-F]{2})/g, (m, hex: string | undefined) => (
        hex === undefined ? m : healHexEscape(m, hex)
      ))
  );
}

function healQuotedJsonStrings(source: string): string {
  return source.replace(/"((?:[^"\\]|\\.)*)"/gs, (_match, inner: string) => `"${healJsonStringInner(inner)}"`);
}

function tryHealedQuotedStrings(trimmed: string): unknown | undefined {
  return tryParse(healQuotedJsonStrings(trimmed));
}

function tryHealedQuotedStringsWithoutTrailingCommas(trimmed: string): unknown | undefined {
  return tryParse(stripTrailingCommasOutsideStrings(healQuotedJsonStrings(trimmed)));
}

function tryHealLooseEscapes(trimmed: string): unknown | undefined {
  const healedEscapes = stripTrailingCommasOutsideStrings(
    escapeStrayBackslashes(
      trimmed.replace(/\\\\|\\x([0-9a-fA-F]{2})/g, (m, hex: string | undefined) => (
        hex === undefined ? m : healHexEscape(m, hex)
      ))
    )
  );
  return tryParse(healedEscapes);
}

function tryPowershellStrippedQuotes(trimmed: string): unknown | undefined {
  if (!trimmed.startsWith('{')) return undefined;
  if (!trimmed.includes('\\ ') && !trimmed.includes('\\:') && !trimmed.includes('\\,')) return undefined;
  let psHealed = trimmed
    .replace(/^\{\s*\\?\s*/, '{"')
    .replace(/\\\s*:\s*\\/g, '":"')
    .replace(/\\\s*:\s*/g, '":"')
    .replace(/\\+\s*,\s*\\+/g, '","')
    .replace(/\\+\s*,\s*/g, '",')
    .replace(/,\s*\\+/g, ',"')
    .replace(/\\+\s*\}$/, '"}');
  if (!psHealed.endsWith('}')) {
    psHealed += psHealed.endsWith('"') ? '}' : '"}';
  }
  return tryParse(psHealed);
}

function tryCloseTrailingBrace(trimmed: string): unknown | undefined {
  if (!trimmed.startsWith('{') || trimmed.endsWith('}')) return undefined;
  const closed = tryParse(trimmed + '}');
  if (closed !== undefined) return closed;
  return tryParse(trimmed + '"}');
}

const KNOWN_KEYS_PATTERN = KNOWN_PAYLOAD_KEYS.join('|');
const TEMPLATE_BACKTICK_COMMA_RE = new RegExp(`(\`)\\s*,\\s*(("?)(${KNOWN_KEYS_PATTERN})("?)\\s*:)`, 'g');

function tryHealTemplateBackticks(trimmed: string): unknown | undefined {
  if (!trimmed.includes('`')) return undefined;
  try {
    const candidate = trimmed
      .replace(TEMPLATE_BACKTICK_COMMA_RE, '$1",$2')
      .replace(/(`)\s*\}/g, '$1"}');
    return tryParse(candidate);
  } catch {
    return undefined;
  }
}

export function tryHealJsonPayload(rawJson: string, depth = 0): unknown | null {
  const trimmed = stripMarkdownFence(rawJson.trim());
  const chain = createRepairChain(trimmed);
  const steps: Array<() => unknown | undefined> = [
    () => tryParse(trimmed),
    () => tryStripOuterQuotes(trimmed, depth),
    () => tryUnescapeQuotes(trimmed),
    () => chain.withoutTrailingCommas(),
    () => chain.withQuotedKeys(),
    () => chain.withSingleQuotes(),
    () => tryHealedQuotedStrings(trimmed),
    () => tryHealedQuotedStringsWithoutTrailingCommas(trimmed),
    () => tryHealLooseEscapes(trimmed),
    () => tryTokenAwareJson(trimmed),
    () => tryPowershellStrippedQuotes(trimmed),
    () => tryCloseTrailingBrace(trimmed),
    () => tryHealTemplateBackticks(trimmed),
    () => tryPowershellObject(trimmed, KNOWN_PAYLOAD_KEYS),
  ];
  for (const step of steps) {
    const value = step();
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value;
  }
  return null;
}

// @ts-nocheck
import { tryPowershellObject } from './json-powershell-object.js';
import { tryTokenAwareJson } from './json-token-scan.js';

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

function tryParse(json: string): unknown | undefined {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

function stripMarkdownFence(trimmed: string): string {
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function tryStripOuterQuotes(trimmed: string): unknown | undefined {
  const singleQuoted = trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2;
  const doubleQuoted = trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2;
  if (!singleQuoted && !doubleQuoted) return undefined;
  return tryParse(trimmed.slice(1, -1).trim());
}

function tryUnescapeQuotes(trimmed: string): unknown | undefined {
  if (!trimmed.includes('\\"')) return undefined;
  return tryParse(trimmed.replace(/\\"/g, '"'));
}

// [INVARIANT]: Key quoting and single-quote repair run on the comma-stripped candidate.
function createRepairChain(trimmed: string): RepairChain {
  let candidate = trimmed;
  return {
    withoutTrailingCommas: () => {
      candidate = candidate.replace(/,\s*([}\]])/g, '$1');
      return tryParse(candidate);
    },
    withQuotedKeys: () => {
      candidate = candidate.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
      return tryParse(candidate);
    },
    withSingleQuotes: () => {
      const singleToDouble = candidate
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, inner: string) => JSON.stringify(inner))
        .replace(/,\s*([}\]])/g, '$1');
      return tryParse(singleToDouble);
    },
  };
}

function healHexEscape(match: string, hex: string): string {
  return hex === '00' ? match : `\\u00${hex}`;
}

// [INVARIANT]: Never synthesize NUL bytes: '\0' and '\x00' are left for the invalid-backslash pass, which keeps them
// as literal backslash sequences (PayloadSchema rejects NULs).
function healJsonStringInner(inner: string): string {
  return inner
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\\x([0-9a-fA-F]{2})/g, healHexEscape)
    .replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, () => '\\\\');
}

function healQuotedJsonStrings(source: string): string {
  return source.replace(/"((?:[^"\\]|\\.)*)"/gs, (_match, inner: string) => `"${healJsonStringInner(inner)}"`);
}

function tryHealedQuotedStrings(trimmed: string): unknown | undefined {
  return tryParse(healQuotedJsonStrings(trimmed));
}

function tryHealedQuotedStringsWithoutTrailingCommas(trimmed: string): unknown | undefined {
  return tryParse(healQuotedJsonStrings(trimmed).replace(/,\s*([}\]])/g, '$1'));
}

function tryHealLooseEscapes(trimmed: string): unknown | undefined {
  const healedEscapes = trimmed
    .replace(/\\x([0-9a-fA-F]{2})/g, healHexEscape)
    .replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, () => '\\\\')
    .replace(/,\s*([}\]])/g, '$1');
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

function tryHealTemplateBackticks(trimmed: string): unknown | undefined {
  if (!trimmed.includes('`')) return undefined;
  try {
    const keysPattern = KNOWN_PAYLOAD_KEYS.join('|');
    const candidate = trimmed
      .replace(new RegExp(`(\`)\\s*,\\s*(("?)(${keysPattern})("?)\\s*:)`, 'g'), '$1",$2')
      .replace(/(`)\s*\}/g, '$1"}');
    return tryParse(candidate);
  } catch {
    return undefined;
  }
}

export function tryHealJsonPayload(rawJson: string): unknown | null {
  const trimmed = stripMarkdownFence(rawJson.trim());
  const chain = createRepairChain(trimmed);
  const steps: Array<() => unknown | undefined> = [
    () => tryParse(trimmed),
    () => tryStripOuterQuotes(trimmed),
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
    if (value !== undefined) return value;
  }
  return null;
}

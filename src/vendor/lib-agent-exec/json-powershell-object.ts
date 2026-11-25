// @ts-nocheck
interface PowershellPair {
  key: string;
  rawVal: string;
}

const KEY_STRIP_RE = /['"\\\s]/g;
const ARRAY_UNESCAPE_RE = /\\(["',])/g;
const VALUE_SPECIAL_RE = /[\\"'`{[\]()}]|,+/g;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isAsciiSpace = (c: number): boolean => c === 32 || (c >= 9 && c <= 13);
const isKeyStartCode = (c: number): boolean =>
  (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 34 || c === 39 || c === 92;

interface PairScan {
  content: string;
  knownKeys: readonly string[];
  currentKey: string;
  inKey: boolean;
  valStart: number;
  depth: number;
  inString: false | '"' | "'" | '`';
  isEscaped: boolean;
  pairs: PowershellPair[];
  index: number;
}

function keyRestStarts(rest: string, key: string): boolean {
  return rest.startsWith(key + ':')
    || rest.startsWith(`"${key}":`)
    || rest.startsWith(`'${key}':`)
    || rest.startsWith(`\\${key}\\`)
    || rest.startsWith(`\\ ${key}\\`)
    || rest.startsWith(`\\${key}:`)
    || rest.startsWith(`\\ ${key}:`)
    || rest.startsWith(`\\${key}\\:`);
}

function handleBackslash(scan: PairScan): void {
  if (scan.inKey) return;
  const nextChar = scan.content[scan.index + 1];
  if (nextChar === ':' || nextChar === ',' || nextChar === '}' || nextChar === ']') return;
  scan.isEscaped = true;
}

function consumeStringDelimiter(scan: PairScan, ch: string): boolean {
  if (scan.inString !== false) {
    if (ch === scan.inString) {
      scan.inString = false;
      return true;
    }
    if (scan.inKey && !isAsciiSpace(ch.charCodeAt(0))) scan.currentKey += ch;
    return true;
  }
  if (ch === '"' || ch === "'" || ch === '`') {
    scan.inString = ch;
    return true;
  }
  return false;
}

function consumeDepthChar(scan: PairScan, ch: string): boolean {
  if (ch === '{' || ch === '[' || ch === '(') {
    scan.depth++;
    return true;
  }
  if (ch === '}' || ch === ']' || ch === ')') {
    if (scan.depth > 0) scan.depth--;
    return true;
  }
  return false;
}

const NEXT_KNOWN_KEY_RE = /^(?:\\ ?|"|')?([A-Za-z]+)(?:\\:|:|"|')/;

function takePairAtComma(scan: PairScan, knownKeySet: ReadonlySet<string>): void {
  let k = scan.index + 1;
  const len = scan.content.length;
  while (k < len && isAsciiSpace(scan.content.charCodeAt(k))) k++;
  if (k >= len || !isKeyStartCode(scan.content.charCodeAt(k))) return;
  const rest = scan.content.slice(k, k + 40);
  const keyMatch = rest.match(NEXT_KNOWN_KEY_RE);
  const candidateKey = keyMatch?.[1];
  if (candidateKey === undefined || !knownKeySet.has(candidateKey) || !keyRestStarts(rest, candidateKey)) return;
  const rawVal = scan.content.slice(scan.valStart, scan.index).trim();
  scan.pairs.push({ key: scan.currentKey.replace(KEY_STRIP_RE, ''), rawVal });
  scan.currentKey = '';
  scan.inKey = true;
}

function pushTrailingPair(scan: PairScan): void {
  if (scan.inKey || scan.valStart === -1) return;
  const rawVal = scan.content.slice(scan.valStart).trim();
  scan.pairs.push({ key: scan.currentKey.replace(KEY_STRIP_RE, ''), rawVal });
}

function handleCommaRun(scan: PairScan, match: RegExpExecArray, knownKeySet: ReadonlySet<string>): number {
  const lastComma = match.index + match[0].length - 1;
  if (lastComma + 1 < scan.content.length) {
    scan.index = lastComma;
    takePairAtComma(scan, knownKeySet);
  }
  return lastComma;
}

function scanPowershellPairs(content: string, knownKeys: readonly string[]): PowershellPair[] {
  const knownKeySet = new Set(knownKeys);
  const scan: PairScan = {
    content,
    knownKeys,
    currentKey: '',
    inKey: true,
    valStart: -1,
    depth: 0,
    inString: false,
    isEscaped: false,
    pairs: [],
    index: 0,
  };
  const len = content.length;
  for (let i = 0; i < len; i++) {
    if (scan.isEscaped) {
      scan.isEscaped = false;
      continue;
    }
    if (!scan.inKey && scan.inString === false && scan.depth === 0) {
      VALUE_SPECIAL_RE.lastIndex = i;
      const match = VALUE_SPECIAL_RE.exec(content);
      if (match === null) break;
      if (content.charCodeAt(match.index) === 44) {
        i = handleCommaRun(scan, match, knownKeySet);
        continue;
      }
      i = match.index;
    }
    const code = content.charCodeAt(i);
    if (code === 92) {
      scan.index = i;
      handleBackslash(scan);
      continue;
    }
    if (scan.inString !== false || code === 34 || code === 39 || code === 96) {
      if (consumeStringDelimiter(scan, content[i] ?? '')) continue;
    }
    if (code === 123 || code === 91 || code === 40 || code === 125 || code === 93 || code === 41) {
      consumeDepthChar(scan, content[i] ?? '');
      continue;
    }
    if (scan.depth !== 0 || !scan.inKey) continue;
    if (code === 58) {
      scan.inKey = false;
      scan.valStart = i + 1;
    } else if (!isAsciiSpace(code)) {
      scan.currentKey += content[i] ?? '';
    }
  }
  pushTrailingPair(scan);
  return scan.pairs;
}

function stripWrappingBackslashes(cleanVal: string): string {
  if (cleanVal.startsWith('\\') && cleanVal.endsWith('\\') && cleanVal.length >= 2) {
    return cleanVal.slice(1, -1).trim();
  }
  return cleanVal;
}

function unwrapQuotes(cleanVal: string): string | null {
  const doubleQuoted = cleanVal.startsWith('"') && cleanVal.endsWith('"') && cleanVal.length >= 2;
  const singleQuoted = cleanVal.startsWith("'") && cleanVal.endsWith("'") && cleanVal.length >= 2;
  if (!doubleQuoted && !singleQuoted) return null;
  return cleanVal.slice(1, -1);
}

function cleanArrayItem(item: string): string {
  let cleaned = stripWrappingBackslashes(item.trim());
  const doubleQuoted = cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length >= 2;
  const singleQuoted = cleaned.startsWith("'") && cleaned.endsWith("'") && cleaned.length >= 2;
  if (doubleQuoted || singleQuoted) cleaned = cleaned.slice(1, -1);
  return cleaned.replace(ARRAY_UNESCAPE_RE, '$1');
}

function splitTopLevelArrayItems(inner: string): string[] {
  const items: string[] = [];
  let start = 0;
  let depth = 0;
  let inQuote: '"' | "'" | null = null;
  let escaped = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') {
      const nextCh = inner[i + 1] ?? '';
      if (inQuote !== null || (nextCh !== ',' && nextCh !== ']' && nextCh !== '}' && nextCh !== ')')) {
        escaped = true;
      }
      continue;
    }
    if (inQuote !== null) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inQuote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { if (depth > 0) depth--; continue; }
    if (ch === ',' && depth === 0) {
      items.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  items.push(inner.slice(start));
  return items;
}

function coerceArray(cleanVal: string): string[] | null {
  if (!cleanVal.startsWith('[') || !cleanVal.endsWith(']')) return null;
  const inner = cleanVal.slice(1, -1).trim();
  if (inner.length === 0) return [];
  const rawItems = splitTopLevelArrayItems(inner);
  if (rawItems.length > 1 && (rawItems[rawItems.length - 1] ?? '').trim().length === 0) {
    rawItems.pop();
  }
  return rawItems.map(cleanArrayItem);
}

function coerceScalar(cleanVal: string): unknown {
  if (cleanVal === 'true') return true;
  if (cleanVal === 'false') return false;
  const num = Number(cleanVal);
  if (cleanVal.trim() !== '' && Number.isFinite(num)) return num;
  return cleanVal;
}

function coercePowershellValue(rawVal: string): unknown {
  const cleanVal = stripWrappingBackslashes(rawVal);
  try {
    return JSON.parse(cleanVal);
  } catch {
    // Fall back to unwrapping quotes for malformed PowerShell values with unescaped backslashes
  }
  const quoted = unwrapQuotes(cleanVal);
  if (quoted !== null) return quoted;
  const items = coerceArray(cleanVal);
  if (items !== null) return items;
  return coerceScalar(cleanVal);
}

function hasPayloadIdentity(pairs: readonly PowershellPair[]): boolean {
  return pairs.length > 0 && pairs.some(pair =>
    pair.key === 'type' || pair.key === 'command' || pair.key === 'code' || pair.key === 'scriptPath'
  );
}

export function tryPowershellObject(trimmed: string, knownKeys: readonly string[]): unknown {
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  try {
    const pairs = scanPowershellPairs(trimmed.slice(1, -1).trim(), knownKeys);
    if (!hasPayloadIdentity(pairs)) return undefined;
    const result: Record<string, unknown> = {};
    for (const pair of pairs) {
      if (FORBIDDEN_KEYS.has(pair.key)) continue;
      result[pair.key] = coercePowershellValue(pair.rawVal);
    }
    return result;
  } catch (err: unknown) {
    if (!(err instanceof SyntaxError)) {
      console.error(`⚠️ PowerShell object heal error: ${err instanceof Error ? err.message : String(err)}`);
    }
    return undefined;
  }
}

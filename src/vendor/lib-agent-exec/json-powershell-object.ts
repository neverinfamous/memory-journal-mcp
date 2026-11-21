// @ts-nocheck
interface PowershellPair {
  key: string;
  rawVal: string;
}

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
    if (ch === scan.inString) scan.inString = false;
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

function takePairAtComma(scan: PairScan): void {
  const rest = scan.content.slice(scan.index + 1).trimStart();
  const matchKey = scan.knownKeys.find(key => keyRestStarts(rest, key));
  if (matchKey === undefined) return;
  const rawVal = scan.content.slice(scan.valStart, scan.index).trim();
  scan.pairs.push({ key: scan.currentKey.replace(/['"\\\s]/g, ''), rawVal });
  scan.currentKey = '';
  scan.inKey = true;
}

function consumeKeyOrComma(scan: PairScan, ch: string): void {
  if (scan.depth !== 0) return;
  if (scan.inKey) {
    if (ch === ':') {
      scan.inKey = false;
      scan.valStart = scan.index + 1;
      return;
    }
    if (!/\s/.test(ch)) scan.currentKey += ch;
    return;
  }
  if (ch === ',') takePairAtComma(scan);
}

function pushTrailingPair(scan: PairScan): void {
  if (scan.inKey || scan.valStart === -1) return;
  const rawVal = scan.content.slice(scan.valStart).trim();
  scan.pairs.push({ key: scan.currentKey.replace(/['"\\\s]/g, ''), rawVal });
}

function scanPowershellPairs(content: string, knownKeys: readonly string[]): PowershellPair[] {
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
  for (scan.index = 0; scan.index < content.length; scan.index++) {
    const ch = content[scan.index];
    if (ch === undefined) continue;
    if (scan.isEscaped) {
      scan.isEscaped = false;
      continue;
    }
    if (ch === '\\') {
      handleBackslash(scan);
      continue;
    }
    if (consumeStringDelimiter(scan, ch)) continue;
    if (consumeDepthChar(scan, ch)) continue;
    consumeKeyOrComma(scan, ch);
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
  const doubleQuoted = cleaned.startsWith('"') && cleaned.endsWith('"');
  const singleQuoted = cleaned.startsWith("'") && cleaned.endsWith("'");
  if (doubleQuoted || singleQuoted) cleaned = cleaned.slice(1, -1);
  return cleaned.replace(/\\/g, '');
}

function coerceArray(cleanVal: string): string[] | null {
  if (!cleanVal.startsWith('[') || !cleanVal.endsWith(']')) return null;
  const inner = cleanVal.slice(1, -1).trim();
  if (inner.length === 0) return [];
  return inner.split(',').map(cleanArrayItem);
}

function coerceScalar(cleanVal: string): unknown {
  if (cleanVal === 'true') return true;
  if (cleanVal === 'false') return false;
  if (!isNaN(Number(cleanVal)) && cleanVal.trim() !== '') return Number(cleanVal);
  return cleanVal;
}

function coercePowershellValue(rawVal: string): unknown {
  const cleanVal = stripWrappingBackslashes(rawVal);
  const quoted = unwrapQuotes(cleanVal);
  if (quoted !== null) return quoted;
  try {
    return JSON.parse(cleanVal);
  } catch {
    // Not JSON primitive
  }
  const items = coerceArray(cleanVal);
  if (items !== null) return items;
  return coerceScalar(cleanVal);
}

function hasPayloadIdentity(pairs: readonly PowershellPair[]): boolean {
  return pairs.length > 0 && pairs.some(pair =>
    pair.key === 'type' || pair.key === 'command' || pair.key === 'code' || pair.key === 'scriptPath'
  );
}

export function tryPowershellObject(trimmed: string, knownKeys: readonly string[]): unknown | undefined {
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  try {
    const pairs = scanPowershellPairs(trimmed.slice(1, -1).trim(), knownKeys);
    if (!hasPayloadIdentity(pairs)) return undefined;
    const result: Record<string, unknown> = {};
    for (const pair of pairs) {
      result[pair.key] = coercePowershellValue(pair.rawVal);
    }
    return result;
  } catch {
    return undefined;
  }
}

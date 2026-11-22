// @ts-nocheck
interface ScanState {
  out: string;
  inString: boolean;
  isEscaped: boolean;
  index: number;
}

function tryParse(json: string): unknown | undefined {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

function unescapeStructuralPrefix(source: string): string {
  if (!source.startsWith('{\\"') && !source.startsWith('{ \\"')) return source;
  return source
    .replace(/\{\s*\\"/g, '{"')
    .replace(/\\"\s*:\s*\\"/g, '":"')
    .replace(/\\"\s*,\s*\\"/g, '","')
    .replace(/\\"\s*:\s*/g, '":')
    .replace(/,\s*\\"/g, ',"')
    .replace(/\\"\s*\}/g, '"}')
    .replace(/\\"\s*\]/g, '"]')
    .replace(/\[\s*\\"/g, '["');
}

function appendOutsideString(state: ScanState, ch: string): void {
  if (ch === '"') state.inString = true;
  state.out += ch;
}

function appendEscapedChar(state: ScanState, source: string, ch: string): void {
  state.isEscaped = false;
  if (['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(ch)) {
    state.out += ch;
    return;
  }
  if (ch === 'u' && /^[0-9a-fA-F]{4}/.test(source.slice(state.index + 1, state.index + 5))) {
    state.out += ch;
    return;
  }
  if (ch === 'x' && /^[0-9a-fA-F]{2}/.test(source.slice(state.index + 1, state.index + 3))) {
    const hex = source.slice(state.index + 1, state.index + 3);
    state.out = state.out.slice(0, -1) + (hex === '00' ? '\\\\x00' : `\\u00${hex}`);
    state.index += 2;
    return;
  }
  state.out = state.out.slice(0, -1) + '\\\\' + ch;
}

function appendPlainStringChar(state: ScanState, ch: string): void {
  if (ch === '\\') {
    state.isEscaped = true;
    state.out += ch;
    return;
  }
  if (ch === '"') {
    state.inString = false;
    state.out += ch;
    return;
  }
  if (ch === '\n') {
    state.out += '\\n';
    return;
  }
  if (ch === '\r') {
    state.out += '\\r';
    return;
  }
  if (ch === '\t') {
    state.out += '\\t';
    return;
  }
  state.out += ch;
}

export function stripTrailingCommasOutsideStrings(source: string): string {
  let out = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === undefined) continue;
    if (quote !== null) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < source.length && /\s/.test(source[j] ?? '')) j++;
      if (source[j] === '}' || source[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}

function scanTokenAwareJson(source: string): string {
  const state: ScanState = { out: '', inString: false, isEscaped: false, index: 0 };
  for (; state.index < source.length; state.index++) {
    const ch = source[state.index];
    if (ch === undefined) continue;
    if (!state.inString) {
      appendOutsideString(state, ch);
      continue;
    }
    if (state.isEscaped) {
      appendEscapedChar(state, source, ch);
      continue;
    }
    appendPlainStringChar(state, ch);
  }
  if (state.isEscaped) {
    state.out = state.out.slice(0, -1) + '\\\\';
  }
  return stripTrailingCommasOutsideStrings(state.out);
}

export function tryTokenAwareJson(trimmed: string): unknown | undefined {
  try {
    return tryParse(scanTokenAwareJson(unescapeStructuralPrefix(trimmed)));
  } catch {
    return undefined;
  }
}

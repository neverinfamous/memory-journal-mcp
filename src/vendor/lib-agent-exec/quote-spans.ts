// @ts-nocheck
interface Span {
  start: number;
  end: number;
}

export interface NonCodeSpanOptions {
  includeHashComments?: boolean;
  includeSlashComments?: boolean;
  includeRegexLiterals?: boolean;
  allowMultilineQuotes?: boolean;
  noSingleQuoteEscape?: boolean;
}

function skipWhitespaceBackwardsIndex(source: string, idx: number): number {
  for (let i = idx - 1; i >= 0; i--) {
    const ch = source[i];
    if (ch !== ' ' && ch !== '\t' && ch !== '\r' && ch !== '\n') return i;
  }
  return -1;
}

function looksLikeRegexStart(source: string, index: number): boolean {
  const prevIdx = skipWhitespaceBackwardsIndex(source, index);
  const prev = prevIdx >= 0 ? (source[prevIdx] ?? '') : '';
  if (prev === '+' || prev === '-') {
    const beforePrev = prevIdx > 0 ? source[prevIdx - 1] : '';
    return beforePrev !== prev;
  }
  if (prev === '' || '(=,[!&|?:;~^*/{(\n'.includes(prev)) return true;
  const before = source.slice(Math.max(0, index - 16), index).trimEnd();
  return /\b(?:return|throw|case|in|of|typeof|instanceof|void|delete|await|yield)$/.test(before);
}

function hasClosingRegexSlashOnLine(source: string, start: number): boolean {
  let inClass = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\n' || ch === '\r') return false;
    if (ch === '\\') { i += 1; continue; }
    if (ch === '[' && !inClass) { inClass = true; continue; }
    if (ch === ']' && inClass) { inClass = false; continue; }
    if (ch === '/' && !inClass) return true;
  }
  return false;
}

function closeRegexLiteral(source: string, index: number): number {
  let inClass = false;
  let i = index;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '\n' || ch === '\r') return index;
    if (ch === '[' && !inClass) {
      inClass = true;
      i += 1;
      continue;
    }
    if (ch === ']' && inClass) {
      inClass = false;
      i += 1;
      continue;
    }
    if (ch === '/' && !inClass) {
      i += 1;
      while (i < source.length && /[a-z]/i.test(source[i] ?? '')) i += 1;
      return i;
    }
    i += 1;
  }
  return index;
}

function closeTemplateLiteral(source: string, index: number, options: NonCodeSpanOptions): number {
  let i = index;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '$' && source[i + 1] === '{') {
      i = closeTemplateExpr(source, i + 2, options);
      continue;
    }
    if (ch === '`') return i + 1;
    i += 1;
  }
  return i;
}

function closeTemplateExpr(source: string, index: number, options: NonCodeSpanOptions): number {
  const { includeSlashComments = true, includeRegexLiterals = true } = options;
  let depth = 1;
  let i = index;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (includeSlashComments && ch === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (includeSlashComments && ch === '/' && source[i + 1] === '*') {
      const endBlock = source.indexOf('*/', i + 2);
      i = endBlock === -1 ? source.length : endBlock + 2;
      continue;
    }
    if (includeRegexLiterals && ch === '/' && looksLikeRegexStart(source, i)) {
      const regexEnd = closeRegexLiteral(source, i + 1);
      if (regexEnd > i + 1) {
        i = regexEnd;
        continue;
      }
    }
    if (ch === "'" || ch === '"') {
      i = closeQuote(source, i + 1, ch);
      continue;
    }
    if (ch === '`') {
      i = closeTemplateLiteral(source, i + 1, options);
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    i += 1;
  }
  return i;
}

/** [INTENT]: Quote, regex-literal, and comment spans so healers do not rewrite non-code or literal contents. */
export function buildNonCodeSpans(source: string, options: NonCodeSpanOptions = {}): Span[] {
  const { includeHashComments = false, includeSlashComments = true, includeRegexLiterals = true } = options;
  const spans: Span[] = [];
  let index = 0;
  while (index < source.length) {
    const ch = source[index];
    if (includeSlashComments && ch === '/' && source[index + 1] === '/') {
      const start = index;
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      spans.push({ start, end: index });
      continue;
    }
    if (includeSlashComments && ch === '/' && source[index + 1] === '*') {
      const start = index;
      const closeIdx = source.indexOf('*/', index + 2);
      index = closeIdx === -1 ? source.length : closeIdx + 2;
      spans.push({ start, end: index });
      continue;
    }
    if (includeHashComments && ch === '#' && (index === 0 || /[\s;(]/.test(source[index - 1] ?? ''))) {
      const start = index;
      while (index < source.length && source[index] !== '\n') index += 1;
      spans.push({ start, end: index });
      continue;
    }
    if (includeRegexLiterals && ch === '/' && source[index + 1] !== '/' && source[index + 1] !== '*' && looksLikeRegexStart(source, index)) {
      const start = index;
      const end = closeRegexLiteral(source, index + 1);
      if (end > index + 1) {
        spans.push({ start, end });
        index = end;
        continue;
      }
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const start = index;
      const quote = ch;
      index = quote === '`' ? closeTemplateLiteral(source, index + 1, options) : closeQuote(source, index + 1, quote, options);
      spans.push({ start, end: index });
      continue;
    }
    index += 1;
  }
  return spans;
}

function closeQuote(source: string, index: number, quote: string, options?: NonCodeSpanOptions): number {
  while (index < source.length) {
    if (source[index] === '\\' && !(quote === "'" && options?.noSingleQuoteEscape === true)) {
      index += 2;
      continue;
    }
    if (source[index] === quote) return index + 1;
    if (quote !== '`' && options?.allowMultilineQuotes !== true && source[index] === '\n') return index;
    index += 1;
  }
  return index;
}

export function isIndexInSpans(spans: readonly Span[], index: number): boolean {
  for (const span of spans) {
    if (index < span.start) return false;
    if (index < span.end) return true;
  }
  return false;
}

function extractReplaceOffset(args: readonly unknown[]): unknown {
  return typeof args[args.length - 1] === 'object' && args[args.length - 1] !== null
    ? args[args.length - 3]
    : args[args.length - 2];
}

export function replaceOutsideQuotes(
  source: string,
  pattern: RegExp,
  replacer: (match: string) => string,
  options?: NonCodeSpanOptions,
): string {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  const spans = buildNonCodeSpans(source, options);
  return source.replace(globalPattern, (match: string, ...args: unknown[]) => {
    const offset = extractReplaceOffset(args);
    if (typeof offset === 'number' && isIndexInSpans(spans, offset)) return match;
    return replacer(match);
  });
}

export interface CodeScanState {
  inSingle: boolean;
  inDouble: boolean;
  inBacktick: boolean;
  inLineComment: boolean;
  inBlockComment: boolean;
  inRegex: boolean;
  inRegexClass: boolean;
  templateExprDepths: number[];
}

export function createCodeScanState(): CodeScanState {
  return {
    inSingle: false,
    inDouble: false,
    inBacktick: false,
    inLineComment: false,
    inBlockComment: false,
    inRegex: false,
    inRegexClass: false,
    templateExprDepths: [],
  };
}

// [INTENT]: Shared single-character string/comment/regex/template-expr scanner so nested heuristics skip literals and comments.
export function stepCodeScanState(code: string, i: number, state: CodeScanState): number | null {
  const ch = code[i];
  const next = code[i + 1];
  if (state.inLineComment) { if (ch === '\n') state.inLineComment = false; return i; }
  if (state.inBlockComment) {
    if (ch === '*' && next === '/') { state.inBlockComment = false; return i + 1; }
    return i;
  }
  if (state.inRegex) {
    if (ch === '\\') return i + 1;
    if (ch === '\n' || ch === '\r') { state.inRegex = false; state.inRegexClass = false; return i; }
    if (ch === '[' && !state.inRegexClass) { state.inRegexClass = true; return i; }
    if (ch === ']' && state.inRegexClass) { state.inRegexClass = false; return i; }
    if (ch === '/' && !state.inRegexClass) { state.inRegex = false; return i; }
    return i;
  }
  if (state.inSingle) {
    if (ch === '\\') return i + 1;
    if (ch === "'") state.inSingle = false;
    return i;
  }
  if (state.inDouble) {
    if (ch === '\\') return i + 1;
    if (ch === '"') state.inDouble = false;
    return i;
  }
  if (state.inBacktick) {
    if (ch === '\\') return i + 1;
    if (ch === '$' && next === '{') {
      state.inBacktick = false;
      state.templateExprDepths.push(1);
      return i + 1;
    }
    if (ch === '`') state.inBacktick = false;
    return i;
  }
  if (state.templateExprDepths.length > 0) {
    if (ch === '{') {
      const topIdx = state.templateExprDepths.length - 1;
      state.templateExprDepths[topIdx] = (state.templateExprDepths[topIdx] ?? 0) + 1;
    } else if (ch === '}') {
      const top = (state.templateExprDepths[state.templateExprDepths.length - 1] ?? 1) - 1;
      if (top <= 0) {
        state.templateExprDepths.pop();
        state.inBacktick = true;
        return i;
      }
      state.templateExprDepths[state.templateExprDepths.length - 1] = top;
    }
  }
  if (ch === '/' && next === '/') { state.inLineComment = true; return i + 1; }
  if (ch === '/' && next === '*') { state.inBlockComment = true; return i + 1; }
  if (ch === '/' && looksLikeRegexStart(code, i) && hasClosingRegexSlashOnLine(code, i + 1)) { state.inRegex = true; return i; }
  if (ch === "'") { state.inSingle = true; return i; }
  if (ch === '"') { state.inDouble = true; return i; }
  if (ch === '`') { state.inBacktick = true; return i; }
  return null;
}

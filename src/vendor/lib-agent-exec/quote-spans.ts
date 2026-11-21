// @ts-nocheck
interface Span {
  start: number;
  end: number;
}

export interface NonCodeSpanOptions {
  includeHashComments?: boolean;
  includeSlashComments?: boolean;
  includeRegexLiterals?: boolean;
}

function skipWhitespaceBackwards(source: string, idx: number): string {
  for (let i = idx - 1; i >= 0; i--) {
    const ch = source[i];
    if (ch !== ' ' && ch !== '\t' && ch !== '\r' && ch !== '\n') return ch ?? '';
  }
  return '';
}

function looksLikeRegexStart(source: string, index: number): boolean {
  const prev = skipWhitespaceBackwards(source, index);
  if (prev === '' || '(=,[!&|?:;~^+-*%/{(\n'.includes(prev)) {
    if (prev === ')') return false;
    return true;
  }
  const before = source.slice(Math.max(0, index - 16), index).trimEnd();
  return /\b(?:return|throw|case|in|of|typeof|instanceof|void|delete|await|yield)$/.test(before);
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

function closeTemplateLiteral(source: string, index: number): number {
  let i = index;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '$' && source[i + 1] === '{') {
      i = closeTemplateExpr(source, i + 2);
      continue;
    }
    if (ch === '`') return i + 1;
    i += 1;
  }
  return i;
}

function closeTemplateExpr(source: string, index: number): number {
  let depth = 1;
  let i = index;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const endBlock = source.indexOf('*/', i + 2);
      i = endBlock === -1 ? source.length : endBlock + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      i = closeQuote(source, i + 1, ch);
      continue;
    }
    if (ch === '`') {
      i = closeTemplateLiteral(source, i + 1);
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
      index = quote === '`' ? closeTemplateLiteral(source, index + 1) : closeQuote(source, index + 1, quote);
      spans.push({ start, end: index });
      continue;
    }
    index += 1;
  }
  return spans;
}

function closeQuote(source: string, index: number, quote: string): number {
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (source[index] === quote) return index + 1;
    if (quote !== '`' && source[index] === '\n') return index;
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

function isLineCommentBefore(prefix: string): boolean {
  let index = 0;
  let quote = '';
  while (index < prefix.length) {
    const ch = prefix[index];
    if (quote.length > 0) {
      if (ch === '\\') {
        index += 2;
        continue;
      }
      if (ch === quote) quote = '';
      index += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      index += 1;
      continue;
    }
    if (ch === '/' && prefix[index + 1] === '/') return true;
    index += 1;
  }
  return false;
}

/** [INTENT]: WSL drive-letter conversion must rewrite quoted JS paths and still leave // comments alone. */
export function replaceOutsideLineComments(source: string, pattern: RegExp, replacer: (match: string) => string): string {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  return source.replace(globalPattern, (match: string, ...args: unknown[]) => {
    const offset = args[args.length - 2];
    if (typeof offset !== 'number') return replacer(match);
    const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
    if (isLineCommentBefore(source.slice(lineStart, offset))) return match;
    return replacer(match);
  });
}

export function replaceOutsideQuotes(source: string, pattern: RegExp, replacer: (match: string) => string): string {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  const spans = buildNonCodeSpans(source);
  return source.replace(globalPattern, (match: string, ...args: unknown[]) => {
    const offset = args[args.length - 2];
    if (typeof offset === 'number' && isIndexInSpans(spans, offset)) return match;
    return replacer(match);
  });
}

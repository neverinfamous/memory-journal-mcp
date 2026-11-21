// @ts-nocheck
interface Span {
  start: number;
  end: number;
}

/** [INTENT]: Quote and line-comment spans so path healers do not rewrite literals. */
export function buildNonCodeSpans(source: string): Span[] {
  const spans: Span[] = [];
  let index = 0;
  while (index < source.length) {
    const ch = source[index];
    if (ch === '/' && source[index + 1] === '/') {
      const start = index;
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      spans.push({ start, end: index });
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const start = index;
      const quote = ch;
      index += 1;
      index = closeQuote(source, index, quote);
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

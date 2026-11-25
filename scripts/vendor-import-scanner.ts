/**
 * Lightweight, comment/string/template/regex-aware ESM module specifier scanner.
 * Replaces full `typescript` compiler loading in `sync-vendor.ts` (~3s cold-start savings).
 */

type Token =
  | { kind: 'ident'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'punct'; value: string };

const REGEX_BEFORE_KEYWORDS = new Set([
  'return',
  'throw',
  'case',
  'delete',
  'void',
  'typeof',
  'await',
  'yield',
  'else',
  'of',
  'in',
  'instanceof',
  'new',
  'export',
  'import',
]);

const REGEX_BEFORE_PUNCTS = new Set([
  '',
  '(',
  '[',
  '{',
  ',',
  ';',
  ':',
  '?',
  '=',
  '!',
  '~',
  '+',
  '-',
  '*',
  '%',
  '&',
  '|',
  '^',
  '<',
  '>',
  '?.',
]);

function isIdentStart(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36 || c >= 128;
}

function isIdentPart(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return isIdentStart(ch) || (c >= 48 && c <= 57);
}

function skipQuoted(src: string, pos: number, quote: string): { value: string; next: number } {
  let i = pos + 1;
  let value = '';
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      value += src.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === quote) return { value, next: i + 1 };
    value += ch;
    i++;
  }
  return { value, next: i };
}

function skipRegexLiteral(src: string, pos: number): number {
  let i = pos + 1;
  let inClass = false;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === ']' && inClass) inClass = false;
    else if (ch === '/' && !inClass) {
      i++;
      while (i < src.length && isIdentStart(src[i] ?? '')) i++;
      return i;
    } else if (ch === '\n' || ch === '\r') {
      return i;
    }
    i++;
  }
  return i;
}

function tokenizeSource(src: string): Token[] {
  const tokens: Token[] = [];
  const tplBraces: number[] = [];
  let braceDepth = 0;
  let canRegex = true;
  let i = 0;

  while (i < src.length) {
    const ch = src[i] ?? '';
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++;
      continue;
    }
    const next = src[i + 1] ?? '';
    if (ch === '/' && next === '/') {
      const nl = src.indexOf('\n', i + 2);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const parsed = skipQuoted(src, i, ch);
      tokens.push({ kind: 'string', value: parsed.value });
      i = parsed.next;
      canRegex = false;
      continue;
    }
    if (ch === '`') {
      const res = readTemplatePart(src, i + 1, braceDepth, tplBraces, tokens, false);
      i = res.next;
      canRegex = res.canRegex;
      continue;
    }
    if (ch === '/' && canRegex) {
      i = skipRegexLiteral(src, i);
      tokens.push({ kind: 'punct', value: 'regex' });
      canRegex = false;
      continue;
    }
    if (ch === '}' && tplBraces.length > 0 && braceDepth === tplBraces[tplBraces.length - 1]) {
      tplBraces.pop();
      const res = readTemplatePart(src, i + 1, braceDepth, tplBraces, tokens, true);
      i = res.next;
      canRegex = res.canRegex;
      continue;
    }
    if (isIdentStart(ch)) {
      let end = i + 1;
      while (end < src.length && isIdentPart(src[end] ?? '')) end++;
      const value = src.slice(i, end);
      tokens.push({ kind: 'ident', value });
      canRegex = REGEX_BEFORE_KEYWORDS.has(value);
      i = end;
      continue;
    }
    if (ch === '?' && next === '.') {
      tokens.push({ kind: 'punct', value: '?.' });
      canRegex = true;
      i += 2;
      continue;
    }
    if (ch === '{') braceDepth++;
    else if (ch === '}' && braceDepth > 0) braceDepth--;
    tokens.push({ kind: 'punct', value: ch });
    canRegex = REGEX_BEFORE_PUNCTS.has(ch);
    i++;
  }
  return tokens;
}

function readTemplatePart(
  src: string,
  start: number,
  braceDepth: number,
  tplBraces: number[],
  tokens: Token[],
  isTail: boolean
): { next: number; canRegex: boolean } {
  let i = start;
  let value = '';
  while (i < src.length) {
    const ch = src[i] ?? '';
    if (ch === '\\') {
      value += src.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === '$' && src[i + 1] === '{') {
      tplBraces.push(braceDepth);
      tokens.push({ kind: 'punct', value: 'tpl_head' });
      return { next: i + 2, canRegex: true };
    }
    if (ch === '`') {
      tokens.push(isTail ? { kind: 'punct', value: 'tpl_tail' } : { kind: 'string', value });
      return { next: i + 1, canRegex: false };
    }
    value += ch;
    i++;
  }
  tokens.push({ kind: 'punct', value: 'tpl_eof' });
  return { next: i, canRegex: false };
}

function scanFromStatement(tokens: Token[], startIdx: number): string | undefined {
  let braceDepth = 0;
  for (let i = startIdx; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === undefined) break;
    if (tok.kind === 'punct') {
      if (tok.value === '{') braceDepth++;
      else if (tok.value === '}') {
        if (braceDepth === 0) break;
        braceDepth--;
      } else if (tok.value === ';' || tok.value === '=' || (braceDepth === 0 && tok.value === ':')) {
        break;
      }
      continue;
    }
    if (braceDepth === 0 && tok.kind === 'ident' && tok.value === 'from') {
      const nextTok = tokens[i + 1];
      if (nextTok !== undefined && nextTok.kind === 'string') return nextTok.value;
    }
  }
  return undefined;
}

/**
 * Extract ESM static `import`/`export ... from` and static-literal dynamic `import(...)` specifiers.
 */
export function collectModuleSpecifiers(source: string): string[] {
  const tokens = tokenizeSource(source);
  const specifiers: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === undefined || tok.kind !== 'ident') continue;

    const prev = i > 0 ? tokens[i - 1] : undefined;
    if (prev !== undefined && prev.kind === 'punct' && (prev.value === '.' || prev.value === '?.')) {
      continue;
    }

    if (tok.value === 'import') {
      const next = tokens[i + 1];
      if (next === undefined) break;
      if (next.kind === 'string') {
        specifiers.push(next.value);
        continue;
      }
      if (next.kind === 'punct' && next.value === '(') {
        const arg = tokens[i + 2];
        const afterArg = tokens[i + 3];
        if (
          arg !== undefined &&
          arg.kind === 'string' &&
          afterArg !== undefined &&
          afterArg.kind === 'punct' &&
          (afterArg.value === ')' || afterArg.value === ',')
        ) {
          specifiers.push(arg.value);
        }
        continue;
      }
      if (next.kind === 'punct' && next.value === '.') continue;
      const spec = scanFromStatement(tokens, i + 1);
      if (spec !== undefined) specifiers.push(spec);
      continue;
    }

    if (tok.value === 'export') {
      let j = i + 1;
      const t1 = tokens[j];
      if (t1 !== undefined && t1.kind === 'ident' && t1.value === 'type') j++;
      const t2 = tokens[j];
      if (t2 !== undefined && t2.kind === 'punct' && (t2.value === '*' || t2.value === '{')) {
        const spec = scanFromStatement(tokens, j);
        if (spec !== undefined) specifiers.push(spec);
      }
    }
  }

  return specifiers;
}

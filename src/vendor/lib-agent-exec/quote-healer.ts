// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { convertToWindowsPath } from './path-convert.js';

const SQL_SELECT_KEYWORDS = new Set([
  'SELECT', 'DISTINCT', 'ALL', 'AS', 'FROM', 'INTO', 'CASE', 'WHEN',
  'THEN', 'ELSE', 'END', 'CAST', 'NOT', 'NULL', 'AND', 'OR', 'IS', 'IN',
]);

type FragmentKind = 'pure-slash' | 'multi-quote' | 'escaped-paren' | 'slash-paren' | 'leading-slash' | 'internal-slash' | 'internal-close';

interface FragmentBody {
  matchedType: FragmentKind;
  internalWord: string;
  internalRest: string;
}

interface FragmentMatch extends FragmentBody {
  endIdx: number;
}

type QuoteKind = 'escaped-double' | 'plain-double' | 'single';

function endsWithUnescapedBackslash(s: string): boolean {
  if (!s.endsWith('\\')) return false;
  let count = 0;
  for (let j = s.length - 1; j >= 0 && s[j] === '\\'; j--) {
    count++;
  }
  return count % 2 === 1;
}

function startsWithUnescapedBackslash(s: string): boolean {
  if (!s.startsWith('\\') || s.startsWith('\\\\')) return false;
  const withoutLeading = s.slice(1);
  // Ignore root-relative Windows directory paths like \Windows\System32 or \Users\
  if (/^[a-zA-Z0-9_-]+[\\/]/.test(withoutLeading)) {
    return false;
  }
  return true;
}

function strippedPathSeparators(s: string): string {
  const withoutTrailing = (s.endsWith('\\') || s.endsWith('/')) ? s.slice(0, -1) : s;
  return withoutTrailing.replace(
    /\\([.*+?^${}()|[\]\\"'`~<>:;!@#%&=,\-_/]|w|W|d|D|s|S|b|B|[0-9])/g,
    ''
  );
}

function isPathWithTrailingSlash(s: string, cwd?: string): boolean {
  if (/[|<>"`']/.test(s) || s.includes('===') || s.includes('!==')) {
    return false;
  }
  if (/^[a-zA-Z]:\\/i.test(s) || /^\.\.?\\/.test(s) || /^\\\\/.test(s)) {
    return true;
  }
  const withoutTrailing = (s.endsWith('\\') || s.endsWith('/')) ? s.slice(0, -1) : s;
  if (withoutTrailing.includes('/') || withoutTrailing.includes('\\')) {
    const strippedEscapes = strippedPathSeparators(s);
    if (strippedEscapes.includes('\\') || strippedEscapes.includes('/')) {
      return true;
    }
  }
  if ((s.endsWith('\\') || s.endsWith('/')) && withoutTrailing.length > 0 && !s.startsWith('-')) {
    const isNonHostPosixCwd = process.platform === 'win32' && cwd !== undefined
      && ((cwd.startsWith('/') && !/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(cwd)) || cwd.startsWith('~'));
    if (isNonHostPosixCwd) return false;
    const baseCwd = cwd !== undefined && cwd.length > 0
      ? (/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(cwd) ? convertToWindowsPath(cwd) : cwd)
      : process.cwd();
    try {
      const candidate = path.resolve(baseCwd, withoutTrailing);
      return fs.statSync(candidate, { throwIfNoEntry: false })?.isDirectory() === true;
    } catch {
      // Ignore missing/inaccessible candidate paths
    }
  }
  return false;
}

function isPureWordWithTrailingSlash(s: string, cwd?: string): boolean {
  if (!endsWithUnescapedBackslash(s) || s.startsWith('-') || s.includes('/')) {
    return false;
  }
  if (isPathWithTrailingSlash(s, cwd)) {
    return false;
  }
  // Avoid treating Windows paths (e.g. C:\..., .\..., ..\..., or paths with directory separators) as fragmented words
  if (/^[a-zA-Z]:\\/i.test(s) || /^\.\.?\\/.test(s) || /^\\\\/.test(s)) {
    return false;
  }
  // Strip common escape sequences used in regex or quoted patterns (e.g. \., \*, \+, \?, \(, \), \[, \], \w, \d, \s, etc.)
  return !strippedPathSeparators(s).includes('\\');
}

function countUnescapedQuotes(s: string, target: '"' | "'"): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (target === '"' && s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === target) count++;
  }
  return count;
}

function countEscapedDoubleQuotes(s: string): number {
  let count = 0;
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i] === '\\' && s[i + 1] === '"') {
      count++;
      i++;
    } else if (s[i] === '\\') {
      i++;
    }
  }
  return count;
}

function quoteKind(current: string): QuoteKind | null {
  if (current.length > 2 && current.startsWith('\\"') && countEscapedDoubleQuotes(current) % 2 === 1) {
    return 'escaped-double';
  }
  if (current.length > 1 && current.startsWith('"') && countUnescapedQuotes(current, '"') % 2 === 1) {
    return 'plain-double';
  }
  if (current.length > 1 && current.startsWith("'") && countUnescapedQuotes(current, "'") % 2 === 1) {
    return 'single';
  }
  return null;
}

function quoteCloses(kind: QuoteKind, next: string): boolean {
  if (kind === 'escaped-double') {
    return (next.endsWith('\\"') && countEscapedDoubleQuotes(next) % 2 === 1)
      || (next.endsWith('"') && !next.endsWith('\\"') && countUnescapedQuotes(next, '"') % 2 === 1);
  }
  if (kind === 'plain-double') {
    return (next.endsWith('"') && countUnescapedQuotes(next, '"') % 2 === 1)
      || (next.endsWith('\\"') && countEscapedDoubleQuotes(next) % 2 === 1);
  }
  return next.endsWith("'") && countUnescapedQuotes(next, "'") % 2 === 1;
}

function findClosingQuoteIndex(args: readonly string[], start: number, kind: QuoteKind): number {
  for (let j = start + 1; j < args.length; j++) {
    const next = args[j];
    if (next === undefined) break;
    if (quoteCloses(kind, next)) return j;
  }
  return -1;
}

function normalizeJoinedQuotes(joined: string): string {
  if (joined.startsWith('\\"') && joined.endsWith('\\"')) {
    return `"${joined.slice(2, -2)}"`;
  }
  if (joined.startsWith('\\"') && joined.endsWith('"')) {
    return `"${joined.slice(2, -1)}"`;
  }
  if (joined.startsWith('"') && joined.endsWith('\\"')) {
    return `"${joined.slice(1, -2)}"`;
  }
  return joined;
}

function mergeSplitQuotes(currentArgs: string[]): void {
  let quoteIdx = 0;
  while (quoteIdx < currentArgs.length) {
    const current = currentArgs[quoteIdx];
    const kind = current === undefined ? null : quoteKind(current);
    if (kind !== null) {
      const matchingIdx = findClosingQuoteIndex(currentArgs, quoteIdx, kind);
      if (matchingIdx !== -1) {
        const joined = normalizeJoinedQuotes(currentArgs.slice(quoteIdx, matchingIdx + 1).join(' '));
        currentArgs.splice(quoteIdx, matchingIdx - quoteIdx + 1, joined);
        quoteIdx++;
        continue;
      }
    }
    quoteIdx++;
  }
}

function captureInnerSplit(next: string, matchedType: FragmentKind, pattern: RegExp): FragmentBody | null {
  const matched = next.match(pattern);
  if (matched === null || matched[1] === undefined || matched[2] === undefined) return null;
  return { matchedType, internalWord: matched[1], internalRest: matched[2] };
}

function matchNextFragment(next: string, cwd?: string): FragmentBody | null {
  if (isPureWordWithTrailingSlash(next, cwd)) {
    return { matchedType: 'pure-slash', internalWord: '', internalRest: '' };
  }
  if (endsWithUnescapedBackslash(next) && !isPathWithTrailingSlash(next, cwd) && /^([^\\]+)\\(.+)$/.test(next)) {
    return captureInnerSplit(next, 'multi-quote', /^([^\\]+)\\(.+)$/);
  }
  if (!isPathWithTrailingSlash(next, cwd) && /^([^\\]+)\\(\).*|[:;,\]].*)$/.test(next)) {
    return captureInnerSplit(next, 'internal-close', /^([^\\]+)\\(\).*|[:;,\]].*)$/);
  }
  if (next.endsWith('\\)') && endsWithUnescapedBackslash(next.slice(0, -1))) {
    return { matchedType: 'escaped-paren', internalWord: '', internalRest: '' };
  }
  if (next.endsWith('/)')) {
    return { matchedType: 'slash-paren', internalWord: '', internalRest: '' };
  }
  if (startsWithUnescapedBackslash(next)) {
    return { matchedType: 'leading-slash', internalWord: '', internalRest: '' };
  }
  if (next.includes('\\ ')) {
    const slashSpaceIdx = next.indexOf('\\ ');
    return {
      matchedType: 'internal-slash',
      internalWord: next.slice(0, slashSpaceIdx),
      internalRest: next.slice(slashSpaceIdx + 1),
    };
  }
  return null;
}

const HYPHEN_INTERNAL_CLOSE_RE = /^(-[a-zA-Z0-9_-]+)\\([|):;,\]].*)$/;

function matchHyphenClosingFragment(next: string): FragmentBody | null {
  if (endsWithUnescapedBackslash(next) && !next.includes('/') && !strippedPathSeparators(next).includes('\\')) {
    return { matchedType: 'pure-slash', internalWord: '', internalRest: '' };
  }
  return captureInnerSplit(next, 'internal-close', HYPHEN_INTERNAL_CLOSE_RE);
}

function findFragmentEnd(currentArgs: readonly string[], start: number, cwd?: string): FragmentMatch | null {
  for (let j = start + 1; j < currentArgs.length; j++) {
    const next = currentArgs[j];
    if (next === undefined) break;
    if (next.startsWith('-')) {
      if (j === start + 1) {
        const hyphenMatch = matchHyphenClosingFragment(next);
        if (hyphenMatch !== null) return { endIdx: j, ...hyphenMatch };
      }
      break;
    }
    const matched = matchNextFragment(next, cwd);
    if (matched !== null) return { endIdx: j, ...matched };
  }
  return null;
}

function isPlainSqlIdentifier(part: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(part) && !SQL_SELECT_KEYWORDS.has(part.toUpperCase());
}

function healSpacedSelectList(tok: string): string | null {
  const parts = tok.trim().split(/\s+/);
  if (parts.length < 2 || !parts.every(isPlainSqlIdentifier)) return null;
  return parts.join(', ');
}

function isSqlLikePattern(prevUpper: string, tok: string): boolean {
  const likeOrGlob = prevUpper === 'LIKE' || prevUpper === 'GLOB';
  const unquoted = !tok.startsWith("'") && !tok.startsWith('"') && tok !== '?';
  const unbound = !tok.startsWith(':') && !tok.startsWith('$') && !tok.startsWith('@');
  const wildcard = tok.includes('%') || (prevUpper === 'GLOB' && tok.includes('*'));
  return likeOrGlob && unquoted && unbound && wildcard;
}

function healSqlToken(tokens: readonly string[], tok: string, idx: number, fromIdx: number): string {
  if (fromIdx > 1 && idx > 0 && idx < fromIdx && /\s/.test(tok)) {
    const healed = healSpacedSelectList(tok);
    if (healed !== null) return healed;
  }
  const prevUpper = idx > 0 ? (tokens[idx - 1]?.trim().toUpperCase() ?? '') : '';
  if (isSqlLikePattern(prevUpper, tok)) return `'${tok}'`;
  return tok;
}

// [INTENT]: Restore commas collapsed by PowerShell's array operator ('name, type' -> 'name type') and single quotes stripped around SQL LIKE patterns ('%audit%' -> '%audit%').
function healSqlTokenList(tokens: readonly string[]): string[] {
  const firstTok = tokens[0]?.trim().toUpperCase() ?? '';
  if (!/^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|PRAGMA|WITH|EXPLAIN)$/.test(firstTok)) {
    return [...tokens];
  }
  const fromIdx = firstTok === 'SELECT'
    ? tokens.findIndex((token, idx) => idx > 0 && token.trim().toUpperCase() === 'FROM')
    : -1;
  return tokens.map((tok, idx) => healSqlToken(tokens, tok, idx, fromIdx));
}

function healTrailingEmptyQuoteRemnants(s: string): string {
  return s.replace(/(?<=[:=\s*])\\\\(?=$|[|\s),;])/g, '""');
}

function reassembleKnownFragment(first: string, rawMiddle: string[], lastArg: string, match: FragmentMatch): string | null {
  if (match.matchedType === 'pure-slash') {
    const healedTokens = healSqlTokenList([...rawMiddle, lastArg.slice(0, -1)]);
    return `${first}"${healedTokens.join(' ')}"`;
  }
  if (match.matchedType === 'multi-quote' || match.matchedType === 'internal-slash' || match.matchedType === 'internal-close') {
    const healedRest = healTrailingEmptyQuoteRemnants(
      match.internalRest.replace(/\\([a-zA-Z0-9_.:/*?+-]+)\\/g, '"$1"')
    );
    const healedTokens = healSqlTokenList([...rawMiddle, match.internalWord]);
    return `${first}"${healedTokens.join(' ')}"${healedRest}`;
  }
  if (match.matchedType === 'escaped-paren') {
    const healedTokens = healSqlTokenList([...rawMiddle, lastArg.slice(0, -2)]);
    return `${first}"${healedTokens.join(' ')}")`;
  }
  if (match.matchedType === 'slash-paren') {
    const healedTokens = healSqlTokenList([...rawMiddle, lastArg.slice(0, -2)]);
    return `${first}"${healedTokens.join(' ')}/)`;
  }
  if (match.matchedType === 'leading-slash') {
    const last = healTrailingEmptyQuoteRemnants(lastArg.slice(1));
    const healedTokens = healSqlTokenList(rawMiddle);
    return `${first}"${healedTokens.join(' ')}"${last}`;
  }
  return null;
}

function reassembleFragment(first: string, rawMiddle: string[], lastArg: string, match: FragmentMatch): string {
  const known = reassembleKnownFragment(first, rawMiddle, lastArg, match);
  if (known !== null) return known;
  return `${first}"${[...rawMiddle, lastArg].join(' ')}"`;
}

function isFragmentStart(current: string | undefined, cwd?: string): current is string {
  return current !== undefined
    && !current.startsWith('-')
    && !/^[A-Za-z0-9_.-]+(?:\\[A-Za-z0-9_.-]+)*\\$/.test(current)
    && endsWithUnescapedBackslash(current)
    && !isPathWithTrailingSlash(current, cwd);
}

function healBackslashFragments(currentArgs: string[], cwd?: string): void {
  let i = 0;
  while (i < currentArgs.length) {
    const current = currentArgs[i];
    if (!isFragmentStart(current, cwd)) {
      i++;
      continue;
    }
    const match = findFragmentEnd(currentArgs, i, cwd);
    const lastArg = match === null ? undefined : currentArgs[match.endIdx];
    if (match === null || lastArg === undefined) {
      i++;
      continue;
    }
    const reassembled = reassembleFragment(
      current.slice(0, -1),
      currentArgs.slice(i + 1, match.endIdx),
      lastArg,
      match,
    );
    currentArgs.splice(i, match.endIdx - i + 1, reassembled);
    // If reassembled still ends with an unescaped backslash (e.g. chained quotes), do not advance i
    if (endsWithUnescapedBackslash(reassembled) && !isPathWithTrailingSlash(reassembled, cwd)) {
      continue;
    }
    i++;
  }
}

export function healFragmentedQuotes(args: string[], cwd?: string): string[] {
  const currentArgs = [...args];
  mergeSplitQuotes(currentArgs);
  healBackslashFragments(currentArgs, cwd);
  return currentArgs;
}

// @ts-nocheck
const RUST_BRACE_ESCAPE_BASE = new Set(['p', 'P', 'u', 'x', 'k']);
const RUST_BRACE_ESCAPE_PCRE2 = new Set(['p', 'P', 'u', 'x', 'k', 'g', 'N', 'o']);
const NON_ATOM_PREV_CHARS = new Set(['(', '|', '^', '*', '+', '?', '{']);
const QUANTIFIER_STICKY_RE = /\{\d+(?:,\d*)?\}/y;

function isRustBraceEscapePrefix(pattern: string, braceIdx: number, pcre2 = false): boolean {
  if (braceIdx < 2) return false;
  const letter = pattern[braceIdx - 1];
  if (letter === undefined) return false;
  const validLetters = pcre2 ? RUST_BRACE_ESCAPE_PCRE2 : RUST_BRACE_ESCAPE_BASE;
  if (!validLetters.has(letter)) return false;
  let slashCount = 0;
  for (let idx = braceIdx - 2; idx >= 0 && pattern[idx] === '\\'; idx--) slashCount++;
  return slashCount % 2 === 1;
}

function escapeUnescapedLiteralBraces(pattern: string, pcre2 = false): string {
  let out = '';
  let escaped = false;
  let inCharClass = false;
  let inLiteralSpan = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === undefined) continue;
    if (pcre2 && inLiteralSpan) {
      if (ch === '\\' && pattern[i + 1] === 'E') {
        out += '\\E';
        inLiteralSpan = false;
        i++;
        continue;
      }
      out += ch;
      continue;
    }
    if (escaped) {
      if (pcre2 && ch === 'Q' && !inCharClass) inLiteralSpan = true;
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '[' && !inCharClass) {
      inCharClass = true;
      out += ch;
      continue;
    }
    if (ch === ']' && inCharClass) {
      inCharClass = false;
      out += ch;
      continue;
    }
    if (ch === '{' && !inCharClass) {
      QUANTIFIER_STICKY_RE.lastIndex = i;
      const isQuantifierSyntax = QUANTIFIER_STICKY_RE.test(pattern);
      const prevChar = i > 0 ? pattern[i - 1] : undefined;
      let backslashes = 0;
      for (let b = i - 2; b >= 0 && pattern[b] === '\\'; b--) backslashes++;
      const prevIsNonAtom =
        prevChar === undefined ||
        (NON_ATOM_PREV_CHARS.has(prevChar) && backslashes % 2 === 0);
      if (!isRustBraceEscapePrefix(pattern, i, pcre2) && (!isQuantifierSyntax || prevIsNonAtom)) {
        out += '\\{';
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function collectUnclosedRegexIndices(pattern: string): Set<number> {
  const parenStack: number[] = [];
  const bracketStack: number[] = [];
  let isEscaped = false;

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (ch === '\\') {
      isEscaped = true;
      continue;
    }
    if (ch === '(' && bracketStack.length === 0) {
      parenStack.push(i);
      continue;
    }
    if (ch === ')' && bracketStack.length === 0) {
      if (parenStack.length > 0) parenStack.pop();
      continue;
    }
    if (ch === '[') {
      bracketStack.push(i);
      continue;
    }
    if (ch === ']') {
      if (bracketStack.length > 0) bracketStack.pop();
    }
  }

  const unclosedIndices = new Set([...parenStack, ...bracketStack]);
  if (isEscaped) unclosedIndices.add(pattern.length - 1);
  return unclosedIndices;
}

function escapeIndices(pattern: string, unclosedIndices: Set<number>): string {
  let result = '';
  for (let i = 0; i < pattern.length; i++) {
    if (unclosedIndices.has(i)) {
      result += '\\' + pattern[i];
    } else {
      result += pattern[i];
    }
  }
  return result;
}

export interface RegexSanitizeOptions {
  pcre2?: boolean;
}

function toJsRegexValidationCopy(pattern: string, pcre2 = false): string {
  // Normalize Rust/PCRE2 inline flag modifiers ((?i), (?-i), (?i:...), (?P<name>...), (?P=name)) before JS RegExp check.
  let normalized = pattern
    .replace(/\(\?P<([a-zA-Z_][a-zA-Z0-9_]*)>/g, '(?<$1>')
    .replace(/\(\?P=([a-zA-Z_][a-zA-Z0-9_]*)\)/g, '\\k<$1>')
    .replace(/\(\?[imsxUu-]+:/g, '(?:')
    .replace(/\(\?[imsxUu-]+\)/g, '');
  if (pcre2) {
    normalized = normalized
      .replace(/(?<!\\)((?:\\\\)*)\\Q[\s\S]*?(?:\\E|$)/g, '$1q')
      .replace(/\(\?[imsxUuJn-]+:/g, '(?:')
      .replace(/\(\?[imsxUuJn-]+\)/g, '')
      .replace(/\(\?\|/g, '(?:')
      .replace(/\(\?#[^)]*\)/g, '')
      .replace(/\(\*(?:FAIL|F|ACCEPT|UTF|UCP|CRLF|CR|LF|ANYCRLF|ANY|BSR_ANYCRLF|BSR_UNICODE|NO_AUTO_POSSESS|NO_START_OPT|(?:COMMIT|PRUNE|SKIP|THEN|MARK)(?::[^)]+)?|(?:LIMIT_MATCH|LIMIT_DEPTH|LIMIT_RECURSION)=\d+)\)/g, '')
      .replace(/\(\?\([^)]+\)/g, '(?:')
      .replace(/\(\?(?:R|[+-]?\d+|&[a-zA-Z_][a-zA-Z0-9_]*)\)/g, 'x')
      .replace(/\(\?>/g, '(?:')
      .replace(/([*+?]|\{\d+(?:,\d*)?\})\+/g, '$1')
      .replace(/(?<!\\)((?:\\\\)*)\\(?:K|h|H|Z|G|R|X|C|e|V|N|o|c[\x20-\x7e]|g\{[^}]+\}|g-?\d+)/g, '$1x');
  }
  return normalized;
}

function isValidRegexPattern(pattern: string, pcre2 = false): boolean {
  try {
    new RegExp(toJsRegexValidationCopy(pattern, pcre2));
    return true;
  } catch {
    return false;
  }
}

export function healRegexPattern(pattern: string, options?: RegexSanitizeOptions): string {
  const pcre2 = options?.pcre2 === true;
  if (isValidRegexPattern(pattern, pcre2)) {
    return escapeUnescapedLiteralBraces(pattern, pcre2);
  }
  const unclosedIndices = collectUnclosedRegexIndices(pattern);
  if (unclosedIndices.size > 0) {
    const result = escapeIndices(pattern, unclosedIndices);
    if (isValidRegexPattern(result, pcre2)) {
      return escapeUnescapedLiteralBraces(result, pcre2);
    }
  }
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hasBalancedWrappingQuotes(value: string, quoteChar: '"' | "'"): boolean {
  if (value.length < 2 || !value.startsWith(quoteChar) || !value.endsWith(quoteChar)) return false;
  const inner = value.slice(1, -1);
  let escaped = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === quoteChar) return false;
  }
  return !escaped;
}

function stripWrappingQuotes(regexArg: string): string {
  if (hasBalancedWrappingQuotes(regexArg, '"')) {
    return regexArg.slice(1, -1);
  }
  if (hasBalancedWrappingQuotes(regexArg, "'")) {
    return regexArg.slice(1, -1);
  }
  return regexArg;
}

const PCRE2_EXTRA_ESCAPES = new Set([
  'K', 'h', 'H', 'Z', 'G', 'Q', 'E', 'R', 'X', 'g', 'o', 'c', 'N', 'C', 'e', 'V',
]);
const VALID_RUST_ESCAPES = new Set([
  'a', 'f', 't', 'n', 'r', 'v',
  'd', 'D', 's', 'S', 'w', 'W',
  'b', 'B', 'A', 'z',
  'p', 'P', 'x', 'u', 'U', 'k',
]);

function healRustLetterEscapes(sanitized: string, pcre2 = false): string {
  // In Rust's regex engine (ripgrep), backslashes before unrecognized ASCII letters
  // (e.g. \R in \README.md or Windows path separators) cause syntax parse errors.
  let healedEscapes = '';
  let inLiteralSpan = false;
  for (let i = 0; i < sanitized.length; i++) {
    const ch = sanitized[i];
    if (pcre2 && inLiteralSpan) {
      if (ch === '\\' && sanitized[i + 1] === 'E') {
        healedEscapes += '\\E';
        inLiteralSpan = false;
        i++;
        continue;
      }
      healedEscapes += ch;
      continue;
    }
    if (ch === '\\') {
      const next = sanitized[i + 1];
      if (next === '\\') {
        healedEscapes += '\\\\';
        i++;
        continue;
      }
      if (pcre2 && next === 'Q') {
        healedEscapes += '\\Q';
        inLiteralSpan = true;
        i++;
        continue;
      }
      const allowed = VALID_RUST_ESCAPES.has(next ?? '') || (pcre2 && PCRE2_EXTRA_ESCAPES.has(next ?? ''));
      if (next !== undefined && /[a-zA-Z]/.test(next) && !allowed) {
        healedEscapes += '\\\\';
        continue;
      }
    }
    healedEscapes += ch;
  }
  return healedEscapes;
}

export function sanitizeWslRegex(regexArg: string, options?: RegexSanitizeOptions): string {
  const pcre2 = options?.pcre2 === true;
  return healRegexPattern(healRustLetterEscapes(stripWrappingQuotes(regexArg), pcre2), { pcre2 });
}

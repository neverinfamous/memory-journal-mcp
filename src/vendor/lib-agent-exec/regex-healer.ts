// @ts-nocheck
function escapeUnescapedLiteralBraces(pattern: string): string {
  let out = '';
  let escaped = false;
  let inCharClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === undefined) continue;
    if (escaped) {
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
      const rest = pattern.slice(i);
      const isQuantifierSyntax = /^\{\d+(?:,\d*)?\}/.test(rest);
      const prevChar = i > 0 ? pattern[i - 1] : undefined;
      const prevIsNonAtom =
        prevChar === undefined ||
        (['(', '|', '^', '*', '+', '?', '{'].includes(prevChar) && (i < 2 || pattern[i - 2] !== '\\'));
      if (!isQuantifierSyntax || prevIsNonAtom) {
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
    if (ch === '(') {
      parenStack.push(i);
      continue;
    }
    if (ch === ')') {
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

export function healRegexPattern(pattern: string): string {
  try {
    new RegExp(pattern);
    return escapeUnescapedLiteralBraces(pattern);
  } catch {
    const unclosedIndices = collectUnclosedRegexIndices(pattern);
    if (unclosedIndices.size > 0) {
      const result = escapeIndices(pattern, unclosedIndices);
      try {
        new RegExp(result);
        return escapeUnescapedLiteralBraces(result);
      } catch {
        // Fallback below
      }
    }
    return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
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

function healRustLetterEscapes(sanitized: string): string {
  // In Rust's regex engine (ripgrep), backslashes before unrecognized ASCII letters
  // (e.g. \R in \README.md or Windows path separators) cause syntax parse errors.
  // Valid Rust letter escapes: a, f, t, n, r, v, d, D, s, S, w, W, b, B, A, z, p, P, x, u, U, k
  const validRustEscapes = new Set([
    'a', 'f', 't', 'n', 'r', 'v',
    'd', 'D', 's', 'S', 'w', 'W',
    'b', 'B', 'A', 'z',
    'p', 'P', 'x', 'u', 'U', 'k'
  ]);

  let healedEscapes = '';
  for (let i = 0; i < sanitized.length; i++) {
    const ch = sanitized[i];
    if (ch === '\\') {
      const next = sanitized[i + 1];
      if (next === '\\') {
        healedEscapes += '\\\\';
        i++;
        continue;
      }
      if (next !== undefined && /[a-zA-Z]/.test(next) && !validRustEscapes.has(next)) {
        healedEscapes += '\\\\';
        continue;
      }
    }
    healedEscapes += ch;
  }
  return healedEscapes;
}

export function sanitizeWslRegex(regexArg: string): string {
  return healRegexPattern(healRustLetterEscapes(stripWrappingQuotes(regexArg)));
}

// @ts-nocheck
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { match, P } from 'ts-pattern';

export const AGENT_EXEC_README_URL = pathToFileURL(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'AGENT_README.md')
).href;

/**
 * Safely strips quoted parts using a ts-pattern state machine
 */
export const getUnquoted = (str: string): string => {
  type ParseState = { inSingle: boolean; inDouble: boolean; unquoted: string; isEscaped: boolean };
  const initialState: ParseState = { inSingle: false, inDouble: false, unquoted: '', isEscaped: false };
  return str.split('').reduce((state: ParseState, char: string) => {
      return match([state, char] as const)
          .with([{ isEscaped: true, inSingle: false, inDouble: false }, P.string], ([s, c]) => ({ ...s, isEscaped: false, unquoted: s.unquoted + c }))
          .with([{ isEscaped: true }, P.string], ([s]) => ({ ...s, isEscaped: false }))
          .with([{ inSingle: false, inDouble: false }, '\\'], ([s, c]) => ({ ...s, isEscaped: true, unquoted: s.unquoted + c }))
          .with([{ inDouble: true }, '\\'], ([s]) => ({ ...s, isEscaped: true }))
          .with([{ inDouble: false }, "'"], ([s]) => ({ ...s, inSingle: !s.inSingle }))
          .with([{ inSingle: false }, '"'], ([s]) => ({ ...s, inDouble: !s.inDouble }))
          .with([{ inSingle: false, inDouble: false }, P.string], ([s, c]) => ({ ...s, unquoted: s.unquoted + c }))
          .with([{ inSingle: true }, P.string], ([s]) => s)
          .with([{ inDouble: true }, P.string], ([s]) => s)
          .exhaustive();
  }, initialState).unquoted;
};

// [INTENT]: Splits a shell snippet at the first unquoted pipeline, chain, or newline operator so single-command heuristics do not bleed across piped stages.
export function splitFirstShellSegment(code: string): { firstSegment: string; remainder: string } {
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;

  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '\\' && !inSingle) {
      i++;
      continue;
    }
    if (ch === "'" && !inDouble && !inBacktick) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle && !inBacktick) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === '`' && !inSingle && !inDouble) {
      inBacktick = !inBacktick;
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick) {
      if (ch === '|' || ch === ';' || ch === '\n') {
        return { firstSegment: code.slice(0, i), remainder: code.slice(i) };
      }
      if (ch === '&') {
        const prev = code[i - 1];
        const next = code[i + 1];
        if (next === '&' || (prev !== '>' && next !== '>')) {
          return { firstSegment: code.slice(0, i), remainder: code.slice(i) };
        }
      }
    }
  }

  return { firstSegment: code, remainder: '' };
}

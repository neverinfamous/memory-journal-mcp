// @ts-nocheck
import { match, P } from 'ts-pattern';

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

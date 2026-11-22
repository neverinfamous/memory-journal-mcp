// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { tokenizeArgs } from '../command-utils.js';
import { hasBackslashRegexEscape, hasUriOrNonDriveColon, isSecondExistingTargetOnly } from './search-path-utils.js';

export interface ParsedGrepSearchArgs {
  pattern: string;
  searchPath: string;
  isCaseInsensitive: boolean;
  isWord: boolean;
  isRegex: boolean;
}

const GREP_PATTERN_VALUE_FLAGS = [
  '-s', '--symbol', '--pattern', '-q', '--query', '--searchpattern', '--search-pattern',
  '--targetcontent', '--target-content', '--content',
];
const GREP_DIR_VALUE_FLAGS = ['-d', '--dir', '--directory', '--path', '--searchpath', '--search-path'];
const GREP_DIR_FLAGS_FOR_P = ['-d', '--dir', '--directory', '--searchpath', '--search-path'];
const GREP_PATTERN_FLAGS_FOR_P = ['-s', '--symbol', '--pattern', '-q', '--query', '--targetcontent', '--target-content'];

interface GrepScanState {
  isCaseInsensitive: boolean;
  isWord: boolean;
  isRegex: boolean;
  pattern: string;
  searchPath: string;
  nonFlagArgs: string[];
}

function createGrepScanState(): GrepScanState {
  return {
    isCaseInsensitive: false,
    isWord: false,
    isRegex: false,
    pattern: '',
    searchPath: '',
    nonFlagArgs: [],
  };
}

function normalizeBundledGrepParserArgs(args: string[]): string[] {
  const normalizedArgs: string[] = [];
  for (const arg of args) {
    if (arg.startsWith('-') && arg.includes(' ')) {
      const tokens = tokenizeArgs(arg);
      if (tokens.length > 1 && tokens[0] !== undefined && tokens[0].startsWith('-')) {
        normalizedArgs.push(...tokens);
        continue;
      }
    }
    normalizedArgs.push(arg);
  }
  return normalizedArgs;
}

function isCaseInsensitiveFlag(arg: string, lower: string): boolean {
  if (lower === '-i' || lower === '-ri' || lower === '-ir' || lower === '--case-insensitive') return true;
  return arg.length <= 5 && /^-[a-zA-Z]+$/.test(arg) && !arg.startsWith('--') && arg.includes('i');
}

function consumeRegexFlag(state: GrepScanState, args: string[], index: number, lower: string): number {
  state.isRegex = true;
  const nextArg = args[index + 1];
  if (lower !== '--is-regex' && nextArg !== undefined && !nextArg.startsWith('-')) {
    state.pattern = nextArg;
    return index + 1;
  }
  return index;
}

function consumeValueInto(state: GrepScanState, args: string[], index: number, field: 'pattern' | 'searchPath'): number {
  const nextArg = args[index + 1];
  if (nextArg !== undefined) {
    state[field] = nextArg;
    return index + 1;
  }
  return index;
}

function assignAmbiguousPValue(state: GrepScanState, args: string[], value: string): void {
  const hasDirFlag = args.some((arg) => {
    const eq = arg.indexOf('=');
    const key = (eq === -1 ? arg : arg.slice(0, eq)).toLowerCase();
    return GREP_DIR_FLAGS_FOR_P.includes(key);
  });
  if (hasDirFlag || state.searchPath.length > 0) {
    state.pattern = value;
    return;
  }
  const hasPatternFlag = args.some((arg) => {
    const eq = arg.indexOf('=');
    const key = (eq === -1 ? arg : arg.slice(0, eq)).toLowerCase();
    return GREP_PATTERN_FLAGS_FOR_P.includes(key);
  });
  if (hasPatternFlag || state.pattern.length > 0) {
    state.searchPath = value;
    return;
  }
  state.pattern = value;
}

function consumeAmbiguousP(state: GrepScanState, args: string[], index: number): number {
  const nextArg = args[index + 1];
  if (nextArg === undefined) return index;
  assignAmbiguousPValue(state, args, nextArg);
  return index + 1;
}

function applyGrepSearchFlag(state: GrepScanState, args: string[], index: number, arg: string): number {
  const eqIdx = arg.indexOf('=');
  if (eqIdx > 0 && arg.startsWith('-')) {
    const flagKey = arg.slice(0, eqIdx).toLowerCase();
    const flagVal = arg.slice(eqIdx + 1);
    if (flagKey === '-e' || flagKey === '--regexp') {
      state.isRegex = true;
      state.pattern = flagVal;
      return index;
    }
    if (GREP_PATTERN_VALUE_FLAGS.includes(flagKey)) {
      state.pattern = flagVal;
      return index;
    }
    if (GREP_DIR_VALUE_FLAGS.includes(flagKey)) {
      state.searchPath = flagVal;
      return index;
    }
  }
  const lower = arg.toLowerCase();
  if (isCaseInsensitiveFlag(arg, lower)) {
    state.isCaseInsensitive = true;
    return index;
  }
  if (lower === '-w' || lower === '--word-regexp') {
    state.isWord = true;
    return index;
  }
  if (lower === '-e' || lower === '--regexp' || lower === '--is-regex') {
    return consumeRegexFlag(state, args, index, lower);
  }
  if (GREP_PATTERN_VALUE_FLAGS.includes(lower)) return consumeValueInto(state, args, index, 'pattern');
  if (GREP_DIR_VALUE_FLAGS.includes(lower)) return consumeValueInto(state, args, index, 'searchPath');
  if (lower === '-p') return consumeAmbiguousP(state, args, index);
  if (!arg.startsWith('-')) state.nonFlagArgs.push(arg);
  return index;
}

function applyPositionalGrepArgs(state: GrepScanState): void {
  const first = state.nonFlagArgs[0];
  const second = state.nonFlagArgs[1];
  if (state.pattern.length === 0 && first !== undefined) {
    state.pattern = first;
    if (state.searchPath.length === 0 && second !== undefined) state.searchPath = second;
    return;
  }
  if (state.searchPath.length === 0 && first !== undefined) state.searchPath = first;
}

function scanGrepSearchFlags(normalizedArgs: string[]): GrepScanState {
  const state = createGrepScanState();
  for (let i = 0; i < normalizedArgs.length; i++) {
    const arg = normalizedArgs[i];
    if (arg === undefined) continue;
    if (arg === '--') {
      state.nonFlagArgs.push(...normalizedArgs.slice(i + 1));
      break;
    }
    i = applyGrepSearchFlag(state, normalizedArgs, i, arg);
  }
  applyPositionalGrepArgs(state);
  return state;
}

function isGrepParsePathLike(value: string, cwd?: string): boolean {
  if (!value || value.length === 0) return false;
  const clean = value.trim();
  if (hasUriOrNonDriveColon(clean)) return false;
  if (/^[a-zA-Z]:[/\\]/.test(clean)) return true;
  if (/[()*+?[\]^$|{}]/.test(clean) || hasBackslashRegexEscape(clean) || clean.includes('|')) {
    return false;
  }
  if (clean === '.' || clean === '..' || clean.startsWith('./') || clean.startsWith('../') || clean.endsWith('/') || clean.endsWith('\\')) {
    return true;
  }
  if (clean.includes('/') || clean.includes('\\') || /^[a-zA-Z]:/.test(clean)) return true;
  try {
    const baseDir = cwd !== undefined && cwd.length > 0 ? path.resolve(cwd) : process.cwd();
    const st = fs.statSync(path.resolve(baseDir, clean), { throwIfNoEntry: false });
    return st !== undefined && st.isDirectory();
  } catch {
    return false;
  }
}

function realignPatternAndSearchPath(pattern: string, searchPath: string, cwd?: string): { pattern: string; searchPath: string } {
  if (!isGrepParsePathLike(pattern, cwd) || isSecondExistingTargetOnly(pattern, searchPath, cwd)) {
    return { pattern, searchPath };
  }
  if (!isGrepParsePathLike(searchPath, cwd) && searchPath.length > 0) {
    return { pattern: searchPath, searchPath: pattern };
  }
  if (searchPath.length === 0) return { pattern: '', searchPath: pattern };
  return { pattern, searchPath };
}

export function parseGrepSearchArgs(args: string[], cwd?: string): ParsedGrepSearchArgs {
  const state = scanGrepSearchFlags(normalizeBundledGrepParserArgs(args));
  const aligned = realignPatternAndSearchPath(state.pattern, state.searchPath, cwd);
  return {
    pattern: aligned.pattern,
    searchPath: aligned.searchPath.length === 0 ? '.' : aligned.searchPath,
    isCaseInsensitive: state.isCaseInsensitive,
    isWord: state.isWord,
    isRegex: state.isRegex,
  };
}

// @ts-nocheck
import { FLAGS_WITH_ARG_SET_BY_TOOL, inspectCombinedShortFlag, tokenizeArgs } from '../command-utils.js';
import { hasBackslashRegexEscape, hasUriOrNonDriveColon, isSecondExistingTargetOnly, statPathKindOnDisk } from './search-path-utils.js';

export interface ParsedGrepSearchArgs {
  pattern: string;
  searchPath: string;
  isCaseInsensitive: boolean;
  isWord: boolean;
  isRegex: boolean;
}

const GREP_PATTERN_VALUE_FLAG_SET: ReadonlySet<string> = new Set([
  '-s', '--symbol', '--pattern', '-q', '--query', '--searchpattern', '--search-pattern',
  '--targetcontent', '--target-content', '--content',
]);
const GREP_DIR_VALUE_FLAG_SET: ReadonlySet<string> = new Set(['-d', '--dir', '--directory', '--path', '--searchpath', '--search-path']);
const GREP_DIR_FLAGS_FOR_P_SET: ReadonlySet<string> = new Set(['-d', '--dir', '--directory', '--searchpath', '--search-path']);
const GREP_PATTERN_FLAGS_FOR_P_SET: ReadonlySet<string> = new Set(['-s', '--symbol', '--pattern', '-q', '--query', '--targetcontent', '--target-content']);
const BUNDLED_GREP_FLAG_HEAD_RE = /^--?[a-zA-Z0-9-]+$/;
const GREP_SHORT_CLUSTER_RE = /^-[rnwivclLqhHsoEFGP]+$/;

interface GrepScanState {
  isCaseInsensitive: boolean;
  isWord: boolean;
  isRegex: boolean;
  pattern: string;
  searchPath: string;
  nonFlagArgs: string[];
  pScanCache?: { hasDirFlag: boolean; hasPatternFlagInArgs: boolean };
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
      if (tokens.length > 1 && tokens[0] !== undefined && BUNDLED_GREP_FLAG_HEAD_RE.test(tokens[0])) {
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
  return arg.length <= 5 && GREP_SHORT_CLUSTER_RE.test(arg) && !arg.startsWith('--') && arg.includes('i');
}

function consumeRegexFlag(state: GrepScanState, args: string[], index: number, lower: string): number {
  state.isRegex = true;
  const nextArg = args[index + 1];
  if (lower !== '--is-regex' && nextArg !== undefined && (lower === '-e' || lower === '--regexp' || !nextArg.startsWith('-'))) {
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

function computePScanCache(args: readonly string[]): { hasDirFlag: boolean; hasPatternFlagInArgs: boolean } {
  let hasDirFlag = false;
  let hasPatternFlagInArgs = false;
  for (const arg of args) {
    const eq = arg.indexOf('=');
    const key = (eq === -1 ? arg : arg.slice(0, eq)).toLowerCase();
    if (GREP_DIR_FLAGS_FOR_P_SET.has(key)) { hasDirFlag = true; break; }
    if (!hasPatternFlagInArgs && GREP_PATTERN_FLAGS_FOR_P_SET.has(key)) hasPatternFlagInArgs = true;
  }
  return { hasDirFlag, hasPatternFlagInArgs };
}

function assignAmbiguousPValue(state: GrepScanState, args: string[], value: string): void {
  if (state.searchPath.length > 0) {
    state.pattern = value;
    return;
  }
  state.pScanCache ??= computePScanCache(args);
  const { hasDirFlag, hasPatternFlagInArgs } = state.pScanCache;
  const hasPatternFlag = state.pattern.length > 0 || hasPatternFlagInArgs;
  if (hasDirFlag || !hasPatternFlag) {
    state.pattern = value;
  } else {
    state.searchPath = value;
  }
}

function consumeAmbiguousP(state: GrepScanState, args: string[], index: number): number {
  const nextArg = args[index + 1];
  if (nextArg === undefined) return index;
  assignAmbiguousPValue(state, args, nextArg);
  return index + 1;
}

function parseOptionalBoolFlagVal(val: string): boolean {
  const normalized = val.trim().toLowerCase();
  return normalized !== 'false' && normalized !== '0' && normalized !== 'no';
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
    if (flagKey === '--is-regex') {
      state.isRegex = parseOptionalBoolFlagVal(flagVal);
      return index;
    }
    if (flagKey === '--case-insensitive') {
      state.isCaseInsensitive = parseOptionalBoolFlagVal(flagVal);
      return index;
    }
    if (flagKey === '--word-regexp') {
      state.isWord = parseOptionalBoolFlagVal(flagVal);
      return index;
    }
    if (GREP_PATTERN_VALUE_FLAG_SET.has(flagKey)) {
      state.pattern = flagVal;
      return index;
    }
    if (GREP_DIR_VALUE_FLAG_SET.has(flagKey)) {
      state.searchPath = flagVal;
      return index;
    }
  }
  const lower = arg.toLowerCase();
  if (!arg.startsWith('--') && arg.length > 2 && arg.length <= 5 && GREP_SHORT_CLUSTER_RE.test(arg)) {
    if (arg.includes('i')) state.isCaseInsensitive = true;
    if (arg.includes('w')) state.isWord = true;
    if (arg.includes('E') || arg.includes('P') || arg.includes('G')) state.isRegex = true;
    return index;
  }
  if (arg === '-E' || arg === '-P' || arg === '-G') {
    state.isRegex = true;
    return index;
  }
  if (isCaseInsensitiveFlag(arg, lower)) {
    state.isCaseInsensitive = true;
    return index;
  }
  if (lower === '-w' || lower === '--word-regexp') {
    state.isWord = true;
    return index;
  }
  if (arg === '-e' || lower === '--regexp' || lower === '--is-regex') {
    return consumeRegexFlag(state, args, index, lower);
  }
  if (GREP_PATTERN_VALUE_FLAG_SET.has(lower)) return consumeValueInto(state, args, index, 'pattern');
  if (GREP_DIR_VALUE_FLAG_SET.has(lower)) return consumeValueInto(state, args, index, 'searchPath');
  if (arg === '-p') return consumeAmbiguousP(state, args, index);
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

function isGrepParsePathLike(value: string, cwd?: string, kindCache?: Map<string, 'dir' | 'file' | 'none'>): boolean {
  if (!value || value.length === 0) return false;
  const clean = value.trim();
  const cachedKind = kindCache?.get(clean);
  if (cachedKind !== undefined) return cachedKind === 'dir';
  if (hasUriOrNonDriveColon(clean)) return false;
  if (/^[a-zA-Z]:[/\\]/.test(clean)) return true;
  if (/[()*+?[\]^$|{}]/.test(clean) || hasBackslashRegexEscape(clean, cwd, kindCache) || clean.includes('|')) {
    return false;
  }
  if (clean === '.' || clean === '..' || clean.startsWith('./') || clean.startsWith('../') || clean.endsWith('/') || clean.endsWith('\\')) {
    return true;
  }
  if (clean.includes('/') || clean.includes('\\') || /^[a-zA-Z]:/.test(clean)) return true;
  return statPathKindOnDisk(clean, cwd, kindCache) === 'dir';
}

function realignPatternAndSearchPath(pattern: string, searchPath: string, cwd?: string): { pattern: string; searchPath: string } {
  const kindCache = new Map<string, 'dir' | 'file' | 'none'>();
  if (!isGrepParsePathLike(pattern, cwd, kindCache) || isSecondExistingTargetOnly(pattern, searchPath, cwd, kindCache)) {
    return { pattern, searchPath };
  }
  if (!isGrepParsePathLike(searchPath, cwd, kindCache) && searchPath.length > 0) {
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

export function isGrepMissingInputTarget(args: readonly string[], positionalArgs: readonly string[]): boolean {
  const valueFlags = FLAGS_WITH_ARG_SET_BY_TOOL['grep'];
  let hasPattern = false;
  let hasRecursive = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (a === '--regexp' || a.startsWith('--regexp=') || a === '--file' || a.startsWith('--file=')) {
      hasPattern = true;
    } else if (a === '--recursive' || a === '--dereference-recursive') {
      hasRecursive = true;
    }
    const info = inspectCombinedShortFlag('grep', a, valueFlags);
    if (info.shortPrefix.length > 1) {
      if (info.shortPrefix.includes('e') || info.shortPrefix.includes('f')) hasPattern = true;
      if (info.shortPrefix.includes('r') || info.shortPrefix.includes('R')) hasRecursive = true;
    }
    if (info.takesSeparateValue) i++;
  }
  return (!hasPattern && positionalArgs.length === 0) || (!hasRecursive && (hasPattern ? positionalArgs.length === 0 : positionalArgs.length < 2));
}

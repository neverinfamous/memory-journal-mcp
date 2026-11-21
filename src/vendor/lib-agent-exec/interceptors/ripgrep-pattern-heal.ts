// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { findPatternExprIndex, getPositionalArgs } from '../command-utils.js';
import { ExecutionContext } from './types.js';
import {
  KNOWN_POSIX_ROOT_DIRS_REGEX,
  existsOnDisk,
  hasBackslashRegexEscape,
  hasUnambiguousRegexMeta,
  hasUnmistakableStructuredPathPrefix,
  hasUriOrNonDriveColon,
  isGlobPathArg,
  isLikelyDirectoryArg,
  isSecondExistingTargetOnly,
} from './search-path-utils.js';

const RG_VALUE_FLAGS_WITH_IGLOB = new Set([
  '-A', '-B', '-C', '-m', '-M', '-e', '-f', '-g', '-t', '-T', '-r', '-j', '-E',
  '--after-context', '--before-context', '--context', '--max-count', '--max-columns', '--max-depth',
  '--regexp', '--file', '--glob', '--iglob', '--type', '--type-not', '--replace', '--threads',
  '--encoding', '--ignore-file', '--max-filesize',
]);

const RG_VALUE_FLAGS_NO_IGLOB = new Set([
  '-A', '-B', '-C', '-m', '-M', '-e', '-f', '-g', '-t', '-T', '-r', '-j', '-E',
  '--after-context', '--before-context', '--context', '--max-count', '--max-columns', '--max-depth',
  '--regexp', '--file', '--glob', '--type', '--type-not', '--replace', '--threads',
  '--encoding', '--ignore-file', '--max-filesize',
]);

const KNOWN_RG_LONG_FLAGS = new Set([
  '--auto-hybrid-regex', '--binary', '--block-buffered', '--byte-offset', '--case-sensitive',
  '--color', '--colors', '--column', '--context-separator', '--count', '--count-matches',
  '--crlf', '--debug', '--dfa-size-limit', '--engine', '--field-context-separator',
  '--field-match-separator', '--files', '--files-with-matches', '--files-without-match',
  '--fixed-strings', '--follow', '--generate', '--heading', '--hidden', '--hostname-bin',
  '--hyperlink-format', '--iglob', '--ignore-case', '--ignore-file-case-insensitive',
  '--include-zero', '--invert-match', '--json', '--line-buffered', '--line-number',
  '--line-regexp', '--max-columns-preview', '--mmap', '--multiline', '--multiline-dotall',
  '--no-auto-hybrid-regex', '--no-binary', '--no-block-buffered', '--no-byte-offset',
  '--no-column', '--no-config', '--no-context-separator', '--no-crlf',
  '--no-encoding', '--no-filename', '--no-fixed-strings', '--no-follow', '--no-heading',
  '--no-hidden', '--no-ignore', '--no-ignore-dot', '--no-ignore-exclude',
  '--no-ignore-files', '--no-ignore-global', '--no-ignore-messages', '--no-ignore-parent',
  '--no-ignore-vcs', '--no-line-buffered', '--no-line-number', '--no-max-columns-preview',
  '--no-messages', '--no-mmap', '--no-multiline', '--no-multiline-dotall', '--no-pcre2',
  '--no-pcre2-unicode', '--no-pre', '--no-require-git', '--no-search-zip', '--no-smart-case',
  '--no-sort-files', '--no-stats', '--no-text', '--no-trim', '--no-unicode', '--null',
  '--null-data', '--one-file-system', '--only-matching', '--passthru', '--path-separator',
  '--pcre2', '--pcre2-unicode', '--pcre2-version', '--pre', '--pre-glob', '--pretty',
  '--quiet', '--regex-size-limit', '--require-git', '--search-zip', '--smart-case',
  '--sort', '--sort-files', '--sortr', '--stats', '--stop-on-nonmatch', '--text',
  '--trace', '--trim', '--type-add', '--type-clear', '--type-list', '--unrestricted',
  '--vimgrep', '--with-filename', '--word-regexp',
]);

const RG_META_FLAGS = new Set(['-h', '--help', '-V', '--version', '-v', '--type-list', '--pcre2-version', '--files']);

export interface RipgrepSearchFlags {
  hasPatternFlag: boolean;
  hasFiles: boolean;
  hasGlob: boolean;
  positionalArgs: string[];
}

function hasRipgrepPatternFlag(args: string[]): boolean {
  return args.some((arg) =>
    arg === '-e' || (arg.startsWith('-e') && !arg.startsWith('--')) ||
    arg === '--regexp' || arg.startsWith('--regexp=') ||
    arg === '-f' || (arg.startsWith('-f') && !arg.startsWith('--')) ||
    arg === '--file' || arg.startsWith('--file=')
  );
}

function resolveCtxCwd(ctx: ExecutionContext): string | undefined {
  return ctx.payload.cwd ?? ctx.cwd;
}

export function readRipgrepSearchFlags(ctx: ExecutionContext): RipgrepSearchFlags {
  return {
    positionalArgs: getPositionalArgs(ctx.cmdBasename, ctx.args),
    hasPatternFlag: hasRipgrepPatternFlag(ctx.args),
    hasFiles: ctx.args.includes('--files'),
    hasGlob: ctx.args.some((arg) => arg === '-g' || arg === '--glob' || arg.startsWith('-g=') || arg.startsWith('--glob=')),
  };
}

function isAnchoredDirectoryArg(arg: string): boolean {
  return arg === '.' || arg === '..'
    || arg.startsWith('./') || arg.startsWith('../')
    || arg.startsWith('.\\') || arg.startsWith('..\\')
    || arg.endsWith('/') || arg.endsWith('\\')
    || /^[a-zA-Z]:[/\\]?/.test(arg)
    || /^\/mnt\/[a-zA-Z](?:\/|$)/.test(arg)
    || KNOWN_POSIX_ROOT_DIRS_REGEX.test(arg);
}

function isConfirmedDirForFiles(arg: string, cwd?: string): boolean {
  if (!isLikelyDirectoryArg(arg, cwd)) return false;
  if (isAnchoredDirectoryArg(arg)) return true;
  try {
    const baseDir = cwd !== undefined && cwd.length > 0 ? path.resolve(cwd) : process.cwd();
    if (!fs.existsSync(baseDir)) return true;
    const resolved = path.resolve(baseDir, arg);
    return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
  } catch {
    return false;
  }
}

export function isRipgrepPathLike(arg: string, cwd?: string): boolean {
  if (isGlobPathArg(arg)) return true;
  if (existsOnDisk(arg, cwd)) return true;
  if (hasUriOrNonDriveColon(arg) || /\s/.test(arg)) return false;
  if (hasUnmistakableStructuredPathPrefix(arg) && !hasUnambiguousRegexMeta(arg.replace(/[+[\]]/g, ''))) return true;
  if (hasUnambiguousRegexMeta(arg)) return false;
  if (!/^[a-zA-Z]:[/\\]/.test(arg) && !/^\.{1,2}[/\\]/.test(arg) && hasBackslashRegexEscape(arg)) return false;
  return arg === '.' || arg === '..'
    || arg.startsWith('./') || arg.startsWith('../')
    || arg.endsWith('/') || arg.endsWith('\\')
    || /^[a-zA-Z]:/.test(arg)
    || arg.startsWith('/mnt/')
    || (arg.startsWith('/') && arg.slice(1).includes('/'))
    || /\.[a-zA-Z0-9_-]+$/.test(arg)
    || isLikelyDirectoryArg(arg, cwd);
}

function swapRipgrepReversedArgs(
  ctx: ExecutionContext,
  hasStdin: boolean,
  hasPatternFlag: boolean,
  hasFiles: boolean,
  positionalArgs: string[],
): string[] {
  if (hasStdin || hasPatternFlag || hasFiles || positionalArgs.length !== 2) return positionalArgs;
  const first = positionalArgs[0];
  const second = positionalArgs[1];
  if (first === undefined || second === undefined) return positionalArgs;
  const cwd = resolveCtxCwd(ctx);
  if (!isLikelyDirectoryArg(first, cwd) || isLikelyDirectoryArg(second, cwd)) return positionalArgs;
  if (isSecondExistingTargetOnly(first, second, cwd)) return positionalArgs;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected reversed arguments in 'rg' (directory before pattern). Swapping arguments to place pattern first... (Frictionless Recovery)\x1b[0m`);
  const idx0 = ctx.args.indexOf(first);
  const idx1 = ctx.args.indexOf(second);
  if (idx0 === -1 || idx1 === -1) return positionalArgs;
  const tmp = ctx.args[idx0];
  ctx.args[idx0] = ctx.args[idx1];
  ctx.args[idx1] = tmp;
  return [second, first];
}

function injectRipgrepFilesForGlobs(
  ctx: ExecutionContext,
  hasStdin: boolean,
  hasPatternFlag: boolean,
  hasFiles: boolean,
  hasGlob: boolean,
  positionalArgs: string[],
): string[] {
  if (hasStdin || hasPatternFlag || hasFiles || !hasGlob) return positionalArgs;
  const cwd = resolveCtxCwd(ctx);
  if (positionalArgs.length === 0) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected 'rg' with glob flag but no search pattern. Auto-injecting '--files' and '.' to search filenames... (Frictionless Recovery)\x1b[0m`);
    ctx.args.unshift('--files');
    ctx.args.push('.');
    return ['.'];
  }
  const onlyConfirmedDirs = positionalArgs.every((arg) => isConfirmedDirForFiles(arg, cwd));
  if (positionalArgs.length === 1 && onlyConfirmedDirs) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected 'rg' with glob flag and target path but no search pattern. Auto-injecting '--files' to search filenames... (Frictionless Recovery)\x1b[0m`);
    ctx.args.unshift('--files');
    return positionalArgs;
  }
  if (positionalArgs.length >= 2 && onlyConfirmedDirs) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected 'rg' with glob flag and directory targets but no search pattern. Auto-injecting '--files' to search filenames... (Frictionless Recovery)\x1b[0m`);
    ctx.args.unshift('--files');
  }
  return positionalArgs;
}

function recombineListedPattern(ctx: ExecutionContext, patternParts: string[]): void {
  const combinedPattern = patternParts.join(' ');
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected unquoted multi-word search pattern in 'rg'. Recombining into a single pattern... (Frictionless Recovery)\x1b[0m`);
  let replaced = false;
  const first = patternParts[0];
  ctx.args = ctx.args.filter((arg) => {
    if (!patternParts.includes(arg)) return true;
    if (!replaced && arg === first) {
      replaced = true;
      return true;
    }
    return false;
  }).map((arg) => arg === first ? combinedPattern : arg);
}

function recombineRipgrepPositionalPattern(
  ctx: ExecutionContext,
  hasPatternFlag: boolean,
  hasFiles: boolean,
  positionalArgs: string[],
): void {
  if (hasPatternFlag || hasFiles || positionalArgs.length <= 2) return;
  const lastArg = positionalArgs[positionalArgs.length - 1];
  const intermediateArgs = positionalArgs.slice(1, -1);
  const cwd = resolveCtxCwd(ctx);
  if (lastArg === undefined || !isRipgrepPathLike(lastArg, cwd)) return;
  if (intermediateArgs.some((arg) => isRipgrepPathLike(arg, cwd))) return;
  recombineListedPattern(ctx, positionalArgs.slice(0, -1));
}

function collectNonFlagIndices(args: string[], toolFlagsWithVal: Set<string>): number[] {
  const nonFlagIndices: number[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--') break;
    if (toolFlagsWithVal.has(arg)) {
      i++;
      continue;
    }
    if (/^-[a-zA-Z0-9]+$/.test(arg) || (arg.startsWith('--') && /^--[a-zA-Z0-9-]+(?:=|$)/.test(arg))) continue;
    nonFlagIndices.push(i);
  }
  return nonFlagIndices;
}

function recombineIndexedPattern(ctx: ExecutionContext, candidateIdxs: number[], patternParts: string[]): void {
  const combinedPattern = patternParts.join(' ');
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected unquoted multi-word search pattern in 'rg'. Recombining into a single pattern... (Frictionless Recovery)\x1b[0m`);
  const firstIdx = candidateIdxs[0];
  const removeSet = new Set(candidateIdxs.slice(1));
  ctx.args = ctx.args
    .map((arg, idx) => (idx === firstIdx ? combinedPattern : arg))
    .filter((_arg, idx) => !removeSet.has(idx));
}

function recombineRipgrepNonFlagPattern(ctx: ExecutionContext, hasPatternFlag: boolean, hasFiles: boolean): void {
  if (hasPatternFlag || hasFiles) return;
  const nonFlagIndices = collectNonFlagIndices(ctx.args, RG_VALUE_FLAGS_WITH_IGLOB);
  const lastPosIdx = nonFlagIndices.length > 0 ? nonFlagIndices[nonFlagIndices.length - 1] : undefined;
  if (lastPosIdx === undefined) return;
  const lastArg = ctx.args[lastPosIdx];
  const cwd = resolveCtxCwd(ctx);
  if (lastArg === undefined || lastArg.startsWith('-') || !isRipgrepPathLike(lastArg, cwd)) return;
  const candidateIdxs = nonFlagIndices.filter((idx) => idx < lastPosIdx);
  if (candidateIdxs.length < 2) return;
  const patternParts = candidateIdxs.map((idx) => ctx.args[idx]);
  const intermediateParts = patternParts.slice(1);
  if (intermediateParts.some((arg) => arg !== undefined && isRipgrepPathLike(arg, cwd))) return;
  const concreteParts = patternParts.filter((arg): arg is string => arg !== undefined);
  if (concreteParts.length !== patternParts.length) return;
  recombineIndexedPattern(ctx, candidateIdxs, concreteParts);
}

function unquoteArg(arg: string): string {
  return arg.replace(/^(['"])(.*)\1$/, '$2');
}

function listNonFlagArgs(args: string[], toolFlagsWithVal: Set<string>): string[] {
  return args.filter((arg, idx) => {
    if (arg.startsWith('-')) return false;
    const prev = idx > 0 ? args[idx - 1] : undefined;
    return prev === undefined || !toolFlagsWithVal.has(prev);
  });
}

function scanForHyphenPatternIndex(
  args: string[],
  allNonFlagArePaths: boolean,
  nonFlagCount: number,
): number {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (RG_VALUE_FLAGS_NO_IGLOB.has(arg)) {
      i++;
      continue;
    }
    const unquoted = unquoteArg(arg);
    if (unquoted !== arg && unquoted.startsWith('-')) return i;
    const baseFlag = unquoted.split('=')[0]?.toLowerCase() ?? '';
    const isUnknownLongFlag = unquoted.startsWith('--')
      && unquoted.length > 2
      && !RG_VALUE_FLAGS_NO_IGLOB.has(baseFlag)
      && !KNOWN_RG_LONG_FLAGS.has(baseFlag);
    if (unquoted.startsWith('\\-') || (isUnknownLongFlag && (allNonFlagArePaths || nonFlagCount === 0))) return i;
  }
  return -1;
}

function resolveHyphenCandidate(ctx: ExecutionContext, patternIdx: number): number {
  const current = patternIdx !== -1 ? ctx.args[patternIdx] : undefined;
  const currentUnquoted = current !== undefined ? unquoteArg(current) : '';
  if (patternIdx !== -1 && currentUnquoted.startsWith('-')) return patternIdx;
  const nonFlagArgs = listNonFlagArgs(ctx.args, RG_VALUE_FLAGS_NO_IGLOB);
  const cwd = resolveCtxCwd(ctx);
  const allNonFlagArePaths = nonFlagArgs.length > 0 && nonFlagArgs.every((arg) => isRipgrepPathLike(arg, cwd));
  return scanForHyphenPatternIndex(ctx.args, allNonFlagArePaths, nonFlagArgs.length);
}

function applyRipgrepHyphenSeparator(ctx: ExecutionContext, candidateIdx: number): void {
  if (candidateIdx === -1) return;
  const rawPat = ctx.args[candidateIdx];
  if (rawPat === undefined) return;
  const unquotedPat = unquoteArg(rawPat);
  if (unquotedPat.startsWith('\\-')) ctx.args[candidateIdx] = unquotedPat.slice(1);
  else if (unquotedPat.startsWith('-')) ctx.args[candidateIdx] = unquotedPat;
  else return;
  ctx.args.splice(candidateIdx, 0, '--');
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected hyphen-prefixed search pattern in 'rg'. Injecting '--' separator to prevent flag parsing errors... (Frictionless Recovery)\x1b[0m`);
}

function healRipgrepHyphenPatterns(ctx: ExecutionContext, hasPatternFlag: boolean, hasHelpOrVersion: boolean): void {
  if (hasHelpOrVersion || hasPatternFlag || ctx.args.includes('--')) return;
  const patternIdx = findPatternExprIndex(ctx.cmdBasename, ctx.args);
  applyRipgrepHyphenSeparator(ctx, resolveHyphenCandidate(ctx, patternIdx));
}

export function healRipgrepPatternShape(ctx: ExecutionContext, hasStdin: boolean, flags: RipgrepSearchFlags): boolean {
  const swapped = swapRipgrepReversedArgs(ctx, hasStdin, flags.hasPatternFlag, flags.hasFiles, flags.positionalArgs);
  const positionalArgs = injectRipgrepFilesForGlobs(
    ctx, hasStdin, flags.hasPatternFlag, flags.hasFiles, flags.hasGlob, swapped,
  );
  const hasFiles = ctx.args.includes('--files');
  recombineRipgrepPositionalPattern(ctx, flags.hasPatternFlag, hasFiles, positionalArgs);
  recombineRipgrepNonFlagPattern(ctx, flags.hasPatternFlag, hasFiles);
  const hasHelpOrVersion = ctx.args.some((arg) => RG_META_FLAGS.has(arg));
  healRipgrepHyphenPatterns(ctx, flags.hasPatternFlag, hasHelpOrVersion);
  return hasHelpOrVersion;
}

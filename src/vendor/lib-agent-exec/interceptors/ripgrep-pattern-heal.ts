// @ts-nocheck
import { RG_VALUE_FLAGS as RG_VALUE_FLAGS_LIST, convertToWindowsPath, extractLeadingShortFlags, findPatternExprIndex } from '../command-utils.js';
import { type ExecutionContext } from './types.js';
import {
  KNOWN_POSIX_ROOT_DIRS_REGEX,
  hasBackslashRegexEscape,
  hasUnambiguousRegexMeta,
  hasUnmistakableStructuredPathPrefix,
  hasUriOrNonDriveColon,
  isGlobPathArg,
  isLikelyDirectoryArg,
  isSecondExistingTargetOnly,
  statPathKindOnDisk,
} from './search-path-utils.js';

const RG_VALUE_FLAGS = new Set<string>(RG_VALUE_FLAGS_LIST);

function isRgSeparateValueFlag(arg: string): boolean {
  if (RG_VALUE_FLAGS.has(arg)) return true;
  if (!arg.startsWith('-') || arg.startsWith('--') || arg.length <= 2) return false;
  const shortPrefix = extractLeadingShortFlags('rg', arg);
  if (arg.length !== shortPrefix.length) return false;
  const lastShort = `-${shortPrefix[shortPrefix.length - 1]}`;
  return RG_VALUE_FLAGS.has(lastShort);
}

function getRgCombinedShortKind(arg: string): { isGlob: boolean; isPattern: boolean } {
  if (!arg.startsWith('-') || arg.startsWith('--')) return { isGlob: false, isPattern: false };
  const shortPrefix = extractLeadingShortFlags('rg', arg);
  const tailChar = shortPrefix.length > 1 ? shortPrefix[shortPrefix.length - 1] : '';
  return {
    isGlob: tailChar === 'g',
    isPattern: tailChar === 'e' || tailChar === 'f',
  };
}

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

const RG_META_FLAGS = new Set(['-h', '--help', '-V', '--version', '--type-list', '--pcre2-version', '--files']);

export interface RipgrepSearchFlags {
  hasPatternFlag: boolean;
  hasFiles: boolean;
  hasGlob: boolean;
  positionalArgs: string[];
}

function scanPreDoubleDashFlags(args: readonly string[]): {
  hasPatternFlag: boolean;
  hasFiles: boolean;
  hasGlob: boolean;
} {
  let hasPatternFlag = false;
  let hasFiles = false;
  let hasGlob = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    if (arg === '--files') hasFiles = true;
    const shortKind = getRgCombinedShortKind(arg);
    if (
      arg === '-g' || arg === '--glob' || arg === '--iglob' ||
      arg.startsWith('-g=') || arg.startsWith('--glob=') || arg.startsWith('--iglob=') ||
      shortKind.isGlob
    ) {
      hasGlob = true;
    }
    if (
      arg === '-e' || (arg.startsWith('-e') && !arg.startsWith('--')) ||
      arg === '--regexp' || arg.startsWith('--regexp=') ||
      arg === '-f' || (arg.startsWith('-f') && !arg.startsWith('--')) ||
      arg === '--file' || arg.startsWith('--file=') ||
      shortKind.isPattern
    ) {
      hasPatternFlag = true;
    }
    if (isRgSeparateValueFlag(arg)) i++;
  }
  return { hasPatternFlag, hasFiles, hasGlob };
}

function resolveCtxCwd(ctx: ExecutionContext): string | undefined {
  const raw = ctx.payload.cwd;
  if (raw !== undefined && raw.length > 0) {
    if (process.platform === 'win32') {
      if ((raw.startsWith('/') && !/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(raw)) || raw.startsWith('~')) {
        return ctx.cwd;
      }
      if (/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(raw)) return convertToWindowsPath(raw);
    }
    return raw;
  }
  return ctx.cwd;
}

export function readRipgrepSearchFlags(ctx: ExecutionContext): RipgrepSearchFlags {
  const pre = scanPreDoubleDashFlags(ctx.args);
  return {
    positionalArgs: collectRgPositionalIndices(ctx.args).map(idx => ctx.args[idx] ?? ''),
    ...pre,
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

function isConfirmedDirForFiles(arg: string, cwd?: string, kindCache?: Map<string, 'dir' | 'file' | 'none'>): boolean {
  if (!isLikelyDirectoryArg(arg, cwd, kindCache)) return false;
  if (isAnchoredDirectoryArg(arg)) return true;
  const cachedKind = kindCache !== undefined ? cachedStatKind(arg, cwd, kindCache) : statPathKindOnDisk(arg, cwd);
  if (cachedKind !== 'none') return cachedKind === 'dir';
  return statPathKindOnDisk('.', cwd, kindCache) === 'none';
}

function cachedStatKind(arg: string, cwd: string | undefined, kindCache: Map<string, 'dir' | 'file' | 'none'>): 'dir' | 'file' | 'none' {
  return statPathKindOnDisk(arg, cwd, kindCache);
}

function isRipgrepPathLikeWithCache(arg: string, cwd: string | undefined, kindCache?: Map<string, 'dir' | 'file' | 'none'>): boolean {
  if (isGlobPathArg(arg, cwd, kindCache)) return true;
  if (statPathKindOnDisk(arg, cwd, kindCache) !== 'none') return true;
  if (hasUriOrNonDriveColon(arg) || /\s/.test(arg)) return false;
  if (hasUnmistakableStructuredPathPrefix(arg) && !hasUnambiguousRegexMeta(arg.replace(/[+[\]]/g, ''))) return true;
  if (hasUnambiguousRegexMeta(arg)) return false;
  if (!/^[a-zA-Z]:[/\\]/.test(arg) && !/^\.{1,2}[/\\]/.test(arg) && hasBackslashRegexEscape(arg, cwd, kindCache)) return false;
  return arg === '.' || arg === '..'
    || arg.startsWith('./') || arg.startsWith('../')
    || arg.endsWith('/') || arg.endsWith('\\')
    || /^[a-zA-Z]:/.test(arg)
    || arg.startsWith('/mnt/')
    || (arg.startsWith('/') && arg.slice(1).includes('/'))
    || /\.[a-zA-Z0-9_-]+$/.test(arg);
}

export function isRipgrepPathLike(arg: string, cwd?: string): boolean {
  return isRipgrepPathLikeWithCache(arg, cwd);
}

function syncCommandArgs(ctx: ExecutionContext): void {
  if (ctx.payload.type === 'command') {
    ctx.payload.args = [...ctx.args];
  }
}

function collectRgPositionalIndices(args: readonly string[]): number[] {
  const indices: number[] = [];
  let seenDoubleDash = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (!seenDoubleDash && arg === '--') { seenDoubleDash = true; continue; }
    if (!seenDoubleDash && isRgSeparateValueFlag(arg)) { i++; continue; }
    if (!seenDoubleDash && arg.startsWith('-')) continue;
    indices.push(i);
  }
  return indices;
}

function swapRipgrepReversedArgs(
  ctx: ExecutionContext,
  hasStdin: boolean,
  hasPatternFlag: boolean,
  hasFiles: boolean,
  positionalArgs: string[],
  kindCache: Map<string, 'dir' | 'file' | 'none'>,
): string[] {
  if (hasStdin || hasPatternFlag || hasFiles || positionalArgs.length !== 2) return positionalArgs;
  const first = positionalArgs[0];
  const second = positionalArgs[1];
  if (first === undefined || second === undefined) return positionalArgs;
  const cwd = resolveCtxCwd(ctx);
  if (!isLikelyDirectoryArg(first, cwd, kindCache) || isLikelyDirectoryArg(second, cwd, kindCache)) return positionalArgs;
  if (isSecondExistingTargetOnly(first, second, cwd, kindCache)) return positionalArgs;
  const posIndices = collectRgPositionalIndices(ctx.args);
  const idx0 = posIndices[0];
  const idx1 = posIndices[1];
  if (idx0 === undefined || idx1 === undefined) return positionalArgs;
  const tmp = ctx.args[idx0];
  const secondVal = ctx.args[idx1];
  if (tmp === undefined || secondVal === undefined) return positionalArgs;
  ctx.args[idx0] = secondVal;
  ctx.args[idx1] = tmp;
  syncCommandArgs(ctx);
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected reversed arguments in 'rg' (directory before pattern). Swapping arguments to place pattern first... (Frictionless Recovery)\x1b[0m`);
  return [second, first];
}

function injectRipgrepFilesForGlobs(
  ctx: ExecutionContext, hasStdin: boolean, hasPatternFlag: boolean, hasFiles: boolean, hasGlob: boolean,
  positionalArgs: string[], kindCache: Map<string, 'dir' | 'file' | 'none'>,
): string[] {
  if (hasStdin || hasPatternFlag || hasFiles || !hasGlob) return positionalArgs;
  const cwd = resolveCtxCwd(ctx);
  if (positionalArgs.length === 0) {
    ctx.args.unshift('--files');
    ctx.args.push('.');
    syncCommandArgs(ctx);
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected 'rg' with glob flag but no search pattern. Auto-injecting '--files' and '.' to search filenames... (Frictionless Recovery)\x1b[0m`);
    return ['.'];
  }
  const onlyConfirmedDirs = positionalArgs.every((arg) => isConfirmedDirForFiles(arg, cwd, kindCache));
  if (positionalArgs.length === 1 && onlyConfirmedDirs) {
    ctx.args.unshift('--files');
    syncCommandArgs(ctx);
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected 'rg' with glob flag and target path but no search pattern. Auto-injecting '--files' to search filenames... (Frictionless Recovery)\x1b[0m`);
    return positionalArgs;
  }
  if (positionalArgs.length >= 2 && onlyConfirmedDirs) {
    ctx.args.unshift('--files');
    syncCommandArgs(ctx);
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected 'rg' with glob flag and directory targets but no search pattern. Auto-injecting '--files' to search filenames... (Frictionless Recovery)\x1b[0m`);
  }
  return positionalArgs;
}

function recombineRipgrepPositionalPattern(
  ctx: ExecutionContext, hasPatternFlag: boolean, hasFiles: boolean,
  positionalArgs: string[], kindCache: Map<string, 'dir' | 'file' | 'none'>,
): void {
  if (hasPatternFlag || hasFiles || positionalArgs.length <= 2) return;
  const lastArg = positionalArgs[positionalArgs.length - 1];
  const intermediateArgs = positionalArgs.slice(1, -1);
  const cwd = resolveCtxCwd(ctx);
  if (lastArg === undefined || !isRipgrepPathLikeWithCache(lastArg, cwd, kindCache)) return;
  if (intermediateArgs.some((arg) => isRipgrepPathLikeWithCache(arg, cwd, kindCache))) return;
  const patternParts = positionalArgs.slice(0, -1);
  const candidateIdxs = collectRgPositionalIndices(ctx.args).slice(0, patternParts.length);
  if (candidateIdxs.length !== patternParts.length) return;
  recombineIndexedPattern(ctx, candidateIdxs, patternParts);
}

const RG_SHORT_KV_RE = /^-[a-zA-Z0-9]+=/;
const RG_SHORT_FLAG_RE = /^-[a-zA-Z0-9]+$/;
const RG_LONG_FLAG_RE = /^--[a-zA-Z0-9-]+(?:=|$)/;
const RG_SINGLE_HYPHEN_META_RE = /[|()[\]^$+{}]/;
const RG_SINGLE_HYPHEN_ESC_RE = /\\[bBwWdDsS]/;
const OUTER_QUOTE_WRAP_RE = /^(['"])(.*)\1$/;

function collectNonFlagIndices(args: string[]): number[] {
  const nonFlagIndices: number[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--') break;
    if (isRgSeparateValueFlag(arg)) { i++; continue; }
    const shortPrefix = arg.startsWith('-') && !arg.startsWith('--') ? extractLeadingShortFlags('rg', arg) : arg;
    if (RG_SHORT_KV_RE.test(arg) || shortPrefix.length < arg.length || RG_SHORT_FLAG_RE.test(arg) || (arg.startsWith('--') && RG_LONG_FLAG_RE.test(arg))) continue;
    nonFlagIndices.push(i);
  }
  return nonFlagIndices;
}

function recombineIndexedPattern(ctx: ExecutionContext, candidateIdxs: number[], patternParts: string[]): void {
  const combinedPattern = patternParts.join(' ');
  const firstIdx = candidateIdxs[0];
  const removeSet = new Set(candidateIdxs.slice(1));
  ctx.args = ctx.args.map((arg, idx) => (idx === firstIdx ? combinedPattern : arg)).filter((_arg, idx) => !removeSet.has(idx));
  syncCommandArgs(ctx);
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected unquoted multi-word search pattern in 'rg'. Recombining into a single pattern... (Frictionless Recovery)\x1b[0m`);
}

function recombineRipgrepNonFlagPattern(
  ctx: ExecutionContext, hasPatternFlag: boolean, hasFiles: boolean, kindCache: Map<string, 'dir' | 'file' | 'none'>,
): void {
  if (hasPatternFlag || hasFiles) return;
  const nonFlagIndices = collectNonFlagIndices(ctx.args);
  const lastPosIdx = nonFlagIndices.length > 0 ? nonFlagIndices[nonFlagIndices.length - 1] : undefined;
  if (lastPosIdx === undefined) return;
  const lastArg = ctx.args[lastPosIdx];
  const cwd = resolveCtxCwd(ctx);
  if (lastArg === undefined || lastArg.startsWith('-') || !isRipgrepPathLikeWithCache(lastArg, cwd, kindCache)) return;
  const candidateIdxs = nonFlagIndices.filter((idx) => idx < lastPosIdx);
  if (candidateIdxs.length < 2) return;
  const patternParts = candidateIdxs.map((idx) => ctx.args[idx]);
  const intermediateParts = patternParts.slice(1);
  if (intermediateParts.some((arg) => arg !== undefined && isRipgrepPathLikeWithCache(arg, cwd, kindCache))) return;
  const concreteParts = patternParts.filter((arg): arg is string => arg !== undefined);
  if (concreteParts.length !== patternParts.length) return;
  if (concreteParts[0]?.startsWith('-') === true) return;
  recombineIndexedPattern(ctx, candidateIdxs, concreteParts);
}

function unquoteArg(arg: string): string {
  return arg.replace(OUTER_QUOTE_WRAP_RE, '$2');
}

function listNonFlagArgs(args: string[]): string[] {
  const result: string[] = [];
  for (let idx = 0; idx < args.length; idx++) {
    const arg = args[idx];
    if (arg === undefined) continue;
    if (arg === '--') { result.push(...args.slice(idx + 1)); break; }
    if (isRgSeparateValueFlag(arg)) { idx++; continue; }
    if (!arg.startsWith('-')) result.push(arg);
  }
  return result;
}

function scanForHyphenPatternIndex(args: string[], allNonFlagArePaths: boolean, nonFlagCount: number): number {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    if (isRgSeparateValueFlag(arg)) { i++; continue; }
    const unquoted = unquoteArg(arg);
    if (unquoted !== arg && unquoted.startsWith('-')) return i;
    const baseFlag = unquoted.split('=')[0]?.toLowerCase() ?? '';
    const isUnknownLongFlag = unquoted.startsWith('--') && unquoted.length > 2 && !RG_VALUE_FLAGS.has(baseFlag) && !KNOWN_RG_LONG_FLAGS.has(baseFlag);
    const isSingleHyphenRegex = !unquoted.startsWith('--') && unquoted.startsWith('-') && unquoted.length > 2
      && !RG_VALUE_FLAGS.has(unquoted) && (RG_SINGLE_HYPHEN_META_RE.test(unquoted) || RG_SINGLE_HYPHEN_ESC_RE.test(unquoted));
    if (unquoted.startsWith('\\-') || ((isUnknownLongFlag || isSingleHyphenRegex) && (allNonFlagArePaths || nonFlagCount === 0))) return i;
  }
  return -1;
}

function resolveHyphenCandidate(ctx: ExecutionContext, patternIdx: number, kindCache: Map<string, 'dir' | 'file' | 'none'>): number {
  const current = patternIdx !== -1 ? ctx.args[patternIdx] : undefined;
  const currentUnquoted = current !== undefined ? unquoteArg(current) : '';
  if (patternIdx !== -1 && currentUnquoted.startsWith('-')) return patternIdx;
  const nonFlagArgs = listNonFlagArgs(ctx.args);
  const cwd = resolveCtxCwd(ctx);
  const allNonFlagArePaths = nonFlagArgs.length > 0 && nonFlagArgs.every((arg) => isRipgrepPathLikeWithCache(arg, cwd, kindCache));
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
  const hasTrailingFlag = ctx.args.slice(candidateIdx + 1).some(a => a.startsWith('-'));
  const sep = hasTrailingFlag ? '-e' : '--';
  ctx.args.splice(candidateIdx, 0, sep);
  syncCommandArgs(ctx);
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected hyphen-prefixed search pattern in 'rg'. Injecting '${sep}' separator to prevent flag parsing errors... (Frictionless Recovery)\x1b[0m`);
}

function healRipgrepHyphenPatterns(
  ctx: ExecutionContext, hasPatternFlag: boolean, hasHelpOrVersion: boolean, kindCache: Map<string, 'dir' | 'file' | 'none'>,
): void {
  if (hasHelpOrVersion || hasPatternFlag || ctx.args.includes('--')) return;
  const patternIdx = findPatternExprIndex(ctx.cmdBasename, ctx.args);
  applyRipgrepHyphenSeparator(ctx, resolveHyphenCandidate(ctx, patternIdx, kindCache));
}

function hasRipgrepMetaFlag(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    if (RG_META_FLAGS.has(arg)) return true;
    if (isRgSeparateValueFlag(arg)) i++;
  }
  return false;
}

export function healRipgrepPatternShape(ctx: ExecutionContext, hasStdin: boolean, flags: RipgrepSearchFlags): boolean {
  const kindCache = new Map<string, 'dir' | 'file' | 'none'>();
  const swapped = swapRipgrepReversedArgs(ctx, hasStdin, flags.hasPatternFlag, flags.hasFiles, flags.positionalArgs, kindCache);
  const preGlobLen = ctx.args.length;
  const positionalArgs = injectRipgrepFilesForGlobs(
    ctx, hasStdin, flags.hasPatternFlag, flags.hasFiles, flags.hasGlob, swapped, kindCache,
  );
  const hasFiles = flags.hasFiles || (ctx.args.length !== preGlobLen && scanPreDoubleDashFlags(ctx.args).hasFiles);
  recombineRipgrepPositionalPattern(ctx, flags.hasPatternFlag, hasFiles, positionalArgs, kindCache);
  recombineRipgrepNonFlagPattern(ctx, flags.hasPatternFlag, hasFiles, kindCache);
  const hasHelpOrVersion = hasRipgrepMetaFlag(ctx.args);
  healRipgrepHyphenPatterns(ctx, flags.hasPatternFlag, hasHelpOrVersion, kindCache);
  return hasHelpOrVersion;
}

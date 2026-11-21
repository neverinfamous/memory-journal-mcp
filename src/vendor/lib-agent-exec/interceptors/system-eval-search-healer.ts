// @ts-nocheck
import type { ExecPayload } from '../schema.js';
import { splitFirstShellSegment } from './utils.js';
import { GREP_EXCLUDE_DIRS, isLikelyDirectoryArg } from './search-interceptor.js';

type EvalPayload = Extract<ExecPayload, { type: 'eval' }>;

export function healEvalGrepSegment(payload: EvalPayload): void {
  const { firstSegment, remainder } = splitFirstShellSegment(payload.code);
  const grepDirMatch = firstSegment.match(/^(?:grep|egrep)\s+(.*)$/i);
  if (grepDirMatch === null) return;
  const tokens = shellTokens(grepDirMatch[1] ?? '');
  const isDir = (token: string): boolean => isLikelyDirectoryArg(stripTokenQuotes(token), payload.cwd);
  const nonFlagTokens = tokens.filter(token => !token.startsWith('-') && !isRedirectionToken(token));
  const swapped = swapReversedDirAndPattern(
    firstSegment,
    nonFlagTokens,
    isDir,
    `\n   🛠️ AUTONOMOUS HEALING: Detected reversed arguments in eval grep (directory before pattern). Swapping arguments to place pattern first... (Frictionless Recovery)\x1b[0m`,
    true,
  );
  const withRecursive = injectEvalGrepRecursive(swapped.segment, swapped.nonFlagTokens, isDir);
  const updatedSegment = injectBroadGrepGuards(payload, withRecursive, swapped.nonFlagTokens);
  if (updatedSegment !== firstSegment) {
    payload.code = `${updatedSegment}${remainder}`;
  }
}

export function healEvalRgSegment(payload: EvalPayload): void {
  const { firstSegment, remainder } = splitFirstShellSegment(payload.code);
  const rgDirMatch = firstSegment.match(/^(?:rg|ripgrep)\s+(.*)$/i);
  if (rgDirMatch === null) return;
  let updatedRgSegment = rewriteRgExtendedFlag(firstSegment);
  const tokens = shellTokens(rgDirMatch[1] ?? '');
  const isDir = (token: string): boolean => isLikelyDirectoryArg(stripTokenQuotes(token), payload.cwd);
  const nonFlagTokens = tokens.filter(token => !token.startsWith('-') && !isRedirectionToken(token));
  const swapped = swapReversedDirAndPattern(
    updatedRgSegment,
    nonFlagTokens,
    isDir,
    `\n   🛠️ AUTONOMOUS HEALING: Detected reversed arguments in eval 'rg' (directory before pattern). Swapping arguments to place pattern first... (Frictionless Recovery)\x1b[0m`,
    false,
  );
  updatedRgSegment = swapped.segment;
  if (updatedRgSegment !== firstSegment) {
    payload.code = `${updatedRgSegment}${remainder}`;
  }
}

function rewriteRgExtendedFlag(segment: string): string {
  if (!/\b(?:rg|ripgrep)\b.*-E\b/.test(segment)) return segment;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected grep-style '-E' flag in eval 'rg'. Rewriting to '-e'... (Frictionless Recovery)\x1b[0m`);
  return segment.replace(/\b(rg|ripgrep)\b(\s+(?:-[^\s]+\s+)*)-E\b/gi, '$1$2-e');
}

function shellTokens(rest: string): string[] {
  return rest.match(/(?:[^\s"'`]+|"[^"]*"|'[^']*'|`[^`]*`)+/g) ?? [];
}

function isRedirectionToken(token: string): boolean {
  return /^(?:\d*>>?|\d*<)/.test(token);
}

function stripTokenQuotes(token: string): string {
  return token.replace(/^['"`]|['"`]$/g, '');
}

function swapReversedDirAndPattern(
  segment: string,
  nonFlagTokens: string[],
  isDir: (token: string) => boolean,
  message: string,
  rejectAbsolutePattern: boolean,
): { segment: string; nonFlagTokens: string[] } {
  if (nonFlagTokens.length !== 2 || segment.includes('-e') || segment.includes('--regexp')) {
    return { segment, nonFlagTokens };
  }
  const first = nonFlagTokens[0];
  const second = nonFlagTokens[1];
  if (first === undefined || second === undefined || !isDir(first) || isDir(second)) {
    return { segment, nonFlagTokens };
  }
  if (rejectAbsolutePattern && second.startsWith('/')) {
    return { segment, nonFlagTokens };
  }
  console.error(message);
  const regexSwap = new RegExp(`(${escapeRegExp(first)})\\s+(${escapeRegExp(second)})`);
  return { segment: segment.replace(regexSwap, '$2 $1'), nonFlagTokens: [second, first] };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function injectEvalGrepRecursive(segment: string, nonFlagTokens: string[], isDir: (token: string) => boolean): string {
  if (/(?:^|\s)(?:-[a-zA-Z]*[rR]\b|--recursive\b)/.test(segment)) return segment;
  const hasPatternFlag = /(?:^|\s)(?:-e\b|--regexp\b|-f\b|--file\b)/.test(segment);
  const targetTokens = hasPatternFlag ? nonFlagTokens : nonFlagTokens.slice(1);
  if (!targetTokens.some(token => isDir(token))) return segment;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected directory target in eval grep without recursive flag. Auto-injecting '-r'... (Frictionless Recovery)\x1b[0m`);
  return segment.replace(/^(grep|egrep)\b/i, '$1 -r');
}

function injectBroadGrepGuards(payload: EvalPayload, segment: string, nonFlagTokens: string[]): string {
  if (!isRecursiveBroadGrep(segment, nonFlagTokens)) return segment;
  let updated = injectMissingExcludeDirs(segment);
  if (!updated.includes('--binary-files=')) {
    updated = updated.replace(/^(grep|egrep)\b/i, '$1 --binary-files=without-match');
  }
  if (payload.timeoutMs === undefined || payload.timeoutMs <= 30000) {
    payload.timeoutMs = 60000;
  }
  return updated;
}

function isRecursiveBroadGrep(segment: string, nonFlagTokens: string[]): boolean {
  const isRecursiveGrep = /(?:^|\s)(?:-[a-zA-Z]*[rR]\b|--recursive\b)/.test(segment);
  if (!isRecursiveGrep) return false;
  return nonFlagTokens.some(token => isBroadGrepPath(stripTokenQuotes(token).trim()));
}

function isBroadGrepPath(clean: string): boolean {
  if (clean === '.' || clean === './' || clean === '..' || clean === '../') return true;
  if (clean.startsWith('./.') || clean.startsWith('.agents') || clean.startsWith('/mnt/')) return true;
  return /^[a-zA-Z]:/.test(clean);
}

function injectMissingExcludeDirs(segment: string): string {
  const missingExcludes = GREP_EXCLUDE_DIRS.filter(
    dir => !segment.includes(`--exclude-dir=${dir}`) && !segment.includes(`--exclude-dir ${dir}`),
  );
  if (missingExcludes.length === 0 || segment.includes('--exclude-dir=')) return segment;
  console.error(
    `\n   🛠️ AUTONOMOUS HEALING: Recursive grep on mounted Windows filesystem detected. Auto-injecting --exclude-dir for node_modules, .git, and dist (and artifact/cache dirs) to prevent timeouts... (Frictionless Recovery)\x1b[0m`,
  );
  const excludeFlags = missingExcludes.map(dir => `--exclude-dir=${dir}`).join(' ');
  return segment.replace(/^(grep|egrep)\b/i, `$1 ${excludeFlags}`);
}

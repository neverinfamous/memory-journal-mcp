// @ts-nocheck
import { FLAGS_WITH_ARG_BY_TOOL, RG_VALUE_FLAGS } from '../command-utils.js';
import type { ExecPayload } from '../schema.js';
import { isKnownRgEncoding } from './ripgrep-flag-normalize.js';
import { isGrepTargetExplicitlyIncluded } from './grep-exclusions.js';
import { splitFirstShellSegment } from './utils.js';
import { GREP_EXCLUDE_DIRS, isLikelyDirectoryArg } from './search-interceptor.js';
import { isSecondExistingTargetOnly } from './search-path-utils.js';

type EvalPayload = Extract<ExecPayload, { type: 'eval' }>;
const RG_VALUE_FLAG_SET: ReadonlySet<string> = new Set(RG_VALUE_FLAGS);
const GREP_VALUE_FLAG_SET: ReadonlySet<string> = new Set(FLAGS_WITH_ARG_BY_TOOL['grep'] ?? []);
const PATTERN_FLAG_SET: ReadonlySet<string> = new Set(['-e', '--regexp', '-f', '--file']);

function extractEvalSearchPositionals(tokens: readonly string[], isRg: boolean): { nonFlagTokens: string[]; hasPatternFlag: boolean; hasRecursiveFlag: boolean } {
  const valueFlags = isRg ? RG_VALUE_FLAG_SET : GREP_VALUE_FLAG_SET;
  const nonFlagTokens: string[] = [];
  let hasPatternFlag = false;
  let hasRecursiveFlag = false;
  let seenDoubleDash = false;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === undefined || isRedirectionToken(tok)) continue;
    if (!seenDoubleDash && tok === '--') { seenDoubleDash = true; continue; }
    if (!seenDoubleDash && tok.startsWith('-')) {
      if (tok === '-r' || tok === '-R' || tok === '--recursive' || (!tok.startsWith('--') && /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(tok))) {
        hasRecursiveFlag = true;
      }
      if (
        PATTERN_FLAG_SET.has(tok)
        || tok.startsWith('--regexp=')
        || tok.startsWith('--file=')
        || (!tok.startsWith('--') && (/^-e./.test(tok) || /^-f./.test(tok)))
      ) {
        hasPatternFlag = true;
      }
      if (valueFlags.has(tok)) i++;
      continue;
    }
    nonFlagTokens.push(tok);
  }
  return { nonFlagTokens, hasPatternFlag, hasRecursiveFlag };
}

function resolveEvalSearchCwd(payload: EvalPayload, baseCwd?: string): string | undefined {
  if (payload.cwd !== undefined && payload.cwd.length > 0 && !payload.cwd.startsWith('/')) {
    return payload.cwd;
  }
  return baseCwd;
}

export function healEvalGrepSegment(payload: EvalPayload, baseCwd?: string): void {
  const { firstSegment, remainder } = splitFirstShellSegment(payload.code);
  const grepDirMatch = firstSegment.match(/^(?:grep|egrep)\s+(.*)$/i);
  if (grepDirMatch === null) return;
  const tokens = shellTokens(grepDirMatch[1] ?? '');
  const cwd = resolveEvalSearchCwd(payload, baseCwd);
  const isDir = (token: string): boolean => isLikelyDirectoryArg(stripTokenQuotes(token), cwd);
  const { nonFlagTokens, hasPatternFlag, hasRecursiveFlag } = extractEvalSearchPositionals(tokens, false);
  const banners: string[] = [];
  const swapped = hasPatternFlag
    ? { segment: firstSegment, nonFlagTokens }
    : swapReversedDirAndPattern(
        firstSegment,
        nonFlagTokens,
        isDir,
        `\n   🛠️ AUTONOMOUS HEALING: Detected reversed arguments in eval grep (directory before pattern). Swapping arguments to place pattern first... (Frictionless Recovery)\x1b[0m`,
        true,
        cwd,
        banners,
      );
  const withRecursive = injectEvalGrepRecursive(swapped.segment, swapped.nonFlagTokens, hasPatternFlag, hasRecursiveFlag, isDir, banners);
  const updatedSegment = injectBroadGrepGuards(payload, withRecursive, swapped.nonFlagTokens, hasPatternFlag, hasRecursiveFlag || withRecursive !== swapped.segment, banners);
  if (updatedSegment !== firstSegment) {
    payload.code = `${updatedSegment}${remainder}`;
  }
  for (const banner of banners) console.error(banner);
}

export function healEvalRgSegment(payload: EvalPayload, baseCwd?: string): void {
  const { firstSegment, remainder } = splitFirstShellSegment(payload.code);
  const rgDirMatch = firstSegment.match(/^(?:rg|ripgrep)\s+(.*)$/i);
  if (rgDirMatch === null) return;
  const rawTokens = shellTokens(rgDirMatch[1] ?? '');
  const banners: string[] = [];
  let updatedRgSegment = rewriteRgExtendedFlag(firstSegment, rawTokens, banners);
  const postTokens = shellTokens(updatedRgSegment.replace(/^(?:rg|ripgrep)\s+/i, ''));
  const cwd = resolveEvalSearchCwd(payload, baseCwd);
  const isDir = (token: string): boolean => isLikelyDirectoryArg(stripTokenQuotes(token), cwd);
  const { nonFlagTokens, hasPatternFlag } = extractEvalSearchPositionals(postTokens, true);
  const swapped = hasPatternFlag
    ? { segment: updatedRgSegment, nonFlagTokens }
    : swapReversedDirAndPattern(
        updatedRgSegment,
        nonFlagTokens,
        isDir,
        `\n   🛠️ AUTONOMOUS HEALING: Detected reversed arguments in eval 'rg' (directory before pattern). Swapping arguments to place pattern first... (Frictionless Recovery)\x1b[0m`,
        false,
        cwd,
        banners,
      );
  updatedRgSegment = swapped.segment;
  if (updatedRgSegment !== firstSegment) {
    payload.code = `${updatedRgSegment}${remainder}`;
  }
  for (const banner of banners) console.error(banner);
}

function replaceNthTokenE(segment: string, eIdx: number, replacement: string): string {
  let count = 0;
  return segment.replace(/(\s)-E(?=\s|$)/g, (m, sp: string) => {
    const out = count === eIdx ? `${sp}${replacement}` : m;
    count++;
    return out;
  }).replace(/\s{2,}/g, ' ').trim();
}

function rewriteRgExtendedFlag(segment: string, tokens: readonly string[], banners: string[]): string {
  let seenECount = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === undefined || tok === '--') break;
    if (tok === '-E') {
      const next = tokens[i + 1];
      const beforeDd = segment.split(/\s+--(?:\s|$)/)[0] ?? segment;
      const ddTail = segment.slice(beforeDd.length);
      if (next === undefined || next.startsWith('-')) {
        const stripped = replaceNthTokenE(beforeDd, seenECount, '');
        if (stripped !== beforeDd) {
          banners.push(`\n   🛠️ AUTONOMOUS HEALING: Stripped incomplete/ambiguous '-E' encoding flag in eval 'rg'... (Frictionless Recovery)\x1b[0m`);
          return `${stripped}${ddTail}`;
        }
        return segment;
      }
      if (!isKnownRgEncoding(stripTokenQuotes(next))) {
        const rewritten = replaceNthTokenE(beforeDd, seenECount, '-e');
        if (rewritten !== beforeDd) {
          banners.push(`\n   🛠️ AUTONOMOUS HEALING: Detected grep-style '-E' flag in eval 'rg'. Rewriting to '-e'... (Frictionless Recovery)\x1b[0m`);
          return `${rewritten}${ddTail}`;
        }
        return segment;
      }
      seenECount++;
      i++;
      continue;
    }
    if (RG_VALUE_FLAG_SET.has(tok)) i++;
  }
  return segment;
}

function shellTokens(rest: string): string[] {
  return rest.match(/(?:[^\s"'`]|"[^"]*"|'[^']*'|`[^`]*`)+/g) ?? [];
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
  cwd?: string,
  banners?: string[],
): { segment: string; nonFlagTokens: string[] } {
  if (nonFlagTokens.length !== 2) {
    return { segment, nonFlagTokens };
  }
  const first = nonFlagTokens[0];
  const second = nonFlagTokens[1];
  if (first === undefined || second === undefined || !isDir(first) || isDir(second)) {
    return { segment, nonFlagTokens };
  }
  if (isSecondExistingTargetOnly(stripTokenQuotes(first), stripTokenQuotes(second), cwd)) {
    return { segment, nonFlagTokens };
  }
  if (rejectAbsolutePattern && second.startsWith('/')) {
    return { segment, nonFlagTokens };
  }
  const regexSwap = new RegExp(`(${escapeRegExp(first)})\\s+(${escapeRegExp(second)})`);
  const replaced = segment.replace(regexSwap, '$2 $1');
  if (replaced === segment) {
    return { segment, nonFlagTokens };
  }
  if (banners) banners.push(message);
  else console.error(message);
  return { segment: replaced, nonFlagTokens: [second, first] };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function injectEvalGrepRecursive(
  segment: string,
  nonFlagTokens: string[],
  hasPatternFlag: boolean,
  hasRecursiveFlag: boolean,
  isDir: (token: string) => boolean,
  banners: string[],
): string {
  if (hasRecursiveFlag) return segment;
  const targetTokens = hasPatternFlag ? nonFlagTokens : nonFlagTokens.slice(1);
  if (!targetTokens.some(token => isDir(token))) return segment;
  banners.push(`\n   🛠️ AUTONOMOUS HEALING: Detected directory target in eval grep without recursive flag. Auto-injecting '-r'... (Frictionless Recovery)\x1b[0m`);
  return segment.replace(/^(grep|egrep)\b/i, '$1 -r');
}

function injectBroadGrepGuards(
  payload: EvalPayload,
  segment: string,
  nonFlagTokens: string[],
  hasPatternFlag: boolean,
  hasRecursiveFlag: boolean,
  banners: string[],
): string {
  if (!isRecursiveBroadGrep(hasRecursiveFlag, nonFlagTokens)) return segment;
  const targetPaths = hasPatternFlag ? nonFlagTokens : nonFlagTokens.slice(1);
  let updated = injectMissingExcludeDirs(segment, targetPaths, banners);
  if (!updated.includes('--binary-files=')) {
    updated = updated.replace(/^(grep|egrep)\b/i, '$1 --binary-files=without-match');
  }
  if (payload.timeoutMs === undefined || (payload.timeoutMs > 0 && payload.timeoutMs <= 30000)) {
    payload.timeoutMs = 60000;
  }
  return updated;
}

function isRecursiveBroadGrep(hasRecursiveFlag: boolean, nonFlagTokens: string[]): boolean {
  if (!hasRecursiveFlag) return false;
  return nonFlagTokens.some(token => isBroadGrepPath(stripTokenQuotes(token).trim()));
}

function isBroadGrepPath(clean: string): boolean {
  if (clean === '.' || clean === './' || clean === '..' || clean === '../') return true;
  if (clean.startsWith('./.') || clean.startsWith('.agents') || clean.startsWith('/mnt/')) return true;
  return /^[a-zA-Z]:/.test(clean);
}

function injectMissingExcludeDirs(segment: string, targetPaths: readonly string[], banners: string[]): string {
  const missingExcludes = GREP_EXCLUDE_DIRS.filter(
    dir => !isGrepTargetExplicitlyIncluded(targetPaths, dir)
      && !segment.includes(`--exclude-dir=${dir}`)
      && !segment.includes(`--exclude-dir ${dir}`),
  );
  if (missingExcludes.length === 0) return segment;
  banners.push(
    `\n   🛠️ AUTONOMOUS HEALING: Recursive grep on mounted Windows filesystem detected. Auto-injecting --exclude-dir for node_modules, .git, and dist (and artifact/cache dirs) to prevent timeouts... (Frictionless Recovery)\x1b[0m`,
  );
  const excludeFlags = missingExcludes.map(dir => `--exclude-dir=${dir}`).join(' ');
  return segment.replace(/^(grep|egrep)\b/i, `$1 ${excludeFlags}`);
}

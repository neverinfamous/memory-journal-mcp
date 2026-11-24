// @ts-nocheck
import { FLAGS_WITH_ARG_BY_TOOL, RG_VALUE_FLAGS, extractLeadingShortFlags, inspectCombinedShortFlag } from '../command-utils.js';
import type { ExecPayload } from '../schema.js';
import { isKnownRgEncoding, splitRgExtendedCluster } from './ripgrep-flag-normalize.js';
import { isGrepTargetExplicitlyIncluded } from './grep-exclusions.js';
import { splitFirstShellSegment } from './utils.js';
import { GREP_EXCLUDE_DIRS, isLikelyDirectoryArg } from './search-interceptor.js';
import { isSecondExistingTargetOnly } from './search-path-utils.js';

type EvalPayload = Extract<ExecPayload, { type: 'eval' }>;
const RG_VALUE_FLAG_SET: ReadonlySet<string> = new Set(RG_VALUE_FLAGS);
const GREP_VALUE_FLAG_SET: ReadonlySet<string> = new Set(FLAGS_WITH_ARG_BY_TOOL['grep'] ?? []);
const PATTERN_FLAG_SET: ReadonlySet<string> = new Set(['-e', '--regexp', '-f', '--file']);
const STANDALONE_REDIR_RE = /^(?:\d*>>?|\d*<<?|<&|>&|&>|&>>)$/;
const SEGMENT_TOKEN_RE = /(?:[^\s"'`]|"[^"]*"|'[^']*'|`[^`]*`)+/g;

function extractEvalSearchPositionals(tokens: readonly string[], isRg: boolean): { nonFlagTokens: string[]; hasPatternFlag: boolean; hasRecursiveFlag: boolean } {
  const valueFlags = isRg ? RG_VALUE_FLAG_SET : GREP_VALUE_FLAG_SET;
  const nonFlagTokens: string[] = [];
  let hasPatternFlag = false;
  let hasRecursiveFlag = false;
  let seenDoubleDash = false;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === undefined) continue;
    if (isRedirectionToken(tok)) {
      if (STANDALONE_REDIR_RE.test(tok)) i++;
      continue;
    }
    if (!seenDoubleDash && tok === '--') { seenDoubleDash = true; continue; }
    if (!seenDoubleDash && tok.startsWith('-')) {
      const shortPrefix = !tok.startsWith('--') ? extractLeadingShortFlags(isRg ? 'rg' : 'grep', tok) : '';
      if (tok === '-r' || tok === '-R' || tok === '--recursive' || (shortPrefix.length > 1 && /[rR]/.test(shortPrefix))) {
        hasRecursiveFlag = true;
      }
      const lastShort = shortPrefix.length > 1 ? `-${shortPrefix[shortPrefix.length - 1]}` : '';
      const consumesNext = valueFlags.has(tok) || (tok.length === shortPrefix.length && lastShort !== '' && valueFlags.has(lastShort));
      if (
        PATTERN_FLAG_SET.has(tok)
        || tok.startsWith('--regexp=')
        || tok.startsWith('--file=')
        || (!tok.startsWith('--') && (/^-[a-zA-Z]*[ef]/.test(shortPrefix) && (tok.length > shortPrefix.length || shortPrefix.endsWith('e') || shortPrefix.endsWith('f'))))
      ) {
        hasPatternFlag = true;
      }
      if (consumesNext) i++;
      continue;
    }
    nonFlagTokens.push(tok);
  }
  return { nonFlagTokens, hasPatternFlag, hasRecursiveFlag };
}

function resolveEvalSearchCwd(payload: EvalPayload, baseCwd?: string): string | undefined {
  if (payload.cwd !== undefined && payload.cwd.length > 0 && !payload.cwd.startsWith('/') && !payload.cwd.startsWith('~')) {
    return payload.cwd;
  }
  return baseCwd;
}

export function healEvalGrepSegment(payload: EvalPayload, baseCwd?: string): void {
  const { firstSegment, remainder } = splitFirstShellSegment(payload.code);
  const leadingWs = /^\s*/.exec(firstSegment)?.[0] ?? '';
  const trimmedSegment = firstSegment.trimStart();
  const grepDirMatch = trimmedSegment.match(/^(?:grep|egrep|fgrep)\s+(.*)$/i);
  if (grepDirMatch === null) return;
  const tokens = shellTokens(grepDirMatch[1] ?? '');
  const cwd = resolveEvalSearchCwd(payload, baseCwd);
  const isDir = (token: string): boolean => isLikelyDirectoryArg(stripTokenQuotes(token), cwd);
  const { nonFlagTokens, hasPatternFlag, hasRecursiveFlag } = extractEvalSearchPositionals(tokens, false);
  const banners: string[] = [];
  const swapped = hasPatternFlag
    ? { segment: trimmedSegment, nonFlagTokens }
    : swapReversedDirAndPattern(
        trimmedSegment,
        nonFlagTokens,
        isDir,
        `\n   🛠️ AUTONOMOUS HEALING: Detected reversed arguments in eval grep (directory before pattern). Swapping arguments to place pattern first... (Frictionless Recovery)\x1b[0m`,
        true,
        cwd,
        banners,
      );
  const withRecursive = injectEvalGrepRecursive(swapped.segment, swapped.nonFlagTokens, hasPatternFlag, hasRecursiveFlag, isDir, banners);
  const updatedSegment = injectBroadGrepGuards(payload, withRecursive, swapped.nonFlagTokens, hasPatternFlag, hasRecursiveFlag || withRecursive !== swapped.segment, banners);
  if (updatedSegment !== trimmedSegment) {
    payload.code = `${leadingWs}${updatedSegment}${remainder}`;
  }
  for (const banner of banners) console.error(banner);
}

export function healEvalRgSegment(payload: EvalPayload, baseCwd?: string): void {
  const { firstSegment, remainder } = splitFirstShellSegment(payload.code);
  const leadingWs = /^\s*/.exec(firstSegment)?.[0] ?? '';
  const trimmedSegment = firstSegment.trimStart();
  const rgDirMatch = trimmedSegment.match(/^(?:rg|ripgrep)\s+(.*)$/i);
  if (rgDirMatch === null) return;
  const rawTokens = shellTokens(rgDirMatch[1] ?? '');
  const banners: string[] = [];
  let updatedRgSegment = rewriteRgExtendedFlag(trimmedSegment, rawTokens, banners);
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
  if (updatedRgSegment !== trimmedSegment) {
    payload.code = `${leadingWs}${updatedRgSegment}${remainder}`;
  }
  for (const banner of banners) console.error(banner);
}

function rebuildSegmentWithTokenReplacement(segment: string, tokenIdx: number, replacement: string): string {
  const outTokens: string[] = [];
  SEGMENT_TOKEN_RE.lastIndex = 0;
  let idx = 0;
  let lastEnd = 0;
  for (const m of segment.matchAll(SEGMENT_TOKEN_RE)) {
    const start = m.index ?? 0;
    const raw = m[0];
    const rawGap = segment.slice(lastEnd, start);
    const gap = lastEnd === 0 ? rawGap.trimStart() : (rawGap.length > 0 ? ' ' : '');
    if (idx === tokenIdx) {
      if (replacement.length > 0) {
        outTokens.push(gap, replacement);
      }
    } else {
      const needSpace = outTokens.length > 0 && gap === '' && lastEnd > 0;
      outTokens.push(needSpace ? ' ' : gap, raw);
    }
    lastEnd = start + raw.length;
    idx++;
  }
  const tail = segment.slice(lastEnd).trimEnd();
  if (tail.length > 0) outTokens.push(tail);
  return outTokens.join('').trim();
}

function stepRgExtendedRewrite(
  segment: string,
  tokens: readonly string[],
): { segment: string; kind: 'stripped' | 'rewrote' } | null {
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok === undefined || tok === '--') break;
    const eSplit = splitRgExtendedCluster(tok);
    if (eSplit === null) {
      const shortInfo = inspectCombinedShortFlag('rg', tok, RG_VALUE_FLAG_SET);
      if (PATTERN_FLAG_SET.has(tok) || shortInfo.takesSeparateValue) i++;
      continue;
    }
    const leadPrefix = eSplit.leadFlags;
    const next = tokens[i + 1];
    if (next === undefined || next.startsWith('-')) {
      const stripped = rebuildSegmentWithTokenReplacement(segment, i + 1, leadPrefix);
      return stripped !== segment ? { segment: stripped, kind: 'stripped' } : null;
    }
    if (!isKnownRgEncoding(stripTokenQuotes(next))) {
      const replacement = leadPrefix.length > 0 ? `${leadPrefix} -e` : '-e';
      const rewritten = rebuildSegmentWithTokenReplacement(segment, i + 1, replacement);
      return rewritten !== segment ? { segment: rewritten, kind: 'rewrote' } : null;
    }
    i++;
  }
  return null;
}

function rewriteRgExtendedFlag(segment: string, tokens: readonly string[], banners: string[]): string {
  let currentSegment = segment;
  let currentTokens = tokens;
  let strippedAny = false;
  let rewroteAny = false;
  for (let pass = 0; pass < 8; pass++) {
    const res = stepRgExtendedRewrite(currentSegment, currentTokens);
    if (res === null) break;
    currentSegment = res.segment;
    if (res.kind === 'stripped') strippedAny = true;
    else rewroteAny = true;
    currentTokens = shellTokens(currentSegment.replace(/^(?:rg|ripgrep)\s+/i, ''));
  }
  if (strippedAny) banners.push(`\n   🛠️ AUTONOMOUS HEALING: Stripped incomplete/ambiguous '-E' encoding flag in eval 'rg'... (Frictionless Recovery)\x1b[0m`);
  if (rewroteAny) banners.push(`\n   🛠️ AUTONOMOUS HEALING: Detected grep-style '-E' flag in eval 'rg'. Rewriting to '-e'... (Frictionless Recovery)\x1b[0m`);
  return currentSegment;
}

function shellTokens(rest: string): string[] {
  return rest.match(/(?:[^\s"'`]|"[^"]*"|'[^']*'|`[^`]*`)+/g) ?? [];
}

function isRedirectionToken(token: string): boolean {
  return /^(?:\d*>>?|\d*<|<&|>&|&>>?)/.test(token);
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
  return segment.replace(/^(grep|egrep|fgrep)\b/i, '$1 -r');
}

function injectBroadGrepGuards(
  payload: EvalPayload,
  segment: string,
  nonFlagTokens: string[],
  hasPatternFlag: boolean,
  hasRecursiveFlag: boolean,
  banners: string[],
): string {
  const targetPaths = hasPatternFlag ? nonFlagTokens : nonFlagTokens.slice(1);
  if (!isRecursiveBroadGrep(hasRecursiveFlag, targetPaths)) return segment;
  let updated = injectMissingExcludeDirs(segment, targetPaths, banners);
  if (!updated.includes('--binary-files=')) {
    updated = updated.replace(/^(grep|egrep|fgrep)\b/i, '$1 --binary-files=without-match');
  }
  if (payload.timeoutMs === undefined || (payload.timeoutMs > 0 && payload.timeoutMs <= 30000)) {
    payload.timeoutMs = 60000;
  }
  return updated;
}

function isRecursiveBroadGrep(hasRecursiveFlag: boolean, targetPaths: string[]): boolean {
  if (!hasRecursiveFlag) return false;
  if (targetPaths.length === 0) return true;
  return targetPaths.some(token => isBroadGrepPath(stripTokenQuotes(token).trim()));
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
  return segment.replace(/^(grep|egrep|fgrep)\b/i, `$1 ${excludeFlags}`);
}

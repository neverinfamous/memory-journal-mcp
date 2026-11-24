// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import {
  RG_VALUE_FLAGS,
  convertToWindowsPath,
  convertToWslPath,
  extractLeadingShortFlags,
  findPatternExprIndex,
  getPositionalArgIndices,
  hasSearchFixedStringsFlag,
  hasSearchPcre2Flag,
  inspectCombinedShortFlag,
} from '../command-utils.js';
import { emitInterceptBanner, resolveNativeBinary } from '../utils.js';
import { normalizeRipgrepInvocation } from './ripgrep-flag-normalize.js';
import { healRipgrepPatternShape, readRipgrepSearchFlags } from './ripgrep-pattern-heal.js';
import { ExecutionContext } from './types.js';

const RG_NON_PATH_VALUE_FLAGS = new Set([
  '-e', '--regexp', '-r', '--replace', '-g', '--glob', '--iglob',
  '--path-separator', '--context-separator', '--field-context-separator', '--field-match-separator',
]);

const RG_NON_PATH_ATTACHED_PREFIXES = [
  '--regexp=', '--replace=', '--glob=', '--iglob=',
  '--path-separator=', '--context-separator=', '--field-context-separator=', '--field-match-separator=',
];

function isAttachedRgNonPathFlag(arg: string): boolean {
  if (RG_NON_PATH_ATTACHED_PREFIXES.some(p => arg.startsWith(p))) return true;
  if (arg.startsWith('--') || !arg.startsWith('-') || arg.length <= 2) return false;
  const shortPrefix = extractLeadingShortFlags('rg', arg);
  return arg.length > shortPrefix.length && /^-[a-zA-Z]*[erg]$/.test(shortPrefix);
}

function collectRgNonPathIndices(args: readonly string[], patternIdx: number): Set<number> {
  const exempt = new Set<number>();
  if (patternIdx !== -1) exempt.add(patternIdx);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--') break;
    const shortInfo = inspectCombinedShortFlag('rg', arg, RG_VALUE_FLAGS);
    const isCombinedNonPath = shortInfo.takesSeparateValue && ['e', 'r', 'g'].includes(shortInfo.tailChar);
    if ((RG_NON_PATH_VALUE_FLAGS.has(arg) || isCombinedNonPath) && i + 1 < args.length) {
      exempt.add(i + 1);
      i++;
    } else if (shortInfo.takesSeparateValue && i + 1 < args.length) {
      i++;
    } else if (isAttachedRgNonPathFlag(arg)) {
      exempt.add(i);
    }
  }
  return exempt;
}

const RG_ATTACHED_PATH_PREFIXES = ['--file=', '--ignore-file='] as const;

function splitAttachedRgPathFlag(arg: string): { prefix: string; val: string } | null {
  for (const prefix of RG_ATTACHED_PATH_PREFIXES) {
    if (arg.startsWith(prefix)) return { prefix, val: arg.slice(prefix.length) };
  }
  return null;
}

function ripgrepTargetsLinuxOnlyPath(args: string[], patternIdx: number): boolean {
  const exempt = collectRgNonPathIndices(args, patternIdx);
  return args.some((arg, idx) => {
    if (exempt.has(idx)) return false;
    const attached = splitAttachedRgPathFlag(arg);
    const candidate = attached !== null ? attached.val : arg;
    return candidate.startsWith('/') && !candidate.startsWith('//') && !/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(candidate);
  });
}

function preferNativeOrWslRipgrep(ctx: ExecutionContext): void {
  if (process.platform !== 'win32' || ctx.payload.target === 'wsl2') return;
  const patternIdx = findPatternExprIndex(ctx.cmdBasename, ctx.args);
  if (resolveNativeBinary('rg') === null) {
    ctx.payload.target = 'wsl2';
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: No native 'rg' binary on PATH. Switching execution target to WSL2... (Frictionless Recovery)`);
    return;
  }
  if (ripgrepTargetsLinuxOnlyPath(ctx.args, patternIdx)) {
    ctx.payload.target = 'wsl2';
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: 'rg' targets a Linux-only POSIX path. Switching execution target to WSL2... (Frictionless Recovery)`);
    return;
  }
  const exempt = collectRgNonPathIndices(ctx.args, patternIdx);
  ctx.args = ctx.args.map((arg, idx) => {
    if (exempt.has(idx)) return arg;
    const attached = splitAttachedRgPathFlag(arg);
    if (attached !== null && /^\/mnt\/[a-zA-Z](?:\/|$)/i.test(attached.val)) {
      return `${attached.prefix}${convertToWindowsPath(attached.val)}`;
    }
    return /^\/mnt\/[a-zA-Z](?:\/|$)/i.test(arg) ? convertToWindowsPath(arg) : arg;
  });
}

function appendRipgrepDefaultTarget(
  ctx: ExecutionContext,
  hasStdin: boolean,
  hasHelpOrVersion: boolean,
  hasPatternFlag: boolean,
  hasFiles: boolean,
  updatedPositional: readonly string[],
): void {
  if (hasStdin || hasHelpOrVersion) return;
  const patternOrFilesMode = hasPatternFlag || hasFiles;
  const targetPositionals = patternOrFilesMode ? updatedPositional : updatedPositional.slice(1);
  if (targetPositionals.includes('.')) return;
  const needsDot = (patternOrFilesMode && updatedPositional.length === 0) || (!patternOrFilesMode && updatedPositional.length === 1);
  if (!needsDot) return;
  ctx.args.push('.');
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
  emitInterceptBanner(`\n   💡 AGENT INTERCEPT: 'rg' missing target directory argument. Auto-appending '.' as target directory... (Frictionless Recovery)`);
}

function finalizeRipgrepArgs(ctx: ExecutionContext, unbundledFlags: boolean, hasHelpOrVersion: boolean): void {
  if (ctx.payload.target === 'wsl2') {
    const patternIdx = findPatternExprIndex(ctx.cmdBasename, ctx.args);
    const exempt = collectRgNonPathIndices(ctx.args, patternIdx);
    ctx.args = ctx.args.map((arg, idx) => exempt.has(idx) ? arg : convertToWslPath(arg));
  }
  if (unbundledFlags && !hasHelpOrVersion && !ctx.args.includes('--no-messages')) ctx.args.unshift('--no-messages');
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
}

const RG_VALUE_FLAG_SET: ReadonlySet<string> = new Set(RG_VALUE_FLAGS);

/**
 * [INTENT]: Linear-time scanner detecting unescaped PCRE2 look-around assertions (`(?=`, `(?!`, `(?<=`, `(?<!`)
 * outside character classes so `rg` can auto-enable `--pcre2` instead of failing with a Rust regex parse error.
 */
export function containsPcre2Lookaround(pattern: string): boolean {
  let inCharClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') { i++; continue; }
    if (inCharClass) {
      if (ch === ']') inCharClass = false;
      continue;
    }
    if (ch === '[') {
      inCharClass = true;
      if (pattern[i + 1] === '^') i++;
      if (pattern[i + 1] === ']') i++;
      continue;
    }
    if (ch === '(' && pattern[i + 1] === '?') {
      const next2 = pattern[i + 2];
      if (next2 === '=' || next2 === '!') return true;
      if (next2 === '<' && (pattern[i + 3] === '=' || pattern[i + 3] === '!')) return true;
    }
  }
  return false;
}

function collectRipgrepPatterns(args: string[], hasPatternFlag: boolean): string[] {
  if (!hasPatternFlag) {
    const idx = findPatternExprIndex('rg', args);
    const pat = idx !== -1 ? args[idx] : undefined;
    return pat !== undefined ? [pat] : [];
  }
  const patterns: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    if (arg === '-e' || arg === '--regexp') {
      const next = args[i + 1];
      if (next !== undefined) patterns.push(next);
      i++;
      continue;
    }
    if (arg.startsWith('--regexp=')) {
      patterns.push(arg.slice('--regexp='.length));
      continue;
    }
    const info = inspectCombinedShortFlag('rg', arg, RG_VALUE_FLAG_SET);
    if (info.tailChar === 'e' && info.takesSeparateValue) {
      const next = args[i + 1];
      if (next !== undefined) patterns.push(next);
      i++;
    } else if (info.tailChar === 'e' && info.hasAttachedValue) {
      patterns.push(arg.slice(info.shortPrefix.length));
    } else if (info.takesSeparateValue) {
      i++;
    }
  }
  return patterns;
}

function hasExplicitRgEngineOverride(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined || arg === '--') break;
    if (arg === '--no-pcre2' || arg === '--engine' || arg.startsWith('--engine=')) return true;
    if (inspectCombinedShortFlag('rg', arg, RG_VALUE_FLAG_SET).takesSeparateValue) i++;
  }
  return false;
}

function healRipgrepPcre2Lookarounds(
  ctx: ExecutionContext,
  hasPatternFlag: boolean,
  hasFiles: boolean,
  hasHelpOrVersion: boolean,
): void {
  if (hasHelpOrVersion || hasFiles) return;
  if (hasSearchFixedStringsFlag('rg', ctx.args) || hasSearchPcre2Flag('rg', ctx.args) || hasExplicitRgEngineOverride(ctx.args)) {
    return;
  }
  const patterns = collectRipgrepPatterns(ctx.args, hasPatternFlag);
  if (!patterns.some((pat) => containsPcre2Lookaround(pat))) return;
  ctx.args.unshift('--pcre2');
  if (ctx.payload.type === 'command') ctx.payload.args = [...ctx.args];
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected PCRE2 look-around syntax in 'rg' pattern. Automatically injecting '--pcre2'... (Frictionless Recovery)`);
}

function resolveRgHostCwd(ctx: ExecutionContext): string | null {
  const raw = ctx.payload.cwd !== undefined && ctx.payload.cwd.length > 0 ? ctx.payload.cwd : ctx.cwd;
  if (raw === undefined || raw.length === 0) return process.cwd();
  if (process.platform === 'win32') {
    if ((raw.startsWith('/') && !/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(raw)) || raw.startsWith('~')) return null;
    if (/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(raw)) return path.resolve(convertToWindowsPath(raw));
  }
  return path.resolve(raw);
}

/**
 * [INTENT]: When `rg` receives multiple target paths and at least one concrete target exists on disk,
 * skip unhealed non-existent targets (with an explicit stderr warning) so `rg` exits cleanly instead of code 2.
 */
function pruneNonExistentMultiTargets(
  ctx: ExecutionContext,
  hasHelpOrVersion: boolean,
  hasPatternFlag: boolean,
  hasFiles: boolean,
): void {
  if (ctx.payload.target === 'wsl2' || (hasHelpOrVersion && !hasFiles)) return;
  const hostCwd = resolveRgHostCwd(ctx);
  if (hostCwd === null || !fs.existsSync(hostCwd)) return;
  const posIndices = getPositionalArgIndices('rg', ctx.args);
  const targetIndices = (hasPatternFlag || hasFiles) ? posIndices : posIndices.slice(1);
  if (targetIndices.length < 2) return;
  let existingCount = 0;
  const missingIndices: number[] = [];
  for (const idx of targetIndices) {
    const target = ctx.args[idx];
    if (target === undefined || target.length === 0) continue;
    if (target.includes('*') || target.includes('?') || target === '~' || target.startsWith('~/')) continue;
    if (process.platform === 'win32' && target.startsWith('/') && !/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(target)) continue;
    const candidate = path.isAbsolute(target) ? path.normalize(target) : path.resolve(hostCwd, target);
    if (fs.existsSync(candidate)) existingCount += 1;
    else missingIndices.push(idx);
  }
  if (existingCount === 0 || missingIndices.length === 0) return;
  const missingNames: string[] = [];
  for (let i = missingIndices.length - 1; i >= 0; i--) {
    const rmIdx = missingIndices[i];
    if (rmIdx === undefined) continue;
    const [removed] = ctx.args.splice(rmIdx, 1);
    if (removed !== undefined) missingNames.unshift(removed);
  }
  if (ctx.payload.type === 'command') ctx.payload.args = [...ctx.args];
  console.error(`\n   💡 AGENT HINT: Search target(s) ${missingNames.map(n => `'${n}'`).join(', ')} do not exist on disk.`);
  console.error(`   🛠️ AUTONOMOUS HEALING: Skipping non-existent 'rg' target(s) so search proceeds cleanly against ${existingCount} existing target(s)... (Frictionless Recovery)`);
}

export function handleRipgrepInterception(ctx: ExecutionContext, hasStdin: boolean): void {
  const unbundledFlags = normalizeRipgrepInvocation(ctx);
  const flags = readRipgrepSearchFlags(ctx);
  const hasHelpOrVersion = healRipgrepPatternShape(ctx, hasStdin, flags);
  const postShapeFlags = readRipgrepSearchFlags(ctx);
  healRipgrepPcre2Lookarounds(ctx, postShapeFlags.hasPatternFlag, postShapeFlags.hasFiles, hasHelpOrVersion);
  preferNativeOrWslRipgrep(ctx);
  const postRouteFlags = readRipgrepSearchFlags(ctx);
  pruneNonExistentMultiTargets(ctx, hasHelpOrVersion, postRouteFlags.hasPatternFlag, postRouteFlags.hasFiles);
  const updatedFlags = readRipgrepSearchFlags(ctx);
  appendRipgrepDefaultTarget(ctx, hasStdin, hasHelpOrVersion, updatedFlags.hasPatternFlag, updatedFlags.hasFiles, updatedFlags.positionalArgs);
  finalizeRipgrepArgs(ctx, unbundledFlags, hasHelpOrVersion);
}

// @ts-nocheck
import os from 'node:os';
import path from 'node:path';
import { convertToWindowsPath, convertToWslPath } from '../command-utils.js';
import { configureCwdModuleResolution, rewriteInlineScriptToTempFile } from '../inline-script-healer.js';
import {
  AUTONOMOUS_HEALING_MSG,
  emitInterceptBanner,
  resolveAgentScriptFallback,
  tryAccelerateCompiledCommitScript,
} from '../utils.js';
import { handleRipgrepInterception, parseGrepSearchArgs } from './search-interceptor.js';
import { resolvePackageProjectDir } from './package-manager-js-rewrites.js';
import { AGENT_NATIVE_TOOLS, ECOSYSTEM_MCP_TOOLS, type ExecutionContext } from './types.js';
import { findFirstPkgSubcmdIndex } from './utils.js';

export function healMissingAgentScriptArgs(
  args: string[],
  projectDir: string,
  payload: ExecutionContext['payload'],
): void {
  if (args.some((a) => path.basename(a).toLowerCase() === 'agent-exec.ts')) return;
  for (let i = 0; i < args.length; i++) {
    const rawArg = args[i];
    if (rawArg === undefined || rawArg === '--') break;
    if (rawArg.startsWith('-')) continue;
    const resolved = resolveAgentScriptFallback(rawArg, projectDir);
    if (resolved !== null) {
      args[i] = resolved;
      if ('command' in payload) payload.args = args;
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Resolved missing '${rawArg}' to '${resolved}'... (Frictionless Recovery)`);
      break;
    }
    if (/\.(?:ts|js|mjs|cjs)$/i.test(rawArg)) break;
  }
}

export function tryAccelerateCommitForPm(
  ctx: ExecutionContext,
  cmdBasename: string,
  args: string[],
  projectDir: string,
): boolean {
  if (cmdBasename.startsWith('bun')) return false;
  const accelerated = tryAccelerateCompiledCommitScript(args, projectDir, ctx.payload.target);
  if (accelerated === null) return false;
  const nodeCmd = process.platform === 'win32' && ctx.payload.target !== 'wsl2' ? 'node.exe' : 'node';
  ctx.cmdBasename = nodeCmd;
  args.splice(0, args.length, accelerated.compiledPath, ...accelerated.remainingArgs);
  ctx.args = args;
  if ('command' in ctx.payload) {
    ctx.payload.command = nodeCmd;
    ctx.payload.args = args;
  }
  ctx.payload.bypassInterceptors = true;
  if (ctx.payload.timeoutMs !== 0 && (ctx.payload.timeoutMs === undefined || ctx.payload.timeoutMs < 240000)) {
    ctx.payload.timeoutMs = 240000;
  }
  emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Disabling stall interceptors and extending timeout for deterministic workflow script to prevent false positive aborts.`);
  return true;
}

function isExternalTsScriptArg(arg: string, projectDir: string): boolean {
  if (!/\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/i.test(arg)) return false;
  const resolvedArg = path.resolve(projectDir, arg);
  const normProj = process.platform === 'win32' ? projectDir.toLowerCase() : projectDir;
  const normArg = process.platform === 'win32' ? resolvedArg.toLowerCase() : resolvedArg;
  const rel = path.relative(normProj, normArg);
  const outsideProj = rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  const normTmp = process.platform === 'win32' ? os.tmpdir().toLowerCase() : os.tmpdir();
  const relTmp = path.relative(normTmp, normArg);
  const inTmp = relTmp === '' || (relTmp !== '..' && !relTmp.startsWith(`..${path.sep}`) && !path.isAbsolute(relTmp));
  return outsideProj || inTmp;
}

export function rewriteTsxInvocation(
  ctx: ExecutionContext,
  tsxBin: string,
  args: string[],
  startIdx: number,
  projectDir: string,
): void {
  const rewritten = rewriteInlineScriptToTempFile({
    interpreterName: tsxBin,
    args,
    envOverrides: ctx.envOverrides,
    cwd: projectDir,
    ...(ctx.payload.target !== undefined ? { target: ctx.payload.target } : {}),
    ...(ctx.payload.env !== undefined ? { payloadEnv: ctx.payload.env } : {}),
    startIdx,
    onSync: () => {
      if ('command' in ctx.payload) ctx.payload.args = ctx.args;
    },
  });
  if (rewritten !== null && 'command' in ctx.payload) {
    ctx.payload.args = ctx.args;
  } else if (rewritten === null && args.some((a) => isExternalTsScriptArg(a, projectDir))) {
    configureCwdModuleResolution(ctx.envOverrides, projectDir, tsxBin, ctx.payload.target, ctx.payload.env);
  }
}

export function splitJoinedTestTargetArgs(ctx: ExecutionContext, args: string[]): void {
  let didSplit = false;
  const expandedArgs: string[] = [];
  for (const a of args) {
    if (!a.startsWith('-') && a.includes(' ')) {
      const parts = a.trim().split(/\s+/);
      const allTestTargets = parts.length > 1 && parts.every(p =>
        /\.(?:test|spec)\.[a-zA-Z0-9]+$/i.test(p) ||
        /(?:^|[/\\])(?:tests?|__tests__)(?:[/\\][^\s.]*)?$/i.test(p)
      );
      if (allTestTargets) {
        expandedArgs.push(...parts);
        didSplit = true;
        continue;
      }
    }
    expandedArgs.push(a);
  }
  if (!didSplit) return;
  args.splice(0, args.length, ...expandedArgs);
  if ('command' in ctx.payload) ctx.payload.args = args;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected space-separated test file paths in a single argument. Splitting into individual arguments... (Frictionless Recovery)`);
}

const DLX_PREFIX_VALUE_FLAGS = new Set([
  '-p', '--package', '-c', '--call', '--userconfig', '--cwd', '--dir', '-C', '--prefix', '--filter', '-F',
]);

function findDlxTargetIndex(args: readonly string[], startIdx: number): number {
  for (let i = startIdx; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    if (DLX_PREFIX_VALUE_FLAGS.has(a)) { i++; continue; }
    if (a.startsWith('-')) continue;
    return i;
  }
  return -1;
}

export function translateNativeOrDlxTool(
  ctx: ExecutionContext,
  cmdBasename: string,
  args: string[],
  subCmd: string | undefined,
): boolean {
  if (subCmd && (AGENT_NATIVE_TOOLS as readonly string[]).includes(subCmd)) {
    return handleAgentNativeToolSubcmd(ctx, cmdBasename, args, subCmd);
  }
  if (subCmd && (ECOSYSTEM_MCP_TOOLS as readonly string[]).includes(subCmd)) {
    console.error(`\n   💡 AGENT HINT: '${subCmd}' is an MCP tool, NOT a package manager script or CLI binary. Please call the '${subCmd}' MCP tool via call_mcp_tool instead of executing '${cmdBasename} ${subCmd}'.\n${AUTONOMOUS_HEALING_MSG}`);
    process.exit(1);
  }
  if (subCmd === 'dlx' || subCmd === 'x') {
    const subCmdIdx = findFirstPkgSubcmdIndex(args);
    const targetIdx = subCmdIdx !== -1 ? findDlxTargetIndex(args, subCmdIdx + 1) : -1;
    const targetPkg = targetIdx !== -1 ? args[targetIdx] : undefined;
    if (targetPkg === 'rg' || targetPkg === 'ripgrep' || targetPkg === 'fd' || targetPkg === 'fdfind') {
      return rewriteToolBinary(ctx, `${cmdBasename} ${subCmd}`, args, targetPkg, targetIdx);
    }
  }
  return false;
}

export function rewriteToolBinary(
  ctx: ExecutionContext,
  label: string,
  args: string[],
  targetPkg: string,
  targetIdx: number,
): boolean {
  const isRg = targetPkg === 'rg' || targetPkg === 'ripgrep';
  const mappedCmd = isRg ? 'rg' : 'fd';
  const rawPayloadCwd = ctx.payload.cwd;
  const isPosixWsl = ctx.payload.target === 'wsl2'
    && typeof rawPayloadCwd === 'string'
    && (rawPayloadCwd.startsWith('/') || rawPayloadCwd.startsWith('~'));
  const baseDir = rawPayloadCwd !== undefined && rawPayloadCwd.length > 0
    ? (isPosixWsl ? rawPayloadCwd : path.resolve(rawPayloadCwd))
    : (ctx.cwd !== undefined && ctx.cwd.length > 0 ? path.resolve(ctx.cwd) : process.cwd());
  const prefixDir = resolvePackageProjectDir(args.slice(0, targetIdx), baseDir);
  if (prefixDir !== baseDir) {
    const resolvedPrefixDir = process.platform === 'win32' && ctx.payload.target !== 'wsl2' && /^\/mnt\/[a-zA-Z](?:\/|$)/.test(prefixDir)
      ? convertToWindowsPath(prefixDir)
      : prefixDir;
    ctx.payload.cwd = resolvedPrefixDir;
  }
  ctx.cmdBasename = mappedCmd;
  ctx.args = args.slice(targetIdx + 1);
  if (!isRg && process.platform === 'win32') ctx.payload.target = 'wsl2';
  if ('command' in ctx.payload) {
    ctx.payload.command = mappedCmd;
    ctx.payload.args = ctx.args;
  }
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Auto-translating '${label} ${targetPkg}' to native ${isRg ? 'ripgrep (rg)' : 'fd'}... (Frictionless Recovery)\x1b[0m`);
  if (isRg) handleRipgrepInterception(ctx, Boolean(ctx.payload.stdin));
  return true;
}

function applySubcmdPrefixCwd(ctx: ExecutionContext, args: readonly string[]): string | undefined {
  const subIdx = findFirstPkgSubcmdIndex(args);
  const rawPayloadCwd = ctx.payload.cwd;
  const isPosixWsl = ctx.payload.target === 'wsl2'
    && typeof rawPayloadCwd === 'string'
    && (rawPayloadCwd.startsWith('/') || rawPayloadCwd.startsWith('~'));
  const baseDir = rawPayloadCwd !== undefined && rawPayloadCwd.length > 0
    ? (isPosixWsl ? rawPayloadCwd : path.resolve(rawPayloadCwd))
    : (ctx.cwd !== undefined && ctx.cwd.length > 0 ? path.resolve(ctx.cwd) : process.cwd());
  if (subIdx > 0) {
    const prefixDir = resolvePackageProjectDir(args.slice(0, subIdx), baseDir);
    if (prefixDir !== baseDir) {
      ctx.payload.cwd = process.platform === 'win32' && ctx.payload.target !== 'wsl2' && /^\/mnt\/[a-zA-Z](?:\/|$)/i.test(prefixDir)
        ? convertToWindowsPath(prefixDir)
        : prefixDir;
    }
  }
  const activeCwd = ctx.payload.cwd !== undefined && ctx.payload.cwd.length > 0 ? ctx.payload.cwd : ctx.cwd;
  if (process.platform === 'win32' && activeCwd !== undefined) {
    if ((activeCwd.startsWith('/') && !/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(activeCwd)) || activeCwd.startsWith('~')) {
      return ctx.cwd;
    }
    if (/^\/mnt\/[a-zA-Z](?:\/|$)/i.test(activeCwd)) return convertToWindowsPath(activeCwd);
  }
  return activeCwd;
}

function handleAgentNativeToolSubcmd(
  ctx: ExecutionContext,
  cmdBasename: string,
  args: string[],
  subCmd: string,
): boolean {
  if (subCmd === 'grep_search') {
    translateGrepSearch(ctx, cmdBasename, args, subCmd);
    return true;
  }
  if (subCmd === 'list_dir') {
    applySubcmdPrefixCwd(ctx, args);
    const subIdx = findFirstPkgSubcmdIndex(args);
    const afterSub = subIdx !== -1 ? args.slice(subIdx + 1) : args;
    const pathArg = afterSub.find(a => !a.startsWith('-')) ?? '.';
    const isWin32 = process.platform === 'win32';
    ctx.cmdBasename = 'ls';
    ctx.args = [isWin32 ? convertToWslPath(pathArg) : pathArg];
    if (isWin32) ctx.payload.target = 'wsl2';
    if ('command' in ctx.payload) { ctx.payload.command = 'ls'; ctx.payload.args = ctx.args; }
    console.error(`\n   💡 AGENT HINT: 'list_dir' is an agent-native tool, NOT a package manager script.`);
    console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating '${cmdBasename} ${subCmd}' to ls... (Frictionless Recovery)\x1b[0m`);
    return true;
  }
  if (subCmd === 'view_file') {
    const subIdx = findFirstPkgSubcmdIndex(args);
    const afterSub = subIdx !== -1 ? args.slice(subIdx + 1) : args;
    const fileArg = afterSub.find(a => !a.startsWith('-'));
    if (fileArg) {
      applySubcmdPrefixCwd(ctx, args);
      const isWin32 = process.platform === 'win32';
      ctx.cmdBasename = 'cat';
      ctx.args = [isWin32 ? convertToWslPath(fileArg) : fileArg];
      if (isWin32) ctx.payload.target = 'wsl2';
      if ('command' in ctx.payload) { ctx.payload.command = 'cat'; ctx.payload.args = ctx.args; }
      console.error(`\n   💡 AGENT HINT: 'view_file' is an agent-native tool, NOT a package manager script.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating '${cmdBasename} ${subCmd}' to cat... (Frictionless Recovery)\x1b[0m`);
      return true;
    }
  }
  console.error(`\n   💡 AGENT HINT: '${subCmd}' is an agent-native tool, NOT a package manager script or CLI binary. Please invoke the '${subCmd}' tool directly instead of executing '${cmdBasename} ${subCmd}'.\n${AUTONOMOUS_HEALING_MSG}`);
  process.exit(1);
}

function translateGrepSearch(ctx: ExecutionContext, cmdBasename: string, args: string[], subCmd: string): void {
  const effectiveCwd = applySubcmdPrefixCwd(ctx, args);
  const subIdx = findFirstPkgSubcmdIndex(args);
  const after = subIdx !== -1 ? args.slice(subIdx + 1) : args;
  const parsed = parseGrepSearchArgs(after, effectiveCwd);
  const finalPattern = parsed.pattern;
  const finalPath = parsed.searchPath || '.';
  if (finalPattern.length === 0) {
    console.error(`\n   💡 AGENT HINT: '${subCmd}' is an agent-native tool, NOT a package manager script or CLI binary. Please invoke the '${subCmd}' tool directly instead of executing '${cmdBasename} ${subCmd}'.\n${AUTONOMOUS_HEALING_MSG}`);
    process.exit(1);
  }
  ctx.cmdBasename = 'rg';
  const rgFlags = ['-n'];
  if (parsed.isCaseInsensitive) rgFlags.push('-i');
  if (parsed.isWord) rgFlags.push('-w');
  if (!parsed.isRegex) rgFlags.push('-F');
  if (finalPattern.startsWith('-')) rgFlags.push('-e');
  ctx.args = [...rgFlags, finalPattern, finalPath];
  if ('command' in ctx.payload) { ctx.payload.command = 'rg'; ctx.payload.args = ctx.args; }
  console.error(`\n   💡 AGENT HINT: '${subCmd}' is an agent-native tool, NOT a package manager script.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating '${cmdBasename} ${subCmd}' to ripgrep (rg)... (Frictionless Recovery)\x1b[0m`);
  handleRipgrepInterception(ctx, Boolean(ctx.payload.stdin));
}

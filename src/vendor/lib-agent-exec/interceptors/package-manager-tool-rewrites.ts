// @ts-nocheck
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configureCwdModuleResolution, rewriteInlineScriptToTempFile } from '../inline-script-healer.js';
import {
  AUTONOMOUS_HEALING_MSG,
  emitInterceptBanner,
  resolveAgentScriptFallback,
  tryAccelerateCompiledCommitScript,
} from '../utils.js';
import { handleRipgrepInterception } from './search-interceptor.js';
import { AGENT_NATIVE_TOOLS, ECOSYSTEM_MCP_TOOLS, type ExecutionContext } from './types.js';

export function healMissingAgentScriptArgs(
  args: string[],
  projectDir: string,
  payload: ExecutionContext['payload'],
): void {
  if (args.some((a) => path.basename(a).toLowerCase() === 'agent-exec.ts')) return;
  let mutated = false;
  for (let i = 0; i < args.length; i++) {
    const rawArg = args[i];
    if (rawArg === undefined || rawArg === '--') break;
    if (rawArg.startsWith('-')) continue;
    const resolved = resolveAgentScriptFallback(rawArg, projectDir);
    if (resolved !== null) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Resolved missing '${rawArg}' to '${resolved}'... (Frictionless Recovery)`);
      args[i] = resolved;
      mutated = true;
      break;
    }
    if (/\.(?:ts|js|mjs|cjs)$/i.test(rawArg)) break;
  }
  if (mutated && 'command' in payload) payload.args = args;
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
  emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Disabling stall interceptors and extending timeout for deterministic workflow script to prevent false positive aborts.`);
  ctx.payload.bypassInterceptors = true;
  if (ctx.payload.timeoutMs === undefined || ctx.payload.timeoutMs < 240000) ctx.payload.timeoutMs = 240000;
  return true;
}

function isExternalTsScriptArg(arg: string, projectDir: string): boolean {
  if (!/\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/i.test(arg)) return false;
  const resolvedArg = path.resolve(projectDir, arg);
  const normProj = process.platform === 'win32' ? projectDir.toLowerCase() : projectDir;
  const normArg = process.platform === 'win32' ? resolvedArg.toLowerCase() : resolvedArg;
  const rel = path.relative(normProj, normArg);
  return rel.startsWith('..') || path.isAbsolute(rel) || resolvedArg.startsWith(os.tmpdir());
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
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected space-separated test file paths in a single argument. Splitting into individual arguments... (Frictionless Recovery)`);
  args.splice(0, args.length, ...expandedArgs);
  if ('command' in ctx.payload) ctx.payload.args = args;
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
    const subCmdIdx = args.indexOf(subCmd);
    const afterSubCmd = args.slice(subCmdIdx + 1);
    const targetPkgIdx = afterSubCmd.findIndex(a => !a.startsWith('-'));
    const targetPkg = targetPkgIdx !== -1 ? afterSubCmd[targetPkgIdx] : undefined;
    if (targetPkg === 'rg' || targetPkg === 'ripgrep' || targetPkg === 'fd' || targetPkg === 'fdfind') {
      return rewriteToolBinary(ctx, `${cmdBasename} ${subCmd}`, args, targetPkg, subCmdIdx + 1 + targetPkgIdx, [subCmdIdx]);
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
  extraRemoveIdxs: readonly number[] = [],
): boolean {
  const isRg = targetPkg === 'rg' || targetPkg === 'ripgrep';
  const mappedCmd = isRg ? 'rg' : 'fd';
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Auto-translating '${label} ${targetPkg}' to native ${isRg ? 'ripgrep (rg)' : 'fd'}... (Frictionless Recovery)\x1b[0m`);
  ctx.cmdBasename = mappedCmd;
  const removeSet = new Set([targetIdx, ...extraRemoveIdxs]);
  ctx.args = args.filter((a, idx) => !removeSet.has(idx) && a !== '-y' && a !== '--yes');
  if (!isRg) ctx.payload.target = 'wsl2';
  if ('command' in ctx.payload) {
    ctx.payload.command = mappedCmd;
    ctx.payload.args = ctx.args;
  }
  if (isRg) handleRipgrepInterception(ctx, false);
  return true;
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
    const pathArg = args.slice(args.indexOf(subCmd) + 1).find(a => !a.startsWith('-')) ?? '.';
    console.error(`\n   💡 AGENT HINT: 'list_dir' is an agent-native tool, NOT a package manager script.`);
    console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating '${cmdBasename} ${subCmd}' to ls... (Frictionless Recovery)\x1b[0m`);
    ctx.cmdBasename = 'ls';
    ctx.args = [pathArg];
    ctx.payload.target = 'wsl2';
    if ('command' in ctx.payload) { ctx.payload.command = 'ls'; ctx.payload.args = ctx.args; }
    return true;
  }
  if (subCmd === 'view_file') {
    const fileArg = args.slice(args.indexOf(subCmd) + 1).find(a => !a.startsWith('-'));
    if (fileArg) {
      console.error(`\n   💡 AGENT HINT: 'view_file' is an agent-native tool, NOT a package manager script.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating '${cmdBasename} ${subCmd}' to cat... (Frictionless Recovery)\x1b[0m`);
      ctx.cmdBasename = 'cat';
      ctx.args = [fileArg];
      ctx.payload.target = 'wsl2';
      if ('command' in ctx.payload) { ctx.payload.command = 'cat'; ctx.payload.args = ctx.args; }
      return true;
    }
  }
  console.error(`\n   💡 AGENT HINT: '${subCmd}' is an agent-native tool, NOT a package manager script or CLI binary. Please invoke the '${subCmd}' tool directly instead of executing '${cmdBasename} ${subCmd}'.\n${AUTONOMOUS_HEALING_MSG}`);
  process.exit(1);
}

function translateGrepSearch(ctx: ExecutionContext, cmdBasename: string, args: string[], subCmd: string): void {
  const valueFlagSet = new Set(['-s', '--symbol', '--pattern', '-p', '--path', '-d', '--dir', '--searchpath', '--search-path', '--searchpattern', '--search-pattern', '--targetcontent', '--target-content', '--content']);
  const sIdx = args.findIndex(a => ['-s', '--symbol', '--pattern', '--searchpattern', '--search-pattern', '--targetcontent', '--target-content', '--content'].includes(a.toLowerCase()));
  const pIdx = args.findIndex(a => ['-p', '--path', '-d', '--dir', '--searchpath', '--search-path'].includes(a.toLowerCase()));
  const after = args.slice(args.indexOf(subCmd) + 1);
  const nonFlags: string[] = [];
  for (let i = 0; i < after.length; i++) {
    const a = after[i];
    if (a === undefined) continue;
    if (valueFlagSet.has(a.toLowerCase())) { i++; continue; }
    if (!a.startsWith('-')) nonFlags.push(a);
  }
  let finalPattern = sIdx !== -1 && sIdx + 1 < args.length ? (args[sIdx + 1] ?? '') : (nonFlags[0] ?? '');
  let finalPath = pIdx !== -1 && pIdx + 1 < args.length ? (args[pIdx + 1] ?? '.') : (nonFlags[1] ?? '.');
  if (isLikelyPathArg(finalPattern, ctx.payload.cwd) && !isLikelyPathArg(finalPath, ctx.payload.cwd) && finalPath.length > 0) {
    [finalPattern, finalPath] = [finalPath, finalPattern];
  }
  if (finalPattern.length === 0) {
    console.error(`\n   💡 AGENT HINT: '${subCmd}' is an agent-native tool, NOT a package manager script or CLI binary. Please invoke the '${subCmd}' tool directly instead of executing '${cmdBasename} ${subCmd}'.\n${AUTONOMOUS_HEALING_MSG}`);
    process.exit(1);
  }
  console.error(`\n   💡 AGENT HINT: '${subCmd}' is an agent-native tool, NOT a package manager script.`);
  console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating '${cmdBasename} ${subCmd}' to ripgrep (rg)... (Frictionless Recovery)\x1b[0m`);
  ctx.cmdBasename = 'rg';
  const rgFlags = ['-n'];
  if (args.some(a => a === '-i' || a === '-ri' || a === '-ir' || a === '--case-insensitive' || (a.startsWith('-') && !a.startsWith('--') && a.includes('i')))) rgFlags.push('-i');
  if (args.some(a => a === '-w' || a === '--word-regexp')) rgFlags.push('-w');
  if (!args.some(a => a === '-e' || a === '--regexp')) rgFlags.push('-F');
  ctx.args = [...rgFlags, finalPattern, finalPath];
  if ('command' in ctx.payload) { ctx.payload.command = 'rg'; ctx.payload.args = ctx.args; }
  handleRipgrepInterception(ctx, false);
}

function isLikelyPathArg(s: string, payloadCwd?: string): boolean {
  if (!s) return false;
  const clean = s.trim();
  if (clean === '.' || clean === '..' || clean.startsWith('./') || clean.startsWith('../') || clean.endsWith('/') || clean.endsWith('\\')) return true;
  if (clean.includes('/') || clean.includes('\\') || /^[a-zA-Z]:/.test(clean)) return true;
  try {
    const cwd = payloadCwd !== undefined && payloadCwd.length > 0 ? path.resolve(payloadCwd) : process.cwd();
    return fs.existsSync(path.resolve(cwd, clean)) && fs.statSync(path.resolve(cwd, clean)).isDirectory();
  } catch {
    return false;
  }
}

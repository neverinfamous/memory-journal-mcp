// @ts-nocheck
import path from 'node:path';
import { convertToWindowsPath } from '../command-utils.js';
import { configureCwdModuleResolution, rewriteInlineScriptToTempFile } from '../inline-script-healer.js';
import type { ExecutionContext } from './types.js';

const INLINE_INTERPRETERS = ['node', 'bun', 'python', 'python3', 'tsx', 'ts-node'];

export function rewriteInlineInterpreterScripts(ctx: ExecutionContext, isCommand: boolean, originalCmd: string): void {
  const interpreterName = originalCmd.replace(/\.exe$/i, '').toLowerCase();
  if (!isCommand || !INLINE_INTERPRETERS.includes(interpreterName)) return;
  const cwd = resolveInlineCwd(ctx);
  const rewritten = rewriteInlineScriptToTempFile({
    interpreterName,
    args: ctx.args,
    envOverrides: ctx.envOverrides,
    cwd,
    ...(ctx.payload.target !== undefined ? { target: ctx.payload.target } : {}),
    ...(ctx.payload.env !== undefined ? { payloadEnv: ctx.payload.env } : {}),
  });
  if (rewritten !== null) {
    ctx.cmdBasename = interpreterName;
    if ('command' in ctx.payload) {
      ctx.payload.command = interpreterName;
      ctx.payload.args = ctx.args;
    }
    return;
  }
  if (interpreterName === 'python' || interpreterName === 'python3') return;
  const hasExternalScratchScript = ctx.args.some(arg => /[\\/]\.gemini[\\/][^\\/]+[\\/]brain[\\/]/i.test(arg));
  if (!hasExternalScratchScript) return;
  configureCwdModuleResolution(ctx.envOverrides, cwd, interpreterName, ctx.payload.target, ctx.payload.env);
}

function normalizeHostMntPath(raw: string): string {
  return process.platform === 'win32' && /^\/?mnt\/[a-zA-Z](?:\/|$)/i.test(raw) ? convertToWindowsPath(raw) : raw;
}

function resolveInlineCwd(ctx: ExecutionContext): string {
  const payloadCwd = ctx.payload.cwd?.trim();
  const isNonHostPosix = process.platform === 'win32'
    && payloadCwd !== undefined
    && ((payloadCwd.startsWith('/') && !/^\/mnt\/[a-zA-Z](?:\/|$)/.test(payloadCwd)) || payloadCwd.startsWith('~'));
  if (!isNonHostPosix && payloadCwd !== undefined && payloadCwd.length > 0) {
    return path.resolve(normalizeHostMntPath(payloadCwd));
  }
  if (ctx.cwd !== undefined && ctx.cwd.length > 0) return path.resolve(normalizeHostMntPath(ctx.cwd));
  return process.cwd();
}

// @ts-nocheck
import path from 'node:path';
import { convertToWindowsPath } from '../command-utils.js';
import { configureCwdModuleResolution, rewriteInlineScriptToTempFile } from '../inline-script-healer.js';
import type { ExecutionContext } from './types.js';

const INLINE_INTERPRETER_SET: ReadonlySet<string> = new Set(['node', 'bun', 'python', 'python3', 'tsx', 'ts-node']);

export function rewriteInlineInterpreterScripts(ctx: ExecutionContext, isCommand: boolean, originalCmd: string): void {
  const interpreterName = originalCmd.replace(/\.(?:exe|cmd|bat)$/i, '').toLowerCase();
  if (!isCommand || !INLINE_INTERPRETER_SET.has(interpreterName)) return;
  const { cwd, skipHostProbe } = resolveInlineCwd(ctx);
  const rewritten = rewriteInlineScriptToTempFile({
    interpreterName,
    args: ctx.args,
    envOverrides: ctx.envOverrides,
    cwd,
    skipHostProbe,
    ...(ctx.payload.target !== undefined ? { target: ctx.payload.target } : {}),
    ...(ctx.payload.env !== undefined ? { payloadEnv: ctx.payload.env } : {}),
    onSync: () => {
      if ('command' in ctx.payload) ctx.payload.args = ctx.args;
    },
  });
  if (rewritten !== null) {
    if ('command' in ctx.payload) {
      ctx.payload.args = ctx.args;
    }
    return;
  }
  if (skipHostProbe || interpreterName === 'python' || interpreterName === 'python3') return;
  const hasExternalScratchScript = ctx.args.some(arg => /[\\/]\.gemini[\\/][^\\/]+[\\/]brain[\\/]/i.test(arg));
  if (!hasExternalScratchScript) return;
  configureCwdModuleResolution(ctx.envOverrides, cwd, interpreterName, ctx.payload.target, ctx.payload.env);
}

function normalizeHostMntPath(raw: string): string {
  return process.platform === 'win32' && /^\/?mnt\/[a-zA-Z](?:\/|$)/i.test(raw) ? convertToWindowsPath(raw) : raw;
}

function resolveInlineCwd(ctx: ExecutionContext): { cwd: string; skipHostProbe: boolean } {
  const payloadCwd = ctx.payload.cwd?.trim();
  const isNonHostPosix = process.platform === 'win32'
    && payloadCwd !== undefined
    && ((payloadCwd.startsWith('/') && !/^\/mnt\/[a-zA-Z](?:\/|$)/.test(payloadCwd)) || payloadCwd.startsWith('~'));
  if (isNonHostPosix) return { cwd: process.cwd(), skipHostProbe: true };
  if (payloadCwd !== undefined && payloadCwd.length > 0) {
    return { cwd: path.resolve(normalizeHostMntPath(payloadCwd)), skipHostProbe: false };
  }
  if (ctx.cwd !== undefined && ctx.cwd.length > 0) {
    return { cwd: path.resolve(normalizeHostMntPath(ctx.cwd)), skipHostProbe: false };
  }
  return { cwd: process.cwd(), skipHostProbe: false };
}

// @ts-nocheck
import { convertToWindowsPath, getUnderlyingPackageScript } from '../command-utils.js';
import { emitInterceptBanner } from '../utils.js';
import { resolvePackageProjectDir } from './package-manager-js-rewrites.js';
import { windowsQualityTimeout, wslQualityTimeout } from './system-timeout-flags.js';
import { stripInlineCodeArgs } from './utils.js';
import type { ExecutionContext } from './types.js';

function shouldBumpTimeout(current: number | undefined, floor: number): boolean {
  return current === undefined || (current > 0 && current < floor);
}

export function applyPackageManagerTimeouts(
  ctx: ExecutionContext,
  cmdBasename: string,
  args: string[],
  isPackageResolution: boolean,
  targetScript: string | undefined,
): void {
  const baseDir = ctx.payload.cwd ?? ctx.cwd ?? process.cwd();
  const effectiveDir = resolvePackageProjectDir(args, baseDir);
  const hostEffectiveDir = process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/.test(effectiveDir)
    ? convertToWindowsPath(effectiveDir)
    : effectiveDir;
  const underlyingScript = getUnderlyingPackageScript(cmdBasename, args, hostEffectiveDir);
  const nonInlineArgs = stripInlineCodeArgs(cmdBasename, args);
  const isKnownDeterministic = nonInlineArgs.some(a => /(?:commit\.(?:ts|js)|get-git-history-json\.ts|backup-conversations\.ts)/i.test(a));
  const isBackupConversations = nonInlineArgs.some(a => /backup-conversations\.ts/i.test(a));
  const isPlaywright = !isPackageResolution && !isKnownDeterministic && Boolean(
    (targetScript && /(?:playwright|cypress|\be2e\b|test:e2e|test-e2e)/i.test(targetScript)) ||
    nonInlineArgs.some(a => /(?:playwright|cypress|\be2e\b|test:e2e|test-e2e)/i.test(a)) ||
    (underlyingScript && /(?:playwright|cypress|\be2e\b)/i.test(underlyingScript))
  );
  const isCoverage = !isPackageResolution && !isKnownDeterministic && Boolean(
    (targetScript && /(?:coverage|test:coverage)/i.test(targetScript)) ||
    nonInlineArgs.some(a => /(?:coverage|--coverage|test:coverage)/i.test(a)) ||
    (underlyingScript && /(?:coverage|--coverage)/i.test(underlyingScript))
  );
  const isBuildCommand = !isPackageResolution && !isKnownDeterministic && Boolean(
    (targetScript && /^(?:build(?::.*|-.*)?|compile)$/i.test(targetScript)) ||
    nonInlineArgs.some(a => /^(?:build(?::.*|-.*)?|compile|tsup|esbuild)$/i.test(a)) ||
    (underlyingScript && /\b(?:tsup|esbuild|tsc\s+-b|vite\s+build|next\s+build)\b/i.test(underlyingScript))
  );
  const isLongRunningQualityCheck = !isPackageResolution && Boolean(
    isPlaywright || isCoverage || isKnownDeterministic || isBuildCommand ||
    (targetScript && (
      targetScript.startsWith('test') ||
      ['lint', 'typecheck', 'check', 'build'].includes(targetScript) ||
      targetScript.includes('test') ||
      targetScript.includes('lint') ||
      targetScript.includes('typecheck')
    )) ||
    nonInlineArgs.some(a => /(?:vitest|jest|playwright|cypress|test|lint|typecheck|tsc|build)/i.test(a)) ||
    (underlyingScript && /(?:vitest|jest|playwright|cypress|eslint|tsc|typecheck|test)/i.test(underlyingScript))
  );

  if (isPackageResolution) {
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Disabling stall interceptors and extending timeout for package installation/resolution command to prevent false positive aborts.`);
    ctx.payload.bypassInterceptors = true;
    if (shouldBumpTimeout(ctx.payload.timeoutMs, 300000)) ctx.payload.timeoutMs = 300000;
    return;
  }
  if (isPlaywright) {
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Disabling stall interceptors and extending timeout for Playwright/E2E test to prevent false positive aborts.`);
    ctx.payload.bypassInterceptors = true;
    if (shouldBumpTimeout(ctx.payload.timeoutMs, 600000)) ctx.payload.timeoutMs = 600000;
    return;
  }
  if (isKnownDeterministic) {
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Disabling stall interceptors and extending timeout for deterministic workflow script to prevent false positive aborts.`);
    ctx.payload.bypassInterceptors = true;
    const detTimeout = ctx.payload.target === 'wsl2' ? 90000 : (isBackupConversations ? 1500000 : 240000);
    if (shouldBumpTimeout(ctx.payload.timeoutMs, detTimeout)) ctx.payload.timeoutMs = detTimeout;
    return;
  }
  if (!isLongRunningQualityCheck) return;

  emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Disabling stall interceptors and extending timeout for quality command to prevent false positive aborts.`);
  ctx.payload.bypassInterceptors = true;
  const combinedScript = targetScript ? `${targetScript} ${underlyingScript}` : underlyingScript;
  const targetTimeout = ctx.payload.target === 'wsl2'
    ? wslQualityTimeout(cmdBasename, nonInlineArgs, combinedScript, isCoverage, isBuildCommand)
    : windowsQualityTimeout(cmdBasename, args, nonInlineArgs, combinedScript, isCoverage, isBuildCommand);
  if (shouldBumpTimeout(ctx.payload.timeoutMs, targetTimeout)) {
    ctx.payload.timeoutMs = targetTimeout;
  }
}

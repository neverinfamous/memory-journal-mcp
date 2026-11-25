// @ts-nocheck
import { convertToWindowsPath, getUnderlyingPackageScript } from '../command-utils.js';
import { emitInterceptBanner } from '../utils.js';
import { windowsQualityTimeout, wslQualityTimeout } from './system-timeout-flags.js';
import { stripInlineCodeArgs } from './utils.js';
import type { ExecutionContext } from './types.js';

const DET_WORKFLOW_RE = /(?:commit\.(?:ts|js)|get-git-history-json\.ts|backup-conversations\.ts)/i;
const BACKUP_CONV_RE = /backup-conversations\.ts/i;
const PLAYWRIGHT_E2E_RE = /(?:playwright|cypress|\be2e\b|test:e2e|test-e2e)/i;
const PLAYWRIGHT_SCRIPT_RE = /(?:playwright|cypress|\be2e\b)/i;
const COVERAGE_TARGET_RE = /(?:coverage|test:coverage)/i;
const COVERAGE_ARG_RE = /(?:coverage|--coverage|test:coverage)/i;
const COVERAGE_SCRIPT_RE = /(?:coverage|--coverage)/i;
const BUILD_TARGET_RE = /^(?:build(?::.*|-.*)?|compile)$/i;
const BUILD_ARG_RE = /^(?:build(?::.*|-.*)?|compile|tsup|esbuild)$/i;
const BUILD_SCRIPT_RE = /\b(?:tsup|esbuild|tsc\s+-b|vite\s+build|next\s+build)\b/i;
const QUALITY_ARG_RE = /(?:vitest|jest|playwright|cypress|test|lint|typecheck|tsc|build)/i;
const QUALITY_SCRIPT_RE = /(?:vitest|jest|playwright|cypress|eslint|tsc|typecheck|test)/i;
const MNT_DRIVE_RE = /^\/mnt\/[a-zA-Z](?:\/|$)/;

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
  if (isPackageResolution) {
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Disabling stall interceptors and extending timeout for package installation/resolution command to prevent false positive aborts.`);
    ctx.payload.bypassInterceptors = true;
    if (shouldBumpTimeout(ctx.payload.timeoutMs, 300000)) ctx.payload.timeoutMs = 300000;
    return;
  }
  const nonInlineArgs = stripInlineCodeArgs(cmdBasename, args);
  const isKnownDeterministic = nonInlineArgs.some(a => DET_WORKFLOW_RE.test(a));
  if (isKnownDeterministic) {
    const isBackupConversations = nonInlineArgs.some(a => BACKUP_CONV_RE.test(a));
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Disabling stall interceptors and extending timeout for deterministic workflow script to prevent false positive aborts.`);
    ctx.payload.bypassInterceptors = true;
    const detTimeout = ctx.payload.target === 'wsl2' ? 90000 : (isBackupConversations ? 1500000 : 240000);
    if (shouldBumpTimeout(ctx.payload.timeoutMs, detTimeout)) ctx.payload.timeoutMs = detTimeout;
    return;
  }
  const baseDir = ctx.payload.cwd ?? ctx.cwd ?? process.cwd();
  const hostBaseDir = process.platform === 'win32' && MNT_DRIVE_RE.test(baseDir)
    ? convertToWindowsPath(baseDir)
    : baseDir;
  const underlyingScript = getUnderlyingPackageScript(cmdBasename, args, hostBaseDir);
  const isPlaywright = Boolean(
    (targetScript && PLAYWRIGHT_E2E_RE.test(targetScript)) ||
    nonInlineArgs.some(a => PLAYWRIGHT_E2E_RE.test(a)) ||
    (underlyingScript && PLAYWRIGHT_SCRIPT_RE.test(underlyingScript))
  );
  if (isPlaywright) {
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Disabling stall interceptors and extending timeout for Playwright/E2E test to prevent false positive aborts.`);
    ctx.payload.bypassInterceptors = true;
    if (shouldBumpTimeout(ctx.payload.timeoutMs, 600000)) ctx.payload.timeoutMs = 600000;
    return;
  }
  const isCoverage = Boolean(
    (targetScript && COVERAGE_TARGET_RE.test(targetScript)) ||
    nonInlineArgs.some(a => COVERAGE_ARG_RE.test(a)) ||
    (underlyingScript && COVERAGE_SCRIPT_RE.test(underlyingScript))
  );
  const isBuildCommand = Boolean(
    (targetScript && BUILD_TARGET_RE.test(targetScript)) ||
    nonInlineArgs.some(a => BUILD_ARG_RE.test(a)) ||
    (underlyingScript && BUILD_SCRIPT_RE.test(underlyingScript))
  );
  const isLongRunningQualityCheck = Boolean(
    isCoverage || isBuildCommand ||
    (targetScript && (
      targetScript.startsWith('test') ||
      targetScript === 'lint' ||
      targetScript === 'typecheck' ||
      targetScript === 'check' ||
      targetScript === 'build' ||
      targetScript.includes('test') ||
      targetScript.includes('lint') ||
      targetScript.includes('typecheck')
    )) ||
    nonInlineArgs.some(a => QUALITY_ARG_RE.test(a)) ||
    (underlyingScript && QUALITY_SCRIPT_RE.test(underlyingScript))
  );
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

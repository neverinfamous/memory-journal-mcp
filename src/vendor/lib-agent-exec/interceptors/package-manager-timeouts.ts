// @ts-nocheck
import { getUnderlyingPackageScript } from '../command-utils.js';
import { emitInterceptBanner } from '../utils.js';
import { stripInlineCodeArgs } from './utils.js';
import type { ExecutionContext } from './types.js';

export function applyPackageManagerTimeouts(
  ctx: ExecutionContext,
  cmdBasename: string,
  args: string[],
  isPackageResolution: boolean,
  targetScript: string | undefined,
): void {
  const underlyingScript = getUnderlyingPackageScript(cmdBasename, args, ctx.payload.cwd);
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
    if (ctx.payload.timeoutMs === undefined || ctx.payload.timeoutMs < 300000) ctx.payload.timeoutMs = 300000;
    return;
  }
  if (isPlaywright) {
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Disabling stall interceptors and extending timeout for Playwright/E2E test to prevent false positive aborts.`);
    ctx.payload.bypassInterceptors = true;
    if (ctx.payload.timeoutMs === undefined || ctx.payload.timeoutMs < 600000) ctx.payload.timeoutMs = 600000;
    return;
  }
  if (isKnownDeterministic) {
    emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Disabling stall interceptors and extending timeout for deterministic workflow script to prevent false positive aborts.`);
    ctx.payload.bypassInterceptors = true;
    const detTimeout = ctx.payload.target === 'wsl2' ? 90000 : (isBackupConversations ? 1500000 : 240000);
    if (ctx.payload.timeoutMs === undefined || ctx.payload.timeoutMs < detTimeout) ctx.payload.timeoutMs = detTimeout;
    return;
  }
  if (!isLongRunningQualityCheck) return;

  emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Disabling stall interceptors and extending timeout for quality command to prevent false positive aborts.`);
  ctx.payload.bypassInterceptors = true;
  const targetTimeout = computeQualityTierTimeout(ctx.payload.target, cmdBasename, args, nonInlineArgs, targetScript, underlyingScript, isCoverage, isBuildCommand);
  if (ctx.payload.timeoutMs === undefined || ctx.payload.timeoutMs < targetTimeout) {
    ctx.payload.timeoutMs = targetTimeout;
  }
}

function computeQualityTierTimeout(
  target: ExecutionContext['payload']['target'],
  cmdBasename: string,
  args: readonly string[],
  nonInlineArgs: readonly string[],
  targetScript: string | undefined,
  underlyingScript: string,
  isCoverage: boolean,
  isBuildCommand: boolean,
): number {
  const testFiles = nonInlineArgs.filter(a => /\.(?:test|spec)\.[a-zA-Z0-9]+$/i.test(a));
  const testDirs = nonInlineArgs.filter(a =>
    !a.startsWith('-') &&
    !['run', 'exec', 'test', 'vitest', 'jest', 'pytest', 'playwright', 'cypress', 'coverage'].includes(a.toLowerCase()) &&
    /(?:^|[/\\])(?:tests?|__tests__)(?:[/\\][^\s.]*)?$/i.test(a) &&
    !/\.[a-zA-Z0-9_-]+$/i.test(a)
  );
  const isMultiTest = testFiles.length > 1;
  const isTestDir = testDirs.length > 0;
  const isLargeTestBatch = testDirs.length > 1 || (testDirs.length >= 1 && testFiles.length + testDirs.length > 1) || testFiles.length >= 5;
  const isTestRunner = /(?:vitest|jest|pytest|playwright|cypress)/i.test(cmdBasename) ||
    nonInlineArgs.some(a => /(?:vitest|jest|pytest|playwright|cypress|^test(?::.*|-.*)?$|^coverage(?::.*)?$)/i.test(a)) ||
    Boolean(targetScript && (targetScript.startsWith('test') || targetScript.includes('coverage'))) ||
    Boolean(underlyingScript && /(?:vitest|jest|pytest|playwright|cypress)/i.test(underlyingScript));
  const isFullSuite = isTestRunner && testFiles.length === 0 && !isTestDir;
  const targetFiles = nonInlineArgs.filter(a => !a.startsWith('-') && /\.(?:ts|js|tsx|jsx|json|mjs|cjs)$/i.test(a));
  const nonTestTargetFiles = targetFiles.filter(a => !/\.(?:test|spec)\.[a-zA-Z0-9]+$/i.test(a));
  const hasLargeFile = nonTestTargetFiles.some(a => /(?:api\.ts|codemode|bundle|generated)/i.test(a));
  const isLintOrCheck = /(?:lint|check)/i.test(cmdBasename) ||
    nonInlineArgs.some(a => /(?:lint|check)/i.test(a)) ||
    Boolean(targetScript && /(?:lint|check)/i.test(targetScript)) ||
    Boolean(underlyingScript && /(?:lint|check)/i.test(underlyingScript));
  const isFullLintOrCheck = isLintOrCheck && targetFiles.length === 0;
  const isIsolatedFullSuite = isFullSuite && Boolean(args.includes('--isolate') || (underlyingScript && /--isolate\b/.test(underlyingScript)));

  if (target === 'wsl2') {
    if (isBuildCommand || isFullLintOrCheck || hasLargeFile || isIsolatedFullSuite) return 360000;
    if (isCoverage || isLargeTestBatch) return 300000;
    if (isMultiTest || isTestDir || isFullSuite) return 180000;
    return 90000;
  }
  if (isBuildCommand || isFullLintOrCheck || hasLargeFile || isIsolatedFullSuite || isCoverage || isFullSuite) return 600000;
  if (isLargeTestBatch) return 480000;
  if (isTestDir) return 360000;
  if (isMultiTest || targetFiles.length > 1) return 300000;
  return 240000;
}

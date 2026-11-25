// @ts-nocheck
import path from 'node:path';
import type { ExecPayload } from '../schema.js';
import { stripInlineCodeArgs } from './utils.js';

const NON_RUNNER_CLIS = [
  'rg', 'ripgrep', 'grep', 'egrep', 'fgrep', 'select-string',
  'find', 'fd', 'fdfind', 'ls', 'dir', 'get-childitem', 'gci', 'tree',
  'cat', 'get-content', 'head', 'tail', 'wc', 'sort', 'uniq', 'tee',
  'jq', 'yq', 'sed', 'awk', 'gawk', 'git', 'gh', 'curl', 'wget',
  'rm', 'rmdir', 'cp', 'mv', 'mkdir', 'touch', 'chmod', 'diff',
];

const TEST_RUNNER_WORDS = ['run', 'exec', 'test', 'vitest', 'jest', 'pytest', 'playwright', 'cypress', 'coverage'];

export interface WslCommandProfile {
  isDockerScout: boolean;
  isPlaywright: boolean;
  isDockerBuild: boolean;
  isKnownDeterministic: boolean;
  isQuality: boolean;
  isSearch: boolean;
  isCoverage: boolean;
  nonInlineArgs: string[];
}

export interface WindowsCommandProfile {
  isPlaywright: boolean;
  isDocker: boolean;
  isInfraOrchestration: boolean;
  isKnownDeterministic: boolean;
  isBackupConversations: boolean;
  isQuality: boolean;
  isCoverage: boolean;
  nonInlineArgs: string[];
}

export function maybeSplitJoinedTestArgs(
  cmdBasename: string,
  args: string[],
  underlyingScript: string,
  payload: ExecPayload,
  isNestedAgentExec: boolean,
): void {
  if (isNestedAgentExec || !isJoinedTestSplitTarget(cmdBasename, args, underlyingScript)) return;
  const expandedArgs = expandJoinedTestArgs(args);
  if (expandedArgs === null) return;
  args.splice(0, args.length, ...expandedArgs);
  if ('args' in payload) payload.args = args;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected space-separated test file paths in a single argument. Splitting into individual arguments... (Frictionless Recovery)`);
}

const NESTED_RUNNER_VALUE_FLAGS = new Set([
  '-C', '--dir', '--cwd', '--prefix', '-F', '--filter', '--package',
  '-r', '--require', '--import', '--preload', '--env-file', '--conditions',
  '--tsconfig', '--tsconfig-override', '--config', '-c',
]);
const NESTED_RUNNER_SUBCMDS = new Set(['run', 'exec', 'x', 'dlx']);
const NESTED_JS_WRAPPERS = new Set(['bun', 'node', 'tsx', 'ts-node', 'deno']);

export function nestedAgentExec(args: readonly string[], startIdx = 0, outerCmdBasename?: string): boolean {
  let sawSubcmd = false;
  let sawWrapper = false;
  let seenDoubleDash = false;
  const isOuterJsRuntime = outerCmdBasename !== undefined && NESTED_JS_WRAPPERS.has(path.basename(outerCmdBasename).toLowerCase().replace(/\.(?:exe|cmd)$/i, ''));
  for (let i = startIdx; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    const low = arg.toLowerCase();
    if (!seenDoubleDash && arg === '--') { seenDoubleDash = true; continue; }
    if (!seenDoubleDash && arg.startsWith('-')) {
      if (low === '-e' || low === '--eval' || low === '--print' || low.startsWith('--eval=') || low.startsWith('--print=')) {
        return false;
      }
      if (low === '-p') { if (isOuterJsRuntime || sawWrapper) return false; i++; continue; }
      if (!arg.includes('=') && NESTED_RUNNER_VALUE_FLAGS.has(arg)) i++;
      continue;
    }
    if (!sawSubcmd && !sawWrapper && NESTED_RUNNER_SUBCMDS.has(low)) { sawSubcmd = true; continue; }
    const base = path.basename(arg).toLowerCase();
    if (base === 'agent-exec.ts' || base === 'agent-exec.js') return true;
    const noExt = base.replace(/\.(?:exe|cmd)$/i, '');
    if (!sawWrapper && NESTED_JS_WRAPPERS.has(noExt)) { sawWrapper = true; continue; }
    return false;
  }
  return false;
}

export function wslCommandProfile(
  cmdBasename: string,
  args: string[],
  underlyingScript: string,
  isNestedAgentExec: boolean,
): WslCommandProfile {
  const isWslNonRunnerCli = NON_RUNNER_CLIS.includes(cmdBasename.toLowerCase().replace(/\.(?:exe|cmd|bat)$/i, ''));
  const isKnownDeterministic = knownDeterministic(cmdBasename, args, isWslNonRunnerCli);
  const nonInlineArgs = stripInlineCodeArgs(cmdBasename, args);
  const isDockerScout = /(?:docker|docker-compose|podman)/i.test(cmdBasename) && nonInlineArgs.some(arg => /scout/i.test(arg));
  const isInfraOrchestration = infraOrchestration(cmdBasename, nonInlineArgs, underlyingScript, isKnownDeterministic, isWslNonRunnerCli);
  const isDockerBuild = !isDockerScout && ((/(?:docker|docker-compose|podman)/i.test(cmdBasename) && nonInlineArgs.some(arg => /^(?:build|pull|push|up|down|restart|recreate|load|save|import|export|prune)$/i.test(arg))) || isInfraOrchestration);
  const isPlaywright = !isKnownDeterministic && !isWslNonRunnerCli && playwrightSignal(cmdBasename, nonInlineArgs, underlyingScript);
  const isCoverage = !isKnownDeterministic && !isWslNonRunnerCli && coverageSignal(cmdBasename, nonInlineArgs, underlyingScript);
  const isQuality = !isNestedAgentExec && !isKnownDeterministic && !isWslNonRunnerCli && !isDockerScout && !isDockerBuild && qualitySignal(cmdBasename, nonInlineArgs, underlyingScript);
  const isSearch = /\b(?:find|grep|rg|ls|tree)\b/i.test(cmdBasename) || nonInlineArgs.some(arg => /\b(?:find|grep|rg|ls|tree)\b/i.test(arg));
  return { isDockerScout, isPlaywright, isDockerBuild, isKnownDeterministic, isQuality, isSearch, isCoverage, nonInlineArgs };
}

export function windowsCommandProfile(
  cmdBasename: string,
  args: string[],
  underlyingScript: string,
  isNestedAgentExec: boolean,
): WindowsCommandProfile {
  const isWinNonRunnerCli = NON_RUNNER_CLIS.includes(cmdBasename.toLowerCase().replace(/\.(?:exe|cmd|bat)$/i, ''));
  const isKnownDeterministic = knownDeterministic(cmdBasename, args, isWinNonRunnerCli);
  const isBackupConversations = /backup-conversations\.ts/i.test(cmdBasename) || args.some(arg => /backup-conversations\.ts/i.test(arg));
  const nonInlineArgs = stripInlineCodeArgs(cmdBasename, args);
  const isInfraOrchestration = infraOrchestration(cmdBasename, nonInlineArgs, underlyingScript, isKnownDeterministic, isWinNonRunnerCli);
  const isDocker = (/(?:docker|docker-compose|podman)/i.test(cmdBasename) && nonInlineArgs.some(arg => /^(?:build|scout|pull|push|up|down|restart|recreate|load|save|import|export|prune)$/i.test(arg))) || isInfraOrchestration;
  const isPlaywright = !isKnownDeterministic && !isWinNonRunnerCli && playwrightSignal(cmdBasename, nonInlineArgs, underlyingScript);
  const isCoverage = !isKnownDeterministic && !isWinNonRunnerCli && coverageSignal(cmdBasename, nonInlineArgs, underlyingScript);
  const isQuality = !isNestedAgentExec && !isKnownDeterministic && !isWinNonRunnerCli && !isDocker && qualitySignal(cmdBasename, nonInlineArgs, underlyingScript);
  return { isPlaywright, isDocker, isInfraOrchestration, isKnownDeterministic, isBackupConversations, isQuality, isCoverage, nonInlineArgs };
}

export function wslQualityTimeout(
  cmdBasename: string,
  nonInlineArgs: string[],
  underlyingScript: string,
  isCoverage: boolean,
  isBuildCommand = false,
): number {
  const gate = qualityGate(cmdBasename, nonInlineArgs, underlyingScript);
  const isLargeTestBatch = gate.testDirs.length > 1 || (gate.testDirs.length >= 1 && gate.testFiles.length + gate.testDirs.length > 1) || gate.testFiles.length >= 5;
  if (gate.isFullLintOrCheck || gate.hasLargeFile || isBuildCommand) return 360000;
  if (isCoverage || isLargeTestBatch) return 300000;
  if (gate.testFiles.length > 1 || gate.testDirs.length > 0 || gate.isFullSuite) return 180000;
  return 90000;
}

export function windowsQualityTimeout(
  cmdBasename: string,
  args: string[],
  nonInlineArgs: string[],
  underlyingScript: string,
  isCoverage: boolean,
  isBuildCommand = false,
): number {
  const gate = qualityGate(cmdBasename, nonInlineArgs, underlyingScript);
  const isLargeTestBatch = gate.testDirs.length > 1 || (gate.testDirs.length >= 1 && gate.testFiles.length + gate.testDirs.length > 1) || gate.testFiles.length >= 5;
  const isIsolatedFullSuite = gate.isFullSuite && (args.includes('--isolate') || /--isolate\b/.test(underlyingScript));
  if (gate.isFullLintOrCheck || gate.hasLargeFile || isIsolatedFullSuite || isCoverage || gate.isFullSuite || isBuildCommand) return 600000;
  if (isLargeTestBatch) return 480000;
  if (gate.testDirs.length > 0) return 360000;
  if (gate.testFiles.length > 1 || gate.targetFiles.length > 1) return 300000;
  return 240000;
}

function knownDeterministic(cmdBasename: string, args: string[], isNonRunnerCli: boolean): boolean {
  if (isNonRunnerCli) return false;
  if (/(?:commit\.(?:ts|js)|get-git-history-json\.ts|backup-conversations\.ts)/i.test(cmdBasename)) return true;
  return args.some(arg => /(?:commit\.(?:ts|js)|get-git-history-json\.ts|backup-conversations\.ts)/i.test(arg));
}

function infraOrchestration(
  cmdBasename: string,
  nonInlineArgs: string[],
  underlyingScript: string,
  isKnownDeterministic: boolean,
  isNonRunnerCli: boolean,
): boolean {
  if (isKnownDeterministic || isNonRunnerCli) return false;
  if (/recreate-ecosystem/i.test(cmdBasename)) return true;
  if (nonInlineArgs.some(arg => /recreate-ecosystem/i.test(arg))) return true;
  return /recreate-ecosystem/i.test(underlyingScript);
}

function playwrightSignal(cmdBasename: string, nonInlineArgs: string[], underlyingScript: string): boolean {
  if (/(?:playwright|cypress)/i.test(cmdBasename)) return true;
  if (nonInlineArgs.some(arg => /(?:playwright|cypress|\be2e\b|test:e2e|test-e2e)/i.test(arg))) return true;
  return /(?:playwright|cypress|\be2e\b)/i.test(underlyingScript);
}

function coverageSignal(cmdBasename: string, nonInlineArgs: string[], underlyingScript: string): boolean {
  if (/(?:coverage)/i.test(cmdBasename)) return true;
  if (nonInlineArgs.some(arg => /(?:coverage|--coverage|test:coverage)/i.test(arg))) return true;
  return /(?:coverage|--coverage)/i.test(underlyingScript);
}

function qualitySignal(cmdBasename: string, nonInlineArgs: string[], underlyingScript: string): boolean {
  if (/(?:typecheck|tsc|lint|check|build|test|vitest|jest)/i.test(cmdBasename)) return true;
  if (nonInlineArgs.some(arg => /(?:typecheck|tsc|lint|check|build|test|vitest|jest)/i.test(arg))) return true;
  return /(?:typecheck|tsc|lint|check|build|test|vitest|jest)/i.test(underlyingScript);
}

interface QualityGate {
  testFiles: string[];
  testDirs: string[];
  targetFiles: string[];
  hasLargeFile: boolean;
  isFullSuite: boolean;
  isFullLintOrCheck: boolean;
}

const LINT_DIR_TARGET_RE = /^(?:\.{1,2}|src|tests?|__tests__|scripts|packages|apps|lib|\.agents)$/i;
const LINT_RUNNER_WORDS = new Set(['run', 'exec', 'x', 'dlx', 'eslint', 'lint', 'check']);
const LINT_SKIP_VALUE_FLAGS = new Set([
  '-C', '--dir', '--cwd', '--prefix', '-F', '--filter',
  '-c', '--config', '-f', '--format', '--ext', '-o', '--output-file',
  '--cache-location', '--cache-strategy', '--ignore-path', '--ignore-pattern', '--max-warnings',
]);

function isLintDirTargetArg(arg: string): boolean {
  if (arg.startsWith('-') || LINT_RUNNER_WORDS.has(arg.toLowerCase())) return false;
  if (/\.(?:ts|js|tsx|jsx|json|mjs|cjs|mts|cts)$/i.test(arg)) return false;
  if (arg.endsWith('/') || arg.endsWith('\\')) return true;
  const trimmed = arg.replace(/[\\/]+$/, '');
  return LINT_DIR_TARGET_RE.test(trimmed);
}

function hasLintDirTargetArg(nonInlineArgs: readonly string[]): boolean {
  for (let i = 0; i < nonInlineArgs.length; i++) {
    const arg = nonInlineArgs[i];
    if (arg === undefined) continue;
    if (arg === '--') return nonInlineArgs.slice(i + 1).some(isLintDirTargetArg);
    if (arg.startsWith('-')) {
      if (!arg.includes('=') && LINT_SKIP_VALUE_FLAGS.has(arg)) i += 1;
      continue;
    }
    if (isLintDirTargetArg(arg)) return true;
  }
  return false;
}

function qualityGate(cmdBasename: string, nonInlineArgs: string[], underlyingScript: string): QualityGate {
  const testFiles = nonInlineArgs.filter(arg => /\.(?:test|spec)\.[a-zA-Z0-9]+$/i.test(arg));
  const testDirs = nonInlineArgs.filter(arg => isTestDirArg(arg));
  const targetFiles = nonInlineArgs.filter(arg => !arg.startsWith('-') && /\.(?:ts|js|tsx|jsx|json|mjs|cjs)$/i.test(arg));
  const isTestRunner = isNamedTestRunner(cmdBasename, nonInlineArgs, underlyingScript);
  const isFullSuite = isTestRunner && testFiles.length === 0 && testDirs.length === 0;
  const isLintOrCheck = matchesLintOrCheck(cmdBasename, nonInlineArgs, underlyingScript);
  const hasLintDirTarget = isLintOrCheck && hasLintDirTargetArg(nonInlineArgs);
  return {
    testFiles,
    testDirs,
    targetFiles,
    hasLargeFile: targetFiles.some(arg => /(?:api\.ts|codemode|bundle|generated)/i.test(arg)),
    isFullSuite,
    isFullLintOrCheck: isLintOrCheck && (targetFiles.length === 0 || hasLintDirTarget),
  };
}

function isTestDirArg(arg: string): boolean {
  if (arg.startsWith('-') || TEST_RUNNER_WORDS.includes(arg.toLowerCase())) return false;
  if (!/(?:^|[/\\])(?:tests?|__tests__)(?:[/\\][^\s.]*)?$/i.test(arg)) return false;
  return !/\.[a-zA-Z0-9_-]+$/i.test(arg);
}

function isNamedTestRunner(cmdBasename: string, nonInlineArgs: string[], underlyingScript: string): boolean {
  if (/(?:vitest|jest|pytest|playwright|cypress)/i.test(cmdBasename)) return true;
  if (nonInlineArgs.some(arg => /(?:vitest|jest|pytest|playwright|cypress|^test(?::.*|-.*)?$|^coverage(?::.*)?$)/i.test(arg))) return true;
  return /(?:vitest|jest|pytest|playwright|cypress)/i.test(underlyingScript);
}

function matchesLintOrCheck(cmdBasename: string, nonInlineArgs: string[], underlyingScript: string): boolean {
  if (/(?:lint|check)/i.test(cmdBasename)) return true;
  if (nonInlineArgs.some(arg => /(?:lint|check)/i.test(arg))) return true;
  return /(?:lint|check)/i.test(underlyingScript);
}

function isJoinedTestSplitTarget(cmdBasename: string, args: string[], underlyingScript: string): boolean {
  return isNamedTestRunner(cmdBasename, args, underlyingScript);
}

function expandJoinedTestArgs(args: string[]): string[] | null {
  let didSplit = false;
  const expandedArgs: string[] = [];
  for (const arg of args) {
    const parts = splitTestTargetArg(arg);
    if (parts !== null) {
      expandedArgs.push(...parts);
      didSplit = true;
      continue;
    }
    expandedArgs.push(arg);
  }
  if (!didSplit) return null;
  return expandedArgs;
}

function splitTestTargetArg(arg: string): string[] | null {
  if (arg.startsWith('-') || !arg.includes(' ')) return null;
  const parts = arg.trim().split(/\s+/);
  if (parts.length <= 1) return null;
  const allTestTargets = parts.every(part =>
    /\.(?:test|spec)\.[a-zA-Z0-9]+$/i.test(part) ||
    /(?:^|[/\\])(?:tests?|__tests__)(?:[/\\][^\s.]*)?$/i.test(part),
  );
  if (!allTestTargets) return null;
  return parts;
}

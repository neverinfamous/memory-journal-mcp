// @ts-nocheck
import type { ExecPayload } from '../schema.js';
import { getUnderlyingPackageScript } from '../command-utils.js';
import { emitInterceptBanner } from '../utils.js';
import type { SystemCommandDerived } from './system-command-context.js';
import {
  maybeSplitJoinedTestArgs,
  nestedAgentExec,
  windowsCommandProfile,
  windowsQualityTimeout,
  wslCommandProfile,
  wslQualityTimeout,
} from './system-timeout-flags.js';

const INLINE_SHELL_RE = /^\s*(?:pwsh|powershell|cmd|bash|sh|wsl)(?:\.exe)?\b/i;

interface ScriptFlags {
  isInlineShellHallucination: boolean;
  isKnownDeterministic: boolean;
  isBackupConversations: boolean;
  isPlaywright: boolean;
  isCoverage: boolean;
  isDockerScout: boolean;
  isDockerBuild: boolean;
  isDocker: boolean;
  isChainedQuality: boolean;
  hasQualityCheck: boolean;
  hasMountedSearch: boolean;
}

export function extendPayloadTimeouts(derived: SystemCommandDerived): void {
  if (derived.payload.target === 'wsl2') {
    const defaultWslTimeout = derived.payload.type === 'command'
      ? wslCommandTimeout(derived)
      : wslNonCommandTimeout(derived.payload);
    derived.payload.timeoutMs = Math.max(derived.payload.timeoutMs || defaultWslTimeout, defaultWslTimeout);
    return;
  }
  if (derived.payload.type === 'eval' || derived.payload.type === 'script') {
    applyWindowsScriptTimeout(derived.payload);
    return;
  }
  if (derived.payload.type === 'command') {
    applyWindowsCommandTimeout(derived);
  }
}

function wslNonCommandTimeout(payload: ExecPayload): number {
  if (payload.type !== 'eval' && payload.type !== 'script') return 30000;
  return wslScriptTimeout(payload);
}

function wslCommandTimeout(derived: SystemCommandDerived): number {
  const { payload, cmdBasename, args } = derived;
  const underlyingScript = getUnderlyingPackageScript(cmdBasename, args, payload.cwd);
  const isNestedAgentExec = nestedAgentExec(args);
  maybeSplitJoinedTestArgs(cmdBasename, args, underlyingScript, payload, isNestedAgentExec);
  const profile = wslCommandProfile(cmdBasename, args, underlyingScript, isNestedAgentExec);
  if (profile.isDockerScout) {
    payload.bypassInterceptors = true;
    return 1800000;
  }
  if (profile.isPlaywright || profile.isDockerBuild) {
    payload.bypassInterceptors = true;
    return 600000;
  }
  if (profile.isKnownDeterministic) {
    payload.bypassInterceptors = true;
    return 90000;
  }
  if (profile.isQuality) {
    payload.bypassInterceptors = true;
    return wslQualityTimeout(cmdBasename, profile.nonInlineArgs, underlyingScript, profile.isCoverage);
  }
  if (profile.isSearch) return 90000;
  return 30000;
}

function wslScriptTimeout(payload: ExecPayload): number {
  const flags = scriptFlags(payload);
  if (flags.isPlaywright) return bannerTimeout(payload, 600000, `\n   💡 AGENT INTERCEPT: Detected Playwright/E2E test in WSL2 eval payload. Auto-extending timeout to 600s...`);
  if (flags.isDockerScout) return bannerTimeout(payload, 1800000, `\n   💡 AGENT INTERCEPT: Detected Docker scout in WSL2 eval payload. Auto-extending timeout to 1800s...`);
  if (flags.isDockerBuild) return bannerTimeout(payload, 600000, `\n   💡 AGENT INTERCEPT: Detected Docker build/ecosystem orchestration in WSL2 eval payload. Auto-extending timeout to 600s...`);
  if (flags.isCoverage) return bannerTimeout(payload, 300000, `\n   💡 AGENT INTERCEPT: Detected test coverage in WSL2 eval payload. Auto-extending timeout to 300s...`);
  if (flags.isChainedQuality) return bannerTimeout(payload, 180000, `\n   💡 AGENT INTERCEPT: Detected chained quality checks in WSL2 eval payload. Auto-extending timeout to 180s...`);
  if (flags.hasQualityCheck || flags.isKnownDeterministic) {
    return bannerTimeout(payload, 90000, `\n   💡 AGENT INTERCEPT: Detected quality check or deterministic script in WSL2 eval payload. Auto-extending timeout to 90s...`);
  }
  if (flags.hasMountedSearch) {
    return searchBannerTimeout(payload, 90000, `\n   💡 AGENT INTERCEPT: Detected file search across mounted filesystem in WSL2 eval payload. Auto-extending timeout to 90s...`);
  }
  return 30000;
}

function applyWindowsScriptTimeout(payload: ExecPayload): void {
  const codeOrScript = codeOrScriptOf(payload);
  const flags = scriptFlags(payload);
  if (flags.isPlaywright) {
    assignBannerTimeout(payload, 600000, `\n   💡 AGENT INTERCEPT: Detected Playwright/E2E test in Windows eval payload. Auto-extending timeout to 600s...`);
    return;
  }
  if (flags.isDocker) {
    assignBannerTimeout(payload, 600000, `\n   💡 AGENT INTERCEPT: Detected Docker build/scout or ecosystem orchestration in Windows eval payload. Auto-extending timeout to 600s...`);
    return;
  }
  if (flags.isCoverage) {
    assignBannerTimeout(payload, 600000, `\n   💡 AGENT INTERCEPT: Detected test coverage in Windows eval payload. Auto-extending timeout to 600s...`);
    return;
  }
  if (flags.isChainedQuality) {
    assignBannerTimeout(payload, 600000, `\n   💡 AGENT INTERCEPT: Detected chained quality checks in Windows eval payload. Auto-extending timeout to 600s...`);
    return;
  }
  if (!flags.hasQualityCheck && !flags.isKnownDeterministic) return;
  const isFullLintOrCheck = Boolean(codeOrScript && /(?:lint|check)/i.test(codeOrScript) && !/\.(?:ts|js|tsx|jsx)\b/i.test(codeOrScript));
  const hasLargeFile = Boolean(codeOrScript && /(?:api\.ts|codemode|bundle|generated)/i.test(codeOrScript));
  const qualityTimeout = flags.isBackupConversations ? 1500000 : ((isFullLintOrCheck || hasLargeFile) ? 600000 : 240000);
  assignBannerTimeout(payload, qualityTimeout, `\n   💡 AGENT INTERCEPT: Detected quality check or deterministic script in Windows eval payload. Auto-extending timeout to ${qualityTimeout / 1000}s...`);
}

function applyWindowsCommandTimeout(derived: SystemCommandDerived): void {
  const { payload, cmdBasename, args } = derived;
  const underlyingScript = getUnderlyingPackageScript(cmdBasename, args, payload.cwd);
  const isNestedAgentExec = nestedAgentExec(args);
  maybeSplitJoinedTestArgs(cmdBasename, args, underlyingScript, payload, isNestedAgentExec);
  const profile = windowsCommandProfile(cmdBasename, args, underlyingScript, isNestedAgentExec);
  if (profile.isPlaywright || profile.isDocker) {
    if (profile.isInfraOrchestration) {
      emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Detected ecosystem orchestration script ('recreate-ecosystem'). Auto-extending timeout to 600s...`);
    }
    payload.timeoutMs = Math.max(payload.timeoutMs || 600000, 600000);
    payload.bypassInterceptors = true;
    return;
  }
  if (profile.isKnownDeterministic) {
    const detTimeout = profile.isBackupConversations ? 1500000 : 240000;
    payload.timeoutMs = Math.max(payload.timeoutMs || detTimeout, detTimeout);
    payload.bypassInterceptors = true;
    return;
  }
  if (!profile.isQuality) return;
  const winTimeout = windowsQualityTimeout(cmdBasename, args, profile.nonInlineArgs, underlyingScript, profile.isCoverage);
  payload.timeoutMs = Math.max(payload.timeoutMs || winTimeout, winTimeout);
  payload.bypassInterceptors = true;
}

function scriptFlags(payload: ExecPayload): ScriptFlags {
  const codeOrScript = codeOrScriptOf(payload);
  const isEval = payload.type === 'eval';
  const isInlineShellHallucination = isEval && INLINE_SHELL_RE.test(codeOrScript);
  const isKnownDeterministic = !isInlineShellHallucination && Boolean(codeOrScript && /(?:commit\.(?:ts|js)|get-git-history-json\.ts|backup-conversations\.ts)/i.test(codeOrScript));
  const isBackupConversations = !isInlineShellHallucination && Boolean(codeOrScript && /backup-conversations\.ts/i.test(codeOrScript));
  const isPlaywright = !isInlineShellHallucination && !isKnownDeterministic && Boolean(codeOrScript && /(?:playwright|cypress|\be2e\b|test:e2e)/i.test(codeOrScript));
  const isCoverage = !isInlineShellHallucination && !isKnownDeterministic && Boolean(codeOrScript && /(?:coverage|--coverage)/i.test(codeOrScript));
  const isDockerScout = !isInlineShellHallucination && Boolean(codeOrScript && /(?:docker|docker-compose|podman)/i.test(codeOrScript) && /scout/i.test(codeOrScript));
  const isDockerBuild = !isInlineShellHallucination && !isDockerScout && Boolean(codeOrScript && (((/(?:docker|docker-compose|podman)/i.test(codeOrScript) && /\b(?:build|pull|push|up|down|restart|recreate|load|save|import|export|prune)\b|Health\.Status/i.test(codeOrScript)) || /recreate-ecosystem/i.test(codeOrScript))));
  const isDocker = !isInlineShellHallucination && Boolean(codeOrScript && (((/(?:docker|docker-compose|podman)/i.test(codeOrScript) && /\b(?:build|scout|pull|push|up|down|restart|recreate|load|save|import|export|prune)\b|Health\.Status/i.test(codeOrScript)) || /recreate-ecosystem/i.test(codeOrScript))));
  const isChainedQuality = !isInlineShellHallucination && isEval && Boolean(codeOrScript && /(?:typecheck|tsc|lint|check|build|test).*(?:&&|;).*(?:typecheck|tsc|lint|check|build|test)/i.test(codeOrScript));
  const hasQualityCheck = !isInlineShellHallucination && isEval && Boolean(codeOrScript && /(?:(?:bun|pnpm|npm|yarn|npx|bunx|pnpx)\s+(?:run\s+)?(?:typecheck|tsc|lint|check|build|test)\b|\b(?:vitest|jest|tsc|eslint)\b)/i.test(codeOrScript));
  const hasMountedSearch = !isInlineShellHallucination && Boolean(codeOrScript && /(?:find|grep|rg|ls|tree)\b/i.test(codeOrScript));
  return {
    isInlineShellHallucination,
    isKnownDeterministic,
    isBackupConversations,
    isPlaywright,
    isCoverage,
    isDockerScout,
    isDockerBuild,
    isDocker,
    isChainedQuality,
    hasQualityCheck,
    hasMountedSearch,
  };
}

function codeOrScriptOf(payload: ExecPayload): string {
  if (payload.type === 'eval') return payload.code;
  if (payload.type === 'script') return payload.scriptPath || '';
  return '';
}

function bannerTimeout(payload: ExecPayload, timeout: number, banner: string): number {
  if (payload.timeoutMs === undefined || payload.timeoutMs < timeout) {
    emitInterceptBanner(banner);
  }
  payload.bypassInterceptors = true;
  return timeout;
}

function searchBannerTimeout(payload: ExecPayload, timeout: number, banner: string): number {
  if (payload.timeoutMs === undefined || payload.timeoutMs < timeout) {
    emitInterceptBanner(banner);
  }
  return timeout;
}

function assignBannerTimeout(payload: ExecPayload, timeout: number, banner: string): void {
  if (payload.timeoutMs === undefined || payload.timeoutMs < timeout) {
    emitInterceptBanner(banner);
  }
  payload.timeoutMs = Math.max(payload.timeoutMs || timeout, timeout);
  payload.bypassInterceptors = true;
}

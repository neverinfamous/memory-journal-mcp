// @ts-nocheck
import { type ExitCodeAnalysis } from './exit-code-policy.js';
import { AUTONOMOUS_HEALING_MSG, BUILT_INS } from './utils.js';

export function isErrnoException(e: Error): e is NodeJS.ErrnoException {
  return 'code' in e || 'syscall' in e;
}

/**
 * [INTENT]: Clamp non-zero exit codes to POSIX uint8 range `1..255` so modulo-256 truncation cannot wrap to `0`.
 */
export function clampNonZeroExitCode(exitCode: unknown): number {
  return typeof exitCode === 'number' && Number.isInteger(exitCode) && exitCode >= 1 && exitCode <= 255
    ? exitCode
    : 1;
}

/**
 * [INTENT]: Resolve final exit code across abort/timeout guards and structured JSON envelopes.
 */
export function resolveFinalExitCode(
  abortedOrTimedOut: boolean,
  code: number | null,
  signal: NodeJS.Signals | null,
  envData: Record<string, unknown> | null,
): number | null {
  if (abortedOrTimedOut) {
    if (code === null && signal !== null) return null;
    return typeof code === 'number' && code !== 0 ? clampNonZeroExitCode(code) : 1;
  }
  if (envData === null) return code;
  const status = envData['status'];
  const exitCode = envData['exit_code'];
  if (status === 'error' || (typeof exitCode === 'number' && exitCode !== 0)) {
    return typeof exitCode === 'number' && exitCode !== 0 ? clampNonZeroExitCode(exitCode) : 1;
  }
  if (status === 'success' && signal === null) {
    return 0;
  }
  return code;
}

export function printProcessSpawnHints(
  cmd: string,
  cwd: string,
  errCode: string | undefined,
  errSyscall: string | undefined,
): void {
  if (errCode !== 'ENOENT' && errCode !== 'EUNKNOWN' && errSyscall !== 'uv_spawn') return;
  console.error(`   Executable '${cmd}' was not found in PATH or working directory.`);
  if (process.platform === 'win32') {
    if (BUILT_INS.includes(cmd.toLowerCase())) {
      console.error(`\n   💡 AGENT HINT: '${cmd}' is a shell built-in, not an executable file. It should be routed through a system shell.\n${AUTONOMOUS_HEALING_MSG}`);
    }
    if (cmd === 'npm' || cmd === 'npx' || cmd === 'tsc') {
      console.error(`\n   💡 AGENT HINT: On Windows, '${cmd}' is usually a .cmd or .ps1 script, not an .exe.\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   You may need to specify the extension (e.g. '${cmd}.cmd') or run it via 'pwsh.exe'.`);
    }
    if (cwd && cwd.length >= 260) {
      console.error(`\n   💡 AGENT HINT: Your working directory path exceeds the Windows MAX_PATH limit (260 characters).\n${AUTONOMOUS_HEALING_MSG}`);
      console.error(`   This causes libuv to fail to spawn the process with an ENOENT error.`);
    }
  }
  if (cmd.includes('-') && /^[A-Z][a-z]+-[A-Z][a-zA-Z]+$/.test(cmd)) {
    console.error(`\n   💡 AGENT HINT: '${cmd}' appears to be a PowerShell cmdlet (e.g. Get-Item, Write-Host).\n${AUTONOMOUS_HEALING_MSG}`);
    console.error(`   You cannot execute cmdlets directly as files. Please wrap them using: {"command": "pwsh", "args": ["-c", "${cmd}"]}`);
  } else if (/\.(?:sh|ps1|bat|cmd)$/i.test(cmd)) {
    console.error(`\n   💡 AGENT HINT: You attempted to run a script file ('${cmd}') as a direct command.\n${AUTONOMOUS_HEALING_MSG}`);
    console.error(`   Please use the {"type": "script", "scriptPath": "${cmd}"} payload type instead.`);
  } else if (cmd.includes(' ')) {
    const parts = cmd.split(' ');
    const errArgs = parts.slice(1).map((s: string) => `"${s}"`).join(', ');
    console.error(`\n   💡 AGENT HINT: Your command contains spaces. Because shell: false is used,\n${AUTONOMOUS_HEALING_MSG}`);
    console.error(`   you MUST pass arguments in the 'args' array, not in the 'command' string.`);
    console.error(`   ❌ BAD: {"command": "${cmd}"}`);
    console.error(`   ✅ GOOD: {"command": "${parts[0]}", "args": [${errArgs}]}`);
  }
}

export function logGracefulExitReason(code: number, analysis: ExitCodeAnalysis): void {
  if (analysis.isGrepNoMatch) console.error(`\nℹ️  No matches found (exit code ${code}).`);
  else if (analysis.isDiffFound) console.error(`\nℹ️  Differences found (exit code ${code}).`);
  else if (analysis.isOutdatedInfo) console.error(`\nℹ️  Outdated packages found (exit code ${code}).`);
}

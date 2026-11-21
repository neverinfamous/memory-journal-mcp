// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import type { ExecPayload } from '../schema.js';
import { isPowerShellCode } from '../eval-healer.js';

const NETWORK_ALIASES = ['curl', 'wget', 'invoke-webrequest', 'iwr'];
const SHELL_INTERPRETERS = ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe'];
const WINDOWS_INTERPRETERS = ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe'];
const SHELL_SCRIPT_EXTS = ['.ps1', '.bat', '.cmd', '.sh', '.bash'];
const FS_SEARCH_ALIASES = ['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe'];
const FS_LIST_ALIASES = ['ls', 'ls.exe', 'dir', 'dir.exe', 'tree', 'tree.com'];
const SYSTEMD_ALIASES = ['journalctl', 'journalctl.exe'];

export function routeEmbeddedShellTools(payload: ExecPayload): boolean {
  routeNetworkCommandString(payload);
  return routeShellToolAliases(payload);
}

function routeNetworkCommandString(payload: ExecPayload): void {
  if (payload.type !== 'command' || !payload.command.includes(' ')) return;
  const firstToken = payload.command.trim().split(/\s+/)[0]?.toLowerCase();
  if (firstToken === undefined || firstToken.length === 0) return;
  const firstTokenBase = path.basename(firstToken).replace(/\.exe$/, '');
  if (!NETWORK_ALIASES.includes(firstTokenBase) || firstToken.endsWith('.exe') || payload.target === 'wsl2') return;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Network request command '${firstToken}' detected in command string. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
  payload.target = 'wsl2';
}

function routeShellToolAliases(payload: ExecPayload): boolean {
  if ((payload.type !== 'eval' && payload.type !== 'script') || payload.target === 'wsl2') return false;
  if (!isShellPayload(payload)) return false;
  const scriptContent = readShellScriptContent(payload);
  // [INTENT]: PowerShell cmdlets stay on Windows pwsh and skip the rest of system interception.
  if (isPowerShellCode(scriptContent)) {
    if (payload.interpreter && ['bash', 'sh'].includes(payload.interpreter.toLowerCase())) {
      payload.interpreter = 'pwsh';
      payload.target = 'windows';
    }
    return true;
  }
  switchShellToolTarget(payload, scriptContent);
  return false;
}

function isShellPayload(payload: ExecPayload): boolean {
  if (payload.type === 'eval') {
    const interp = (payload.interpreter || 'pwsh').toLowerCase();
    return SHELL_INTERPRETERS.includes(interp);
  }
  if (payload.type === 'script' && typeof payload.scriptPath === 'string') {
    if (payload.interpreter) return SHELL_INTERPRETERS.includes(payload.interpreter.toLowerCase());
    return SHELL_SCRIPT_EXTS.includes(path.extname(payload.scriptPath).toLowerCase());
  }
  return false;
}

function readShellScriptContent(payload: ExecPayload): string {
  if (payload.type === 'eval') return payload.code;
  if (payload.type === 'script' && typeof payload.scriptPath === 'string' && fs.existsSync(payload.scriptPath)) {
    return fs.readFileSync(payload.scriptPath, 'utf8');
  }
  return '';
}

function switchShellToolTarget(payload: ExecPayload, scriptContent: string): void {
  if (payload.type !== 'eval' && payload.type !== 'script') return;
  const tokens = scriptContent.split(/[\s;|{>&<]+/).filter(Boolean).map((token: string) => token.toLowerCase());
  const detected = tokens.find((token: string) => NETWORK_ALIASES.includes(token))
    ?? tokens.find((token: string) => FS_SEARCH_ALIASES.includes(token))
    ?? tokens.find((token: string) => FS_LIST_ALIASES.includes(token))
    ?? tokens.find((token: string) => SYSTEMD_ALIASES.includes(token));
  if (detected === undefined) return;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Shell command/script using '${detected}' detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
  payload.target = 'wsl2';
  if (!payload.interpreter || WINDOWS_INTERPRETERS.includes(payload.interpreter)) {
    payload.interpreter = 'bash';
  }
}

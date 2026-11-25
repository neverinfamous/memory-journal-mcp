// @ts-nocheck
import { DB_CLIENT_BASE_NAMES } from './repl-body-parsers.js';

export * from './repl-body-parsers.js';

export const REPL_COMMANDS: readonly string[] = [
  'node', 'node.exe', 'node.cmd', 'python', 'python.exe', 'python.cmd', 'python3', 'python3.exe',
  'pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'wsl', 'wsl.exe', 'adb', 'adb.exe',
  'bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe', 'ash', 'ash.exe', 'dash', 'dash.exe', 'bun', 'bun.exe', 'bun.cmd',
  'ruby', 'ruby.exe', 'ruby.cmd', 'perl', 'perl.exe', 'perl.cmd',
  'ts-node', 'tsx', 'tsx.exe', 'tsx.cmd', 'deno', 'deno.exe', 'irb', 'iex', 'php', 'php.exe', 'lua', 'irssi', 'mysql', 'mysql.exe', 'psql', 'psql.exe', 'sqlite3', 'sqlite3.exe', 'sqlite', 'sqlite.exe',
  'redis-cli', 'redis-cli.exe', 'mongo', 'mongo.exe', 'mongosh', 'mongosh.exe', 'pry', 'tinker', 'scala', 'clojure', 'sbcl', 'ghci', 'erl', 'hugs', 'kdb', 'q', 'r', 'R',
  'ssh', 'ssh.exe', 'sftp', 'sftp.exe', 'ftp', 'ftp.exe', 'telnet', 'telnet.exe', 'openssl', 'openssl.exe',
];

const BASE_TUI_COMMANDS = [
  'less', 'more', 'vi', 'vim', 'nvim', 'nano', 'emacs', 'top', 'htop', 'tmux', 'screen',
  'lazygit', 'lazydocker', 'k9s', 'ncdu', 'fzf', 'mut', 'mc', 'micro', 'w3m', 'lynx',
  'links', 'btop', 'nmon', 'glances', 'vimdiff', 'joe', 'bat', 'glow', 'tig', 'nmtui',
  'minikube', 'k3d', 'alsamixer', 'cfdisk', 'cgdisk', 'parted',
];

export const TUI_COMMANDS: readonly string[] = [...BASE_TUI_COMMANDS, ...BASE_TUI_COMMANDS.map(c => `${c}.exe`)];

export const PWSH_UI_CMDLETS: readonly string[] = ['Get-Credential', 'Show-Command', 'Out-GridView', 'Read-Host', 'PromptForChoice'];

const PATH_PREFIX = `(?:[^\\s;|&\`'"]*[\\\\/])?`;
const SHELL_WRAPPER_PREFIX = `(?:(?:pwsh|powershell|bash|sh|zsh|ash|dash|cmd|wsl)(?:\\.exe)?\\s+(?:(?:-c|-command)(?:\\s+|:)|/c(?:\\s+|[=:]))(?:['"]\\s*)?)?`;
const SU_WRAPPER_PREFIX = `(?:su[ \\t]+(?:-[^\\s]*[ \\t]+)*(?:[^\\s-][^\\s]*[ \\t]+)?(?:-[lmpt]*c[ \\t]*|--command(?:=[ \\t]*|[ \\t]+))(?:['"][ \\t]*)?)?`;
const ENV_SPLIT_PREFIX = `(?:env[ \\t]+(?:(?:-[i0v]*S[ \\t]*|--split-string(?:=[ \\t]*|[ \\t]+))(?:['"][ \\t]*)?)?)?`;
export const CMD_PREFIX_SOURCE = `(?:^|[;\\n&|{\`]|\\$\\()\\s*(?:['"]\\s*)?${SHELL_WRAPPER_PREFIX}(?:(?:sudo|env|doas|time|timeout|stdbuf|nohup|exec)\\s+)*${ENV_SPLIT_PREFIX}${SU_WRAPPER_PREFIX}(?:su\\s+)?(?:['"]\\s*)?`;

const REPL_PATTERN = REPL_COMMANDS
  .filter(c => !DB_CLIENT_BASE_NAMES.has(c.toLowerCase().replace(/\.exe$/, '')))
  .map((c) => {
    const base = c.toLowerCase().replace(/\.exe$/, '');
    if (['sh', 'bash', 'zsh', 'ash', 'dash', 'pwsh', 'powershell', 'cmd', 'wsl'].includes(base)) {
      return `${c.replace('.', '\\.')}(?!\\s+(?:-c|-command|/c)\\b)`;
    }
    return c.replace('.', '\\.');
  })
  .join('|');

const TUI_PATTERN = TUI_COMMANDS.map((c) => c.replace(/\./g, '\\.')).join('|');
const NON_FLAG_INTERACTIVE_PATTERN = `(?:--inspect(?:\\b(?![-_]))|--inspect-brk(?:\\b(?![-_]))|--inspect-wait(?:\\b(?![-_]))|-[a-zA-Z]*m\\s*pdb\\b)`;
const SHELL_PY_INTERACTIVE = `(?:bash|sh|zsh|ash|dash|python3?)(?:\\.exe|\\.cmd)?`;
const OPT_PRE_FLAGS = `(?:[ \\t]+(?!(?:-c|-e|-m|--command|--eval)\\b)-[a-zA-Z0-9_.-]+(?:=[^\\s;|&]+)?(?:[ \\t]+[^-\\s;|&][^\\s;|&]*)?)*`;

export const TUI_REGEX = new RegExp(`(${CMD_PREFIX_SOURCE})(${PATH_PREFIX})(${TUI_PATTERN})(?=$|\\s|[;\\n&|)'"])`, 'i');
export const REPL_REGEX = new RegExp(`(${CMD_PREFIX_SOURCE})(${PATH_PREFIX})(${REPL_PATTERN})(?=\\s*['"]?\\s*(?:$|[;\\n&|)]))`, 'i');
export const INTERACTIVE_FLAG_REGEX = new RegExp(
  `(${CMD_PREFIX_SOURCE})(${PATH_PREFIX})(?:(${SHELL_PY_INTERACTIVE})${OPT_PRE_FLAGS}[ \\t]+(?:-(?:[a-bd-ln-z]*i[a-zA-Z]*)|--interactive)(?=\\s|$|[;)|&])|(${REPL_PATTERN})${OPT_PRE_FLAGS}[ \\t]+${NON_FLAG_INTERACTIVE_PATTERN})`,
  'i',
);
const GLOBAL_INTERACTIVE_FLAG_REGEX = new RegExp(
  INTERACTIVE_FLAG_REGEX.source,
  `${INTERACTIVE_FLAG_REGEX.flags.replace(/g/g, '')}g`,
);

const PY_SHORT_I_RE = /^-[a-bd-ln-zA-VY-Z]*i[a-zA-Z]*$/;
const SH_SHORT_I_RE = /^-[a-bd-lnp-zA-NP-Z]*i[a-zA-Z]*$/;

export function matchInteractiveFlagInBody(body: string): RegExpExecArray | null {
  for (const m of body.matchAll(GLOBAL_INTERACTIVE_FLAG_REGEX)) {
    if (m[3] !== undefined) {
      const flagRe = m[3].toLowerCase().startsWith('python') ? PY_SHORT_I_RE : SH_SHORT_I_RE;
      const toks = m[0].trim().split(/\s+/);
      const hasLowerIOrInteractive = toks.some((t) => t.toLowerCase() === '--interactive' || (t.startsWith('-') && !t.startsWith('--') && flagRe.test(t)));
      if (!hasLowerIOrInteractive) continue;
    }
    return m;
  }
  return null;
}
export const NODE_INSPECT_SUBCMD_REGEX = new RegExp(`(${CMD_PREFIX_SOURCE})(${PATH_PREFIX})(node(?:\\.exe|\\.cmd)?)\\s+(?:--?\\S+\\s+)*inspect\\b`, 'i');

export const WATCH_REGEX = new RegExp(`${CMD_PREFIX_SOURCE}${PATH_PREFIX}watch(?:\\.exe)?\\s+`, 'i');
export const TAIL_F_REGEX = new RegExp(`(${CMD_PREFIX_SOURCE})(${PATH_PREFIX})tail(?:\\.exe)?[^\\n;|&]*\\s(?:(?:-(?:[a-zA-Z]*|\\d+[bckm]?)|\\+\\d+[bckm]?)[fF][a-zA-Z0-9]*|--follow)(?=\\s|=|$|[;\\n&|)])`, 'i');
export const JOURNALCTL_FOLLOW_REGEX = /\b[jJ]ournalctl(?:\.[eE][xX][eE])?\b[^;\n|&]*(?:\s-(?:[exqrkaobml]*f\S*)|\s--[fF][oO][lL][lL][oO][wW]\b)/;
export const DOCKER_LOGS_REGEX = /\bdocker(?:-compose)?(?:\.exe)?\b(?:[ \t]+(?!logs\b)[^\s;|&]+)*[ \t]+logs\b(?:[ \t]+(?!(?:-[a-zA-Z]*f[a-zA-Z]*\b|--follow\b(?!=(?:false|0|no|off)\b)))[^\s;|&]+)*[ \t]+(?:-[a-zA-Z]*f[a-zA-Z]*\b|--follow\b(?!=(?:false|0|no|off)\b))/i;
export const NODE_WATCH_REGEX = /\b(?:node|bun|deno|tsx|npx|pnpx|bunx|yarn|pnpm|npm|vitest|jest)(?:\.exe|\.cmd)?\b[^\n;|&]*--watch(?:-path)?\b(?!=(?:false|0|no|off)\b)/i;
export const WATCH_TOOL_REGEX = new RegExp(`${CMD_PREFIX_SOURCE}${PATH_PREFIX}(?:nodemon|ts-node-dev)(?:\\.exe|\\.cmd)?\\b`, 'i');
export const TSX_WATCH_REGEX = /\btsx(?:\.exe|\.cmd)?\s+(?:watch|--watch)\b/i;
export const PM2_INTERACTIVE_REGEX = /\bpm2(?:\.exe|\.cmd)?\s+(?:logs|monit|dash)\b/i;
export const BUN_REPL_REGEX = /\b(?:bun|deno)(?:\.exe|\.cmd)?\s+repl\b/i;
export const CMD_PAUSE_REGEX = /(?:^|[;&|\n]\s*)pause\b/i;
export const PWSH_NO_EXIT_REGEX = /\b(?:pwsh|powershell)(?:\.exe)?\s+[^\n;|&]*-noexit\b/i;
export const PWSH_UI_REGEX = /\b(?:Get-Credential|Show-Command|Out-GridView|Read-Host|PromptForChoice)\b/i;
export const INLINE_SHELL_REGEX = new RegExp(`${CMD_PREFIX_SOURCE}(?:[^\\s;|&\`'"]*[\\\\/])?(?:(?:pwsh(?:\\.exe)?|powershell(?:\\.exe)?|bash(?:\\.exe)?|sh(?:\\.exe)?|cmd(?:\\.exe)?)(?:['"]|\\b)\\s+(?:-c|-command|/c|-ec|-encodedcommand|-en)|wsl(?:\\.exe)?(?:['"]|\\b)\\s+(?:-c|-command|/c|-e|--exec))\\b`, 'i');
export const IMPLICIT_PWSH_REGEX = new RegExp(`${CMD_PREFIX_SOURCE}(?:[^\\s;|&\`'"]*[\\\\/])?(?:pwsh(?:\\.exe)?|powershell(?:\\.exe)?)(?:['"]|\\b)\\s+(?:-(?:nologo|noprofile|noninteractive|mta|sta|noexit|(?:executionpolicy|ep|workingdirectory|wd|inputformat|if|outputformat|of|configurationname|settingsfile|custompipename)\\s+\\S+|version\\s+\\d+(?:\\.\\d+)*)\\s+)*(?!-(?:nologo|noprofile|noninteractive|mta|sta|noexit|executionpolicy|ep|workingdirectory|wd|inputformat|if|outputformat|of|configurationname|settingsfile|custompipename|file|help|version|\\?|h|v)\\b|-(?:file|f)(?:\\s+\\S|:\\S)|--?(?:help|version)\\b)(?!\\/\\?)\\S+`, 'i');



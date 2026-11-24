// @ts-nocheck
export const REPL_COMMANDS: readonly string[] = [
  'node', 'node.exe', 'node.cmd', 'python', 'python.exe', 'python.cmd', 'python3', 'python3.exe',
  'pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'wsl', 'wsl.exe', 'adb', 'adb.exe',
  'bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe', 'bun', 'bun.exe', 'bun.cmd',
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

export const TUI_COMMANDS: readonly string[] = [
  ...BASE_TUI_COMMANDS,
  ...BASE_TUI_COMMANDS.map(c => `${c}.exe`),
];

export const NODE_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-r', '--require', '--import', '--loader', '--experimental-loader',
  '-C', '--conditions', '--input-type', '--env-file', '--env-file-if-exists',
  '--watch-path', '--redirect-warnings', '--diagnostic-dir', '--heapsnapshot-signal',
  '--openssl-config', '--icu-data-dir', '--title', '--max-old-space-size',
]);

export const REDIS_OPTION_WITH_ARG: ReadonlySet<string> = new Set([
  '-h', '-p', '-s', '-a', '-u', '--user', '--pass', '-n', '-r', '-i', '-d',
]);

export const SSH_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-B', '-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J',
  '-L', '-l', '-m', '-O', '-o', '-p', '-P', '-Q', '-R', '-S', '-W', '-w',
]);

export const PWSH_UI_CMDLETS: readonly string[] = [
  'Get-Credential', 'Show-Command', 'Out-GridView', 'Read-Host', 'PromptForChoice',
];

const PATH_PREFIX = `(?:[^\\s;|&\`'"]*[\\\\/])?`;
const SHELL_WRAPPER_PREFIX = `(?:(?:pwsh|powershell|bash|sh|zsh|cmd|wsl)(?:\\.exe)?\\s+(?:-c|-command|/c)\\s+(?:['"]\\s*)?)?`;
export const CMD_PREFIX_SOURCE = `(?:^|[;\\n&|{\`]|\\$\\()\\s*(?:['"]\\s*)?${SHELL_WRAPPER_PREFIX}(?:(?:sudo|env|su|doas|time|timeout|stdbuf|nohup|exec)\\s+)*(?:['"]\\s*)?`;

const REPL_PATTERN = REPL_COMMANDS.map((c) => {
  const base = c.toLowerCase().replace(/\.exe$/, '');
  if (['sh', 'bash', 'zsh', 'pwsh', 'powershell', 'cmd', 'wsl'].includes(base)) {
    return `${c.replace('.', '\\.')}(?!\\s+(?:-c|-command|/c)\\b)`;
  }
  return c.replace('.', '\\.');
}).join('|');

const TUI_PATTERN = TUI_COMMANDS.map((c) => c.replace(/\./g, '\\.')).join('|');
const NON_FLAG_INTERACTIVE_PATTERN = `(?:--inspect(?:\\b(?![-_]))|--inspect-brk(?:\\b(?![-_]))|--inspect-wait(?:\\b(?![-_]))|-[a-zA-Z]*m\\s*pdb\\b)`;
const SHELL_PY_INTERACTIVE = `(?:bash|sh|zsh|python3?)(?:\\.exe|\\.cmd)?`;
const OPT_PRE_FLAGS = `(?:[ \\t]+(?!(?:-c|-e|--command|--eval)\\b)-[a-zA-Z0-9_.-]+(?:=[^\\s;|&]+)?(?:[ \\t]+[^-\\s;|&][^\\s;|&]*)?)*`;

export const TUI_REGEX = new RegExp(`(${CMD_PREFIX_SOURCE})(${PATH_PREFIX})(${TUI_PATTERN})(?=$|\\s|[;\\n&|)'"])`, 'i');
export const REPL_REGEX = new RegExp(`(${CMD_PREFIX_SOURCE})(${PATH_PREFIX})(${REPL_PATTERN})(?=\\s*['"]?\\s*(?:$|[;\\n&|)]))`, 'i');
export const INTERACTIVE_FLAG_REGEX = new RegExp(
  `(${CMD_PREFIX_SOURCE})(${PATH_PREFIX})(?:(${SHELL_PY_INTERACTIVE})${OPT_PRE_FLAGS}[ \\t]+(?:-(?:i|it|ti)|--interactive)(?=\\s|$|[;)|&])|(${REPL_PATTERN})${OPT_PRE_FLAGS}[ \\t]+${NON_FLAG_INTERACTIVE_PATTERN})`,
  'i',
);
export const NODE_INSPECT_SUBCMD_REGEX = new RegExp(`(${CMD_PREFIX_SOURCE})(${PATH_PREFIX})(node(?:\\.exe|\\.cmd)?)\\s+(?:--?\\S+\\s+)*inspect\\b`, 'i');

export const WATCH_REGEX = new RegExp(`${CMD_PREFIX_SOURCE}${PATH_PREFIX}watch(?:\\.exe)?\\s+`, 'i');
export const TAIL_F_REGEX = new RegExp(`(${CMD_PREFIX_SOURCE})(${PATH_PREFIX})tail(?:\\.exe)?[^\\n;|&]*\\s(?:(?:-(?:[a-zA-Z]*|\\d+[bckm]?)|\\+\\d+[bckm]?)[fF][a-zA-Z0-9]*|--follow)(?=\\s|=|$|[;\\n&|)])`, 'i');
export const JOURNALCTL_FOLLOW_REGEX = /\b[jJ]ournalctl(?:\.[eE][xX][eE])?\b[^;\n|&]*(?:\s-(?:[exqrkaobml]*f\S*)|\s--[fF][oO][lL][lL][oO][wW]\b)/;
export const DOCKER_LOGS_REGEX = /\bdocker(?:-compose)?(?:\.exe)?\b(?:[ \t]+(?!logs\b)[^\s;|&]+)*[ \t]+logs\b(?:[ \t]+(?!(?:-[a-zA-Z]*f[a-zA-Z]*\b|--follow(?:\b|=)))[^\s;|&]+)*[ \t]+(?:-[a-zA-Z]*f[a-zA-Z]*\b|--follow(?:\b|=))/i;
export const NODE_WATCH_REGEX = /\b(?:node|bun|deno|tsx|npx|pnpx|bunx|yarn|pnpm|npm|vitest|jest)(?:\.exe|\.cmd)?\b[^\n;|&]*--watch(?:-path)?\b(?!=(?:false|0|no|off)\b)/i;
export const WATCH_TOOL_REGEX = new RegExp(`${CMD_PREFIX_SOURCE}${PATH_PREFIX}(?:nodemon|ts-node-dev)(?:\\.exe|\\.cmd)?\\b`, 'i');
export const TSX_WATCH_REGEX = /\btsx(?:\.exe|\.cmd)?\s+(?:watch|--watch)\b/i;
export const PM2_INTERACTIVE_REGEX = /\bpm2(?:\.exe|\.cmd)?\s+(?:logs|monit|dash)\b/i;
export const BUN_REPL_REGEX = /\b(?:bun|deno)(?:\.exe|\.cmd)?\s+repl\b/i;
export const CMD_PAUSE_REGEX = /(?:^|[;&|\n]\s*)pause\b/i;
export const PWSH_NO_EXIT_REGEX = /\b(?:pwsh|powershell)(?:\.exe)?\s+[^\n;|&]*-noexit\b/i;
export const PWSH_UI_REGEX = /\b(?:Get-Credential|Show-Command|Out-GridView|Read-Host|PromptForChoice)\b/i;
export const INLINE_SHELL_REGEX = new RegExp(`${CMD_PREFIX_SOURCE}(?:[^\\s;|&\`'"]*[\\\\/])?(?:pwsh(?:\\.exe)?|powershell(?:\\.exe)?|bash(?:\\.exe)?|sh(?:\\.exe)?|wsl(?:\\.exe)?|cmd(?:\\.exe)?)(?:['"]|\\b)\\s+(?:-c|-command|/c|-ec|-encodedcommand|-en)\\b`, 'i');
export const IMPLICIT_PWSH_REGEX = new RegExp(`${CMD_PREFIX_SOURCE}(?:[^\\s;|&\`'"]*[\\\\/])?(?:pwsh(?:\\.exe)?|powershell(?:\\.exe)?)(?:['"]|\\b)\\s+(?:-(?:nologo|noprofile|noninteractive|mta|sta|noexit|(?:executionpolicy|ep|workingdirectory|wd|inputformat|if|outputformat|of|configurationname|settingsfile|custompipename)\\s+\\S+|version\\s+\\d+(?:\\.\\d+)*)\\s+)*(?!-(?:nologo|noprofile|noninteractive|mta|sta|noexit|executionpolicy|ep|workingdirectory|wd|inputformat|if|outputformat|of|configurationname|settingsfile|custompipename|file|help|version|\\?|h|v)\\b|-(?:file|f)(?:\\s+\\S|:\\S)|--?(?:help|version)\\b)(?!\\/\\?)\\S+`, 'i');

const SQLITE_VALUE_FLAGS = new Set(['-separator', '-nullvalue', '-newline', '-init', '-cmd']);
const DB_CLIENT_BASE_NAMES = new Set(['mysql', 'psql', 'sqlite3', 'sqlite', 'redis-cli', 'mongo', 'mongosh']);
const SSH_CLIENT_BASE_NAMES = new Set(['ssh', 'sftp', 'ftp', 'telnet']);

function matchesFlagOrPrefix(arg: string, exactFlags: readonly string[], allowShortPrefix = false): boolean {
  for (const flag of exactFlags) {
    if (arg === flag || arg.startsWith(`${flag}=`)) return true;
    if (allowShortPrefix && flag.length === 2 && flag.startsWith('-') && !flag.startsWith('--') && arg.startsWith(flag) && arg.length > 2) {
      return true;
    }
  }
  return false;
}

function countSqlitePositionals(args: readonly string[]): number {
  let count = 0;
  let seenDoubleDash = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (!seenDoubleDash && a === '--') { seenDoubleDash = true; continue; }
    if (!seenDoubleDash && a.startsWith('-')) {
      if (SQLITE_VALUE_FLAGS.has(a)) i++;
      continue;
    }
    count++;
  }
  return count;
}

export function isDbNonInteractive(cmd: string, args: readonly string[]): boolean {
  const base = cmd.replace(/\.exe$/, '');
  if (base === 'sqlite3' || base === 'sqlite') {
    if (args.some(arg => matchesFlagOrPrefix(arg, ['-cmd', '-batch', '--batch'], false))) return true;
    return countSqlitePositionals(args) >= 2;
  }
  if (base === 'psql') {
    return args.some(arg => matchesFlagOrPrefix(arg, ['-c', '--command', '-f', '--file'], true));
  }
  if (base === 'mysql') {
    return args.some(arg => matchesFlagOrPrefix(arg, ['-e', '--execute'], true));
  }
  if (base === 'mongo' || base === 'mongosh') {
    return args.some(arg => matchesFlagOrPrefix(arg, ['--eval', '-f', '--file'], false));
  }
  if (base === 'redis-cli') {
    if (args.some(arg => matchesFlagOrPrefix(arg, ['--eval'], false))) return true;
    const nonOptionArgs: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const curr = args[i];
      if (curr === undefined) continue;
      if (curr.startsWith('-')) {
        if (REDIS_OPTION_WITH_ARG.has(curr) && i + 1 < args.length) i++;
        continue;
      }
      nonOptionArgs.push(curr);
    }
    return nonOptionArgs.length > 0;
  }
  return false;
}

export function collectSshPositionals(args: readonly string[]): string[] {
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith('-')) {
      if (SSH_VALUE_FLAGS.has(arg) && i + 1 < args.length) i++;
      continue;
    }
    positionals.push(arg);
  }
  return positionals;
}

const SHELL_BODY_WRAPPERS = new Set(['sudo', 'env', 'su', 'doas', 'time', 'timeout', 'stdbuf', 'nohup', 'exec']);

export function findInteractiveDbOrSshInBody(body: string): string | null {
  const segRe = /(?:^|[;\n|{}]|&&|\|\|)\s*([^;\n|&{}]+)/g;
  for (const m of body.matchAll(segRe)) {
    const rawMatch = m[0] ?? '';
    const trimmedLead = rawMatch.trimStart();
    if (trimmedLead.startsWith('|') && !trimmedLead.startsWith('||')) continue;
    const seg = (m[1] ?? '').trim();
    if (seg.length === 0 || seg.includes('<')) continue;
    const rawTokens = seg.split(/\s+/).filter(Boolean);
    let cmdIdx = 0;
    while (cmdIdx < rawTokens.length) {
      const tok = rawTokens[cmdIdx] ?? '';
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok) || SHELL_BODY_WRAPPERS.has(tok.toLowerCase())) {
        cmdIdx++;
        continue;
      }
      break;
    }
    const rawCmd = rawTokens[cmdIdx];
    if (rawCmd === undefined) continue;
    const base = rawCmd.replace(/^.*[\\/]/, '').toLowerCase().replace(/\.exe$/, '');
    const rest = rawTokens.slice(cmdIdx + 1);
    if (rest.length === 0 || rest.some(a => a === '--help' || a === '--version' || a === '-help' || a === '-version' || a === '-V')) {
      continue;
    }
    if (DB_CLIENT_BASE_NAMES.has(base) && !isDbNonInteractive(base, rest)) return base;
    if (SSH_CLIENT_BASE_NAMES.has(base)) {
      if (base === 'ftp' || base === 'telnet' || collectSshPositionals(rest).length < 2) return base;
    }
  }
  return null;
}

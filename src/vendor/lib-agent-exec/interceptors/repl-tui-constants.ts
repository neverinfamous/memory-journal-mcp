// @ts-nocheck
export const REPL_COMMANDS: readonly string[] = [
  'node', 'node.exe', 'node.cmd', 'python', 'python.exe', 'python.cmd', 'python3', 'python3.exe',
  'pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'wsl', 'wsl.exe', 'adb', 'adb.exe',
  'bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe', 'bun', 'bun.exe', 'bun.cmd',
  'ruby', 'ruby.exe', 'ruby.cmd', 'perl', 'perl.exe', 'perl.cmd',
  'ts-node', 'tsx', 'deno', 'irb', 'iex', 'php', 'lua', 'irssi', 'mysql', 'mysql.exe', 'psql', 'psql.exe', 'sqlite3', 'sqlite3.exe', 'sqlite', 'sqlite.exe',
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
  '-h', '-p', '-s', '-a', '-u', '-n', '-r', '-i', '-c', '-d', '--ldb',
]);

export const SSH_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-B', '-b', '-c', '-D', '-E', '-e', '-F', '-I', '-i', '-J',
  '-L', '-l', '-m', '-O', '-o', '-p', '-P', '-Q', '-R', '-S', '-W', '-w',
]);

export const PWSH_UI_CMDLETS: readonly string[] = [
  'Get-Credential', 'Show-Command', 'Out-GridView', 'Read-Host', 'PromptForChoice',
];

const PATH_PREFIX = `(?:[^\\s;|&\`'"]*[\\\\/])?`;
const SHELL_WRAPPER_PREFIX = `(?:(?:pwsh|powershell|bash|sh|zsh|cmd|wsl)(?:\\.exe)?\\s+(?:-c|-command|/c)\\s+)?`;
export const CMD_PREFIX_SOURCE = `(?:^|[;\\n&|{\`]|\\$\\()\\s*(?:['"])?\\s*${SHELL_WRAPPER_PREFIX}(?:(?:sudo|env|su|doas|time|timeout|stdbuf|nohup|exec)\\s+)*(?:['"])?\\s*`;

const REPL_PATTERN = REPL_COMMANDS.map((c) => {
  const base = c.toLowerCase().replace(/\.exe$/, '');
  if (['sh', 'bash', 'zsh', 'pwsh', 'powershell', 'cmd', 'wsl'].includes(base)) {
    return `${c.replace('.', '\\.')}(?!\\s+(?:-c|-command|/c)\\b)`;
  }
  return c.replace('.', '\\.');
}).join('|');

const INTERACTIVE_FLAG_PATTERN = `(?:-(?:i|it|ti)\\b|--interactive\\b|--inspect\\b|--inspect-brk\\b|-m\\s+pdb\\b)`;

export const TUI_REGEX = new RegExp(`(${CMD_PREFIX_SOURCE})(${PATH_PREFIX})(${TUI_COMMANDS.join('|')})\\b`, 'i');
export const REPL_REGEX = new RegExp(`(${CMD_PREFIX_SOURCE})(${PATH_PREFIX})(${REPL_PATTERN})(?=\\s*['"]?\\s*(?:$|[;\\n&|)]))`, 'i');
export const INTERACTIVE_FLAG_REGEX = new RegExp(`(${CMD_PREFIX_SOURCE})(${PATH_PREFIX})(${REPL_PATTERN})\\s+(?:[^;\\n|&]*\\s)?${INTERACTIVE_FLAG_PATTERN}`);
export const NODE_INSPECT_SUBCMD_REGEX = new RegExp(`(${CMD_PREFIX_SOURCE})(${PATH_PREFIX})(node(?:\\.exe|\\.cmd)?)\\s+(?:--?\\S+\\s+)*inspect\\b`, 'i');

export const WATCH_REGEX = /\bwatch(?:\.exe)?\s+/i;
export const TAIL_F_REGEX = /\btail(?:\.exe)?(?:\s+\S+)*\s+(?:-f|--follow)(?:\s|=|$)/i;
export const JOURNALCTL_FOLLOW_REGEX = /\bjournalctl(?:\.exe)?\b[^;\n|&]*(?:\s-(?:[exqrkaobml]*f[exqrkaobml]*)\b|\s--follow\b)/i;
export const DOCKER_LOGS_REGEX = /\bdocker(?:-compose)?(?:\.exe)?\b[^\n;|&]*\s+logs\b[^\n;|&]*(?:\s(?:-f|--follow)\b|--follow=)/i;
export const NODE_WATCH_REGEX = /\b(?:node|bun|npx|pnpx|bunx|yarn)(?:\.exe|\.cmd)?\b[^\n;|&]*--watch\b/i;
export const WATCH_TOOL_REGEX = /\b(?:nodemon|ts-node-dev)(?:\.exe|\.cmd)?\b/i;
export const TSX_WATCH_REGEX = /\btsx(?:\.exe|\.cmd)?\s+watch\b/i;
export const PM2_INTERACTIVE_REGEX = /\bpm2(?:\.exe|\.cmd)?\s+(?:logs|monit|dash)\b/i;
export const BUN_REPL_REGEX = /\bbun(?:\.exe|\.cmd)?\s+repl\b/i;
export const CMD_PAUSE_REGEX = /(?:^|[;&|\n]\s*)pause\b/i;
export const PWSH_NO_EXIT_REGEX = /\b(?:pwsh|powershell)(?:\.exe)?\s+[^\n;|&]*-noexit\b/i;
export const PWSH_UI_REGEX = /\b(?:Get-Credential|Show-Command|Out-GridView|Read-Host|PromptForChoice)\b/i;
export const INLINE_SHELL_REGEX = new RegExp(`${CMD_PREFIX_SOURCE}(?:[^\\s;|&\`'"]*[\\\\/])?(?:pwsh(?:\\.exe)?|powershell(?:\\.exe)?|bash(?:\\.exe)?|sh(?:\\.exe)?|wsl(?:\\.exe)?|cmd(?:\\.exe)?)(?:['"]|\\b)\\s+(?:-c|-command|/c|-ec|-encodedcommand|-en)\\b`, 'i');
export const IMPLICIT_PWSH_REGEX = new RegExp(`${CMD_PREFIX_SOURCE}(?:[^\\s;|&\`'"]*[\\\\/])?(?:pwsh(?:\\.exe)?|powershell(?:\\.exe)?)(?:['"]|\\b)\\s+(?!-(?:file|help|version|\\?|/?)\\b)\\S+`, 'i');

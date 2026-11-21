// @ts-nocheck
import path from 'node:path';
import { isPwsh, isCmd } from './command-utils.js';
import type { ExecPayload } from './schema.js';

export interface CodeScanState {
  inSingle: boolean;
  inDouble: boolean;
  inBacktick: boolean;
  inLineComment: boolean;
  inBlockComment: boolean;
}

export function createCodeScanState(): CodeScanState {
  return { inSingle: false, inDouble: false, inBacktick: false, inLineComment: false, inBlockComment: false };
}

// [INTENT]: Shared single-character string/comment scanner for eval/inline code rewriters so nested heuristics skip literals and comments.
export function stepCodeScanState(code: string, i: number, state: CodeScanState): number | null {
  const ch = code[i];
  const next = code[i + 1];
  if (state.inLineComment) {
    if (ch === '\n') state.inLineComment = false;
    return i;
  }
  if (state.inBlockComment) {
    if (ch === '*' && next === '/') {
      state.inBlockComment = false;
      return i + 1;
    }
    return i;
  }
  if (state.inSingle) {
    if (ch === '\\') return i + 1;
    if (ch === "'") state.inSingle = false;
    return i;
  }
  if (state.inDouble) {
    if (ch === '\\') return i + 1;
    if (ch === '"') state.inDouble = false;
    return i;
  }
  if (state.inBacktick) {
    if (ch === '\\') return i + 1;
    if (ch === '`') state.inBacktick = false;
    return i;
  }
  if (ch === '/' && next === '/') {
    state.inLineComment = true;
    return i + 1;
  }
  if (ch === '/' && next === '*') {
    state.inBlockComment = true;
    return i + 1;
  }
  if (ch === "'") { state.inSingle = true; return i; }
  if (ch === '"') { state.inDouble = true; return i; }
  if (ch === '`') { state.inBacktick = true; return i; }
  return null;
}

export interface EvalExecutionTarget {
  effectiveInterpreter: string;
  ext: string;
}

const SHELL_INTERPRETERS = new Set([
  'bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe',
  'pwsh', 'pwsh.exe', 'powershell', 'powershell.exe',
  'cmd', 'cmd.exe', 'bat',
]);

export function isJavaScriptOrTypeScriptCode(code: string): boolean {
  const trimmed = code.trim();
  // Direct statements at the top
  if (/^(?:import\s|export\s|console\.(?:log|error|warn|info|dir|trace)\b|const\s|let\s|var\s|async\s+function|function\*?\s|process\.(?:exit|env|cwd|version|argv)\b|require\s*\()/.test(trimmed)) {
    return true;
  }
  // Characteristic JS constructs anywhere in snippet
  if (/\b(?:console\.(?:log|error|warn|info|dir|trace)\s*\(|require\s*\(['"][^'"]+['"]\)|JSON\.(?:stringify|parse)\s*\(|process\.(?:exit|env|cwd|version)\b)/.test(code)) {
    return true;
  }
  return false;
}

export function isShellCommandScript(code: string): boolean {
  const trimmed = code.trim();
  const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('//') && !l.startsWith('/*'));
  const shellCommands = /^(?:echo\s|cat\s|rm\s|mkdir\s|touch\s|cd\s|ls\s|dir\s|git\s|apt\s|apt-get\s|pnpm\s|npm\s|yarn\s|bun\s|node\s|python\s|python3\s|which\s|where\s|curl\s|wget\s|chmod\s|chown\s|source\s|export\s+[A-Za-z_][A-Za-z0-9_]*=)/;
  if (lines.some(line => shellCommands.test(line))) return true;
  if (isJavaScriptOrTypeScriptCode(code) || isPythonCode(code) || isPowerShellCode(code)) return false;
  if (/\b(?:type|interface|enum|class)\s+[A-Z]/.test(trimmed) || /=>/.test(trimmed)) return false;
  const shellOperators = /(?:&&|\|\||(?<![|<>=!])\|(?![|=])|(?:^|\s)\d*>{1,2}\s+\S)/;
  return lines.some(line => !line.startsWith('#') && shellOperators.test(line));
}

export function isPythonCode(code: string): boolean {
  const trimmed = code.trim();
  if (/^(?:import\s+[a-zA-Z0-9_]+|from\s+[a-zA-Z0-9_]+\s+import|def\s+[a-zA-Z0-9_]+\s*\(|class\s+[a-zA-Z0-9_]+[:(]|print\s*\()/.test(trimmed)) {
    return true;
  }
  return false;
}

export function isPowerShellCode(code: string): boolean {
  const trimmed = code.trim();
  const psCmdletRegex = /\b(?:Get|Set|New|Remove|Start|Stop|Restart|Select|Test|Invoke|Clear|Copy|Move|Write|Add|Enter|Exit|Find|Format|Measure|Read|Reset|Resume|Search|Show|Split|Switch|Wait)-(?:[A-Za-z]+)\b/;
  if (psCmdletRegex.test(trimmed)) {
    return true;
  }
  if (/\$(?:PSScriptRoot|PSVersionTable|LASTEXITCODE|ErrorActionPreference|ProgressPreference)\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

export function hasTopLevelReturn(code: string): boolean {
  let depth = 0;
  const scanState = createCodeScanState();

  for (let i = 0; i < code.length; i++) {
    const nextScanIdx = stepCodeScanState(code, i, scanState);
    if (nextScanIdx !== null) {
      i = nextScanIdx;
      continue;
    }

    const char = code[i];
    if (char === '{') {
      depth++;
      continue;
    }
    if (char === '}') {
      if (depth > 0) depth--;
      continue;
    }

    if (depth === 0 && (i === 0 || /[\s;]/.test(code[i - 1] ?? '')) && code.startsWith('return', i)) {
      if (/[\s;({'"`]/.test(code[i + 6] ?? '')) return true;
    }
  }
  return false;
}

function isHoistedImport(trimmed: string): boolean {
  if (/^import\s+['"][^'"]+['"];?$/.test(trimmed)) return true;
  if (!trimmed.startsWith('import ')) return false;
  const marker = ' from ';
  const fromAt = trimmed.lastIndexOf(marker);
  if (fromAt < 0) return false;
  const specifier = trimmed.slice(fromAt + marker.length).trim();
  if (!/^['"][^'"]+['"];?$/.test(specifier)) return false;
  const clause = trimmed.slice('import'.length, fromAt);
  if (!/^\s+\S/.test(clause)) return false;
  return !/[();]/.test(clause);
}

export function wrapCodeInAsyncIife(code: string): string {
  const lines = code.split('\n');
  const importLines: string[] = [];
  const bodyLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (isHoistedImport(trimmed)) {
      importLines.push(line);
    } else {
      bodyLines.push(line);
    }
  }

  const imports = importLines.length > 0 ? `${importLines.join('\n')}\n\n` : '';
  const body = bodyLines.join('\n');

  return `${imports}(async () => {\n${body}\n})().then(res => {\n  if (res !== undefined) console.log(typeof res === 'object' ? JSON.stringify(res, null, 2) : res);\n}).catch(err => {\n  console.error(err);\n  process.exit(1);\n});`;
}

const UNQUOTED_SQL_START_REGEX = /^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|PRAGMA|WITH|ATTACH|DETACH|VACUUM|REINDEX|REPLACE|EXPLAIN)\s+(?:[A-Za-z_*('"[]|--|\/\*)/i;

function findMatchingSqlCloseParen(code: string, startIdx: number): number {
  let depth = 1;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = startIdx; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "'" && next === "'") {
        i++;
        continue;
      }
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"' && next === '"') {
        i++;
        continue;
      }
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }

    if (ch === '-' && next === '-') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '(') {
      depth++;
      continue;
    }
    if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

interface HealedSqlCall {
  openParenIdx: number;
  closeParenIdx: number;
  sqlLiteral: string;
}

function tryHealSqlCallAt(code: string, dotIdx: number): HealedSqlCall | null {
  const methodMatch = code.slice(dotIdx + 1).match(/^(exec|prepare)\s*\(/);
  if (methodMatch === null || methodMatch[0] === undefined) return null;
  const openParenIdx = dotIdx + methodMatch[0].length;
  const afterOpen = code.slice(openParenIdx + 1);
  const leadingMatch = afterOpen.match(/^\s*(?:\\\s*)?/);
  const leadingOffset = leadingMatch?.[0]?.length ?? 0;
  const candidateStart = afterOpen.slice(leadingOffset);
  const firstChar = candidateStart[0];
  if (firstChar === undefined || firstChar === "'" || firstChar === '"' || firstChar === '`') return null;
  if (!UNQUOTED_SQL_START_REGEX.test(candidateStart)) return null;
  const closeParenIdx = findMatchingSqlCloseParen(code, openParenIdx + 1);
  if (closeParenIdx === -1) return null;
  const rawBody = code.slice(openParenIdx + 1, closeParenIdx)
    .replace(/^(\s*)\\/, '$1')
    .replace(/\\(\s*)$/, '$1')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
  return { openParenIdx, closeParenIdx, sqlLiteral: `\`${rawBody}\`` };
}

// [INTENT]: Restores backtick template literals around unquoted SQL statements inside .exec(...) and .prepare(...) when PowerShell double-quoting stripped the backticks.
export function healStrippedSqlTemplateLiterals(code: string): string {
  let result = '';
  let lastCopied = 0;
  let healedCount = 0;
  const scanState = createCodeScanState();

  for (let i = 0; i < code.length; i++) {
    const nextScanIdx = stepCodeScanState(code, i, scanState);
    if (nextScanIdx !== null) {
      i = nextScanIdx;
      continue;
    }
    if (code[i] !== '.') continue;
    const healedCall = tryHealSqlCallAt(code, i);
    if (healedCall === null) continue;
    result += code.slice(lastCopied, healedCall.openParenIdx + 1) + healedCall.sqlLiteral;
    lastCopied = healedCall.closeParenIdx;
    i = healedCall.closeParenIdx - 1;
    healedCount++;
  }

  if (healedCount === 0) return code;

  result += code.slice(lastCopied);
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected unquoted SQL inside .exec()/.prepare() from PowerShell backtick stripping. Restoring template literals... (Frictionless Recovery)\x1b[0m`);
  return result;
}

const INTERPRETER_EXT_MAP: Readonly<Record<string, string>> = {
  python: '.py',
  python3: '.py',
  py: '.py',
  pwsh: '.ps1',
  powershell: '.ps1',
  ps1: '.ps1',
  bash: '.sh',
  sh: '.sh',
  zsh: '.sh',
  cmd: '.bat',
  bat: '.bat',
  node: '.js',
  nodejs: '.js',
  js: '.js',
  javascript: '.js',
  bun: '.ts',
  tsx: '.ts',
  ts: '.ts',
  typescript: '.ts',
};

function mapInterpreterExtension(interp: string, fallback: string): string {
  const base = path.basename(interp.trim().toLowerCase()).replace(/\.(?:exe|cmd|bat)$/i, '');
  if (Object.hasOwn(INTERPRETER_EXT_MAP, base)) {
    return INTERPRETER_EXT_MAP[base] ?? fallback;
  }
  if (base.includes('python')) return '.py';
  if (base.includes('pwsh') || base.includes('powershell')) return '.ps1';
  if (base.includes('bash') || base.includes('zsh') || base === 'sh') return '.sh';
  if (base.includes('cmd') || base.includes('bat')) return '.bat';
  if (base.includes('node')) return '.js';
  if (base.includes('bun') || base.includes('ts')) return '.ts';
  return fallback;
}

export function resolveEvalExecutionTarget(
  p: Extract<ExecPayload, { type: 'eval' }>
): EvalExecutionTarget {
  let effectiveInterpreter = p.interpreter;
  if (p.target === 'wsl2' && effectiveInterpreter !== undefined && (isPwsh(effectiveInterpreter) || isCmd(effectiveInterpreter))) {
    effectiveInterpreter = 'bash';
  }

  const currentInterp = (effectiveInterpreter ?? (p.target === 'wsl2' ? 'bash' : 'bun')).toLowerCase();
  const isShell = SHELL_INTERPRETERS.has(currentInterp);

  if (isShell) {
    if (isPowerShellCode(p.code) && (p.target === 'wsl2' || currentInterp === 'bash' || currentInterp === 'sh')) {
      const orig = effectiveInterpreter ?? (p.target === 'wsl2' ? 'bash' : 'bun');
      console.error(`\n   💡 AGENT HINT: PowerShell cmdlet/code detected in eval payload with shell interpreter '${orig}'.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Automatically switching interpreter to 'pwsh' and target to 'windows'... (Frictionless Recovery)\x1b[0m`);
      effectiveInterpreter = 'pwsh';
      p.target = 'windows';
    } else if (!isShellCommandScript(p.code) && (isJavaScriptOrTypeScriptCode(p.code) || hasTopLevelReturn(p.code))) {
      const orig = effectiveInterpreter ?? (p.target === 'wsl2' ? 'bash' : 'bun');
      const needsWindowsTarget = p.target === 'wsl2' && (/\bbetter-sqlite3\b|[a-zA-Z]:[/\\]/.test(p.code));
      console.error(`\n   💡 AGENT HINT: JavaScript/TypeScript code detected in eval payload with shell interpreter '${orig}'.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Automatically switching interpreter to 'bun'${needsWindowsTarget ? " and target to 'windows'" : ''}... (Frictionless Recovery)\x1b[0m`);
      effectiveInterpreter = 'bun';
      if (needsWindowsTarget) {
        p.target = 'windows';
      }
    } else if (!isShellCommandScript(p.code) && isPythonCode(p.code)) {
      const orig = effectiveInterpreter ?? (p.target === 'wsl2' ? 'bash' : 'bun');
      console.error(`\n   💡 AGENT HINT: Python code detected in eval payload with shell interpreter '${orig}'.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Automatically switching interpreter to 'python'... (Frictionless Recovery)\x1b[0m`);
      effectiveInterpreter = 'python';
    }
  }

  const defaultExt = p.target === 'wsl2' ? '.sh' : '.ts';
  const ext = effectiveInterpreter !== undefined
    ? mapInterpreterExtension(effectiveInterpreter, defaultExt)
    : defaultExt;

  const finalInterpreter = effectiveInterpreter ?? (p.target === 'wsl2' ? 'bash' : 'bun');
  p.interpreter = finalInterpreter;

  return {
    effectiveInterpreter: finalInterpreter,
    ext,
  };
}

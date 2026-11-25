// @ts-nocheck
import path from 'node:path';
import { isPwsh, isCmd } from './command-utils.js';
import { buildNonCodeSpans, createCodeScanState, isIndexInSpans, stepCodeScanState, type CodeScanState } from './quote-spans.js';
import type { ExecPayload } from './schema.js';

export { createCodeScanState, stepCodeScanState, type CodeScanState };

export interface EvalExecutionTarget {
  effectiveInterpreter: string;
  ext: string;
}

const SHELL_INTERPRETERS = new Set([
  'bash', 'bash.exe', 'sh', 'sh.exe', 'zsh', 'zsh.exe',
  'pwsh', 'pwsh.exe', 'powershell', 'powershell.exe',
  'cmd', 'cmd.exe', 'bat',
]);

const JS_ESM_IMPORT_RE = /^import(?:\s*\(|\s*\.meta\b|\s+(?:type\s+)?(?:['"*{]|[A-Za-z_$][\w$]*(?:\s*,\s*(?:\*\s+as\s+[A-Za-z_$][\w$]*|\{[^}]*\}))?\s+from\s+['"]))/;
const JS_DIRECT_STMT_RE = /^(?:export\s|console\.(?:log|error|warn|info|dir|trace)\b|const\s|let\s|var\s|async\s+function|function\*?\s|process\.(?:exit|env|cwd|version|argv)\b|require\s*\()/;
const JS_CONSTRUCT_RE = /\b(?:console\.(?:log|error|warn|info|dir|trace)\s*\(|require\s*\(['"][^'"]+['"]\)|JSON\.(?:stringify|parse)\s*\(|process\.(?:exit|env|cwd|version)\b)/g;
const SHELL_COMMANDS_RE = /^(?:echo|cat|rm|mkdir|touch|cd|ls|dir|git|apt|apt-get|pnpm|npm|yarn|bun|node|python|python3|which|where|curl|wget|chmod|chown|source|rg|grep|egrep|fgrep|find|sed|awk|gawk|jq|printf|docker|gh|kubectl)\s(?![ \t]*=)|^(?:export\s+[A-Za-z_][A-Za-z0-9_]*=)/;
const SHELL_TS_INDICATOR_RE = /\b(?:type|interface|enum|class)\s+[A-Z]/;
const SHELL_OPERATORS_RE = /(?:&&|\|\||(?<![|<>=!])\|(?![|=])|(?:^|\s)\d*>{1,2}\s+\S)/;
const PYTHON_CODE_RE = /^(?:import\s+[a-zA-Z0-9_]+|from\s+[a-zA-Z0-9_]+\s+import|def\s+[a-zA-Z0-9_]+\s*\(|class\s+[a-zA-Z0-9_]+[:(]|print\s*\()/;
const PS_VAR_REGEX = /\$(?:PSScriptRoot|PSVersionTable|LASTEXITCODE|ErrorActionPreference|ProgressPreference)\b/gi;
type CodeSpan = { start: number; end: number };

export function isJavaScriptOrTypeScriptCode(code: string, precomputedSpans?: readonly CodeSpan[]): boolean {
  const trimmed = code.trim();
  if (JS_ESM_IMPORT_RE.test(trimmed) || JS_DIRECT_STMT_RE.test(trimmed)) return true;
  const spans = precomputedSpans ?? buildNonCodeSpans(code, { includeHashComments: true });
  JS_CONSTRUCT_RE.lastIndex = 0;
  for (const m of code.matchAll(JS_CONSTRUCT_RE)) {
    if (m.index !== undefined && !isIndexInSpans(spans, m.index)) return true;
  }
  return false;
}

function classifyShellPsAndJs(code: string): { isShell: boolean; isPs: boolean; isJs: boolean } {
  const trimmed = code.trim();
  // [INTENT]: One shared span scan covers JS constructs and PS cmdlets/vars alongside active-line extraction.
  const spans = buildNonCodeSpans(code, { includeHashComments: true, includeSlashComments: true, includeRegexLiterals: false });
  const activeLines: string[] = [];
  let offset = 0;
  for (const rawLine of code.split('\n')) {
    const trimmedLine = rawLine.trim();
    if (trimmedLine.length > 0 && !trimmedLine.startsWith('//') && !trimmedLine.startsWith('/*')) {
      const firstNonWs = offset + rawLine.search(/\S/);
      if (rawLine[rawLine.search(/\S/)] === '#' || !isIndexInSpans(spans, firstNonWs)) activeLines.push(trimmedLine);
    }
    offset += rawLine.length + 1;
  }
  if (activeLines.some(line => SHELL_COMMANDS_RE.test(line))) return { isShell: true, isPs: false, isJs: false };
  const isPs = isPowerShellCode(code, spans);
  const isJs = isJavaScriptOrTypeScriptCode(code, spans);
  if (isJs || isPythonCode(code) || isPs) return { isShell: false, isPs, isJs };
  if (SHELL_TS_INDICATOR_RE.test(trimmed) || trimmed.includes('=>')) return { isShell: false, isPs: false, isJs: false };
  return { isShell: activeLines.some(line => !line.startsWith('#') && SHELL_OPERATORS_RE.test(line)), isPs: false, isJs: false };
}

export function isShellCommandScript(code: string): boolean {
  return classifyShellPsAndJs(code).isShell;
}

export function isPythonCode(code: string): boolean {
  return PYTHON_CODE_RE.test(code.trim());
}

const PS_CMDLET_REGEX = /(?:^|[;\n|&({])[ \t]*(?:Get|Set|New|Remove|Start|Stop|Restart|Select|Test|Invoke|Clear|Copy|Move|Write|Add|Enter|Exit|Find|Format|Measure|Read|Reset|Resume|Search|Show|Split|Switch|Wait)-(?:[A-Za-z]+)\b/g;

export function isPowerShellCode(code: string, precomputedSpans?: readonly CodeSpan[]): boolean {
  const spans = precomputedSpans ?? buildNonCodeSpans(code, { includeHashComments: true, includeSlashComments: true, includeRegexLiterals: false });
  PS_CMDLET_REGEX.lastIndex = 0;
  for (const m of code.matchAll(PS_CMDLET_REGEX)) {
    if (m.index !== undefined && !isIndexInSpans(spans, m.index)) return true;
  }
  PS_VAR_REGEX.lastIndex = 0;
  for (const m of code.matchAll(PS_VAR_REGEX)) {
    if (m.index !== undefined && !isIndexInSpans(spans, m.index)) return true;
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
      const nextCh = code[i + 6];
      if (nextCh === undefined || /[\s;({['"`!~+-]/.test(nextCh)) return true;
    }
  }
  return false;
}

function findStaticImportEnd(code: string, start: number): number | null {
  const prev = start === 0 ? '\n' : (code[start - 1] ?? '');
  if (start > 0 && !/[\s;]/.test(prev)) return null;
  const nextCh = code[start + 6] ?? '';
  if (!/[\s{'"*]/.test(nextCh)) return null;
  const trimmedAfter = code.slice(start + 6, start + 38).trimStart();
  if (trimmedAfter.startsWith('(') || trimmedAfter.startsWith('.')) return null;

  const scan = createCodeScanState();
  let brace = 0, paren = 0, bracket = 0;
  let sawSpec = false;
  let inSpec = false;
  for (let j = start + 6; j < code.length; j++) {
    const wasStr = scan.inSingle || scan.inDouble;
    const wasLineComment = scan.inLineComment;
    const skip = stepCodeScanState(code, j, scan);
    if (!wasStr && (scan.inSingle || scan.inDouble) && brace === 0 && paren === 0 && bracket === 0) inSpec = true;
    if (skip !== null) {
      if (inSpec && !scan.inSingle && !scan.inDouble) { sawSpec = true; inSpec = false; }
      j = skip;
      if (wasLineComment && !scan.inLineComment && code[j] === '\n' && brace === 0 && paren === 0 && bracket === 0 && sawSpec) {
        if (!/^(?:with|assert)\s*\{/.test(code.slice(j + 1, j + 32).trimStart())) return j;
      }
      continue;
    }
    const ch = code[j];
    if (ch === '{') brace++;
    else if (ch === '}' && brace > 0) brace--;
    else if (ch === '(') paren++;
    else if (ch === ')' && paren > 0) paren--;
    else if (ch === '[') bracket++;
    else if (ch === ']' && bracket > 0) bracket--;
    if (brace === 0 && paren === 0 && bracket === 0 && sawSpec) {
      if (ch === ';') return j + 1;
      if (ch === '\n' && !/^(?:with|assert)\s*\{/.test(code.slice(j + 1, j + 32).trimStart())) return j;
    }
  }
  return sawSpec ? code.length : null;
}

export function wrapCodeInAsyncIife(code: string): string {
  const spans = buildNonCodeSpans(code);
  const importChunks: string[] = [];
  const bodyParts: string[] = [];
  let cursor = 0;
  let braceDepth = 0;
  let spanIdx = 0;

  for (let i = 0; i < code.length; i++) {
    while (spanIdx < spans.length) {
      const span = spans[spanIdx];
      if (span === undefined || i < span.end) break;
      spanIdx++;
    }
    const activeSpan = spans[spanIdx];
    if (activeSpan !== undefined && i >= activeSpan.start && i < activeSpan.end) {
      i = activeSpan.end - 1;
      continue;
    }
    const ch = code[i];
    if (ch === '{') { braceDepth++; continue; }
    if (ch === '}') { if (braceDepth > 0) braceDepth--; continue; }
    if (braceDepth !== 0 || !code.startsWith('import', i)) continue;
    const end = findStaticImportEnd(code, i);
    if (end === null) continue;
    const lineStart = code.lastIndexOf('\n', i - 1) + 1;
    const chunkStart = /^[ \t]*$/.test(code.slice(lineStart, i)) ? lineStart : i;
    if (chunkStart > cursor) bodyParts.push(code.slice(cursor, chunkStart));
    importChunks.push(code.slice(chunkStart, end).trim());
    let nextCursor = end;
    if (code[nextCursor] === '\r') nextCursor++;
    if (code[nextCursor] === '\n') nextCursor++;
    cursor = nextCursor;
    i = nextCursor - 1;
  }
  if (cursor < code.length) bodyParts.push(code.slice(cursor));

  const imports = importChunks.length > 0 ? `${importChunks.join('\n')}\n\n` : '';
  const body = bodyParts.join('');
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
  const methodMatch = code.slice(dotIdx + 1, dotIdx + 32).match(/^(exec|prepare)\s*\(/);
  if (methodMatch === null || methodMatch[0] === undefined) return null;
  const openParenIdx = dotIdx + methodMatch[0].length;
  const afterOpen = code.slice(openParenIdx + 1, openParenIdx + 256);
  const leadingMatch = afterOpen.match(/^\s*(?:\\\s*)?/);
  const leadingOffset = leadingMatch?.[0]?.length ?? 0;
  const candidateStart = afterOpen.slice(leadingOffset);
  const firstChar = candidateStart[0];
  if (firstChar === undefined || firstChar === "'" || firstChar === '"' || firstChar === '`') return null;
  if (!UNQUOTED_SQL_START_REGEX.test(candidateStart)) return null;
  const afterKw = candidateStart.replace(/^[A-Za-z]+\s+/, '');
  if (/^(?:as|satisfies|in|instanceof)\b|^[,)=:?;+-]/i.test(afterKw)) return null;
  const closeParenIdx = findMatchingSqlCloseParen(code, openParenIdx + 1);
  if (closeParenIdx === -1) return null;
  const rawBody = code.slice(openParenIdx + 1, closeParenIdx)
    .replace(/^(\s*)\\/, '$1')
    .replace(/(?<!\\)(\\+)(\s*)$/, (m, slashes: string, ws: string) => (slashes.length % 2 === 1 ? `${slashes.slice(0, -1)}${ws}` : m))
    .replace(/(?<!\\)(\\*)(`|\$\{)/g, (_m, slashes: string, tok: string) => (slashes.length % 2 === 1 ? `${slashes}\\\\${tok}` : `${slashes}\\${tok}`));
  return { openParenIdx, closeParenIdx, sqlLiteral: `\`${rawBody}\`` };
}

// [INTENT]: Restores backtick template literals around unquoted SQL statements inside .exec(...) and .prepare(...) when PowerShell double-quoting stripped the backticks.
export function healStrippedSqlTemplateLiterals(code: string, deferredLogs?: string[]): string {
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
  const banner = `\n   🛠️ AUTONOMOUS HEALING: Detected unquoted SQL inside .exec()/.prepare() from PowerShell backtick stripping. Restoring template literals... (Frictionless Recovery)\x1b[0m`;
  if (deferredLogs !== undefined) deferredLogs.push(banner);
  else console.error(banner);
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
  if (p.target === 'wsl2' && effectiveInterpreter !== undefined) {
    const interpBase = path.basename(effectiveInterpreter.replace(/\\/g, '/')).toLowerCase();
    if (isPwsh(interpBase) || isCmd(interpBase) || interpBase === 'ps1' || interpBase === 'bat') {
      effectiveInterpreter = 'bash';
    }
  }

  const currentInterp = (effectiveInterpreter ?? (p.target === 'wsl2' ? 'bash' : 'bun')).toLowerCase();
  const isShell = SHELL_INTERPRETERS.has(currentInterp);

  if (isShell) {
    const classified = classifyShellPsAndJs(p.code);
    if (!classified.isShell) {
      if (classified.isPs && (p.target === 'wsl2' || currentInterp === 'bash' || currentInterp === 'sh')) {
        const orig = effectiveInterpreter ?? (p.target === 'wsl2' ? 'bash' : 'bun');
        effectiveInterpreter = 'pwsh';
        p.interpreter = 'pwsh';
        p.target = 'windows';
        console.error(`\n   💡 AGENT HINT: PowerShell cmdlet/code detected in eval payload with shell interpreter '${orig}'.`);
        console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Automatically switching interpreter to 'pwsh' and target to 'windows'... (Frictionless Recovery)\x1b[0m`);
      } else if (!classified.isPs && !(p.target !== 'wsl2' && isPwsh(p.interpreter ?? '')) && (classified.isJs || hasTopLevelReturn(p.code))) {
        const orig = effectiveInterpreter ?? (p.target === 'wsl2' ? 'bash' : 'bun');
        const needsWindowsTarget = p.target === 'wsl2' && (/\bbetter-sqlite3\b|(?<![A-Za-z0-9_:])[a-zA-Z]:[/\\]/.test(p.code));
        effectiveInterpreter = 'bun';
        p.interpreter = 'bun';
        if (needsWindowsTarget) {
          p.target = 'windows';
        }
        console.error(`\n   💡 AGENT HINT: JavaScript/TypeScript code detected in eval payload with shell interpreter '${orig}'.`);
        console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Automatically switching interpreter to 'bun'${needsWindowsTarget ? " and target to 'windows'" : ''}... (Frictionless Recovery)\x1b[0m`);
      } else if (isPythonCode(p.code)) {
        const orig = effectiveInterpreter ?? (p.target === 'wsl2' ? 'bash' : 'bun');
        effectiveInterpreter = 'python';
        p.interpreter = 'python';
        console.error(`\n   💡 AGENT HINT: Python code detected in eval payload with shell interpreter '${orig}'.`);
        console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Automatically switching interpreter to 'python'... (Frictionless Recovery)\x1b[0m`);
      }
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

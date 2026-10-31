// @ts-nocheck
import { match } from 'ts-pattern';
import { isPwsh, isCmd } from './command-utils.js';
import type { ExecPayload } from './schema.js';

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
  const shellOperators = /(?:&&|\|\||\|(?!=)|>(?!=)|<(?!=))/;
  return lines.some(line => shellCommands.test(line)) || shellOperators.test(code);
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
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    const nextChar = code[i + 1];

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingleQuote) {
      if (char === '\\') { i++; continue; }
      if (char === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (char === '\\') { i++; continue; }
      if (char === '"') inDoubleQuote = false;
      continue;
    }
    if (inBacktick) {
      if (char === '\\') { i++; continue; }
      if (char === '`') inBacktick = false;
      continue;
    }

    if (char === '/' && nextChar === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (char === '/' && nextChar === '*') {
      inBlockComment = true;
      i++;
      continue;
    }

    if (char === "'") { inSingleQuote = true; continue; }
    if (char === '"') { inDoubleQuote = true; continue; }
    if (char === '`') { inBacktick = true; continue; }

    if (char === '{') {
      depth++;
      continue;
    }
    if (char === '}') {
      if (depth > 0) depth--;
      continue;
    }

    // Check for return keyword at depth === 0
    if (depth === 0 && (i === 0 || /[\s;]/.test(code[i - 1] ?? ''))) {
      if (code.startsWith('return', i)) {
        const afterReturn = code[i + 6] ?? '';
        if (/[\s;({'"`]/.test(afterReturn)) {
          return true;
        }
      }
    }
  }
  return false;
}

export function wrapCodeInAsyncIife(code: string): string {
  const lines = code.split('\n');
  const importLines: string[] = [];
  const bodyLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^import\s+(?:(?:\*\s+as\s+\w+)|(?:\{\s*[^}]*\s*\}|\w+)(?:\s*,\s*(?:\{\s*[^}]*\s*\}|\w+))*)?\s+from\s+['"][^'"]+['"];?$/.test(trimmed) || /^import\s+['"][^'"]+['"];?$/.test(trimmed)) {
      importLines.push(line);
    } else {
      bodyLines.push(line);
    }
  }

  const imports = importLines.length > 0 ? `${importLines.join('\n')}\n\n` : '';
  const body = bodyLines.join('\n');

  return `${imports}(async () => {\n${body}\n})().then(res => {\n  if (res !== undefined) console.log(typeof res === 'object' ? JSON.stringify(res, null, 2) : res);\n}).catch(err => {\n  console.error(err);\n  process.exit(1);\n});`;
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

  let ext = p.target === 'wsl2' ? '.sh' : '.ts';
  if (effectiveInterpreter !== undefined) {
    const interp = effectiveInterpreter.toLowerCase();
    ext = match(interp)
      .when(i => i.includes('python') || i === 'py', () => '.py')
      .when(i => i.includes('pwsh') || i.includes('powershell') || i === 'ps1', () => '.ps1')
      .when(i => i.includes('bash') || i.includes('sh') || i.includes('zsh'), () => '.sh')
      .when(i => i.includes('cmd') || i.includes('bat'), () => '.bat')
      .when(i => i.includes('node') || i === 'js' || i === 'javascript', () => '.js')
      .when(i => i.includes('bun') || i === 'ts' || i === 'typescript', () => '.ts')
      .otherwise(() => ext);
  }

  const finalInterpreter = effectiveInterpreter ?? (p.target === 'wsl2' ? 'bash' : 'bun');
  p.interpreter = finalInterpreter;

  return {
    effectiveInterpreter: finalInterpreter,
    ext,
  };
}

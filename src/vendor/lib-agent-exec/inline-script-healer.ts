// @ts-nocheck
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { healStrippedSqlTemplateLiterals } from './eval-healer.js';
import { healEvalCodePathHallucinations } from './path-healer.js';

const RESOLVER_MODULE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cwd-module-resolver.mjs');

const INTERPRETER_INLINE_FLAGS: Record<string, readonly string[]> = {
  node: ['-e', '--eval', '-p', '--print'],
  bun: ['-e', '--eval', '-p', '--print'],
  tsx: ['-e', '--eval', '-p', '--print'],
  'ts-node': ['-e', '--eval', '-p', '--print'],
  python: ['-c', '--command'],
  python3: ['-c', '--command'],
};

const INTERPRETER_VALUE_FLAGS: Record<string, readonly string[]> = {
  node: [
    '-r', '--require', '--import', '--loader', '--experimental-loader',
    '-C', '--conditions', '--input-type', '--env-file', '--env-file-if-exists',
  ],
  bun: ['-r', '--preload', '--conditions', '--env-file', '--cwd', '--config', '-c'],
  tsx: ['-r', '--require', '--import', '--tsconfig', '--conditions', '--env-file'],
  'ts-node': ['-r', '--require', '-P', '--project', '-O', '--compiler-options'],
  python: ['-W', '-X'],
  python3: ['-W', '-X'],
};

export interface InlineScriptDetails {
  flagIdx: number;
  isPrint: boolean;
  scriptContent: string;
  inputType: 'module' | 'commonjs' | null;
  stripIndices: number[];
}

// [INTENT]: Restores backtick template literals on String.raw`...` path expressions stripped by PowerShell double-quoting (e.g. String.rawC:\path\file -> String.raw`C:\path\file`).
export function healStrippedStringRawLiterals(code: string): string {
  let result = '';
  let lastCopied = 0;
  let healedCount = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < code.length; i++) {
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
      if (ch === '\\') { i++; continue; }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inBacktick) {
      if (ch === '\\') { i++; continue; }
      if (ch === '`') inBacktick = false;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === '`') { inBacktick = true; continue; }

    const prevChar = i > 0 ? (code[i - 1] ?? '') : '';
    if (ch === 'S' && !/[A-Za-z0-9_$.]/.test(prevChar) && code.slice(i, i + 10) === 'String.raw') {
      const startIdx = i + 10;
      const afterRaw = code.slice(startIdx);
      if (/^(?:[a-zA-Z]:[/\\]|[/\\]|\.\.?[/\\])/.test(afterRaw)) {
        let parenDepth = 0;
        let bracketDepth = 0;
        let endIdx = code.length;
        for (let k = startIdx; k < code.length; k++) {
          const c = code[k];
          if (c === '(') {
            parenDepth++;
          } else if (c === ')') {
            if (parenDepth === 0) {
              endIdx = k;
              break;
            }
            parenDepth--;
          } else if (c === '[') {
            bracketDepth++;
          } else if (c === ']') {
            if (bracketDepth === 0) {
              endIdx = k;
              break;
            }
            bracketDepth--;
          } else if (parenDepth === 0 && bracketDepth === 0 && (c === ',' || c === ';' || c === '\n' || c === '\r')) {
            endIdx = k;
            break;
          }
        }
        if (endIdx > startIdx) {
          const rawBody = code.slice(startIdx, endIdx).replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
          result += `${code.slice(lastCopied, startIdx)}\`${rawBody}\``;
          lastCopied = endIdx;
          i = endIdx - 1;
          healedCount++;
          continue;
        }
      }
    }
  }

  if (healedCount === 0) return code;

  result += code.slice(lastCopied);
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected unquoted String.raw path from PowerShell backtick stripping. Restoring template literal... (Frictionless Recovery)\x1b[0m`);
  return result;
}

export function buildCwdNodeModulePaths(cwd: string, existingNodePath?: string): string {
  const paths: string[] = [];
  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, 'node_modules');
    if (!paths.includes(candidate)) {
      paths.push(candidate);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  if (typeof existingNodePath === 'string' && existingNodePath.length > 0) {
    for (const entry of existingNodePath.split(path.delimiter)) {
      const trimmed = entry.trim();
      if (trimmed.length > 0 && !paths.includes(trimmed)) {
        paths.push(trimmed);
      }
    }
  }

  return paths.join(path.delimiter);
}

// [SIDE-EFFECT]: Populates NODE_PATH (and Node's synchronous registerHooks preload for ESM/relative specifiers) so temp scripts in os.tmpdir() resolve workspace packages cleanly.
export function configureCwdModuleResolution(
  envOverrides: Record<string, string>,
  cwd: string,
  interpreterName: string,
  target?: string,
  payloadEnv?: Record<string, string | undefined>
): void {
  if (target === 'wsl2') {
    return;
  }

  const baseNodePath = envOverrides['NODE_PATH'] ?? payloadEnv?.['NODE_PATH'] ?? process.env['NODE_PATH'];
  envOverrides['NODE_PATH'] = buildCwdNodeModulePaths(cwd, baseNodePath);

  if (['node', 'tsx', 'ts-node'].includes(interpreterName.toLowerCase()) && fs.existsSync(RESOLVER_MODULE_PATH)) {
    envOverrides['AGENT_EXEC_INLINE_CWD'] = path.resolve(cwd);
    const resolverUrl = pathToFileURL(RESOLVER_MODULE_PATH).href;
    const importFlag = `--import=${resolverUrl}`;
    const baseNodeOptions = envOverrides['NODE_OPTIONS'] ?? payloadEnv?.['NODE_OPTIONS'] ?? process.env['NODE_OPTIONS'] ?? '';
    if (!baseNodeOptions.includes(resolverUrl)) {
      const trimmed = baseNodeOptions.trim();
      envOverrides['NODE_OPTIONS'] = trimmed.length > 0 ? `${trimmed} ${importFlag}` : importFlag;
    }
  }
}

export function getInlineScriptDetails(interpreter: string, args: readonly string[]): InlineScriptDetails | null {
  const lower = interpreter.toLowerCase();
  const allowed = INTERPRETER_INLINE_FLAGS[lower];
  if (allowed === undefined || args.length === 0) {
    return null;
  }
  const valueFlags = INTERPRETER_VALUE_FLAGS[lower] ?? [];
  let inputType: 'module' | 'commonjs' | null = null;
  const stripIndices: number[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;

    if (allowed.includes(arg)) {
      const scriptContent = args[i + 1];
      if (scriptContent !== undefined) {
        return {
          flagIdx: i,
          isPrint: arg === '-p' || arg === '--print',
          scriptContent,
          inputType,
          stripIndices,
        };
      }
      return null;
    }

    if (arg.startsWith('--input-type=')) {
      const val = arg.slice('--input-type='.length).toLowerCase();
      if (val === 'module' || val === 'commonjs') {
        inputType = val;
      }
      stripIndices.push(i);
      continue;
    }

    if (arg === '--input-type') {
      const nextVal = args[i + 1]?.toLowerCase();
      if (nextVal === 'module' || nextVal === 'commonjs') {
        inputType = nextVal;
        stripIndices.push(i, i + 1);
        i++;
        continue;
      }
    }

    if (!arg.startsWith('-')) {
      return null;
    }

    if (arg.startsWith('./') || arg.startsWith('.\\') || /\.(?:ts|js|mjs|cjs|py)$/i.test(arg)) {
      return null;
    }

    if (valueFlags.includes(arg) && i + 1 < args.length) {
      i++;
    }
  }

  return null;
}

export function rewriteInlineScriptToTempFile(params: {
  interpreterName: string;
  args: string[];
  envOverrides: Record<string, string>;
  cwd: string;
  target?: 'windows' | 'wsl2';
  payloadEnv?: Record<string, string | undefined>;
  startIdx?: number;
}): string | null {
  const { interpreterName, args, envOverrides, cwd, target, payloadEnv, startIdx = 0 } = params;
  const subArgs = startIdx > 0 ? args.slice(startIdx) : args;
  const details = getInlineScriptDetails(interpreterName, subArgs);
  if (details === null) {
    return null;
  }

  const { flagIdx, isPrint, scriptContent, inputType, stripIndices } = details;
  console.error(`\n   💡 AGENT INTERCEPT: Transparently rewriting inline ${interpreterName} script to a temporary file execution to avoid quoting bugs... (Frictionless Recovery)`);

  const ext = interpreterName.startsWith('python')
    ? 'py'
    : (['bun', 'tsx', 'ts-node'].includes(interpreterName)
      ? 'ts'
      : (inputType === 'module' ? 'mjs' : (inputType === 'commonjs' ? 'cjs' : 'js')));

  const tmpFile = path.join(
    os.tmpdir(),
    `.agent_inline_script_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`
  );

  let fileContent = interpreterName.startsWith('python')
    ? `import sys; sys.path.insert(0, '')\n${scriptContent}`
    : healStrippedStringRawLiterals(
        healStrippedSqlTemplateLiterals(
          healEvalCodePathHallucinations(scriptContent, cwd, target)
        )
      );

  if (isPrint) {
    fileContent = `try {\n  const __res = eval(${JSON.stringify(fileContent)});\n  if (__res !== undefined) console.log(__res);\n} catch {\n  ${fileContent}\n}\n`;
  }

  if (!interpreterName.startsWith('python')) {
    configureCwdModuleResolution(envOverrides, cwd, interpreterName, target, payloadEnv);
  }

  fs.writeFileSync(tmpFile, fileContent, { mode: 0o600 });
  process.on('exit', () => {
    try {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    } catch {
      // ignore
    }
  });

  const absFlagIdx = startIdx + flagIdx;
  args.splice(absFlagIdx, 2, tmpFile);

  const sortedStrip = [...stripIndices]
    .map(idx => startIdx + idx)
    .sort((a, b) => b - a);
  for (const absStripIdx of sortedStrip) {
    if (absStripIdx < absFlagIdx) {
      args.splice(absStripIdx, 1);
    }
  }

  return tmpFile;
}

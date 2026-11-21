// @ts-nocheck
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCodeScanState, healStrippedSqlTemplateLiterals, stepCodeScanState } from './eval-healer.js';
import { healEvalCodePathHallucinations } from './path-healer.js';
import { emitInterceptBanner } from './utils.js';

const RESOLVER_MODULE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cwd-module-resolver.mjs');
const TEMP_FILES_TO_CLEANUP = new Set<string>();
let exitCleanupRegistered = false;

function registerTempScriptCleanup(tmpFile: string): void {
  TEMP_FILES_TO_CLEANUP.add(tmpFile);
  if (exitCleanupRegistered) return;
  exitCleanupRegistered = true;
  process.once('exit', () => {
    for (const filePath of TEMP_FILES_TO_CLEANUP) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // ignore cleanup failure
      }
    }
  });
}

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

function findStringRawEndIdx(code: string, startIdx: number): number {
  let parenDepth = 0;
  let bracketDepth = 0;
  for (let k = startIdx; k < code.length; k++) {
    const c = code[k];
    if (c === '(') parenDepth++;
    else if (c === ')') {
      if (parenDepth === 0) return k;
      parenDepth--;
    } else if (c === '[') bracketDepth++;
    else if (c === ']') {
      if (bracketDepth === 0) return k;
      bracketDepth--;
    } else if (parenDepth === 0 && bracketDepth === 0 && (c === ',' || c === ';' || c === '\n' || c === '\r')) {
      return k;
    }
  }
  return code.length;
}

function tryHealStringRawAt(code: string, idx: number): { startIdx: number; endIdx: number; literal: string } | null {
  const prevChar = idx > 0 ? (code[idx - 1] ?? '') : '';
  if (code[idx] !== 'S' || /[A-Za-z0-9_$.]/.test(prevChar) || code.slice(idx, idx + 10) !== 'String.raw') {
    return null;
  }
  const startIdx = idx + 10;
  if (!/^(?:[a-zA-Z]:[/\\]|[/\\]|\.\.?[/\\])/.test(code.slice(startIdx))) {
    return null;
  }
  const endIdx = findStringRawEndIdx(code, startIdx);
  if (endIdx <= startIdx) return null;
  const rawBody = code.slice(startIdx, endIdx).replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  return { startIdx, endIdx, literal: `\`${rawBody}\`` };
}

// [INTENT]: Restores backtick template literals on String.raw`...` path expressions stripped by PowerShell double-quoting (e.g. String.rawC:\path\file -> String.raw`C:\path\file`).
export function healStrippedStringRawLiterals(code: string): string {
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
    const healed = tryHealStringRawAt(code, i);
    if (healed === null) continue;
    result += `${code.slice(lastCopied, healed.startIdx)}${healed.literal}`;
    lastCopied = healed.endIdx;
    i = healed.endIdx - 1;
    healedCount++;
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

    if (arg.startsWith('./') || arg.startsWith('.\\')) {
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
  emitInterceptBanner(`\n   💡 AGENT INTERCEPT: Transparently rewriting inline ${interpreterName} script to a temporary file execution to avoid quoting bugs... (Frictionless Recovery)`);

  const ext = interpreterName.startsWith('python')
    ? 'py'
    : (['bun', 'tsx', 'ts-node'].includes(interpreterName)
      ? 'ts'
      : (inputType === 'module' ? 'mjs' : (inputType === 'commonjs' ? 'cjs' : 'js')));

  const tmpFile = path.join(
    os.tmpdir(),
    `.agent_inline_script_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`
  );

  const skipValidFileRewrite = target !== 'wsl2' && ['node', 'tsx', 'ts-node'].includes(interpreterName);
  let fileContent = interpreterName.startsWith('python')
    ? `import sys; sys.path.insert(0, '')\n${scriptContent}`
    : healStrippedStringRawLiterals(
        healStrippedSqlTemplateLiterals(
          healEvalCodePathHallucinations(scriptContent, cwd, target, { skipValidFileRewrite })
        )
      );

  if (isPrint) {
    fileContent = `try {\n  const __res = eval(${JSON.stringify(fileContent)});\n  if (__res !== undefined) console.log(__res);\n} catch (__err) {\n  if (!(__err instanceof SyntaxError)) throw __err;\n  ${fileContent}\n}\n`;
  }

  if (!interpreterName.startsWith('python')) {
    configureCwdModuleResolution(envOverrides, cwd, interpreterName, target, payloadEnv);
  }

  fs.writeFileSync(tmpFile, fileContent, { mode: 0o600 });
  registerTempScriptCleanup(tmpFile);

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

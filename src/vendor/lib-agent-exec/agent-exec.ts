// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { match, P } from 'ts-pattern';
import { executeCommand } from './execution-engine.js';
import { buildCommand } from './command-builder.js';
import { PayloadSchema, agentExecCliArgsSchema, normalizeTarget } from './schema.js';
import { showHelp, showUsageError } from './help.js';
import { decodePayloadBuffer } from './utils.js';
import { tryHealJsonPayload } from './command-utils.js';
import { AGENT_EXEC_README_URL } from './interceptors/utils.js';
import {
  hasTopLevelCliFlag,
  loadWorkspacePlugins,
  mergeFinalEnvironment,
  parseTimeoutOverride,
  resolveAndValidateCwd,
  splitRawCommandInvocation,
} from './cli-loader.js';

const DEFAULT_MAX_PAYLOAD_SIZE = 10 * 1024 * 1024;
let payloadPath = '';
let interceptorsPaths: string[] = [];
let targetOverride: string | undefined;
let cwdOverride: string | undefined;
let timeoutOverrideRaw: string | number | undefined;
let hasBlankTimeoutMs = false;
let positionals: string[] = [];
let isJson = hasTopLevelCliFlag(process.argv.slice(2), (tok) => tok === '--json');

function hasTopLevelVersionFlag(argv: readonly string[]): boolean {
  return hasTopLevelCliFlag(argv, (tok) => tok === '--version' || tok === '-v' || tok === '-V');
}

function fatalError(msg: string, details?: string[]): never {
  if (isJson) {
    console.log(JSON.stringify({ status: 'error', message: msg, details }));
  } else {
    console.error(`❌ Error: ${msg}`);
    if (details) {
      for (const d of details) console.error(`  - ${d}`);
    }
  }
  process.exit(1);
}

function getMaxPayloadSize(): number {
  const raw = process.env['AGENT_EXEC_MAX_PAYLOAD_SIZE']?.trim() ?? '';
  if (/^[1-9]\d*$/.test(raw)) {
    const envSize = Number(raw);
    if (Number.isSafeInteger(envSize) && envSize > 0) return envSize;
  }
  return DEFAULT_MAX_PAYLOAD_SIZE;
}

function unwrapQuotedJsonInput(rawArg: string): string {
  const cleaned = rawArg.trim();
  if ((cleaned.startsWith("'") && cleaned.endsWith("'") && cleaned.length >= 2) ||
      (cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length >= 2)) {
    const inner = cleaned.slice(1, -1).trim();
    if (inner.startsWith('{') && inner.endsWith('}')) return inner;
  }
  return cleaned;
}

function readPayloadInput(rawArg: string): string {
  const maxPayloadSize = getMaxPayloadSize();
  const absPayloadPath = path.resolve(rawArg);
  if (!fs.existsSync(absPayloadPath)) {
    if (rawArg.startsWith('base64:')) {
      const buf = Buffer.from(rawArg.slice(7), 'base64');
      if (buf.length > maxPayloadSize) fatalError(`Payload exceeds ${maxPayloadSize} bytes limit.`);
      return decodePayloadBuffer(buf);
    }
    const unwrapped = unwrapQuotedJsonInput(rawArg);
    if (unwrapped.startsWith('{') || unwrapped.startsWith('```')) return unwrapped;
    if (!positionals[0] || path.extname(rawArg).toLowerCase() === '.json') {
      fatalError(`Payload file not found: ${rawArg}`);
    }
    console.error(`\n   💡 AGENT HINT: You passed a raw command directly to agent-exec.ts instead of a payload file.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-wrapping command into JSON payload... (Frictionless Recovery)\x1b[0m`);
    return JSON.stringify({ type: 'command', target: 'windows', command: positionals[0], args: positionals.slice(1) });
  }
  let payloadBuf: Buffer;
  try {
    const stats = fs.statSync(absPayloadPath);
    if (!stats.isFile()) fatalError(`Payload path must be a regular file.`);
    if (stats.size > maxPayloadSize) fatalError(`Payload file exceeds ${maxPayloadSize} bytes limit.`);
    payloadBuf = fs.readFileSync(absPayloadPath);
  } catch (err) {
    fatalError(`Payload path must be a regular file. ${err instanceof Error ? err.message : String(err)}`);
  }
  if (payloadBuf.length > maxPayloadSize) fatalError(`Payload file exceeds ${maxPayloadSize} bytes limit.`);
  return decodePayloadBuffer(payloadBuf);
}

try {
  const rawArgv = process.argv.slice(2);
  if (hasTopLevelVersionFlag(rawArgv)) {
    console.log(isJson ? JSON.stringify({ version: '1.0.0' }) : '1.0.0');
    process.exit(0);
  }
  const options = {
    interceptors: { type: 'string', multiple: true },
    plugin: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
    json: { type: 'boolean' },
    payload: { type: 'string', short: 'p' },
    base64: { type: 'string' },
    payloadPath: { type: 'string' },
    target: { type: 'string', short: 't' },
    cwd: { type: 'string' },
    timeout: { type: 'string' },
    timeoutMs: { type: 'string' },
  } as const;

  let values: Record<string, string | boolean | string[] | undefined>;
  try {
    const { flagArgs, rawPositionals } = splitRawCommandInvocation(rawArgv);
    const parsed = parseArgs({ args: flagArgs, options, strict: true, allowPositionals: rawPositionals === null });
    values = parsed.values;
    positionals = rawPositionals ?? parsed.positionals;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Unknown option')) {
      fatalError(`\n   \x1b[38;5;208m🛠️ AUTONOMOUS HEALING: You passed a CLI flag to 'agent-exec.ts' (${msg}).\n   'agent-exec.ts' ONLY accepts a JSON payload file. Put your command and arguments INSIDE the JSON payload file.\n   Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
    }
    throw err;
  }
  targetOverride = typeof values['target'] === 'string' ? values['target'] : undefined;
  cwdOverride = typeof values['cwd'] === 'string' ? values['cwd'] : undefined;
  const rawTimeoutMs = values['timeoutMs'];
  const rawTimeout = values['timeout'];
  hasBlankTimeoutMs = typeof rawTimeoutMs === 'string' && rawTimeoutMs.trim().length === 0 && rawTimeout === undefined;
  timeoutOverrideRaw = (typeof rawTimeoutMs === 'string' && rawTimeoutMs.trim().length > 0) ? rawTimeoutMs : (typeof rawTimeout === 'string' ? rawTimeout : undefined);

  if (typeof values['base64'] === 'string' && values['base64'].trim().length === 0) {
    fatalError('Invalid --base64 value: must not be empty.');
  }
  if (typeof values['payload'] === 'string' && values['payload'].trim().length === 0) {
    fatalError('Invalid --payload value: must not be empty.');
  }
  const parsedArgs = agentExecCliArgsSchema.parse(values);
  if (parsedArgs.json === true) isJson = true;
  const rawBase64 = typeof parsedArgs.base64 === 'string' ? `base64:${parsedArgs.base64}` : undefined;
  const firstPos = (positionals[0] ?? '').trim();
  const isJsonStart = firstPos.startsWith('{') || firstPos.startsWith("'{") || firstPos.startsWith('"{') || firstPos.startsWith("'{\\");
  const posInput = positionals.length > 0 ? (isJsonStart ? positionals.join(' ') : positionals[0]) : undefined;
  const resolvedInput = rawBase64 ?? parsedArgs.payload ?? parsedArgs.payloadPath ?? posInput;
  const result = match({ help: parsedArgs.help, version: parsedArgs.version, resolvedInput })
    .with({ version: true }, () => {
      console.log(isJson ? JSON.stringify({ version: '1.0.0' }) : '1.0.0');
      return process.exit(0);
    })
    .with({ help: true }, () => showHelp(Boolean(parsedArgs.json)))
    .with({ resolvedInput: P.string }, ({ resolvedInput: validInput }) => {
      if (validInput.trim().length === 0) showUsageError('Missing payload JSON file path.', isJson);
      const interceptors: string[] = Array.isArray(parsedArgs.interceptors)
        ? [...parsedArgs.interceptors]
        : (typeof parsedArgs.interceptors === 'string' ? [parsedArgs.interceptors] : []);
      if (typeof parsedArgs.plugin === 'string') interceptors.push(parsedArgs.plugin);
      return { path: validInput, interceptors };
    })
    .otherwise(() => showUsageError('Missing payload JSON file path.', isJson));

  payloadPath = result.path;
  interceptorsPaths = result.interceptors;
} catch (err: unknown) {
  showUsageError(err instanceof Error ? err.message : String(err), isJson);
}

try {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  await loadWorkspacePlugins(
    interceptorsPaths,
    [process.cwd(), scriptDir],
    (resolvedPath) => fatalError(`Interceptor plugin must be loaded from within the workspace: ${resolvedPath}`),
    (resolvedPath, err) => fatalError(`Failed to load interceptor plugin at ${resolvedPath}: ${err instanceof Error ? err.message : String(err)}`),
  );

  const payloadStr = readPayloadInput(payloadPath);
  const absPayloadForExt = path.resolve(payloadPath);
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(payloadStr);
  } catch (parseErr) {
    const isFile = fs.existsSync(absPayloadForExt);
    const ext = isFile ? path.extname(absPayloadForExt).toLowerCase() : '';
    const healed = (!isFile || ext !== '.json') ? tryHealJsonPayload(payloadStr) : null;
    if (healed !== null && healed !== undefined) {
      console.error(`\n   💡 AGENT HINT: Malformed JSON payload detected.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-healed malformed JSON payload string... (Frictionless Recovery)\x1b[0m`);
      rawPayload = healed;
    } else {
      throw parseErr;
    }
  }
  const parseResult = PayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    const details = parseResult.error.issues.map(err => `${err.path.length > 0 ? err.path.join('.') : 'root'}: ${err.message}`);
    fatalError('Payload schema validation failed.', details);
  }

  const payload = parseResult.data;
  if (targetOverride !== undefined) {
    const normalized = normalizeTarget(targetOverride);
    if (!normalized) fatalError(`Invalid --target value: '${targetOverride}'. Must be 'windows', 'wsl2', or an alias (wsl, linux, ubuntu, native, win, pwsh, cmd, bash).`);
    payload.target = normalized;
  }
  if (cwdOverride !== undefined) {
    if (cwdOverride.trim().length === 0) fatalError('Invalid --cwd value: must not be empty.');
    payload.cwd = cwdOverride;
  }
  if (hasBlankTimeoutMs) fatalError('Invalid --timeoutMs value: must not be empty.');
  if (timeoutOverrideRaw !== undefined) {
    const parsedTimeout = parseTimeoutOverride(timeoutOverrideRaw);
    if (parsedTimeout === undefined) fatalError(`Invalid timeout value: '${String(timeoutOverrideRaw)}'.`);
    payload.timeoutMs = parsedTimeout;
  }

  const absPayloadPath = path.resolve(payloadPath);
  process.once('exit', () => {
    if (payload.keepPayload === true || path.extname(absPayloadPath).toLowerCase() !== '.json') return;
    if (fs.existsSync(absPayloadPath)) {
      try { fs.unlinkSync(absPayloadPath); } catch { /* ignore */ }
    }
  });

  const cwd = resolveAndValidateCwd(payload, (badCwd) => fatalError(`The provided cwd '${badCwd}' does not exist or is not a directory.`));
  const effectiveIsJson = isJson || Boolean(payload.expectJsonEnvelope);
  const { cmd, args, tempScriptPath, envOverrides, resolvedCwd } = buildCommand(payload, cwd, effectiveIsJson);
  const finalEnv = mergeFinalEnvironment(payload.env, envOverrides);

  await executeCommand(payload, resolvedCwd ?? cwd, cmd, args, finalEnv, tempScriptPath, effectiveIsJson);
} catch (err) {
  if (err instanceof SyntaxError) {
    fatalError(`Invalid JSON in payload file. ${err.message}`);
  } else {
    fatalError(`Error executing agent-exec: ${err instanceof Error ? err.message : String(err)}`);
  }
}

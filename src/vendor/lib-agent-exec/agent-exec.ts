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
import { AGENT_EXEC_README_URL } from './interceptors/utils.js';
import { loadWorkspacePlugins, mergeFinalEnvironment, resolveAndValidateCwd } from './cli-loader.js';

const DEFAULT_MAX_PAYLOAD_SIZE = 10 * 1024 * 1024;
let payloadPath: string;
let interceptorsPaths: string[] = [];
let targetOverride: string | undefined;
let positionals: string[] = [];
const isJson = process.argv.includes('--json');

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

function readPayloadInput(rawArg: string): string {
  const absPayloadPath = path.resolve(rawArg);
  if (!fs.existsSync(absPayloadPath)) {
    if (rawArg.startsWith('base64:')) return Buffer.from(rawArg.slice(7), 'base64').toString('utf8');
    if (rawArg.trim().startsWith('{')) return rawArg;
    if (!positionals[0]) fatalError('Missing payload JSON file path or raw command.');
    console.error(`\n   💡 AGENT HINT: You passed a raw command directly to agent-exec.ts instead of a payload file.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-wrapping command into JSON payload... (Frictionless Recovery)\x1b[0m`);
    return JSON.stringify({ type: 'command', target: 'windows', command: positionals[0], args: positionals.slice(1) });
  }
  let payloadBuf: Buffer;
  try {
    payloadBuf = fs.readFileSync(absPayloadPath);
  } catch (err) {
    fatalError(`Payload path must be a regular file. ${err instanceof Error ? err.message : String(err)}`);
  }
  const envSize = process.env['AGENT_EXEC_MAX_PAYLOAD_SIZE'] ? Number.parseInt(process.env['AGENT_EXEC_MAX_PAYLOAD_SIZE'], 10) : NaN;
  const maxPayloadSize = !Number.isNaN(envSize) && envSize > 0 ? envSize : DEFAULT_MAX_PAYLOAD_SIZE;
  if (payloadBuf.length > maxPayloadSize) fatalError(`Payload file exceeds ${maxPayloadSize} bytes limit.`);
  return decodePayloadBuffer(payloadBuf);
}

try {
  const options = {
    interceptors: { type: 'string', multiple: true },
    plugin: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
    json: { type: 'boolean' },
    payloadPath: { type: 'string' },
    target: { type: 'string' },
  } as const;

  let values: Record<string, string | boolean | string[] | undefined>;
  try {
    const parsed = parseArgs({ args: process.argv.slice(2), options, strict: true, allowPositionals: true });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Unknown option')) {
      fatalError(`\n   \x1b[38;5;208m🛠️ AUTONOMOUS HEALING: You passed a CLI flag to 'agent-exec.ts' (${msg}).\n   'agent-exec.ts' ONLY accepts a JSON payload file. Put your command and arguments INSIDE the JSON payload file.\n   Ref: [AGENT_README.md](${AGENT_EXEC_README_URL})\x1b[0m`);
    }
    throw err;
  }
  targetOverride = typeof values['target'] === 'string' ? values['target'] : undefined;

  const parsedArgs = agentExecCliArgsSchema.parse({ ...values, payloadPath: values['payloadPath'] ?? positionals[0] });
  const result = match(parsedArgs)
    .with({ help: true }, (args) => showHelp(Boolean(args.json)))
    .with({ payloadPath: P.string }, (args) => {
      const interceptors: string[] = Array.isArray(args.interceptors)
        ? [...args.interceptors]
        : (typeof args.interceptors === 'string' ? [args.interceptors] : []);
      if (typeof args.plugin === 'string') interceptors.push(args.plugin);
      return { path: args.payloadPath, interceptors };
    })
    .otherwise(() => showUsageError('Missing payload JSON file path.', isJson));

  payloadPath = result.path;
  interceptorsPaths = result.interceptors;
} catch (err: unknown) {
  showUsageError(err instanceof Error ? err.message : String(err), isJson);
}

try {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  await loadWorkspacePlugins(interceptorsPaths, [process.cwd(), scriptDir], (resolvedPath) => {
    fatalError(`Interceptor plugin must be loaded from within the workspace: ${resolvedPath}`);
  });

  const payloadStr = readPayloadInput(payloadPath);
  const rawPayload: unknown = JSON.parse(payloadStr);
  const parseResult = PayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    const details = parseResult.error.issues.map(err => `${err.path.length > 0 ? err.path.join('.') : 'root'}: ${err.message}`);
    fatalError('Payload schema validation failed.', details);
  }

  const payload = parseResult.data;
  if (targetOverride) {
    const normalized = normalizeTarget(targetOverride);
    if (!normalized) fatalError(`Invalid --target value: '${targetOverride}'. Must be 'windows', 'wsl2', or an alias (wsl, linux, ubuntu, native, win, pwsh, cmd, bash).`);
    payload.target = normalized;
  }

  if (payload.keepPayload !== true) {
    try { fs.unlinkSync(payloadPath); } catch { /* ignore */ }
  }

  const cwd = resolveAndValidateCwd(payload, (badCwd) => fatalError(`The provided cwd '${badCwd}' does not exist or is not a directory.`));
  const { cmd, args, tempScriptPath, envOverrides, resolvedCwd } = buildCommand(payload, cwd, isJson);
  const finalEnv = mergeFinalEnvironment(payload.env, envOverrides);

  await executeCommand(payload, resolvedCwd ?? cwd, cmd, args, finalEnv, tempScriptPath, isJson || Boolean(payload.expectJsonEnvelope));
} catch (err) {
  if (err instanceof SyntaxError) {
    fatalError(`Invalid JSON in payload file. ${err.message}`);
  } else {
    fatalError(`Error executing agent-exec: ${err instanceof Error ? err.message : String(err)}`);
  }
}

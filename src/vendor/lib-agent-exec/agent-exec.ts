// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { match, P } from 'ts-pattern';
import { executeCommand } from './execution-engine.js';
import { buildCommand, customInterceptors } from './command-builder.js';
import { buildEnvironment } from './environment.js';
import { PayloadSchema, agentExecCliArgsSchema, normalizeTarget } from './schema.js';
import { showHelp, showUsageError } from './help.js';
import { convertToWindowsPath } from './command-utils.js';

const DEFAULT_MAX_PAYLOAD_SIZE = 10 * 1024 * 1024;
let payloadPath: string;
let interceptorsPaths: string[] = [];
let targetOverride: string | undefined;
let positionals: string[] = [];
const isJson = process.argv.includes('--json');

function fatalError(msg: string, details?: string[]): never {
  if (isJson) {
    console.log(JSON.stringify({ status: "error", message: msg, details }));
  } else {
    console.error(`❌ Error: ${msg}`);
    if (details) {
      for (const d of details) {
        console.error(`  - ${d}`);
      }
    }
  }
  process.exit(1);
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
    const parsed = parseArgs({
      args: process.argv.slice(2),
      options,
      strict: true,
      allowPositionals: true
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Unknown option')) {
       fatalError(`\n   \x1b[38;5;208m🛠️ AUTONOMOUS HEALING: You passed a CLI flag to 'agent-exec.ts' (${msg}).\n   'agent-exec.ts' ONLY accepts a JSON payload file. Put your command and arguments INSIDE the JSON payload file.\n   Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
    }
    throw err;
  }
  targetOverride = values.target as string | undefined;
  
  

  const parsedArgs = agentExecCliArgsSchema.parse({
    ...values,
    payloadPath: values.payloadPath ?? positionals[0]
  });

  const result = match(parsedArgs)
    .with({ help: true }, (args) => showHelp(!!args.json))
    .with({ payloadPath: P.string }, (args) => {
      let interceptors: string[] = [];
      if (Array.isArray(args.interceptors)) {
        interceptors = args.interceptors;
      } else if (typeof args.interceptors === 'string') {
        interceptors = [args.interceptors];
      }
      if (typeof args.plugin === 'string') {
        interceptors.push(args.plugin);
      }
      return { path: args.payloadPath, interceptors };
    })
    .otherwise(() => showUsageError('Missing payload JSON file path.', isJson));
    
  payloadPath = result.path;
  interceptorsPaths = result.interceptors;
} catch (err: unknown) {
  showUsageError(err instanceof Error ? err.message : String(err), isJson);
}

try {
  for (const interceptorsPath of interceptorsPaths) {
    const resolvedPath = path.resolve(interceptorsPath);
    if (!resolvedPath.startsWith(process.cwd()) && !resolvedPath.startsWith(__dirname)) {
      fatalError(`Interceptor plugin must be loaded from within the workspace: ${resolvedPath}`);
    }
    const plugin = await import(resolvedPath);
    if (plugin.default && Array.isArray(plugin.default)) {
      customInterceptors.push(...plugin.default);
    } else if (plugin.default && typeof plugin.default === 'function') {
      customInterceptors.push(plugin.default);
    }
  }

  let payloadStr: string;
  const absPayloadPath = path.resolve(payloadPath);
  
  if (!fs.existsSync(absPayloadPath)) {
    if (payloadPath.startsWith('base64:')) {
      payloadStr = Buffer.from(payloadPath.slice(7), 'base64').toString('utf8');
    } else if (payloadPath.trim().startsWith('{')) {
      console.error(`\n   💡 AGENT HINT: You passed a JSON payload directly as an argument to agent-exec.ts.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Treating argument as JSON payload... (Frictionless Recovery)\x1b[0m`);
      payloadStr = payloadPath;
    } else {
      if (!positionals[0]) {
        fatalError('Missing payload JSON file path or raw command.');
      }
      console.error(`\n   💡 AGENT HINT: You passed a raw command directly to agent-exec.ts instead of a payload file.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-wrapping command into JSON payload... (Frictionless Recovery)\x1b[0m`);
      const payload = {
        type: "command",
        target: "windows",
        command: positionals[0],
        args: positionals.slice(1)
      };
      payloadStr = JSON.stringify(payload);
    }
  } else {
    let payloadBuf;
    try {
      payloadBuf = fs.readFileSync(absPayloadPath);
    } catch (err) {
      fatalError(`Payload path must be a regular file. ${err instanceof Error ? err.message : String(err)}`);
    }
    const envSize = process.env.AGENT_EXEC_MAX_PAYLOAD_SIZE ? parseInt(process.env.AGENT_EXEC_MAX_PAYLOAD_SIZE, 10) : NaN;
    const maxPayloadSize = !Number.isNaN(envSize) && envSize > 0 ? envSize : DEFAULT_MAX_PAYLOAD_SIZE;
    if (payloadBuf.length > maxPayloadSize) {
      fatalError(`Payload file exceeds ${maxPayloadSize} bytes limit.`);
    }
    payloadStr = payloadBuf.toString('utf8');
  }

  const rawPayload = JSON.parse(payloadStr);

  const parseResult = PayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    const details = parseResult.error.issues.map(err => {
      const pathStr = err.path.length > 0 ? err.path.join('.') : 'root';
      return `${pathStr}: ${err.message}`;
    });
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
  fs.appendFileSync(path.join(os.tmpdir(), 'agent-exec-payload.log'), JSON.stringify(payload) + '\n');
  if (payload.cwd !== undefined && typeof payload.cwd === 'string') {
    const unquotedCwd = payload.cwd.trim().replace(/^['"]|['"]$/g, '');
    if (/^\/?mnt\/[a-zA-Z](?:\/.*)?$/i.test(unquotedCwd)) {
      const converted = convertToWindowsPath(unquotedCwd);
      console.error(`\n   💡 AGENT HINT: The provided cwd '${payload.cwd}' is a WSL mount path.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-converting WSL mount cwd to Windows path... (Frictionless Recovery)\x1b[0m`);
      payload.cwd = converted;
    }
  }

  const isWslTarget = payload.target === 'wsl2';
  const isPosixInternalCwd = isWslTarget && payload.cwd !== undefined && typeof payload.cwd === 'string' && (payload.cwd.startsWith('/') || payload.cwd.startsWith('~'));
  const cwd = payload.cwd !== undefined && payload.cwd.length > 0 ? (isPosixInternalCwd ? process.cwd() : path.resolve(payload.cwd)) : process.cwd();
  
  if (!isPosixInternalCwd && (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory())) {
    fatalError(`The provided cwd '${cwd}' does not exist or is not a directory.`);
  }

  const { cmd, args, tempScriptPath, envOverrides } = buildCommand(payload, cwd, isJson);
  
  const env = buildEnvironment(payload.env);
  
  const finalEnv = { ...env };
  for (const [k, v] of Object.entries(envOverrides)) {
    let targetKey = k;
    if (process.platform === 'win32') {
      const existingKey = Object.keys(finalEnv).find(key => key.toUpperCase() === k.toUpperCase());
      if (existingKey) targetKey = existingKey;
    }
    finalEnv[targetKey] = v;
  }

  await executeCommand(payload, cwd, cmd, args, finalEnv, tempScriptPath, isJson || !!payload.expectJsonEnvelope);

} catch (err) {
  if (err instanceof SyntaxError) {
    fatalError(`Invalid JSON in payload file. ${err.message}`);
  } else {
    fatalError(`Error executing agent-exec: ${err instanceof Error ? err.message : String(err)}`);
  }
}

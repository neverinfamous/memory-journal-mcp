// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { match, P } from 'ts-pattern';
import { executeCommand } from './execution-engine.js';
import { buildCommand, customInterceptors } from './command-builder.js';
import { buildEnvironment } from './environment.js';
import { PayloadSchema, agentExecCliArgsSchema } from './schema.js';
import { showHelp, showUsageError } from './help.js';

const DEFAULT_MAX_PAYLOAD_SIZE = 10 * 1024 * 1024;
let payloadPath: string;
let interceptorsPaths: string[] = [];
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
  } as const;

  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options,
    strict: true,
    allowPositionals: true
  });
  
  

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

  const stat = fs.statSync(payloadPath);
  if (!stat.isFile()) fatalError('Payload path must be a regular file.');
  const envSize = process.env.AGENT_EXEC_MAX_PAYLOAD_SIZE ? parseInt(process.env.AGENT_EXEC_MAX_PAYLOAD_SIZE, 10) : NaN;
  const maxPayloadSize = !Number.isNaN(envSize) && envSize > 0 ? envSize : DEFAULT_MAX_PAYLOAD_SIZE;
  if (stat.size > maxPayloadSize) {
    fatalError(`Payload file exceeds ${maxPayloadSize} bytes limit.`);
  }
  const payloadStr = fs.readFileSync(payloadPath, 'utf8');
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
  if (payload.keepPayload !== true) {
    try { fs.unlinkSync(payloadPath); } catch { /* ignore */ }
  }
  fs.appendFileSync(path.join(os.tmpdir(), 'agent-exec-payload.log'), JSON.stringify(payload) + '\n');
  const cwd = payload.cwd ? path.resolve(payload.cwd) : process.cwd();
  
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    fatalError(`The provided cwd '${cwd}' does not exist or is not a directory.`);
  }

  const { cmd, args, tempScriptPath, envOverrides } = buildCommand(payload, cwd);
  
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

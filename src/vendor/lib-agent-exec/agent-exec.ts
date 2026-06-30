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

let payloadPath: string;
let interceptorsPath: string | null = null;
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
    interceptors: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
    json: { type: 'boolean' },
  } as const;

  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options,
    strict: true,
    allowPositionals: true
  });
  
  

  const parsedArgs = agentExecCliArgsSchema.parse({
    ...values,
    payloadPath: positionals[0]
  });

  const result = match(parsedArgs)
    .with({ help: true }, (args) => showHelp(!!args.json))
    .with({ payloadPath: P.string }, (args) => {
      return { path: args.payloadPath, interceptors: args.interceptors || null };
    })
    .otherwise(() => showUsageError('Missing payload JSON file path.', isJson));
    
  payloadPath = result.path;
  interceptorsPath = result.interceptors;
} catch (err: unknown) {
  showUsageError(err instanceof Error ? err.message : String(err), isJson);
}

try {
  if (interceptorsPath) {
    const plugin = await import(path.resolve(interceptorsPath));
    if (plugin.default && Array.isArray(plugin.default)) {
      customInterceptors.push(...plugin.default);
    } else if (plugin.default && typeof plugin.default === 'function') {
      customInterceptors.push(plugin.default);
    }
  }

  const stat = fs.statSync(payloadPath);
  if (stat.size > 10 * 1024 * 1024) {
    fatalError('Payload file exceeds 10MB limit.');
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

  executeCommand(payload, cwd, cmd, args, finalEnv, tempScriptPath);

} catch (err) {
  if (err instanceof SyntaxError) {
    fatalError(`Invalid JSON in payload file. ${err.message}`);
  } else {
    fatalError(`Error executing agent-exec: ${err instanceof Error ? err.message : String(err)}`);
  }
}

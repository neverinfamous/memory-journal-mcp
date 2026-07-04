import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, stripVTControlCharacters } from 'node:util';
import { match } from 'ts-pattern';
import { PayloadSchema, agentExecCliArgsSchema } from './lib-agent-exec/schema.js';
import { buildEnvironment } from './lib-agent-exec/environment.js';
import { buildCommand } from './lib-agent-exec/command-builder.js';
import { executeCommand } from './lib-agent-exec/execution-engine.js';
import { showHelp, showUsageError } from './lib-agent-exec/help.js';
import { recordAgentIssue } from './lib-agent-exec/utils.js';

let currentPayload: unknown = undefined;

const originalConsoleError = console.error;
console.error = function(...args: unknown[]) {
  const msg = args.map(a => typeof a === 'string' ? a : (a instanceof Error ? a.message : String(a))).join(' ');
  const cleanMsg = stripVTControlCharacters(msg); // strip ansi
  
  if (cleanMsg.includes('AUTONOMOUS HEALING')) {
    recordAgentIssue('AUTONOMOUS_HEALING_TRIGGERED', cleanMsg.trim(), currentPayload);
  } else if (cleanMsg.includes('❌') || cleanMsg.includes('Error:')) {
    let ignore = false;
    
    // Filter out standard developer friction (tests, lints, installs) that aren't healable hallucinations
    if (cleanMsg.match(/Command exited with code/) && currentPayload && typeof currentPayload === 'object') {
      const p = currentPayload as Record<string, unknown>;
      if (typeof p.command === 'string' && ['pnpm', 'npm', 'bun', 'yarn', 'node'].includes(p.command)) {
        ignore = true;
      }
    }
    
    if (!ignore) {
      recordAgentIssue('EXECUTION_ERROR', cleanMsg.trim(), currentPayload);
    }
  }
  
  originalConsoleError.apply(console, args);
};

async function main() {
  let parsedArgs;
  try {
    parsedArgs = parseArgs({
      args: process.argv.slice(2),
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        interceptors: { type: 'string', multiple: true },
        plugin: { type: 'string' },
      },
      allowPositionals: true,
    });
  } catch (err) {
    showUsageError(err instanceof Error ? err.message : String(err));
  }

  const parsedFlags = agentExecCliArgsSchema.safeParse(parsedArgs.values);
  match(parsedFlags)
    .with({ success: false }, (result) => showUsageError(result.error.message))
    .with({ success: true }, () => {})
    .exhaustive();

  const flags = parsedFlags.data!;

  if (flags.help) {
    showHelp(flags.json ?? false);
  }

  const pluginPaths: string[] = [];
  if (Array.isArray(flags.interceptors)) {
    pluginPaths.push(...flags.interceptors);
  } else if (typeof flags.interceptors === 'string') {
    pluginPaths.push(flags.interceptors);
  }
  if (flags.plugin) {
    pluginPaths.push(flags.plugin);
  }
  
  for (const pluginPath of pluginPaths) {
    const absPluginPath = path.resolve(pluginPath);
    try {
      await import(`file://${absPluginPath.replace(/\\/g, '/')}`);
    } catch (err) {
      console.error(`❌ Error: Failed to load plugin at ${pluginPath}`);
      console.error(err instanceof Error ? err.message : String(err));
    }
  }

  const payloadPath = parsedArgs.positionals[0];

  if (!payloadPath) {
    showUsageError("Missing path to JSON payload file.", flags.json);
  }

  let payloadContent: string;
  const absPayloadPath = path.resolve(payloadPath);
  try {
    const stats = fs.statSync(absPayloadPath);
    if (stats.size > 10 * 1024 * 1024) { // 10MB
    if (flags.json) {
      console.log(JSON.stringify({ status: "error", message: `Payload file exceeds 10MB limit.` }));
      process.exit(1);
    }
    console.error(`❌ Error: Payload file exceeds 10MB limit.`);
    process.exit(1);
  }
  payloadContent = fs.readFileSync(absPayloadPath, 'utf-8');
} catch (err) {
  if (flags.json) {
    console.log(JSON.stringify({ status: "error", message: `Failed to read payload file at ${payloadPath}: ${err instanceof Error ? err.message : String(err)}` }));
    process.exit(1);
  }
  console.error(`❌ Error: Failed to read payload file at ${payloadPath}`);
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

  let rawPayload: unknown;
  try {
  rawPayload = JSON.parse(payloadContent);
} catch (err) {
  if (flags.json) {
    console.log(JSON.stringify({ status: "error", message: `Invalid JSON in payload file: ${err instanceof Error ? err.message : String(err)}` }));
    process.exit(1);
  }
  console.error(`❌ Error: Invalid JSON in payload file.`);
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const parsed = PayloadSchema.safeParse(rawPayload);
if (!parsed.success) {
  if (flags.json) {
    console.log(JSON.stringify({ status: "error", message: `Payload schema validation failed: ${parsed.error.message}` }));
    process.exit(1);
  }
  console.error(`❌ Error: Payload schema validation failed.`);
  console.error(parsed.error.message);
  process.exit(1);
}

  const payload = parsed.data;
  currentPayload = payload;

  const cleanupPayload = () => {
    if (!payload.keepPayload && fs.existsSync(absPayloadPath)) {
      try { fs.unlinkSync(absPayloadPath); } catch { /* ignore */ }
    }
  };
  process.on('exit', cleanupPayload);

const cwd = payload.cwd ? path.resolve(payload.cwd) : process.cwd();
if (cwd.length < 260) {
  try {
    if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
      if (flags.json) {
        console.log(JSON.stringify({ status: "error", message: `The provided cwd '${cwd}' does not exist or is not a directory.` }));
        process.exit(1);
      }
      console.error(`❌ Error: The provided cwd '${cwd}' does not exist or is not a directory.`);
      process.exit(1);
    }
  } catch {
      if (flags.json) {
        console.log(JSON.stringify({ status: "error", message: `The provided cwd '${cwd}' does not exist or is not a directory.` }));
        process.exit(1);
      }
      console.error(`❌ Error: The provided cwd '${cwd}' does not exist or is not a directory.`);
      process.exit(1);
  }
}

  const isJson = match(payload)
    .with({ type: 'command' }, (p) => flags.json || p.expectJsonEnvelope === true)
    .with({ type: 'script' }, (p) => flags.json || p.expectJsonEnvelope === true)
    .with({ type: 'eval' }, (p) => flags.json || p.expectJsonEnvelope === true)
    .exhaustive();

  const { cmd, args, tempScriptPath, envOverrides } = buildCommand(payload, cwd, isJson);
  const env = { ...buildEnvironment(payload.env), ...(envOverrides || {}) };

  executeCommand(payload, cwd, cmd, args, env, tempScriptPath, isJson);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

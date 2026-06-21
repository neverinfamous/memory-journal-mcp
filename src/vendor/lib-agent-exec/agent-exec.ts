// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { executeCommand } from './execution-engine.js';
import { buildCommand } from './command-builder.js';
import { buildEnvironment } from './environment.js';
import { PayloadSchema } from './schema.js';

const payloadPath = process.argv[2];
if (!payloadPath) {
  console.error('❌ Error: Missing payload JSON file path.');
  process.exit(1);
}

try {
  const stat = fs.statSync(payloadPath);
  if (stat.size > 10 * 1024 * 1024) {
    console.error('❌ Error: Payload file exceeds 10MB limit.');
    process.exit(1);
  }
  const payloadStr = fs.readFileSync(payloadPath, 'utf8');
  const rawPayload = JSON.parse(payloadStr);

  const parseResult = PayloadSchema.safeParse(rawPayload);
  if (!parseResult.success) {
    console.error('❌ Error: Payload schema validation failed.');
    for (const err of parseResult.error.issues) {
      const pathStr = err.path.length > 0 ? err.path.join('.') : 'root';
      console.error(`  - ${pathStr}: ${err.message}`);
    }
    process.exit(1);
  }

  const payload = parseResult.data;
  const cwd = payload.cwd ? path.resolve(payload.cwd) : process.cwd();
  
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    console.error(`❌ Error: The provided cwd '${cwd}' does not exist or is not a directory.`);
    process.exit(1);
  }

  const env = buildEnvironment(payload.env);
  
  if (payload.plugins && payload.plugins.length > 0) {
    const { customInterceptors } = await import('./command-builder.js');
    for (const plugin of payload.plugins) {
      try {
        const pluginPath = path.resolve(cwd, plugin);
        const pluginModule = await import(pluginPath);
        if (typeof pluginModule.default === 'function') {
          customInterceptors.push(pluginModule.default);
        } else if (typeof pluginModule.interceptor === 'function') {
          customInterceptors.push(pluginModule.interceptor);
        }
      } catch (err) {
        console.error(`❌ Error: Failed to load plugin '${plugin}': ${err}`);
      }
    }
  }

  const { cmd, args, tempScriptPath, envOverrides } = buildCommand(payload, cwd);
  
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
    console.error(`❌ Error: Invalid JSON in payload file. ${err.message}`);
  } else {
    console.error(`❌ Error executing agent-exec: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(1);
}

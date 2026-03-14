import { spawn } from 'child_process';
import { join } from 'path';

const projectDir = 'C:\\Users\\chris\\Desktop\\memory-journal-mcp';
const proc = spawn('node', ['dist/cli.js', '--instruction-level', 'essential'], {
  cwd: projectDir,
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buffer = '';

proc.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  
  // Try to parse complete JSON-RPC responses
  const lines = buffer.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      if (msg.id === 1) {
        // Initialize response — skip
      } else if (msg.id === 2) {
        // tools/list response
        const tools = msg.result?.tools || [];
        console.log(`Total tools: ${tools.length}`);
        
        let withAnnotations = 0;
        let openWorldTrue = 0;
        let openWorldFalse = 0;
        let missing = 0;
        const trueNames = [];
        const missingNames = [];
        
        for (const tool of tools) {
          if (tool.annotations) {
            withAnnotations++;
            if (tool.annotations.openWorldHint === true) {
              openWorldTrue++;
              trueNames.push(tool.name);
            } else if (tool.annotations.openWorldHint === false) {
              openWorldFalse++;
            } else {
              missing++;
              missingNames.push(tool.name);
            }
          } else {
            missing++;
            missingNames.push(tool.name);
          }
        }
        
        console.log(`Tools with annotations: ${withAnnotations}`);
        console.log(`openWorldHint=true (GitHub): ${openWorldTrue}`);
        console.log(`openWorldHint=false (core/local): ${openWorldFalse}`);
        console.log(`Missing openWorldHint: ${missing}`);
        
        if (trueNames.length > 0) {
          console.log(`\nopenWorldHint=true tools: ${trueNames.join(', ')}`);
        }
        if (missingNames.length > 0) {
          console.log(`\nMISSING annotations: ${missingNames.join(', ')}`);
        }
        
        proc.kill();
      }
    } catch {
      // Not complete JSON yet
    }
  }
});

proc.stderr.on('data', () => {});

// Send initialize
proc.stdin.write(JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0' },
  },
}) + '\n');

// Wait, then send initialized + tools/list
setTimeout(() => {
  proc.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  }) + '\n');
  
  setTimeout(() => {
    proc.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }) + '\n');
  }, 500);
}, 1500);

setTimeout(() => {
  console.log('Timeout — killing process');
  proc.kill();
  process.exit(1);
}, 15000);

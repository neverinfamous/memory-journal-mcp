/**
 * Phase 1.3A: Instruction Level Test
 *
 * Starts the server with each --instruction-level value (essential, standard, full)
 * and verifies that instruction text length increases across levels.
 *
 * Usage:
 *   node test-server/test-instruction-levels.mjs
 */

import { spawn } from 'child_process';

const PROJECT_DIR = 'C:\\Users\\chris\\Desktop\\memory-journal-mcp';
const LEVELS = ['essential', 'standard', 'full'];

function testLevel(level) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['dist/cli.js', '--instruction-level', level], {
      cwd: PROJECT_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buffer = '';
    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          if (msg.id === 1 && msg.result) {
            const instructions = msg.result?.serverInfo?.instructions
              || msg.result?.instructions
              || '';

            // Also check for the instructions field in capabilities
            const capInstructions = msg.result?.capabilities?.instructions || '';
            const text = instructions || capInstructions;

            proc.kill();
            resolve({ level, charCount: text.length, tokenEstimate: Math.round(text.length / 4) });
          }
        } catch {
          // Not complete JSON yet
        }
      }
    });

    proc.stderr.on('data', () => {});

    // Send initialize request
    proc.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'instruction-test', version: '1.0' },
      },
    }) + '\n');

    setTimeout(() => {
      proc.kill();
      reject(new Error(`Timeout for level ${level}`));
    }, 10000);
  });
}

async function main() {
  console.log('=== Phase 1.3A: Instruction Level Test ===\n');

  const results = [];
  for (const level of LEVELS) {
    const result = await testLevel(level);
    results.push(result);
    console.log(`  ${level}: ${result.charCount} chars (~${result.tokenEstimate} tokens)`);
  }

  // Verify ordering
  const [essential, standard, full] = results;
  const orderCorrect = essential.charCount < standard.charCount && standard.charCount < full.charCount;

  console.log(`\n  Order correct (essential < standard < full): ${orderCorrect ? '✅' : '❌'}`);
  console.log(`    ${essential.tokenEstimate} < ${standard.tokenEstimate} < ${full.tokenEstimate}`);

  process.exit(orderCorrect ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});

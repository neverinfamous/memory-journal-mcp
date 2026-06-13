import { spawn } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function run() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/cli.js'],
    env: { ...process.env, TEAM_AUTHOR: 'test_author', TEAM_DB_PATH: 'test-team-prompts.db' }
  });
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  
  console.log("=== TEAM TOOLS ===");
  try {
    const res1 = await client.callTool({ 
      name: 'team_create_entry', 
      arguments: { project_number: 5, entry_type: 'invalid', content: 'test' } 
    });
    console.log("team_create_entry invalid type:", JSON.stringify(res1, null, 2));
  } catch(e) { console.error("team_create_entry error:", e); }
  
  try {
    const res2 = await client.callTool({ 
      name: 'team_update_entry', 
      arguments: { project_number: 5, entry_id: 999999 } 
    });
    console.log("team_update_entry invalid id:", JSON.stringify(res2, null, 2));
  } catch(e) { console.error("team_update_entry error:", e); }

  console.log("\n=== COERCION TESTS ===");
  try {
    const res3 = await client.callTool({ 
      name: 'create_entry', 
      arguments: { project_number: 5, content: true } 
    });
    console.log("create_entry with bool content:", JSON.stringify(res3, null, 2));
  } catch(e) { console.error("create_entry bool error:", e); }

  try {
    const res4 = await client.callTool({ 
      name: 'create_entry', 
      arguments: { project_number: 5, content: ["array"] } 
    });
    console.log("create_entry with array content:", JSON.stringify(res4, null, 2));
  } catch(e) { console.error("create_entry array error:", e); }

  process.exit(0);
}
run();

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import fs from "fs";
// Auto-load Datadog secrets for E2E validation
if (fs.existsSync('C:/Users/chris/Desktop/adamic/secrets.env')) {
  const envConfig = fs.readFileSync('C:/Users/chris/Desktop/adamic/secrets.env', 'utf-8');
  envConfig.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      process.env[match[1]] = (match[2] || '').trim().replace(/^['"](.*)['"]$/, '$1');
    }
  });
}

async function main() {
  console.log("🚀 Starting metrics generation load test for Memory Journal MCP...");
  const startTime = Math.floor(Date.now() / 1000);

  // 1. Connect to memory-journal-mcp via stdio transport
  console.log("🔌 Spawning memory-journal-mcp via stdio...");
  const transport = new StdioClientTransport({
    command: "node",
    args: [
      path.resolve(process.cwd(), "dist/cli.js"), 
      "--metrics-export", "prometheus", 
      "--metrics-port", "9466",
      "--audit-log", path.resolve(process.cwd(), "logs/mcp-audit.jsonl")
    ],
    env: {
      ...process.env
    }
  });
  
  const client = new Client({ name: "metrics-generator", version: "1.0.0" }, { capabilities: {} });
  
  await client.connect(transport);
  console.log("✅ Connected to MCP Server via stdio!");

  console.log("🌊 Starting continuous load generation for 60 seconds...");
  
  // Create a flag to control the loop
  let running = true;
  setTimeout(() => {
    running = false;
  }, 65000); // Run for 65 seconds to give Prometheus ~4 scrapes

  // Function to continuously generate traffic
  const generateTraffic = async () => {
    while (running) {
      try {
        // Successful cache hits or quick searches (3 requests per loop)
        await client.callTool({ name: "update_configuration", arguments: { target: "test" } }).catch(() => {});
        
        // This tool might not exist or might fail due to args, which is fine, we want some errors!
        await client.callTool({ name: "mj_execute_code", arguments: { code: "console.log('test')" } }).catch(() => {});
        await client.callTool({ name: "mj_execute_code", arguments: { code: "console.log('test2')" } }).catch(() => {});

        // Intentional Error (for error rate % and error log)
        await client.callTool({ name: "non_existent_tool_for_testing", arguments: {} }).catch(() => {});

        // Wait 1 second between loops to space out the load
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err) {
        // Ignore loop errors
      }
    }
  };

  // Run a few traffic generators concurrently to simulate concurrency
  await Promise.all([
    generateTraffic(),
    generateTraffic(),
    generateTraffic(),
    generateTraffic()
  ]);

  console.log("👋 Load generation complete.");
  process.exit(0);
}

main().catch(err => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});

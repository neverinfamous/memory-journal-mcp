import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "child_process";
import path from "path";

async function main() {
  console.log("🚀 Starting memory-journal-mcp metrics generation load test...");



  // 2. Connect client
  const transport = new StdioClientTransport({
    command: "node",
    args: [
      path.resolve(process.cwd(), "dist/cli/index.js"), 
      "--metrics-export", "prometheus", 
      "--metrics-port", "9466",
      "--audit-log", path.resolve(process.cwd(), "logs/mcp-audit.jsonl"),
      "--audit-reads"
    ],
    env: {
      ...process.env,
      MJ_METRICS_PORT: "9466",
      NODE_ENV: "development",
      WORKTREE_ROOT: process.cwd()
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
        // Successful Tool Calls (3 requests per loop)
        await client.callTool({ name: "mj_execute_code", arguments: { code: "return await mj.searchEntries({ query: 'test' });" } }).catch(() => {});
        await client.callTool({ name: "mj_execute_code", arguments: { code: "return await mj.getStatistics();" } }).catch(() => {});
        await client.callTool({ name: "mj_execute_code", arguments: { code: "return await mj.listTags();" } }).catch(() => {});

        // Intentional Error (for error rate % and error log)
        await client.callTool({ name: "mj_execute_code", arguments: { code: "throw new Error('Intentional error to trigger error metrics');" } }).catch(() => {});

        // Resource Reads
        await client.readResource({ uri: "memory://briefing" }).catch(() => {});
        await client.readResource({ uri: "memory://health" }).catch(() => {});
        
        // Wait 1 second between loops to space out the load
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err) {
        // Ignore loop errors
      }
    }
  };

  // Run a few traffic generators concurrently
  await Promise.all([
    generateTraffic(),
    generateTraffic(),
    generateTraffic(),
    generateTraffic()
  ]);

  console.log("👋 Shutting down metrics generation script.");
  process.exit(0);
}

main().catch(err => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});

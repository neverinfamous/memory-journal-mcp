import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function run() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["C:\\\\Users\\\\chris\\\\Desktop\\\\memory-journal-mcp\\\\dist\\\\index.js"]
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("Connected to MCP server\\n");

  const tests = [
    { name: "update_entry (empty)", tool: "update_entry", params: {} },
    { name: "update_entry (wrong type)", tool: "update_entry", params: { entry_id: "abc", content: "foo", entry_type: "technical_note", is_personal: true, tags: [] } },
    { name: "delete_entry (empty)", tool: "delete_entry", params: {} },
    { name: "delete_entry (wrong type)", tool: "delete_entry", params: { entry_id: "abc", permanent: false } },
    { name: "merge_tags (empty)", tool: "merge_tags", params: {} },
    { name: "merge_tags (wrong type)", tool: "merge_tags", params: { source_tag: 123, target_tag: 456 } },
    { name: "add_to_vector_index (empty)", tool: "add_to_vector_index", params: {} },
    { name: "add_to_vector_index (wrong type)", tool: "add_to_vector_index", params: { entry_id: "abc" } },
  ];

  for (const t of tests) {
    try {
      const res = await client.callTool({
        name: t.tool,
        arguments: t.params
      });
      console.log(`❌ ${t.name} succeeded unexpectedly!`, JSON.stringify(res, null, 2));
    } catch (e) {
      // MCP SDK throws an Error object on error responses. Let's see its payload.
      if (e.message) {
        console.log(`✅ ${t.name} failed properly with validation error.`);
        console.log(`   Message: ${e.message}`);
      } else {
        console.log(`⚠️ ${t.name} failed, but no standard message:`, e);
      }
    }
  }

  process.exit(0);
}

run().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});

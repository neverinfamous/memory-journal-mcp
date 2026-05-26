# Building MCP Servers on Cloudflare

Creates production-ready Model Context Protocol servers on Cloudflare Workers with tools, authentication, and deployment.

## Prerequisites

- Cloudflare account with Workers enabled
- Node.js 18+ and npm/pnpm/yarn
- Wrangler CLI (`npm install -g wrangler`)

## Quick Start

### Option 1: Public Server (No Auth)

```bash
npm create cloudflare@latest -- my-mcp-server \
  --template=cloudflare/ai/demos/remote-mcp-authless
cd my-mcp-server
npm start
```

Server runs at `http://localhost:8788/mcp`

### Option 2: Authenticated Server (OAuth)

```bash
npm create cloudflare@latest -- my-mcp-server \
  --template=cloudflare/ai/demos/remote-mcp-github-oauth
cd my-mcp-server
```

Requires OAuth app setup.

## Core Workflow

### Step 1: Define Tools

Tools are functions MCP clients can call. Define them using `server.tool()`:

```typescript
import { McpAgent } from "agents/mcp";
import { z } from "zod";

export class MyMCP extends McpAgent {
  server = new Server({ name: "my-mcp", version: "1.0.0" });

  async init() {
    // Simple tool with parameters
    this.server.tool(
      "add",
      { a: z.number(), b: z.number() },
      async ({ a, b }) => ({
        content: [{ type: "text", text: String(a + b) }],
      })
    );

    // Tool that calls external API
    this.server.tool(
      "get_weather",
      { city: z.string() },
      async ({ city }) => {
        // Prevent SSRF: Always construct URLs safely, never interpolate raw strings into the base URL path
        const url = new URL("https://api.weather.com/v1/current");
        url.searchParams.set("city", city);
        const response = await fetch(url.toString());
        const data = await response.json();
        return {
          content: [{ type: "text", text: JSON.stringify(data) }],
        };
      }
    );
  }
}
```

### Step 2: Configure Entry Point

**Public server** (`src/index.ts`):

```typescript
import { MyMCP } from "./mcp";

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") {
      return MyMCP.serveSSE("/mcp").fetch(request, env, ctx);
    }
    return new Response("MCP Server", { status: 200 });
  },
};

export { MyMCP };
```

### Step 3: Test Locally

```bash
# Start server
npm start

# In another terminal, test with MCP Inspector
npx @modelcontextprotocol/inspector@latest
# Open http://localhost:5173, enter http://localhost:8788/mcp
```

### Step 4: Deploy

> **CRITICAL HITL GATE**: You MUST stop and ask the user for explicit confirmation before running the `npx wrangler deploy` command. Deploying to production requires consent.

```bash
npx wrangler deploy
```

Server accessible at `https://[worker-name].[account].workers.dev/mcp`

### Step 5: Connect Clients

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["mcp-remote", "https://my-mcp.workers.dev/mcp"]
    }
  }
}
```

Restart Claude Desktop after updating config.

## Accessing Environment/Bindings

```typescript
export class MyMCP extends McpAgent<Env> {
  async init() {
    this.server.tool("get_user", { id: z.number() }, async ({ id }) => {
      // Access D1 binding safely with parameterized query
      // NOTE: Never pass raw SQL strings from tool arguments directly to prepare()
      const result = await this.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).all();
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    });
  }
}
```

## Wrangler Configuration

Minimal `wrangler.toml`:

```toml
name = "my-mcp-server"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[durable_objects]
bindings = [{ name = "MCP", class_name = "MyMCP" }]

[[migrations]]
tag = "v1"
new_classes = ["MyMCP"]
```

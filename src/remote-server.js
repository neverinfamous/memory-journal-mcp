/**
 * Memory Journal Remote MCP Server
 * Simple implementation for Cloudflare Workers
 */

// In-memory storage for demo (in production, use D1 or KV)
let entries = [];
let nextId = 1;

// MCP protocol handlers
const mcpHandlers = {
  async initialize(params) {
    return {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        logging: {}
      },
      serverInfo: {
        name: "memory-journal-mcp-remote",
        version: "1.0.0"
      }
    };
  },

  async "tools/list"() {
    return {
      tools: [
        {
          name: "create_entry",
          description: "Create a new journal entry",
          inputSchema: {
            type: "object",
            properties: {
              content: { type: "string", description: "The journal entry content" },
              tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
              entry_type: { type: "string", default: "personal_reflection" },
              is_personal: { type: "boolean", default: true }
            },
            required: ["content"]
          }
        },
        {
          name: "search_entries",
          description: "Search journal entries",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
              limit: { type: "integer", default: 10 }
            },
            required: ["query"]
          }
        },
        {
          name: "get_recent_entries",
          description: "Get recent entries",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "integer", default: 5 }
            }
          }
        },
        {
          name: "list_tags",
          description: "List all tags",
          inputSchema: {
            type: "object",
            properties: {}
          }
        }
      ]
    };
  },

  async "tools/call"(params) {
    const { name, arguments: args } = params;
    
    switch (name) {
      case "create_entry":
        const entry = {
          id: nextId++,
          content: args.content,
          tags: args.tags || [],
          entry_type: args.entry_type || "personal_reflection",
          is_personal: args.is_personal !== false,
          created_at: new Date().toISOString()
        };
        entries.push(entry);
        
        return {
          content: [{
            type: "text",
            text: `✅ Created journal entry #${entry.id}\nType: ${entry.entry_type}\nTags: ${entry.tags.join(', ') || 'None'}`
          }]
        };

      case "search_entries":
        const searchResults = entries
          .filter(entry => 
            entry.content.toLowerCase().includes(args.query.toLowerCase()) ||
            entry.tags.some(tag => tag.toLowerCase().includes(args.query.toLowerCase()))
          )
          .slice(0, args.limit || 10);
        
        const searchText = searchResults.length === 0 
          ? `No entries found matching "${args.query}"`
          : `Found ${searchResults.length} entries:\n\n` + searchResults
              .map(e => `#${e.id}: ${e.content.substring(0, 100)}${e.content.length > 100 ? '...' : ''}`)
              .join('\n');
        
        return {
          content: [{ type: "text", text: searchText }]
        };

      case "get_recent_entries":
        const recentEntries = entries
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(0, args.limit || 5);
        
        const recentText = recentEntries.length === 0
          ? "No entries found"
          : "Recent entries:\n\n" + recentEntries
              .map(e => `#${e.id} (${e.created_at}): ${e.content}`)
              .join('\n\n');
        
        return {
          content: [{ type: "text", text: recentText }]
        };

      case "list_tags":
        const tagCounts = {};
        entries.forEach(entry => {
          entry.tags.forEach(tag => {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
          });
        });
        
        const tagsText = Object.keys(tagCounts).length === 0
          ? "No tags found"
          : "Available tags:\n" + Object.entries(tagCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([tag, count]) => `${tag} (${count})`)
              .join('\n');
        
        return {
          content: [{ type: "text", text: tagsText }]
        };

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
};

// SSE connection handler
async function handleSSE(request) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  
  // Send initial connection
  await writer.write(new TextEncoder().encode("event: connect\ndata: {}\n\n"));
  
  request.signal?.addEventListener('abort', () => {
    writer.close();
  });

  // Keep connection alive
  const keepAlive = setInterval(async () => {
    try {
      await writer.write(new TextEncoder().encode("event: ping\ndata: {}\n\n"));
    } catch (e) {
      clearInterval(keepAlive);
    }
  }, 30000);

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}

// HTTP MCP handler
async function handleMCP(request) {
  const body = await request.json();
  
  try {
    const handler = mcpHandlers[body.method];
    if (!handler) {
      return new Response(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32601, message: `Method not found: ${body.method}` }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const result = await handler(body.params || {});
    
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      result
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      error: { code: -32603, message: error.message }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Main handler
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }
    
    // SSE endpoint for MCP
    if (url.pathname === '/sse') {
      return handleSSE(request);
    }
    
    // HTTP MCP endpoint
    if (url.pathname === '/mcp' && request.method === 'POST') {
      return handleMCP(request);
    }
    
    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: "healthy",
        service: "memory-journal-mcp-remote",
        version: "1.0.0"
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Root info
    if (url.pathname === '/') {
      return new Response(JSON.stringify({
        name: "Memory Journal Remote MCP Server",
        version: "1.0.0",
        endpoints: {
          "/sse": "MCP Server-Sent Events endpoint",
          "/mcp": "MCP HTTP endpoint",
          "/health": "Health check"
        }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('Not found', { status: 404 });
  }
};
# Cloudflare Workers Deployment

## What I've Created

I've created a Cloudflare Workers version of your Memory Journal MCP Server that provides similar functionality as a REST API:

### Files Created:
- **`src/worker.js`** - Cloudflare Workers JavaScript implementation
- **`wrangler.toml`** - Wrangler configuration file
- **D1 Database**: `memory-journal` (ID: a0941707-86d9-4ee7-bcb6-75dc24f62c37)
- **KV Namespace**: `memory-journal-cache` (ID: 9ecfc38419ca4be49aa334aba80b40cb)

### API Endpoints:
- `GET /` - API information and available endpoints
- `GET /health` - Health check
- `GET /entries` - List journal entries (params: limit, is_personal)
- `POST /entries` - Create new journal entry
- `GET /entries/search` - Search entries (params: q, limit)
- `GET /tags` - List all tags

### Database Schema:
The worker automatically creates these tables on first request:
- `memory_journal` - Main entries table
- `tags` - Tag definitions
- `entry_tags` - Many-to-many relationship
- `significant_entries` - Special significance tracking

## Deployment Issue

The deployment failed because the API token doesn't have sufficient permissions for Workers deployment. 

### Options to Deploy:

1. **Manual Deployment via Cloudflare Dashboard:**
   - Go to Cloudflare Dashboard → Workers & Pages
   - Create new Worker named "memory-journal-mcp"
   - Copy the content from `src/worker.js` into the editor
   - Add the D1 and KV bindings in Settings

2. **Update API Token Permissions:**
   - Go to https://dash.cloudflare.com/profile/api-tokens
   - Edit the existing token to include:
     - Workers Scripts:Edit
     - Workers KV Storage:Edit
     - Account:Read
     - User Details:Read

3. **Use OAuth Login:**
   - Run `wrangler login` in a local environment with browser access
   - Then run `wrangler deploy`

## Testing the API

Once deployed, you can test with:

```bash
# Health check
curl https://memory-journal-mcp.your-subdomain.workers.dev/health

# Create entry
curl -X POST https://memory-journal-mcp.your-subdomain.workers.dev/entries \
  -H "Content-Type: application/json" \
  -d '{"content": "Test journal entry", "tags": ["test", "api"]}'

# Search entries
curl "https://memory-journal-mcp.your-subdomain.workers.dev/entries/search?q=test"
```

The Workers version provides similar functionality to the MCP server but as a REST API that can be accessed from anywhere.
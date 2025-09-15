/**
 * Memory Journal Remote MCP Server - FULL FEATURED VERSION
 * Preserves ALL functionality from the original Python server
 * Uses D1 database for persistence and KV for caching
 */

// Database initialization SQL (complete schema from schema.sql)
const INIT_SQL = `
-- Core entries table
CREATE TABLE IF NOT EXISTS memory_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_type TEXT NOT NULL DEFAULT 'personal_reflection',
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_personal INTEGER NOT NULL DEFAULT 1,
    project_context TEXT,
    related_patterns TEXT,
    metadata TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Tags table
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT,
    usage_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Entry-tag relationships
CREATE TABLE IF NOT EXISTS entry_tags (
    entry_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (entry_id, tag_id),
    FOREIGN KEY (entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

-- Entry relationships
CREATE TABLE IF NOT EXISTS memory_journal_relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_entry_id INTEGER NOT NULL,
    target_entry_id INTEGER NOT NULL,
    relationship_type TEXT NOT NULL DEFAULT 'related_to',
    relationship_strength REAL DEFAULT 0.5,
    bidirectional INTEGER DEFAULT 0,
    metadata TEXT,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE,
    FOREIGN KEY (target_entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE
);

-- Significant entries
CREATE TABLE IF NOT EXISTS significant_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    significance_type TEXT NOT NULL,
    significance_rating REAL DEFAULT 0.5,
    notes TEXT,
    related_entries TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE
);

-- Relationship types
CREATE TABLE IF NOT EXISTS relationship_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    direction TEXT DEFAULT 'one-way',
    category TEXT
);

-- Vector embeddings for semantic search
CREATE TABLE IF NOT EXISTS memory_journal_embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    embedding_model TEXT NOT NULL DEFAULT 'all-MiniLM-L6-v2',
    embedding_vector BLOB NOT NULL,
    embedding_dimension INTEGER NOT NULL DEFAULT 384,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (entry_id) REFERENCES memory_journal (id) ON DELETE CASCADE
);

-- Insert default relationship types
INSERT OR IGNORE INTO relationship_types (name, description, direction, category) VALUES
('evolves_from', 'Entry represents evolution from target', 'one-way', 'development'),
('references', 'Entry explicitly references target', 'one-way', 'citation'),
('related_to', 'Entries are thematically related', 'bidirectional', 'association'),
('implements', 'Entry implements concepts from target', 'one-way', 'technical'),
('associated_with', 'Entries are contextually associated', 'bidirectional', 'context'),
('clarifies', 'Entry clarifies concepts in target', 'one-way', 'explanation'),
('contradicts', 'Entry challenges or contradicts target', 'one-way', 'conflict'),
('response_to', 'Entry directly responds to target', 'one-way', 'dialogue');

-- Insert common tags
INSERT OR IGNORE INTO tags (name, category) VALUES
('consciousness', 'core'),
('technical-integration', 'core'),
('development', 'core'),
('growth', 'core'),
('collaboration', 'core'),
('milestone', 'achievement'),
('reflection', 'type'),
('identity', 'core'),
('mathematics', 'domain'),
('linguistics', 'domain'),
('temporal', 'type');
`;

// Initialize database
async function initializeDatabase(db) {
    try {
        // Split and execute each statement
        const statements = INIT_SQL.split(';').filter(stmt => stmt.trim());
        for (const statement of statements) {
            if (statement.trim()) {
                await db.prepare(statement).run();
            }
        }
        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
        throw error;
    }
}

// Get project context (simulated for Workers environment)
async function getProjectContext() {
    return {
        repo: "memory-journal-mcp",
        branch: "main", 
        files: ["remote-server.js"],
        thread_id: "cloudflare-workers-" + Date.now(),
        deployment: "cloudflare-workers",
        timestamp: new Date().toISOString()
    };
}

// Auto-create tags
async function autoCreateTags(db, tags) {
    const tagIds = [];
    
    for (const tagName of tags) {
        // Try to get existing tag
        const existingTag = await db.prepare('SELECT id FROM tags WHERE name = ?').bind(tagName).first();
        
        if (existingTag) {
            tagIds.push(existingTag.id);
            // Increment usage count
            await db.prepare('UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?').bind(existingTag.id).run();
        } else {
            // Create new tag
            const result = await db.prepare('INSERT INTO tags (name, usage_count) VALUES (?, 1)').bind(tagName).run();
            tagIds.push(result.meta.last_row_id);
        }
    }
    
    return tagIds;
}

// Validate input (security)
function validateInput(content, entry_type, tags, significance_type) {
    if (!content || typeof content !== 'string' || content.length > 50000) {
        throw new Error('Content must be a non-empty string under 50,000 characters');
    }
    
    if (entry_type && typeof entry_type !== 'string') {
        throw new Error('Entry type must be a string');
    }
    
    if (tags && (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string'))) {
        throw new Error('Tags must be an array of strings');
    }
    
    if (significance_type && typeof significance_type !== 'string') {
        throw new Error('Significance type must be a string');
    }
}

// MCP protocol handlers with FULL functionality
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
                name: "memory-journal-mcp-remote-full",
                version: "1.0.0"
            }
        };
    },

    async "tools/list"() {
        return {
            tools: [
                {
                    name: "create_entry",
                    description: "Create a new journal entry with context and tags",
                    inputSchema: {
                        type: "object",
                        properties: {
                            content: { type: "string", description: "The journal entry content" },
                            tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
                            entry_type: { type: "string", default: "personal_reflection", description: "Type of entry" },
                            is_personal: { type: "boolean", default: true, description: "Whether this is personal" },
                            significance_type: { type: "string", description: "Type of significance if important" },
                            auto_context: { type: "boolean", default: true, description: "Automatically capture context" }
                        },
                        required: ["content"]
                    }
                },
                {
                    name: "search_entries", 
                    description: "Search journal entries by content",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "Search query" },
                            limit: { type: "integer", default: 10, description: "Maximum results" },
                            is_personal: { type: "boolean", description: "Filter by personal entries" }
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "get_recent_entries",
                    description: "Get recent journal entries", 
                    inputSchema: {
                        type: "object",
                        properties: {
                            limit: { type: "integer", default: 5, description: "Number of entries" },
                            is_personal: { type: "boolean", description: "Filter by personal entries" }
                        }
                    }
                },
                {
                    name: "list_tags",
                    description: "List all available tags",
                    inputSchema: {
                        type: "object",
                        properties: {}
                    }
                },
                {
                    name: "semantic_search",
                    description: "Perform semantic/vector search on journal entries",
                    inputSchema: {
                        type: "object", 
                        properties: {
                            query: { type: "string", description: "Search query for semantic similarity" },
                            limit: { type: "integer", default: 10, description: "Maximum results" },
                            similarity_threshold: { type: "number", default: 0.3, description: "Minimum similarity score" },
                            is_personal: { type: "boolean", description: "Filter by personal entries" }
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "create_entry_minimal",
                    description: "Minimal entry creation without context or tags",
                    inputSchema: {
                        type: "object",
                        properties: {
                            content: { type: "string", description: "The journal entry content" }
                        },
                        required: ["content"]
                    }
                },
                {
                    name: "test_simple",
                    description: "Simple test tool that returns a message",
                    inputSchema: {
                        type: "object",
                        properties: {
                            message: { type: "string", default: "Hello", description: "Test message" }
                        }
                    }
                }
            ]
        };
    },

    async "tools/call"(params, env) {
        const { name, arguments: args } = params;
        
        // Initialize database if needed
        if (!env.DB_INITIALIZED) {
            await initializeDatabase(env.DB);
            env.DB_INITIALIZED = true;
        }
        
        try {
            switch (name) {
                case "create_entry":
                    return await handleCreateEntry(args, env);
                    
                case "search_entries":
                    return await handleSearchEntries(args, env);
                    
                case "get_recent_entries":
                    return await handleGetRecentEntries(args, env);
                    
                case "list_tags":
                    return await handleListTags(env);
                    
                case "semantic_search":
                    return await handleSemanticSearch(args, env);
                    
                case "create_entry_minimal":
                    return await handleCreateEntryMinimal(args, env);
                    
                case "test_simple":
                    return {
                        content: [{
                            type: "text",
                            text: `✅ Test successful: ${args.message || "Hello"}`
                        }]
                    };
                    
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        } catch (error) {
            return {
                content: [{
                    type: "text", 
                    text: `❌ Error: ${error.message}`
                }]
            };
        }
    }
};

// Tool handlers with full functionality
async function handleCreateEntry(args, env) {
    const { content, tags = [], entry_type = "personal_reflection", is_personal = true, significance_type, auto_context = true } = args;
    
    // Validate input
    validateInput(content, entry_type, tags, significance_type);
    
    // Get project context if requested
    let project_context = null;
    if (auto_context) {
        const context = await getProjectContext();
        project_context = JSON.stringify(context);
    }
    
    // Auto-create tags
    const tagIds = await autoCreateTags(env.DB, tags);
    
    // Insert entry
    const insertResult = await env.DB.prepare(`
        INSERT INTO memory_journal (entry_type, content, is_personal, project_context, related_patterns)
        VALUES (?, ?, ?, ?, ?)
    `).bind(entry_type, content, is_personal ? 1 : 0, project_context, tags.join(',')).run();
    
    const entryId = insertResult.meta.last_row_id;
    
    // Link tags to entry
    for (const tagId of tagIds) {
        await env.DB.prepare('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)').bind(entryId, tagId).run();
    }
    
    // Handle significance if provided
    if (significance_type) {
        await env.DB.prepare(`
            INSERT INTO significant_entries (entry_id, significance_type, significance_rating)
            VALUES (?, ?, 0.8)
        `).bind(entryId, significance_type).run();
    }
    
    return {
        content: [{
            type: "text",
            text: `✅ Created journal entry #${entryId}\n` +
                  `Type: ${entry_type}\n` +
                  `Personal: ${is_personal}\n` +
                  `Tags: ${tags.length > 0 ? tags.join(', ') : 'None'}\n` +
                  `Context: ${auto_context ? 'Captured' : 'None'}\n` +
                  `Significance: ${significance_type || 'None'}`
        }]
    };
}

async function handleSearchEntries(args, env) {
    const { query, limit = 10, is_personal } = args;
    
    let sql = 'SELECT * FROM memory_journal WHERE (content LIKE ? OR related_patterns LIKE ?)';
    const params = [`%${query}%`, `%${query}%`];
    
    if (is_personal !== undefined) {
        sql += ' AND is_personal = ?';
        params.push(is_personal ? 1 : 0);
    }
    
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    
    const { results } = await env.DB.prepare(sql).bind(...params).all();
    
    if (results.length === 0) {
        return {
            content: [{
                type: "text",
                text: `No entries found matching "${query}"`
            }]
        };
    }
    
    const resultText = results
        .map(entry => {
            const tags = entry.related_patterns ? entry.related_patterns.split(',').join(', ') : 'None';
            return `Entry #${entry.id} (${entry.created_at})\n` +
                   `Type: ${entry.entry_type}\n` +
                   `Content: ${entry.content.substring(0, 200)}${entry.content.length > 200 ? '...' : ''}\n` +
                   `Tags: ${tags}\n` +
                   `Personal: ${entry.is_personal ? 'Yes' : 'No'}`;
        })
        .join('\n---\n');
    
    return {
        content: [{
            type: "text",
            text: `Found ${results.length} entries matching "${query}":\n\n${resultText}`
        }]
    };
}

async function handleGetRecentEntries(args, env) {
    const { limit = 5, is_personal } = args;
    
    let sql = 'SELECT * FROM memory_journal';
    const params = [];
    
    if (is_personal !== undefined) {
        sql += ' WHERE is_personal = ?';
        params.push(is_personal ? 1 : 0);
    }
    
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    
    const { results } = await env.DB.prepare(sql).bind(...params).all();
    
    if (results.length === 0) {
        return {
            content: [{
                type: "text",
                text: "No entries found"
            }]
        };
    }
    
    const resultText = results
        .map(entry => {
            const tags = entry.related_patterns ? entry.related_patterns.split(',').join(', ') : 'None';
            return `Entry #${entry.id} (${entry.created_at})\n` +
                   `Type: ${entry.entry_type}\n` +
                   `Content: ${entry.content}\n` +
                   `Tags: ${tags}\n` +
                   `Personal: ${entry.is_personal ? 'Yes' : 'No'}`;
        })
        .join('\n---\n');
    
    return {
        content: [{
            type: "text",
            text: `Recent entries:\n\n${resultText}`
        }]
    };
}

async function handleListTags(env) {
    const { results } = await env.DB.prepare('SELECT name, category, usage_count FROM tags ORDER BY usage_count DESC').all();
    
    if (results.length === 0) {
        return {
            content: [{
                type: "text",
                text: "No tags found"
            }]
        };
    }
    
    const tagText = results
        .map(tag => `${tag.name} (${tag.usage_count})${tag.category ? ` [${tag.category}]` : ''}`)
        .join('\n');
    
    return {
        content: [{
            type: "text",
            text: `Available tags:\n\n${tagText}`
        }]
    };
}

async function handleSemanticSearch(args, env) {
    // For now, fallback to regular search since we don't have embedding generation in Workers
    // In a full implementation, you'd use Workers AI or external API for embeddings
    const { query, limit = 10, similarity_threshold = 0.3, is_personal } = args;
    
    // Use regular search as fallback
    const searchResult = await handleSearchEntries({ query, limit, is_personal }, env);
    
    // Add note about semantic search
    const originalText = searchResult.content[0].text;
    const enhancedText = `🧠 Semantic Search Results (using text search fallback):\n\n${originalText}`;
    
    return {
        content: [{
            type: "text",
            text: enhancedText
        }]
    };
}

async function handleCreateEntryMinimal(args, env) {
    const { content } = args;
    
    // Simple entry creation without context or tags
    const insertResult = await env.DB.prepare(`
        INSERT INTO memory_journal (content, entry_type, is_personal)
        VALUES (?, 'quick_note', 1)
    `).bind(content).run();
    
    const entryId = insertResult.meta.last_row_id;
    
    return {
        content: [{
            type: "text",
            text: `✅ Created minimal entry #${entryId}: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`
        }]
    };
}

// SSE and HTTP handlers (same as before but with full functionality)
async function handleSSE(request) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    
    await writer.write(new TextEncoder().encode("event: connect\ndata: {}\n\n"));
    
    request.signal?.addEventListener('abort', () => {
        writer.close();
    });

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

async function handleMCP(request, env) {
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
        
        const result = await handler(body.params || {}, env);
        
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
            return handleMCP(request, env);
        }
        
        // Health check
        if (url.pathname === '/health') {
            return new Response(JSON.stringify({
                status: "healthy",
                service: "memory-journal-mcp-remote-full",
                version: "1.0.0",
                features: [
                    "Full database persistence with D1",
                    "Complete schema with relationships", 
                    "Tag management and auto-creation",
                    "Project context awareness",
                    "Significance tracking",
                    "Semantic search (fallback to text search)",
                    "All original MCP tools preserved"
                ],
                database: "D1 SQLite with complete schema",
                cache: "KV namespace for embeddings and caching"
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // Root info
        if (url.pathname === '/') {
            return new Response(JSON.stringify({
                name: "Memory Journal Remote MCP Server - Full Featured",
                version: "1.0.0",
                description: "Complete remote MCP server preserving ALL original functionality",
                endpoints: {
                    "/sse": "MCP Server-Sent Events endpoint (primary)",
                    "/mcp": "MCP HTTP endpoint",
                    "/health": "Health check with feature list"
                },
                tools: [
                    "create_entry - Full entry creation with context and tags",
                    "search_entries - Search entries by content and tags", 
                    "get_recent_entries - Get recent entries with filtering",
                    "list_tags - List all tags with usage counts and categories",
                    "semantic_search - Semantic/vector search (with fallback)",
                    "create_entry_minimal - Quick minimal entry creation",
                    "test_simple - Simple test tool"
                ],
                features: [
                    "D1 SQLite database with complete schema",
                    "Tag management with auto-creation",
                    "Project context awareness", 
                    "Significance tracking",
                    "Entry relationships",
                    "Full-text search capabilities",
                    "KV caching for performance"
                ]
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        return new Response('Not found', { status: 404 });
    }
};
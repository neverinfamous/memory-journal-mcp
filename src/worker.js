/**
 * Memory Journal - Cloudflare Workers Edition
 * A REST API version of the Memory Journal MCP Server
 * 
 * This provides similar functionality to the MCP server but as a REST API
 * that can be deployed on Cloudflare Workers with D1 database storage.
 */

// Database schema initialization
const INIT_SQL = `
CREATE TABLE IF NOT EXISTS memory_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_type TEXT DEFAULT 'personal_reflection',
    content TEXT NOT NULL,
    is_personal BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    project_context TEXT,
    related_patterns TEXT
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    usage_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS entry_tags (
    entry_id INTEGER,
    tag_id INTEGER,
    PRIMARY KEY (entry_id, tag_id),
    FOREIGN KEY (entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS significant_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id INTEGER NOT NULL,
    significance_type TEXT NOT NULL,
    significance_rating REAL DEFAULT 0.5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE
);
`;

export default {
    async fetch(request, env, ctx) {
        // Initialize database on first request
        if (!env.DB_INITIALIZED) {
            await initializeDatabase(env.DB);
            env.DB_INITIALIZED = true;
        }

        // CORS headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        };

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const path = url.pathname;

        try {
            let response;

            // Route handling
            if (path === '/' && request.method === 'GET') {
                response = await handleRoot();
            } else if (path === '/health' && request.method === 'GET') {
                response = await handleHealth();
            } else if (path === '/entries' && request.method === 'GET') {
                response = await handleGetEntries(url.searchParams, env.DB);
            } else if (path === '/entries' && request.method === 'POST') {
                response = await handleCreateEntry(request, env.DB);
            } else if (path === '/entries/search' && request.method === 'GET') {
                response = await handleSearchEntries(url.searchParams, env.DB);
            } else if (path === '/tags' && request.method === 'GET') {
                response = await handleGetTags(env.DB);
            } else {
                response = new Response(JSON.stringify({ 
                    error: 'Not Found',
                    message: `Path ${path} not found`
                }), { 
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Add CORS headers to response
            Object.entries(corsHeaders).forEach(([key, value]) => {
                response.headers.set(key, value);
            });

            return response;

        } catch (error) {
            console.error('Error handling request:', error);
            return new Response(JSON.stringify({ 
                error: 'Internal Server Error',
                message: error.message
            }), { 
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
        }
    }
};

async function initializeDatabase(db) {
    try {
        // Split the SQL into individual statements and execute them
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

async function handleRoot() {
    return new Response(JSON.stringify({
        name: 'Memory Journal API',
        version: '1.0.0',
        description: 'Cloudflare Workers version of the Memory Journal MCP Server',
        endpoints: {
            'GET /': 'API information',
            'GET /health': 'Health check',
            'GET /entries': 'List journal entries (params: limit, is_personal)',
            'POST /entries': 'Create new journal entry',
            'GET /entries/search': 'Search entries (params: q, limit)',
            'GET /tags': 'List all tags'
        }
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleHealth() {
    return new Response(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'memory-journal-workers'
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleGetEntries(searchParams, db) {
    const limit = parseInt(searchParams.get('limit') || '10');
    const isPersonal = searchParams.get('is_personal');
    
    let query = 'SELECT * FROM memory_journal';
    const params = [];
    
    if (isPersonal !== null) {
        query += ' WHERE is_personal = ?';
        params.push(isPersonal === 'true' ? 1 : 0);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    
    const { results } = await db.prepare(query).bind(...params).all();
    
    return new Response(JSON.stringify({
        entries: results,
        count: results.length
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleCreateEntry(request, db) {
    const body = await request.json();
    
    const {
        content,
        entry_type = 'personal_reflection',
        is_personal = true,
        tags = [],
        significance_type
    } = body;
    
    if (!content) {
        return new Response(JSON.stringify({
            error: 'Bad Request',
            message: 'Content is required'
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    try {
        // Insert the journal entry
        const insertResult = await db.prepare(`
            INSERT INTO memory_journal (entry_type, content, is_personal, related_patterns)
            VALUES (?, ?, ?, ?)
        `).bind(entry_type, content, is_personal ? 1 : 0, tags.join(',')).run();
        
        const entryId = insertResult.meta.last_row_id;
        
        // Handle tags
        const tagIds = [];
        for (const tagName of tags) {
            // Try to get existing tag or create new one
            let tagResult = await db.prepare('SELECT id FROM tags WHERE name = ?').bind(tagName).first();
            
            if (!tagResult) {
                const insertTagResult = await db.prepare('INSERT INTO tags (name, usage_count) VALUES (?, 1)').bind(tagName).run();
                tagIds.push(insertTagResult.meta.last_row_id);
            } else {
                tagIds.push(tagResult.id);
                // Increment usage count
                await db.prepare('UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?').bind(tagResult.id).run();
            }
        }
        
        // Link tags to entry
        for (const tagId of tagIds) {
            await db.prepare('INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)').bind(entryId, tagId).run();
        }
        
        // Handle significance if provided
        if (significance_type) {
            await db.prepare(`
                INSERT INTO significant_entries (entry_id, significance_type, significance_rating)
                VALUES (?, ?, 0.8)
            `).bind(entryId, significance_type).run();
        }
        
        return new Response(JSON.stringify({
            success: true,
            entry_id: entryId,
            message: `Created journal entry #${entryId}`,
            entry_type,
            is_personal,
            tags
        }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
        });
        
    } catch (error) {
        console.error('Error creating entry:', error);
        return new Response(JSON.stringify({
            error: 'Database Error',
            message: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

async function handleSearchEntries(searchParams, db) {
    const query = searchParams.get('q');
    const limit = parseInt(searchParams.get('limit') || '10');
    
    if (!query) {
        return new Response(JSON.stringify({
            error: 'Bad Request',
            message: 'Query parameter "q" is required'
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    const { results } = await db.prepare(`
        SELECT * FROM memory_journal 
        WHERE content LIKE ? OR related_patterns LIKE ?
        ORDER BY created_at DESC 
        LIMIT ?
    `).bind(`%${query}%`, `%${query}%`, limit).all();
    
    return new Response(JSON.stringify({
        query,
        entries: results,
        count: results.length
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function handleGetTags(db) {
    const { results } = await db.prepare('SELECT * FROM tags ORDER BY usage_count DESC').all();
    
    return new Response(JSON.stringify({
        tags: results
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
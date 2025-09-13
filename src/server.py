#!/usr/bin/env python3
"""
Memory Journal MCP Server
A Model Context Protocol server for personal journaling with context awareness.
"""

import asyncio
import json
import sqlite3
import os
import subprocess
from datetime import datetime
from typing import Dict, List, Optional, Any

try:
    from mcp.server import Server, NotificationOptions, InitializationOptions
    from mcp.types import Resource, Tool, TextContent
    import mcp.server.stdio
    import mcp.types as types
except ImportError:
    print("MCP library not found. Install with: pip install mcp")
    exit(1)

# Initialize the MCP server
server = Server("memory-journal")

# Database path - relative to server location
DB_PATH = os.path.join(os.path.dirname(__file__), "..", "memory_journal.db")

class MemoryJournalDB:
    """Database operations for the Memory Journal system."""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.init_database()
    
    def init_database(self):
        """Initialize database with schema."""
        schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
        
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("PRAGMA foreign_keys = ON")
            
            if os.path.exists(schema_path):
                with open(schema_path, 'r') as f:
                    conn.executescript(f.read())
    
    def get_connection(self):
        """Get database connection with proper settings."""
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA foreign_keys = ON")
        conn.row_factory = sqlite3.Row
        return conn
    
    def auto_create_tags(self, tag_names: List[str]) -> List[int]:
        """Auto-create tags if they don't exist, return tag IDs."""
        tag_ids = []
        
        with self.get_connection() as conn:
            for tag_name in tag_names:
                cursor = conn.execute("SELECT id FROM tags WHERE name = ?", (tag_name,))
                row = cursor.fetchone()
                
                if row:
                    tag_ids.append(row['id'])
                else:
                    cursor = conn.execute(
                        "INSERT INTO tags (name, usage_count) VALUES (?, 1)",
                        (tag_name,)
                    )
                    tag_ids.append(cursor.lastrowid)
        
        return tag_ids
    
    def get_project_context(self) -> Dict[str, Any]:
        """Get current project context (git repo, branch, etc.)."""
        context = {}
        
        try:
            result = subprocess.run(['git', 'rev-parse', '--show-toplevel'], 
                                  capture_output=True, text=True, cwd=os.getcwd())
            if result.returncode == 0:
                repo_path = result.stdout.strip()
                context['repo_path'] = repo_path
                context['repo_name'] = os.path.basename(repo_path)
                
                result = subprocess.run(['git', 'branch', '--show-current'], 
                                      capture_output=True, text=True, cwd=repo_path)
                if result.returncode == 0:
                    context['branch'] = result.stdout.strip()
        
        except Exception:
            pass
        
        context['cwd'] = os.getcwd()
        context['timestamp'] = datetime.now().isoformat()
        
        return context

# Initialize database
db = MemoryJournalDB(DB_PATH)

@server.list_resources()
async def list_resources() -> List[Resource]:
    """List available resources."""
    return [
        Resource(
            uri="memory://recent",
            name="Recent Journal Entries",
            description="Most recent journal entries",
            mimeType="application/json"
        ),
        Resource(
            uri="memory://significant",
            name="Significant Entries", 
            description="Entries marked as significant",
            mimeType="application/json"
        )
    ]

@server.read_resource()
async def read_resource(uri: str) -> str:
    """Read a specific resource."""
    if uri == "memory://recent":
        with db.get_connection() as conn:
            cursor = conn.execute("""
                SELECT id, entry_type, content, timestamp, is_personal, project_context
                FROM memory_journal 
                ORDER BY timestamp DESC 
                LIMIT 10
            """)
            entries = [dict(row) for row in cursor.fetchall()]
            return json.dumps(entries, indent=2)
    
    elif uri == "memory://significant":
        with db.get_connection() as conn:
            cursor = conn.execute("""
                SELECT se.significance_type, se.significance_rating,
                       mj.id, mj.entry_type, mj.content, mj.timestamp
                FROM significant_entries se
                JOIN memory_journal mj ON se.entry_id = mj.id
                ORDER BY se.significance_rating DESC
                LIMIT 10
            """)
            entries = [dict(row) for row in cursor.fetchall()]
            return json.dumps(entries, indent=2)
    
    else:
        raise ValueError(f"Unknown resource: {uri}")

@server.list_tools()
async def list_tools() -> List[Tool]:
    """List available tools."""
    return [
        Tool(
            name="create_entry",
            description="Create a new journal entry with context and tags",
            inputSchema={
                "type": "object",
                "properties": {
                    "content": {"type": "string", "description": "The journal entry content"},
                    "is_personal": {"type": "boolean", "default": True},
                    "entry_type": {"type": "string", "default": "personal_reflection"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "significance_type": {"type": "string"},
                    "auto_context": {"type": "boolean", "default": True}
                },
                "required": ["content"]
            }
        ),
        Tool(
            name="search_entries",
            description="Search journal entries",
            inputSchema={
                "type": "object", 
                "properties": {
                    "query": {"type": "string"},
                    "is_personal": {"type": "boolean"},
                    "limit": {"type": "integer", "default": 10}
                }
            }
        ),
        Tool(
            name="get_recent_entries",
            description="Get recent journal entries",
            inputSchema={
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "default": 5},
                    "is_personal": {"type": "boolean"}
                }
            }
        ),
        Tool(
            name="list_tags",
            description="List all available tags",
            inputSchema={"type": "object", "properties": {}}
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle tool calls."""
    
    if name == "create_entry":
        content = arguments["content"]
        is_personal = arguments.get("is_personal", True)
        entry_type = arguments.get("entry_type", "personal_reflection")
        tags = arguments.get("tags", [])
        significance_type = arguments.get("significance_type")
        auto_context = arguments.get("auto_context", True)
        
        project_context = None
        if auto_context:
            context = db.get_project_context()
            project_context = json.dumps(context)
        
        tag_ids = []
        if tags:
            tag_ids = db.auto_create_tags(tags)
        
        with db.get_connection() as conn:
            cursor = conn.execute("""
                INSERT INTO memory_journal (
                    entry_type, content, is_personal, project_context, related_patterns
                ) VALUES (?, ?, ?, ?, ?)
            """, (entry_type, content, is_personal, project_context, ','.join(tags)))
            
            entry_id = cursor.lastrowid
            
            for tag_id in tag_ids:
                conn.execute(
                    "INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)",
                    (entry_id, tag_id)
                )
                conn.execute(
                    "UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?",
                    (tag_id,)
                )
            
            if significance_type:
                conn.execute("""
                    INSERT INTO significant_entries (
                        entry_id, significance_type, significance_rating
                    ) VALUES (?, ?, 0.8)
                """, (entry_id, significance_type))
        
        return [types.TextContent(
            type="text",
            text=f"✅ Created journal entry #{entry_id}\n"
                 f"Type: {entry_type}\n"
                 f"Personal: {is_personal}\n"
                 f"Tags: {', '.join(tags) if tags else 'None'}"
        )]
    
    elif name == "search_entries":
        query = arguments.get("query")
        is_personal = arguments.get("is_personal")
        limit = arguments.get("limit", 10)
        
        if query:
            sql = """
                SELECT m.id, m.entry_type, m.content, m.timestamp, m.is_personal,
                       snippet(memory_journal_fts, 0, '**', '**', '...', 20) AS snippet
                FROM memory_journal_fts
                JOIN memory_journal m ON memory_journal_fts.rowid = m.id
                WHERE memory_journal_fts MATCH ?
            """
            params = [query]
        else:
            sql = """
                SELECT id, entry_type, content, timestamp, is_personal,
                       substr(content, 1, 100) || '...' AS snippet
                FROM memory_journal
                WHERE 1=1
            """
            params = []
        
        if is_personal is not None:
            sql += " AND is_personal = ?"
            params.append(is_personal)
        
        sql += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)
        
        with db.get_connection() as conn:
            cursor = conn.execute(sql, params)
            entries = [dict(row) for row in cursor.fetchall()]
        
        result = f"Found {len(entries)} entries:\n\n"
        for entry in entries:
            result += f"#{entry['id']} ({entry['entry_type']}) - {entry['timestamp']}\n"
            result += f"Personal: {bool(entry['is_personal'])}\n"
            result += f"Snippet: {entry['snippet']}\n\n"
        
        return [types.TextContent(type="text", text=result)]
    
    elif name == "get_recent_entries":
        limit = arguments.get("limit", 5)
        is_personal = arguments.get("is_personal")
        
        sql = "SELECT id, entry_type, content, timestamp, is_personal, project_context FROM memory_journal"
        params = []
        
        if is_personal is not None:
            sql += " WHERE is_personal = ?"
            params.append(is_personal)
        
        sql += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)
        
        with db.get_connection() as conn:
            cursor = conn.execute(sql, params)
            entries = [dict(row) for row in cursor.fetchall()]
        
        result = f"Recent {len(entries)} entries:\n\n"
        for entry in entries:
            result += f"#{entry['id']} ({entry['entry_type']}) - {entry['timestamp']}\n"
            result += f"Personal: {bool(entry['is_personal'])}\n"
            content_preview = entry['content'][:200] + ('...' if len(entry['content']) > 200 else '')
            result += f"Content: {content_preview}\n"
            
            # Add context if available
            if entry.get('project_context'):
                try:
                    context = json.loads(entry['project_context'])
                    if context.get('repo_name'):
                        result += f"Context: {context['repo_name']} ({context.get('branch', 'unknown branch')})\n"
                except:
                    pass
            result += "\n"
        
        return [types.TextContent(type="text", text=result)]
    
    elif name == "list_tags":
        with db.get_connection() as conn:
            cursor = conn.execute(
                "SELECT name, category, usage_count FROM tags ORDER BY usage_count DESC, name"
            )
            tags = [dict(row) for row in cursor.fetchall()]
        
        result = f"Available tags ({len(tags)}):\n\n"
        for tag in tags:
            result += f"• {tag['name']}"
            if tag['category']:
                result += f" ({tag['category']})"
            result += f" - used {tag['usage_count']} times\n"
        
        return [types.TextContent(type="text", text=result)]
    
    else:
        raise ValueError(f"Unknown tool: {name}")

async def main():
    """Run the server."""
    async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            InitializationOptions(
                server_name="memory-journal",
                server_version="1.0.0",
                capabilities=server.get_capabilities(
                    notification_options=NotificationOptions(),
                    experimental_capabilities={},
                ),
            ),
        )

if __name__ == "__main__":
    asyncio.run(main())
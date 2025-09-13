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
from concurrent.futures import ThreadPoolExecutor

try:
    from mcp.server import Server, NotificationOptions, InitializationOptions
    from mcp.types import Resource, Tool, TextContent, Prompt, PromptMessage
    import mcp.server.stdio
    import mcp.types as types
except ImportError:
    print("MCP library not found. Install with: pip install mcp")
    exit(1)

# Thread pool for non-blocking database operations
thread_pool = ThreadPoolExecutor(max_workers=2)

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
    
    def get_project_context_sync(self) -> Dict[str, Any]:
        """Get current project context (git repo, branch, etc.) - synchronous version for thread pool."""
        context = {}
        
        # AGGRESSIVE TIMEOUT: Use much shorter timeouts and fail fast
        git_timeout = 2  # 2 seconds max per Git command
        
        try:
            # Get git repository root with aggressive timeout
            result = subprocess.run(['git', 'rev-parse', '--show-toplevel'], 
                                  capture_output=True, text=True, cwd=os.getcwd(), 
                                  timeout=git_timeout, shell=False)
            if result.returncode == 0:
                repo_path = result.stdout.strip()
                context['repo_path'] = repo_path
                context['repo_name'] = os.path.basename(repo_path)
                context['git_status'] = 'repo_found'
                
                # Get current branch with aggressive timeout
                try:
                    result = subprocess.run(['git', 'branch', '--show-current'], 
                                          capture_output=True, text=True, cwd=repo_path, 
                                          timeout=git_timeout, shell=False)
                    if result.returncode == 0:
                        context['branch'] = result.stdout.strip()
                except subprocess.TimeoutExpired:
                    context['branch_error'] = 'Branch query timed out'
                
                # Get last commit info with aggressive timeout
                try:
                    result = subprocess.run(['git', 'log', '-1', '--format=%H:%s'], 
                                          capture_output=True, text=True, cwd=repo_path, 
                                          timeout=git_timeout, shell=False)
                    if result.returncode == 0:
                        commit_info = result.stdout.strip()
                        if ':' in commit_info:
                            commit_hash, commit_msg = commit_info.split(':', 1)
                            context['last_commit'] = {
                                'hash': commit_hash[:8],  # Short hash
                                'message': commit_msg.strip()
                            }
                except subprocess.TimeoutExpired:
                    context['commit_error'] = 'Commit query timed out'
            else:
                context['git_status'] = 'not_a_repo'
        
        except subprocess.TimeoutExpired:
            context['git_error'] = f'Git operations timed out after {git_timeout}s'
        except FileNotFoundError:
            context['git_error'] = 'Git not found in PATH'
        except Exception as e:
            context['git_error'] = f'Git error: {str(e)}'
        
        # Get GitHub issue context if we have a valid repo
        if 'repo_path' in context and context.get('git_status') == 'repo_found':
            try:
                # Check if GitHub CLI is available and authenticated
                result = subprocess.run(['gh', 'auth', 'status'], 
                                      capture_output=True, text=True, 
                                      timeout=git_timeout, shell=False)
                if result.returncode == 0:
                    # Get current open issues (limit to 3 most recent)
                    try:
                        result = subprocess.run(['gh', 'issue', 'list', '--limit', '3', '--json', 'number,title,state,createdAt'], 
                                              capture_output=True, text=True, cwd=context['repo_path'], 
                                              timeout=git_timeout, shell=False)
                        if result.returncode == 0 and result.stdout.strip():
                            import json
                            issues = json.loads(result.stdout.strip())
                            if issues:
                                context['github_issues'] = {
                                    'count': len(issues),
                                    'recent_issues': [
                                        {
                                            'number': issue['number'],
                                            'title': issue['title'][:60] + ('...' if len(issue['title']) > 60 else ''),
                                            'state': issue['state'],
                                            'created': issue['createdAt'][:10]  # Just the date
                                        }
                                        for issue in issues
                                    ]
                                }
                            else:
                                context['github_issues'] = {'count': 0, 'message': 'No open issues'}
                    except subprocess.TimeoutExpired:
                        context['github_issues_error'] = 'GitHub issues query timed out'
                    except json.JSONDecodeError:
                        context['github_issues_error'] = 'Failed to parse GitHub issues JSON'
                else:
                    context['github_issues_error'] = 'GitHub CLI not authenticated'
            except FileNotFoundError:
                context['github_issues_error'] = 'GitHub CLI (gh) not found in PATH'
            except subprocess.TimeoutExpired:
                context['github_issues_error'] = 'GitHub auth check timed out'
            except Exception as e:
                context['github_issues_error'] = f'GitHub error: {str(e)}'
        
        context['cwd'] = os.getcwd()
        context['timestamp'] = datetime.now().isoformat()
        
        return context
    
    async def get_project_context(self) -> Dict[str, Any]:
        """Get current project context (git repo, branch, etc.) - async version."""
        loop = asyncio.get_event_loop()
        try:
            # Add overall timeout to the async operation itself
            return await asyncio.wait_for(
                loop.run_in_executor(thread_pool, self.get_project_context_sync),
                timeout=10.0  # 10 seconds total timeout
            )
        except asyncio.TimeoutError:
            return {
                'git_error': 'Async Git operations timed out after 10s',
                'cwd': os.getcwd(),
                'timestamp': datetime.now().isoformat()
            }

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
    # Debug logging
    print(f"DEBUG: Requested resource URI: '{uri}' (type: {type(uri)})")
    
    # Convert URI to string if it's not already (handles AnyUrl objects)
    uri_str = str(uri).strip()
    
    if uri_str == "memory://recent":
        try:
            def get_recent_entries():
                with db.get_connection() as conn:
                    cursor = conn.execute("""
                        SELECT id, entry_type, content, timestamp, is_personal, project_context
                        FROM memory_journal 
                        ORDER BY timestamp DESC 
                        LIMIT 10
                    """)
                    entries = [dict(row) for row in cursor.fetchall()]
                    print(f"DEBUG: Found {len(entries)} recent entries")
                    return entries
            
            # Run in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            entries = await loop.run_in_executor(thread_pool, get_recent_entries)
            return json.dumps(entries, indent=2)
        except Exception as e:
            print(f"DEBUG: Error reading recent entries: {e}")
            raise
    
    elif uri_str == "memory://significant":
        try:
            def get_significant_entries():
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
                    print(f"DEBUG: Found {len(entries)} significant entries")
                    return entries
            
            # Run in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            entries = await loop.run_in_executor(thread_pool, get_significant_entries)
            return json.dumps(entries, indent=2)
        except Exception as e:
            print(f"DEBUG: Error reading significant entries: {e}")
            raise
    
    else:
        print(f"DEBUG: No match for URI '{uri_str}'. Available: memory://recent, memory://significant")
        raise ValueError(f"Unknown resource: {uri_str}")

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
        ),
        Tool(
            name="test_simple",
            description="Simple test tool that just returns a message",
            inputSchema={
                "type": "object",
                "properties": {
                    "message": {"type": "string", "default": "Hello"}
                }
            }
        ),
        Tool(
            name="create_entry_minimal",
            description="Minimal entry creation without context or tags",
            inputSchema={
                "type": "object",
                "properties": {
                    "content": {"type": "string", "description": "The journal entry content"}
                },
                "required": ["content"]
            }
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle tool calls."""
    
    # Debug logging
    print(f"DEBUG: Tool call received: {name} with args: {list(arguments.keys())}")
    
    if name == "create_entry":
        print("DEBUG: Starting create_entry processing...")
        content = arguments["content"]
        is_personal = arguments.get("is_personal", True)
        entry_type = arguments.get("entry_type", "personal_reflection")
        tags = arguments.get("tags", [])
        significance_type = arguments.get("significance_type")
        auto_context = arguments.get("auto_context", True)
        
        print(f"DEBUG: Parsed arguments - content length: {len(content)}, tags: {len(tags)}")
        
        project_context = None
        if auto_context:
            print("DEBUG: Getting project context...")
            context = await db.get_project_context()
            project_context = json.dumps(context)
            print("DEBUG: Project context captured successfully")
        
        tag_ids = []
        if tags:
            print(f"DEBUG: Auto-creating {len(tags)} tags...")
            # Run tag creation in thread pool to avoid blocking  
            loop = asyncio.get_event_loop()
            tag_ids = await loop.run_in_executor(thread_pool, db.auto_create_tags, tags)
            print(f"DEBUG: Tags created successfully: {tag_ids}")
        
        # Run database operations in thread pool to avoid blocking event loop
        def create_entry_in_db():
            print("DEBUG: Starting database operations...")
            with db.get_connection() as conn:
                print("DEBUG: Database connection established")
                cursor = conn.execute("""
                    INSERT INTO memory_journal (
                        entry_type, content, is_personal, project_context, related_patterns
                    ) VALUES (?, ?, ?, ?, ?)
                """, (entry_type, content, is_personal, project_context, ','.join(tags)))
                
                entry_id = cursor.lastrowid
                print(f"DEBUG: Entry inserted with ID: {entry_id}")
                
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
                
                conn.commit()  # CRITICAL FIX: Missing commit was causing hangs!
                print("DEBUG: Database transaction committed successfully")
                return entry_id
        
        # Run in thread pool to avoid blocking
        print("DEBUG: Submitting database operation to thread pool...")
        loop = asyncio.get_event_loop()
        entry_id = await loop.run_in_executor(thread_pool, create_entry_in_db)
        print(f"DEBUG: Database operation completed, entry_id: {entry_id}")
        
        result = [types.TextContent(
            type="text",
            text=f"✅ Created journal entry #{entry_id}\n"
                 f"Type: {entry_type}\n"
                 f"Personal: {is_personal}\n"
                 f"Tags: {', '.join(tags) if tags else 'None'}"
        )]
        print(f"DEBUG: create_entry completed successfully, returning result")
        return result
    
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
    
    elif name == "test_simple":
        print("DEBUG: Running simple test...")
        message = arguments.get("message", "Hello")
        print(f"DEBUG: Simple test completed with message: {message}")
        return [types.TextContent(
            type="text",
            text=f"✅ Simple test successful! Message: {message}"
        )]
    
    elif name == "create_entry_minimal":
        print("DEBUG: Starting minimal entry creation...")
        content = arguments["content"]
        
        # Just a simple database insert without any context or tag operations
        def minimal_db_insert():
            print("DEBUG: Minimal DB insert starting...")
            with db.get_connection() as conn:
                cursor = conn.execute("""
                    INSERT INTO memory_journal (
                        entry_type, content, is_personal
                    ) VALUES (?, ?, ?)
                """, ("test_entry", content, True))
                entry_id = cursor.lastrowid
                conn.commit()
                print(f"DEBUG: Minimal DB insert completed, entry_id: {entry_id}")
                return entry_id
        
        # Run in thread pool
        loop = asyncio.get_event_loop()
        entry_id = await loop.run_in_executor(thread_pool, minimal_db_insert)
        
        return [types.TextContent(
            type="text",
            text=f"✅ Minimal entry created #{entry_id}"
        )]
    
    else:
        raise ValueError(f"Unknown tool: {name}")

@server.list_prompts()
async def list_prompts() -> List[Prompt]:
    """List available prompts."""
    return [
        Prompt(
            name="get-context-bundle",
            description="Get current project context as JSON",
            arguments=[
                {
                    "name": "include_git",
                    "description": "Include Git repository information",
                    "required": False
                }
            ]
        ),
        Prompt(
            name="get-recent-entries",
            description="Get the last X journal entries",
            arguments=[
                {
                    "name": "count",
                    "description": "Number of recent entries to retrieve (default: 5)",
                    "required": False
                },
                {
                    "name": "personal_only",
                    "description": "Only show personal entries (true/false)",
                    "required": False
                }
            ]
        )
    ]

@server.get_prompt()
async def get_prompt(name: str, arguments: Dict[str, str]) -> types.GetPromptResult:
    """Handle prompt requests."""
    
    if name == "get-context-bundle":
        include_git = arguments.get("include_git", "true").lower() == "true"
        
        if include_git:
            # Get full context with Git info
            context = await db.get_project_context()
        else:
            # Get basic context without Git operations
            context = {
                'cwd': os.getcwd(),
                'timestamp': datetime.now().isoformat(),
                'git_disabled': 'Git operations skipped by request'
            }
        
        context_json = json.dumps(context, indent=2)
        
        return types.GetPromptResult(
            description="Current project context bundle",
            messages=[
                PromptMessage(
                    role="user",
                    content=types.TextContent(
                        type="text",
                        text=f"Here is the current project context bundle:\n\n```json\n{context_json}\n```\n\nThis includes repository information, current working directory, and timestamp. You can use this context to understand the current project state when creating journal entries."
                    )
                )
            ]
        )
    
    elif name == "get-recent-entries":
        count = int(arguments.get("count", "5"))
        personal_only = arguments.get("personal_only", "false").lower() == "true"
        
        # Get recent entries using existing database functionality
        def get_entries_sync():
            with db.get_connection() as conn:
                sql = "SELECT id, entry_type, content, timestamp, is_personal, project_context FROM memory_journal"
                params = []
                
                if personal_only:
                    sql += " WHERE is_personal = ?"
                    params.append(True)
                
                sql += " ORDER BY timestamp DESC LIMIT ?"
                params.append(count)
                
                cursor = conn.execute(sql, params)
                entries = []
                for row in cursor.fetchall():
                    entry = {
                        'id': row[0],
                        'entry_type': row[1], 
                        'content': row[2],
                        'timestamp': row[3],
                        'is_personal': bool(row[4]),
                        'project_context': json.loads(row[5]) if row[5] else None
                    }
                    entries.append(entry)
                return entries
        
        # Run in thread pool
        loop = asyncio.get_event_loop()
        entries = await loop.run_in_executor(thread_pool, get_entries_sync)
        
        # Format entries for display
        entries_text = f"Here are the {len(entries)} most recent journal entries"
        if personal_only:
            entries_text += " (personal only)"
        entries_text += ":\n\n"
        
        for i, entry in enumerate(entries, 1):
            entries_text += f"**Entry #{entry['id']}** ({entry['entry_type']}) - {entry['timestamp']}\n"
            entries_text += f"Personal: {entry['is_personal']}\n"
            entries_text += f"Content: {entry['content'][:200]}"
            if len(entry['content']) > 200:
                entries_text += "..."
            entries_text += "\n"
            
            if entry['project_context']:
                ctx = entry['project_context']
                if 'repo_name' in ctx:
                    entries_text += f"Context: {ctx['repo_name']} ({ctx.get('branch', 'unknown branch')})\n"
            entries_text += "\n"
        
        return types.GetPromptResult(
            description=f"Last {count} journal entries",
            messages=[
                PromptMessage(
                    role="user", 
                    content=types.TextContent(
                        type="text",
                        text=entries_text
                    )
                )
            ]
        )
    
    else:
        raise ValueError(f"Unknown prompt: {name}")

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
"""
Memory Journal MCP Server - Search Tool Handlers
Handlers for full-text search, semantic search, and date range search.
"""

import asyncio
import sqlite3
from typing import Any, Dict, List, Optional
from concurrent.futures import ThreadPoolExecutor

import mcp.types as types

from constants import DB_PATH, TEAM_DB_PATH
from database.base import MemoryJournalDB
from database.team_db import TeamDatabaseManager
from vector_search import VectorSearchManager
from utils import escape_fts5_query
import sys

# These will be initialized by the main server
db: Optional[MemoryJournalDB] = None
vector_search: Optional[VectorSearchManager] = None
thread_pool: Optional[ThreadPoolExecutor] = None
team_db: Optional[TeamDatabaseManager] = None


def initialize_search_handlers(db_instance: MemoryJournalDB, 
                                vector_search_instance: Optional[VectorSearchManager],
                                thread_pool_instance: ThreadPoolExecutor):
    """Initialize the search handlers with database and vector search instances."""
    global db, vector_search, thread_pool, team_db
    db = db_instance
    vector_search = vector_search_instance
    thread_pool = thread_pool_instance
    # Initialize team database manager
    try:
        team_db = TeamDatabaseManager(TEAM_DB_PATH)
        print("[INFO] Team database manager initialized for search", file=sys.stderr)
    except Exception as e:
        print(f"[WARNING] Team database search initialization failed: {e}", file=sys.stderr)
        team_db = None


async def handle_search_entries(arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle full-text search on journal entries using FTS5."""
    if db is None:
        raise RuntimeError("Search handlers not initialized.")
    
    query = arguments.get("query")
    is_personal = arguments.get("is_personal")
    limit = arguments.get("limit", 10)
    project_number = arguments.get("project_number")
    issue_number = arguments.get("issue_number")
    pr_number = arguments.get("pr_number")
    pr_status = arguments.get("pr_status")
    workflow_run_id = arguments.get("workflow_run_id")

    if query:
        # Use the utility function from utils.py
        escaped_query = escape_fts5_query(query)
        
        sql = """
            SELECT m.id, m.entry_type, m.content, m.timestamp, m.is_personal, m.project_number,
                   snippet(memory_journal_fts, 0, '**', '**', '...', 20) AS snippet
            FROM memory_journal_fts
            JOIN memory_journal m ON memory_journal_fts.rowid = m.id
            WHERE memory_journal_fts MATCH ?
            AND m.deleted_at IS NULL
        """
        params = [escaped_query]
        
        if is_personal is not None:
            sql += " AND m.is_personal = ?"
            params.append(is_personal)
        
        if project_number is not None:
            sql += " AND m.project_number = ?"
            params.append(project_number)
        
        if issue_number is not None:
            sql += " AND m.issue_number = ?"
            params.append(issue_number)
        
        if pr_number is not None:
            sql += " AND m.pr_number = ?"
            params.append(pr_number)
        
        if pr_status is not None:
            sql += " AND m.pr_status = ?"
            params.append(pr_status)
        
        if workflow_run_id is not None:
            sql += " AND m.workflow_run_id = ?"
            params.append(workflow_run_id)
    else:
        sql = """
            SELECT id, entry_type, content, timestamp, is_personal, project_number,
                   substr(content, 1, 100) || '...' AS snippet
            FROM memory_journal
            WHERE deleted_at IS NULL
        """
        params: list[Any] = []
        
        if is_personal is not None:
            sql += " AND is_personal = ?"
            params.append(is_personal)
        
        if project_number is not None:
            sql += " AND project_number = ?"
            params.append(project_number)
        
        if issue_number is not None:
            sql += " AND issue_number = ?"
            params.append(issue_number)
        
        if pr_number is not None:
            sql += " AND pr_number = ?"
            params.append(pr_number)
        
        if pr_status is not None:
            sql += " AND pr_status = ?"
            params.append(pr_status)
        
        if workflow_run_id is not None:
            sql += " AND workflow_run_id = ?"
            params.append(workflow_run_id)

    sql += " ORDER BY timestamp DESC LIMIT ?"
    params.append(limit)

    # Query personal database
    with db.get_connection() as conn:
        cursor = conn.execute(sql, params)
        entries = [dict(row) for row in cursor.fetchall()]
        # Mark as personal entries
        for entry in entries:
            entry['source'] = 'personal'
    
    # Query team database if available (v2.0.0 Team Collaboration)
    team_entries = []
    if team_db:
        try:
            # Use team_db's get_team_entries method with basic filters
            team_entries = team_db.get_team_entries(
                limit=limit,
                tags=None,  # Could be enhanced to parse from query
                entry_type=None,
                start_date=None,
                end_date=None
            )
            # Add snippets to team entries
            for entry in team_entries:
                if 'content' in entry:
                    entry['snippet'] = entry['content'][:100] + '...' if len(entry['content']) > 100 else entry['content']
        except Exception as e:
            print(f"[WARNING] Failed to query team database: {e}", file=sys.stderr)
    
    # Merge results, sort by timestamp, limit to requested number
    all_entries = entries + team_entries
    all_entries.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
    all_entries = all_entries[:limit]

    result = f"Found {len(all_entries)} entries ({len(entries)} personal, {len(team_entries)} team):\n\n"
    for entry in all_entries:
        source_indicator = "👥 " if entry.get('source') == 'team' else ""
        result += f"{source_indicator}#{entry['id']} ({entry['entry_type']}) - {entry['timestamp']}\n"
        result += f"Personal: {bool(entry['is_personal'])}\n"
        if entry.get('source') == 'team':
            result += f"Source: Team-shared entry\n"
        result += f"Snippet: {entry.get('snippet', '')}\n\n"

    return [types.TextContent(type="text", text=result)]


async def handle_semantic_search(arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle semantic/vector search on journal entries."""
    query = arguments.get("query")
    limit = arguments.get("limit", 10)
    similarity_threshold = arguments.get("similarity_threshold", 0.3)
    is_personal = arguments.get("is_personal")

    if not query:
        return [types.TextContent(
            type="text",
            text="❌ Query parameter is required for semantic search"
        )]

    if not vector_search:
        return [types.TextContent(
            type="text",
            text="❌ Vector search not available. Install dependencies: pip install sentence-transformers faiss-cpu"
        )]
    
    # Trigger lazy initialization on first use (await since it's now async)
    await vector_search.ensure_initialized()
    
    if not vector_search.initialized:
        return [types.TextContent(
            type="text",
            text="❌ Vector search initialization failed. Check server logs for details."
        )]

    try:
        # Perform semantic search
        search_results = await vector_search.semantic_search(query, limit, similarity_threshold)

        if not search_results:
            return [types.TextContent(
                type="text",
                text=f"🔍 No semantically similar entries found for: '{query}'"
            )]

        # Fetch entry details from database
        def get_semantic_entry_details() -> Dict[int, Dict[str, Any]]:
            entry_ids: list[Any] = [result[0] for result in search_results]
            with sqlite3.connect(DB_PATH) as conn:
                placeholders = ','.join(['?'] * len(entry_ids))
                sql = f"""
                    SELECT id, entry_type, content, timestamp, is_personal
                    FROM memory_journal
                    WHERE id IN ({placeholders})
                """
                if is_personal is not None:
                    sql += " AND is_personal = ?"
                    entry_ids.append(is_personal)

                cursor = conn.execute(sql, entry_ids)
                entries: Dict[int, Dict[str, Any]] = {}
                for row in cursor.fetchall():
                    entries[row[0]] = {
                        'id': row[0],
                        'entry_type': row[1],
                        'content': row[2],
                        'timestamp': row[3],
                        'is_personal': bool(row[4])
                    }
                return entries

        loop = asyncio.get_event_loop()
        entries = await loop.run_in_executor(thread_pool, get_semantic_entry_details)

        # Format results
        result_text = f"🔍 **Semantic Search Results** for: '{query}'\n"
        result_text += f"Found {len(search_results)} semantically similar entries:\n\n"

        for entry_id, similarity_score in search_results:
            if entry_id in entries:
                entry = entries[entry_id]
                result_text += f"**Entry #{entry['id']}** (similarity: {similarity_score:.3f})\n"
                result_text += f"Type: {entry['entry_type']} | Personal: {entry['is_personal']} | {entry['timestamp']}\n"

                # Show content preview
                content_preview = entry['content'][:200]
                if len(entry['content']) > 200:
                    content_preview += "..."
                result_text += f"Content: {content_preview}\n\n"

        return [types.TextContent(
            type="text",
            text=result_text
        )]

    except Exception as e:
        return [types.TextContent(
            type="text",
            text=f"❌ Error in semantic search: {str(e)}"
        )]


async def handle_search_by_date_range(arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle searching journal entries within a date range."""
    if db is None:
        raise RuntimeError("Search handlers not initialized.")
    
    # Capture for use in nested functions
    _db = db
    
    start_date = arguments.get("start_date")
    end_date = arguments.get("end_date")
    is_personal = arguments.get("is_personal")
    entry_type = arguments.get("entry_type")
    tags = arguments.get("tags", [])
    project_number = arguments.get("project_number")
    issue_number = arguments.get("issue_number")
    pr_number = arguments.get("pr_number")
    workflow_run_id = arguments.get("workflow_run_id")

    if not start_date or not end_date:
        return [types.TextContent(type="text", text="❌ Both start_date and end_date are required (YYYY-MM-DD)")]

    def search_entries():
        with _db.get_connection() as conn:
            sql = """
                SELECT DISTINCT m.id, m.entry_type, m.content, m.timestamp, m.is_personal, m.project_number
                FROM memory_journal m
                WHERE m.deleted_at IS NULL
                AND DATE(m.timestamp) >= DATE(?)
                AND DATE(m.timestamp) <= DATE(?)
            """
            params = [start_date, end_date]

            if is_personal is not None:
                sql += " AND m.is_personal = ?"
                params.append(is_personal)

            if entry_type:
                sql += " AND m.entry_type = ?"
                params.append(entry_type)
            
            if project_number is not None:
                sql += " AND m.project_number = ?"
                params.append(project_number)
            
            if issue_number is not None:
                sql += " AND m.issue_number = ?"
                params.append(issue_number)
            
            if pr_number is not None:
                sql += " AND m.pr_number = ?"
                params.append(pr_number)
            
            if workflow_run_id is not None:
                sql += " AND m.workflow_run_id = ?"
                params.append(workflow_run_id)

            if tags:
                sql += """ AND m.id IN (
                    SELECT et.entry_id FROM entry_tags et
                    JOIN tags t ON et.tag_id = t.id
                    WHERE t.name IN ({})
                )""".format(','.join(['?'] * len(tags)))
                params.extend(tags)

            sql += " ORDER BY m.timestamp DESC"

            cursor = conn.execute(sql, params)
            return [dict(row) for row in cursor.fetchall()]

    loop = asyncio.get_event_loop()
    entries = await loop.run_in_executor(thread_pool, search_entries)
    
    # Mark personal entries
    for entry in entries:
        entry['source'] = 'personal'
    
    # Query team database if available (v2.0.0 Team Collaboration)
    team_entries = []
    if team_db:
        try:
            team_entries = team_db.get_team_entries(
                limit=1000,  # Large limit for date range
                tags=tags if tags else None,
                entry_type=entry_type,
                start_date=start_date,
                end_date=end_date
            )
        except Exception as e:
            print(f"[WARNING] Failed to query team database for date range: {e}", file=sys.stderr)
    
    # Merge and sort
    all_entries = entries + team_entries
    all_entries.sort(key=lambda x: x.get('timestamp', ''), reverse=True)

    if not all_entries:
        return [types.TextContent(
            type="text",
            text=f"🔍 No entries found between {start_date} and {end_date}"
        )]

    result = f"📅 Found {len(all_entries)} entries between {start_date} and {end_date} ({len(entries)} personal, {len(team_entries)} team):\n\n"
    for entry in all_entries:
        source_indicator = "👥 " if entry.get('source') == 'team' else ""
        result += f"{source_indicator}**Entry #{entry['id']}** ({entry['entry_type']}) - {entry['timestamp']}\n"
        if entry.get('source') == 'team':
            result += f"(Team-shared entry)\n"
        preview = entry['content'][:150] + ('...' if len(entry['content']) > 150 else '')
        result += f"{preview}\n\n"

    return [types.TextContent(type="text", text=result)]


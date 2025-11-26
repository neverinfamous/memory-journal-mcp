"""
Memory Journal MCP Server - Export Tool Handlers
Handlers for exporting journal entries to various formats.
"""

import asyncio
import json
from typing import Any, Dict, List, Optional
from concurrent.futures import ThreadPoolExecutor

import mcp.types as types

from database.base import MemoryJournalDB

# These will be initialized by the main server
db: Optional[MemoryJournalDB] = None
thread_pool: Optional[ThreadPoolExecutor] = None


def initialize_export_handlers(db_instance: MemoryJournalDB, thread_pool_instance: ThreadPoolExecutor):
    """Initialize the export handlers with database instance."""
    global db, thread_pool
    db = db_instance
    thread_pool = thread_pool_instance


async def handle_export_entries(arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle exporting journal entries to JSON or Markdown format."""
    if db is None:
        raise RuntimeError("Export handlers not initialized.")
    
    # Capture for use in nested functions
    _db = db
    
    format_type = arguments.get("format", "json")
    start_date = arguments.get("start_date")
    end_date = arguments.get("end_date")
    tags = arguments.get("tags", [])
    entry_types = arguments.get("entry_types", [])

    def get_entries_for_export() -> list[dict[str, Any]]:
        with _db.get_connection() as conn:
            sql = """
                SELECT DISTINCT m.id, m.entry_type, m.content, m.timestamp, 
                       m.is_personal, m.project_context, m.related_patterns
                FROM memory_journal m
                WHERE m.deleted_at IS NULL
            """
            params: list[Any] = []

            if start_date:
                sql += " AND DATE(m.timestamp) >= DATE(?)"
                params.append(start_date)
            if end_date:
                sql += " AND DATE(m.timestamp) <= DATE(?)"
                params.append(end_date)

            if tags:
                sql += """ AND m.id IN (
                    SELECT et.entry_id FROM entry_tags et
                    JOIN tags t ON et.tag_id = t.id
                    WHERE t.name IN ({})
                )""".format(','.join(['?'] * len(tags)))
                params.extend(tags)

            if entry_types:
                sql += " AND m.entry_type IN ({})".format(','.join(['?'] * len(entry_types)))
                params.extend(entry_types)

            sql += " ORDER BY m.timestamp"

            cursor = conn.execute(sql, params)
            entries: list[dict[str, Any]] = []
            
            for row in cursor.fetchall():
                entry = dict(row)
                entry_id = entry['id']
                
                # Get tags for this entry
                tag_cursor = conn.execute("""
                    SELECT t.name FROM tags t
                    JOIN entry_tags et ON t.id = et.tag_id
                    WHERE et.entry_id = ?
                """, (entry_id,))
                entry['tags'] = [t[0] for t in tag_cursor.fetchall()]
                
                entries.append(entry)

            return entries

    loop = asyncio.get_event_loop()
    entries = await loop.run_in_executor(thread_pool, get_entries_for_export)

    if not entries:
        return [types.TextContent(type="text", text="📦 No entries found matching the criteria")]

    if format_type == "markdown":
        output = f"# Journal Export\n\n"
        output += f"Exported {len(entries)} entries\n"
        if start_date or end_date:
            output += f"Date range: {start_date or 'beginning'} to {end_date or 'end'}\n"
        output += f"\n---\n\n"

        for entry in entries:
            output += f"## Entry #{entry['id']} - {entry['timestamp']}\n\n"
            output += f"**Type:** {entry['entry_type']}  \n"
            output += f"**Personal:** {bool(entry['is_personal'])}  \n"
            if entry['tags']:
                output += f"**Tags:** {', '.join(entry['tags'])}  \n"
            output += f"\n{entry['content']}\n\n---\n\n"
    else:  # json
        output = json.dumps(entries, indent=2)

    # Format output preview
    truncated_suffix = '...\n[truncated]' if len(output) > 2000 else ''
    output_preview = output[:2000] + truncated_suffix
    
    return [types.TextContent(
        type="text",
        text=f"📦 **Export Complete**\n\n"
             f"Format: {format_type.upper()}\n"
             f"Entries: {len(entries)}\n\n"
             f"```{format_type}\n{output_preview}\n```"
    )]


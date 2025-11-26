"""
Memory Journal MCP Server - Relationship Tool Handlers
Handlers for linking entries and visualizing relationships.
"""

import asyncio
from typing import Any, Dict, List, Optional
from concurrent.futures import ThreadPoolExecutor

import mcp.types as types

from database.base import MemoryJournalDB

# These will be initialized by the main server
db: Optional[MemoryJournalDB] = None
thread_pool: Optional[ThreadPoolExecutor] = None


def initialize_relationship_handlers(db_instance: MemoryJournalDB, thread_pool_instance: ThreadPoolExecutor):
    """Initialize the relationship handlers with database instance."""
    global db, thread_pool
    db = db_instance
    thread_pool = thread_pool_instance


async def handle_link_entries(arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle creating a relationship between two journal entries."""
    if db is None:
        raise RuntimeError("Relationship handlers not initialized.")
    
    # Capture for use in nested functions
    _db = db
    
    from_entry_id = arguments.get("from_entry_id")
    to_entry_id = arguments.get("to_entry_id")
    relationship_type = arguments.get("relationship_type", "references")
    description = arguments.get("description")

    if not from_entry_id or not to_entry_id:
        return [types.TextContent(type="text", text="❌ Both from_entry_id and to_entry_id are required")]

    if from_entry_id == to_entry_id:
        return [types.TextContent(type="text", text="❌ Cannot link an entry to itself")]

    def create_relationship():
        with _db.get_connection() as conn:
            # Verify both entries exist
            cursor = conn.execute(
                "SELECT COUNT(*) FROM memory_journal WHERE id IN (?, ?) AND deleted_at IS NULL",
                (from_entry_id, to_entry_id)
            )
            if cursor.fetchone()[0] != 2:
                return None

            # Check if relationship already exists
            cursor = conn.execute("""
                SELECT id FROM relationships 
                WHERE from_entry_id = ? AND to_entry_id = ? AND relationship_type = ?
            """, (from_entry_id, to_entry_id, relationship_type))
            
            if cursor.fetchone():
                return "exists"

            # Create relationship
            conn.execute("""
                INSERT INTO relationships (from_entry_id, to_entry_id, relationship_type, description)
                VALUES (?, ?, ?, ?)
            """, (from_entry_id, to_entry_id, relationship_type, description))
            
            conn.commit()
            return "created"

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(thread_pool, create_relationship)

    if result is None:
        return [types.TextContent(type="text", text="❌ One or both entries not found")]
    elif result == "exists":
        return [types.TextContent(
            type="text",
            text=f"ℹ️  Relationship already exists: Entry #{from_entry_id} -{relationship_type}-> Entry #{to_entry_id}"
        )]
    else:
        return [types.TextContent(
            type="text",
            text=f"✅ Created relationship: Entry #{from_entry_id} -{relationship_type}-> Entry #{to_entry_id}"
        )]


async def handle_visualize_relationships(arguments: Dict[str, Any]) -> List[types.TextContent]:
    """Handle generating a Mermaid diagram visualization of entry relationships."""
    if db is None:
        raise RuntimeError("Relationship handlers not initialized.")
    
    # Capture for use in nested functions
    _db = db
    
    entry_id = arguments.get("entry_id")
    tags = arguments.get("tags", [])
    depth = arguments.get("depth", 2)
    limit = arguments.get("limit", 20)

    def generate_graph():
        with _db.get_connection() as conn:
            # Build the query to get entries and their relationships
            entries_query = """
                SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
                FROM memory_journal mj
                WHERE mj.deleted_at IS NULL
            """
            params: List[Any] = []

            if entry_id:
                # Get the specified entry and all connected entries up to depth
                entries_query = f"""
                    WITH RECURSIVE connected_entries(id, distance) AS (
                        SELECT id, 0 FROM memory_journal WHERE id = ? AND deleted_at IS NULL
                        UNION
                        SELECT DISTINCT 
                            CASE 
                                WHEN r.from_entry_id = ce.id THEN r.to_entry_id
                                ELSE r.from_entry_id
                            END,
                            ce.distance + 1
                        FROM connected_entries ce
                        JOIN relationships r ON r.from_entry_id = ce.id OR r.to_entry_id = ce.id
                        WHERE ce.distance < ?
                    )
                    SELECT DISTINCT mj.id, mj.entry_type, mj.content, mj.is_personal
                    FROM memory_journal mj
                    JOIN connected_entries ce ON mj.id = ce.id
                    WHERE mj.deleted_at IS NULL
                    LIMIT ?
                """
                params = [entry_id, depth, limit]
            elif tags:
                # Filter by tags
                placeholders = ','.join(['?' for _ in tags])
                entries_query += f"""
                    AND mj.id IN (
                        SELECT et.entry_id FROM entry_tags et
                        JOIN tags t ON et.tag_id = t.id
                        WHERE t.name IN ({placeholders})
                    )
                    LIMIT ?
                """
                params = tags + [limit]
            else:
                # Get recent entries with relationships
                entries_query += """
                    AND mj.id IN (
                        SELECT DISTINCT from_entry_id FROM relationships
                        UNION
                        SELECT DISTINCT to_entry_id FROM relationships
                    )
                    ORDER BY mj.timestamp DESC
                    LIMIT ?
                """
                params = [limit]

            cursor = conn.execute(entries_query, params)
            entries = {row[0]: dict(row) for row in cursor.fetchall()}

            if not entries:
                return None, None

            # Get all relationships between these entries
            entry_ids = list(entries.keys())
            placeholders = ','.join(['?' for _ in entry_ids])
            relationships_query = f"""
                SELECT from_entry_id, to_entry_id, relationship_type
                FROM relationships
                WHERE from_entry_id IN ({placeholders})
                  AND to_entry_id IN ({placeholders})
            """
            cursor = conn.execute(relationships_query, entry_ids + entry_ids)
            relationships = cursor.fetchall()

            return entries, relationships

    loop = asyncio.get_event_loop()
    entries, relationships = await loop.run_in_executor(thread_pool, generate_graph)

    if not entries:
        return [types.TextContent(
            type="text",
            text="❌ No entries found with relationships matching your criteria"
        )]

    # Generate Mermaid diagram
    mermaid = "```mermaid\ngraph TD\n"
    
    # Add nodes with truncated content
    for entry_id_key, entry in entries.items():
        content_preview = entry['content'][:40].replace('\n', ' ')
        if len(entry['content']) > 40:
            content_preview += '...'
        # Escape special characters for Mermaid
        content_preview = content_preview.replace('"', "'").replace('[', '(').replace(']', ')')
        
        entry_type_short = entry['entry_type'][:20]
        node_label = f"#{entry_id_key}: {content_preview}<br/>{entry_type_short}"
        mermaid += f"    E{entry_id_key}[\"{node_label}\"]\n"

    mermaid += "\n"

    # Add relationships
    relationship_symbols = {
        'references': '-->',
        'implements': '==>',
        'clarifies': '-.->',
        'evolves_from': '-->',
        'response_to': '<-->'
    }

    if relationships:
        for rel in relationships:
            from_id, to_id, rel_type = rel
            arrow = relationship_symbols.get(rel_type, '-->')
            mermaid += f"    E{from_id} {arrow}|{rel_type}| E{to_id}\n"

    # Add styling
    mermaid += "\n"
    for entry_id_key, entry in entries.items():
        if entry['is_personal']:
            mermaid += f"    style E{entry_id_key} fill:#E3F2FD\n"
        else:
            mermaid += f"    style E{entry_id_key} fill:#FFF3E0\n"

    mermaid += "```"

    summary = f"🔗 **Relationship Graph**\n\n"
    summary += f"**Entries:** {len(entries)}\n"
    summary += f"**Relationships:** {len(relationships) if relationships else 0}\n"
    if entry_id:
        summary += f"**Root Entry:** #{entry_id}\n"
        summary += f"**Depth:** {depth}\n"
    summary += f"\n{mermaid}\n\n"
    summary += "**Legend:**\n"
    summary += "- Blue nodes: Personal entries\n"
    summary += "- Orange nodes: Project entries\n"
    summary += "- `-->` references / evolves_from | `==>` implements | `-.->` clarifies | `<-->` response_to"

    return [types.TextContent(type="text", text=summary)]


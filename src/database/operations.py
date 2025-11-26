"""
Memory Journal MCP Server - Database Operations Module
CRUD operations and tag management for journal entries.
"""

import sqlite3
from typing import List

from exceptions import DatabaseError


def auto_create_tags(conn: sqlite3.Connection, tag_names: List[str]) -> List[int]:
    """
    Auto-create tags if they don't exist, return tag IDs. Thread-safe with INSERT OR IGNORE.
    
    Args:
        conn: Database connection
        tag_names: List of tag names to create/retrieve
        
    Returns:
        List of tag IDs
    """
    tag_ids: list[int] = []

    try:
        for tag_name in tag_names:
            # Use INSERT OR IGNORE to handle race conditions
            conn.execute(
                "INSERT OR IGNORE INTO tags (name, usage_count) VALUES (?, 1)",
                (tag_name,)
            )
            
            # Now fetch the tag ID (whether we just created it or it already existed)
            cursor = conn.execute("SELECT id FROM tags WHERE name = ?", (tag_name,))
            row = cursor.fetchone()
            if row:
                tag_ids.append(row['id'] if hasattr(row, 'keys') else row[0])
    except sqlite3.Error as e:
        raise DatabaseError(f"Failed to create/retrieve tags: {e}")

    return tag_ids


"""
Memory Journal MCP Server - GitHub Caching Module
Caching functionality for GitHub API responses.
"""

import json
import sys
import time
from typing import Optional, Any, TYPE_CHECKING

from exceptions import DatabaseError as _DatabaseError  # pyright: ignore[reportUnusedImport]

if TYPE_CHECKING:
    from database.base import MemoryJournalDB


def get_cache(db_connection: Optional['MemoryJournalDB'], key: str) -> Optional[Any]:
    """
    Get value from cache if not expired.
    
    Args:
        db_connection: Database connection instance
        key: Cache key to retrieve
        
    Returns:
        Cached value or None if not found/expired
    """
    if not db_connection:
        return None
    
    try:
        with db_connection.get_connection() as conn:
            cursor = conn.execute("""
                SELECT cache_value, cached_at, ttl_seconds
                FROM github_project_cache
                WHERE cache_key = ?
            """, (key,))
            row = cursor.fetchone()
            
            if row:
                cache_value, cached_at, ttl_seconds = row
                current_time = int(time.time())
                
                # Check if cache is still valid
                if current_time - cached_at < ttl_seconds:
                    return json.loads(cache_value)
                else:
                    # Cache expired, delete it
                    conn.execute("DELETE FROM github_project_cache WHERE cache_key = ?", (key,))
    except Exception as e:
        print(f"Cache read error: {e}", file=sys.stderr)
    
    return None


def set_cache(db_connection: Optional['MemoryJournalDB'], key: str, value: Any, ttl: int) -> None:
    """
    Set value in cache with TTL.
    
    Args:
        db_connection: Database connection instance
        key: Cache key to set
        value: Value to cache (will be JSON-serialized)
        ttl: Time to live in seconds
    """
    if not db_connection:
        return
    
    try:
        with db_connection.get_connection() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO github_project_cache (cache_key, cache_value, cached_at, ttl_seconds)
                VALUES (?, ?, ?, ?)
            """, (key, json.dumps(value), int(time.time()), ttl))
    except Exception as e:
        print(f"Cache write error: {e}", file=sys.stderr)


def clear_cache(db_connection: Optional['MemoryJournalDB'], key_pattern: Optional[str] = None) -> int:
    """
    Clear cache entries.
    
    Args:
        db_connection: Database connection instance
        key_pattern: Optional SQL LIKE pattern to match keys (e.g., "project:%")
                    If None, clears all cache entries
        
    Returns:
        Number of entries cleared
    """
    if not db_connection:
        return 0
    
    try:
        with db_connection.get_connection() as conn:
            if key_pattern:
                cursor = conn.execute(
                    "DELETE FROM github_project_cache WHERE cache_key LIKE ?",
                    (key_pattern,)
                )
            else:
                cursor = conn.execute("DELETE FROM github_project_cache")
            
            return cursor.rowcount
    except Exception as e:
        print(f"Cache clear error: {e}", file=sys.stderr)
        return 0


def clear_expired_cache(db_connection: Optional['MemoryJournalDB']) -> int:
    """
    Clear expired cache entries.
    
    Args:
        db_connection: Database connection instance
        
    Returns:
        Number of entries cleared
    """
    if not db_connection:
        return 0
    
    try:
        current_time = int(time.time())
        with db_connection.get_connection() as conn:
            cursor = conn.execute("""
                DELETE FROM github_project_cache
                WHERE (cached_at + ttl_seconds) < ?
            """, (current_time,))
            
            return cursor.rowcount
    except Exception as e:
        print(f"Cache cleanup error: {e}", file=sys.stderr)
        return 0


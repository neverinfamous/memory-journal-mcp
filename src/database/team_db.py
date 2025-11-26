"""
Memory Journal MCP Server - Team Database Module
Manages the shared team database for Git-based collaboration.
"""

import sqlite3
import os
import sys
from typing import Optional, List, Dict, Any
from datetime import datetime

from constants import TEAM_DB_PATH, DB_PRAGMA_SETTINGS
from exceptions import (
    DatabaseError, DatabaseConnectionError
)


class TeamDatabaseManager:
    """
    Manages the team-shared database operations.
    
    This class handles a separate SQLite database file that is Git-tracked
    and shared among team members. Entries marked with share_with_team=true
    are copied to this database for team visibility.
    """

    def __init__(self, team_db_path: str = TEAM_DB_PATH):
        """
        Initialize the team database connection.
        
        Args:
            team_db_path: Path to the team SQLite database file
        """
        self.db_path = team_db_path
        self._ensure_database_exists()

    def _ensure_database_exists(self):
        """Ensure team database exists with proper schema."""
        if not os.path.exists(self.db_path):
            print(f"[INFO] Creating team database at {self.db_path}", file=sys.stderr)
            self._initialize_database()
        else:
            # Verify database integrity
            try:
                with self.get_connection() as conn:
                    conn.execute("SELECT 1 FROM memory_journal LIMIT 1")
            except sqlite3.Error:
                print("[WARNING] Team database corrupted, reinitializing", file=sys.stderr)
                self._initialize_database()

    def _initialize_database(self):
        """Initialize team database with same schema as personal DB."""
        schema_path = os.path.join(os.path.dirname(__file__), "..", "schema.sql")
        
        try:
            with sqlite3.connect(self.db_path) as conn:
                # Apply all PRAGMA settings
                for pragma, value in DB_PRAGMA_SETTINGS.items():
                    conn.execute(f"PRAGMA {pragma} = {value}")
                
                # Load and execute schema
                if os.path.exists(schema_path):
                    with open(schema_path, 'r') as f:
                        conn.executescript(f.read())
                else:
                    raise DatabaseConnectionError(f"Schema file not found: {schema_path}")
                
                print("[INFO] Team database initialized successfully", file=sys.stderr)
        except sqlite3.Error as e:
            raise DatabaseConnectionError(f"Failed to initialize team database: {e}")

    def get_connection(self):
        """Get database connection with proper settings."""
        try:
            conn = sqlite3.connect(self.db_path)
            
            # Apply consistent PRAGMA settings
            for pragma, value in DB_PRAGMA_SETTINGS.items():
                conn.execute(f"PRAGMA {pragma} = {value}")
            
            conn.row_factory = sqlite3.Row
            return conn
        except sqlite3.Error as e:
            raise DatabaseConnectionError(f"Failed to connect to team database: {e}")

    def copy_entry_to_team(self, entry: Dict[str, Any]) -> bool:
        """
        Copy a shared entry to the team database.
        
        Args:
            entry: Dictionary containing entry data
            
        Returns:
            bool: True if successful, False otherwise
        """
        try:
            with self.get_connection() as conn:
                # Check if entry already exists (by original entry_id in metadata)
                original_id = entry.get('id')
                if original_id:
                    existing = conn.execute("""
                        SELECT id FROM memory_journal 
                        WHERE json_extract(metadata, '$.original_entry_id') = ?
                    """, (original_id,)).fetchone()
                    
                    if existing:
                        print(f"[INFO] Entry {original_id} already shared, updating", file=sys.stderr)
                        return self._update_team_entry(conn, existing['id'], entry)
                
                # Insert new shared entry
                cursor = conn.execute("""
                    INSERT INTO memory_journal (
                        entry_type, content, timestamp, is_personal, share_with_team,
                        project_context, related_patterns, project_number, 
                        project_item_id, github_project_url, metadata, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    entry.get('entry_type', 'development_note'),
                    entry.get('content', ''),
                    entry.get('timestamp', datetime.now().isoformat()),
                    0,  # Team entries are always project-level (not personal)
                    1,  # Mark as shared
                    entry.get('project_context'),
                    entry.get('related_patterns'),
                    entry.get('project_number'),
                    entry.get('project_item_id'),
                    entry.get('github_project_url'),
                    self._build_team_metadata(entry),
                    entry.get('created_at', datetime.now().isoformat())
                ))
                
                team_entry_id = cursor.lastrowid
                
                # Ensure we got a valid entry ID
                if team_entry_id is None:
                    raise DatabaseError("Failed to get team entry ID after insert")
                
                # Copy tags if present
                if 'tags' in entry and entry['tags']:
                    self._copy_tags(conn, team_entry_id, entry['tags'])
                
                # Copy significance if present
                if entry.get('significance_type'):
                    self._copy_significance(conn, team_entry_id, entry)
                
                conn.commit()
                print(f"[INFO] Entry {original_id} copied to team database as #{team_entry_id}", file=sys.stderr)
                return True
                
        except sqlite3.Error as e:
            print(f"[ERROR] Failed to copy entry to team database: {e}", file=sys.stderr)
            return False

    def _build_team_metadata(self, entry: Dict[str, Any]) -> str:
        """Build metadata JSON for team entry including original entry ID."""
        import json
        
        metadata = {}
        if entry.get('metadata'):
            try:
                metadata = json.loads(entry['metadata'])
            except json.JSONDecodeError:
                pass
        
        # Add original entry ID for tracking
        metadata['original_entry_id'] = entry.get('id')
        metadata['shared_at'] = datetime.now().isoformat()
        metadata['source'] = 'team_shared'
        
        return json.dumps(metadata)

    def _update_team_entry(self, conn: sqlite3.Connection, team_entry_id: int, entry: Dict[str, Any]) -> bool:
        """Update an existing team entry."""
        try:
            conn.execute("""
                UPDATE memory_journal 
                SET content = ?, entry_type = ?, timestamp = ?,
                    project_context = ?, related_patterns = ?,
                    project_number = ?, project_item_id = ?, 
                    github_project_url = ?, metadata = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (
                entry.get('content'),
                entry.get('entry_type'),
                entry.get('timestamp'),
                entry.get('project_context'),
                entry.get('related_patterns'),
                entry.get('project_number'),
                entry.get('project_item_id'),
                entry.get('github_project_url'),
                self._build_team_metadata(entry),
                team_entry_id
            ))
            
            # Update tags
            if 'tags' in entry:
                # Delete old tag associations
                conn.execute("DELETE FROM entry_tags WHERE entry_id = ?", (team_entry_id,))
                # Add new tags
                self._copy_tags(conn, team_entry_id, entry['tags'])
            
            return True
        except sqlite3.Error as e:
            print(f"[ERROR] Failed to update team entry: {e}", file=sys.stderr)
            return False

    def _copy_tags(self, conn: sqlite3.Connection, entry_id: int, tags: List[str]) -> None:
        """Copy tags to team database."""
        for tag_name in tags:
            # Ensure tag exists
            cursor = conn.execute("SELECT id FROM tags WHERE name = ?", (tag_name,))
            tag_row = cursor.fetchone()
            
            if tag_row:
                tag_id = tag_row['id']
            else:
                cursor = conn.execute(
                    "INSERT INTO tags (name, usage_count) VALUES (?, 1)",
                    (tag_name,)
                )
                tag_id = cursor.lastrowid
            
            # Create entry-tag association
            conn.execute(
                "INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)",
                (entry_id, tag_id)
            )

    def _copy_significance(self, conn: sqlite3.Connection, entry_id: int, entry: Dict[str, Any]) -> None:
        """Copy significance to team database."""
        conn.execute("""
            INSERT INTO significant_entries (entry_id, significance_type, timestamp)
            VALUES (?, ?, ?)
        """, (
            entry_id,
            entry.get('significance_type'),
            entry.get('timestamp', datetime.now().isoformat())
        ))

    def get_team_entries(
        self, 
        limit: int = 10,
        tags: Optional[List[str]] = None,
        entry_type: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Query team database for shared entries.
        
        Args:
            limit: Maximum number of entries to return
            tags: Filter by tags (if provided)
            entry_type: Filter by entry type
            start_date: Filter by start date (ISO format)
            end_date: Filter by end date (ISO format)
            
        Returns:
            List of entry dictionaries
        """
        try:
            with self.get_connection() as conn:
                query = """
                    SELECT DISTINCT mj.*
                    FROM memory_journal mj
                    WHERE mj.deleted_at IS NULL
                """
                params: list[Any] = []
                
                # Add tag filter
                if tags:
                    query += """
                        AND mj.id IN (
                            SELECT et.entry_id FROM entry_tags et
                            JOIN tags t ON et.tag_id = t.id
                            WHERE t.name IN ({})
                        )
                    """.format(','.join('?' * len(tags)))
                    params.extend(tags)
                
                # Add entry type filter
                if entry_type:
                    query += " AND mj.entry_type = ?"
                    params.append(entry_type)
                
                # Add date filters
                if start_date:
                    query += " AND mj.timestamp >= ?"
                    params.append(start_date)
                if end_date:
                    query += " AND mj.timestamp <= ?"
                    params.append(end_date)
                
                query += " ORDER BY mj.timestamp DESC LIMIT ?"
                params.append(limit)
                
                cursor = conn.execute(query, params)
                entries: list[dict[str, Any]] = []
                
                for row in cursor.fetchall():
                    entry = dict(row)
                    entry['source'] = 'team'  # Mark as team entry
                    
                    # Fetch tags
                    tag_cursor = conn.execute("""
                        SELECT t.name FROM tags t
                        JOIN entry_tags et ON t.id = et.tag_id
                        WHERE et.entry_id = ?
                    """, (entry['id'],))
                    entry['tags'] = [row['name'] for row in tag_cursor.fetchall()]
                    
                    entries.append(entry)
                
                return entries
                
        except sqlite3.Error as e:
            print(f"[ERROR] Failed to query team database: {e}", file=sys.stderr)
            return []

    def sync_status(self) -> Dict[str, Any]:
        """
        Check Git status of team database file.
        
        Returns:
            Dictionary with sync status information
        """
        import subprocess
        
        status = {
            'exists': os.path.exists(self.db_path),
            'size': os.path.getsize(self.db_path) if os.path.exists(self.db_path) else 0,
            'git_tracked': False,
            'has_changes': False
        }
        
        try:
            # Check if file is tracked by Git
            result = subprocess.run(
                ['git', 'ls-files', self.db_path],
                capture_output=True,
                text=True,
                timeout=2
            )
            status['git_tracked'] = bool(result.stdout.strip())
            
            # Check for uncommitted changes
            result = subprocess.run(
                ['git', 'diff', '--name-only', self.db_path],
                capture_output=True,
                text=True,
                timeout=2
            )
            status['has_changes'] = bool(result.stdout.strip())
            
        except (subprocess.TimeoutExpired, subprocess.SubprocessError) as e:
            print(f"[WARNING] Could not check Git status: {e}", file=sys.stderr)
        
        return status

    def get_entry_count(self) -> int:
        """Get total count of shared entries in team database."""
        try:
            with self.get_connection() as conn:
                cursor = conn.execute("""
                    SELECT COUNT(*) as count 
                    FROM memory_journal 
                    WHERE deleted_at IS NULL
                """)
                return cursor.fetchone()['count']
        except sqlite3.Error as e:
            print(f"[ERROR] Failed to get entry count: {e}", file=sys.stderr)
            return 0


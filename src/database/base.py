"""
Memory Journal MCP Server - Database Base Module
Core database initialization, connection management, and migrations.
"""

import sqlite3
import os
import sys
from typing import Optional, List

from constants import (
    MAX_CONTENT_LENGTH, MAX_TAG_LENGTH, MAX_ENTRY_TYPE_LENGTH,
    MAX_SIGNIFICANCE_TYPE_LENGTH, DB_PRAGMA_SETTINGS, DB_VACUUM_SIZE_THRESHOLD
)
from exceptions import (
    DatabaseError, DatabaseConnectionError, DatabaseIntegrityError,
    DatabaseMigrationError, ValidationError, ContentTooLongError,
    TagTooLongError, InvalidCharactersError
)


class MemoryJournalDB:
    """Database operations for the Memory Journal system."""

    # Security constants (class-level for backward compatibility)
    MAX_CONTENT_LENGTH = MAX_CONTENT_LENGTH
    MAX_TAG_LENGTH = MAX_TAG_LENGTH
    MAX_ENTRY_TYPE_LENGTH = MAX_ENTRY_TYPE_LENGTH
    MAX_SIGNIFICANCE_TYPE_LENGTH = MAX_SIGNIFICANCE_TYPE_LENGTH

    def __init__(self, db_path: str):
        """
        Initialize the database connection and schema.
        
        Args:
            db_path: Path to the SQLite database file
        """
        self.db_path = db_path
        self._validate_db_path()
        self.init_database()

    def _validate_db_path(self):
        """Validate database path for security."""
        # Ensure the database path is within allowed directories
        abs_db_path = os.path.abspath(self.db_path)

        # Get the directory containing the database
        db_dir = os.path.dirname(abs_db_path)

        # Ensure directory exists and create if it doesn't
        if not os.path.exists(db_dir):
            try:
                os.makedirs(db_dir, mode=0o700)  # Restrictive permissions
            except OSError as e:
                raise DatabaseConnectionError(f"Failed to create database directory: {e}")

        # Set restrictive permissions on database file if it exists
        if os.path.exists(abs_db_path):
            try:
                os.chmod(abs_db_path, 0o600)  # Read/write for owner only
            except OSError as e:
                print(f"Warning: Could not set database permissions: {e}", file=sys.stderr)

    def init_database(self):
        """Initialize database with schema and optimal settings."""
        schema_path = os.path.join(os.path.dirname(__file__), "..", "..", "schema.sql")

        try:
            with sqlite3.connect(self.db_path) as conn:
                # Apply all PRAGMA settings
                for pragma, value in DB_PRAGMA_SETTINGS.items():
                    conn.execute(f"PRAGMA {pragma} = {value}")

                # Run migrations BEFORE applying schema (for existing databases)
                self._run_migrations(conn)

                if os.path.exists(schema_path):
                    with open(schema_path, 'r') as f:
                        conn.executescript(f.read())

                # Note: PRAGMA optimize and ANALYZE are expensive and only run during maintenance
                # They don't need to run on every startup
        except sqlite3.Error as e:
            raise DatabaseConnectionError(f"Failed to initialize database: {e}")

    def _run_migrations(self, conn: sqlite3.Connection) -> None:
        """Run database migrations for schema updates."""
        try:
            # Check if memory_journal table exists first
            cursor = conn.execute("""
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name='memory_journal'
            """)
            if not cursor.fetchone():
                # Table doesn't exist yet, skip migrations (schema will create it)
                return
            
            # Check if deleted_at column exists
            cursor = conn.execute("PRAGMA table_info(memory_journal)")
            columns = {row[1] for row in cursor.fetchall()}
            
            if 'deleted_at' not in columns:
                print("Running migration: Adding deleted_at column to memory_journal table", file=sys.stderr)
                conn.execute("ALTER TABLE memory_journal ADD COLUMN deleted_at TEXT")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_memory_journal_deleted ON memory_journal(deleted_at)")
                conn.commit()
                print("Migration completed: deleted_at column added", file=sys.stderr)
            
            # Check if relationships table exists
            cursor = conn.execute("""
                SELECT name FROM sqlite_master 
                WHERE type='table' AND name='relationships'
            """)
            if not cursor.fetchone():
                print("Running migration: Creating relationships table", file=sys.stderr)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS relationships (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        from_entry_id INTEGER NOT NULL,
                        to_entry_id INTEGER NOT NULL,
                        relationship_type TEXT NOT NULL DEFAULT 'references',
                        description TEXT,
                        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (from_entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE,
                        FOREIGN KEY (to_entry_id) REFERENCES memory_journal(id) ON DELETE CASCADE
                    )
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_entry_id)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships(to_entry_id)")
                conn.commit()
                print("Migration completed: relationships table created", file=sys.stderr)
            
            # Migration: Add GitHub Projects columns (Phase 1 - Issue #15)
            cursor = conn.execute("PRAGMA table_info(memory_journal)")
            columns = {row[1] for row in cursor.fetchall()}
            
            if 'project_number' not in columns:
                print("Running migration: Adding GitHub Projects columns to memory_journal table", file=sys.stderr)
                conn.execute("ALTER TABLE memory_journal ADD COLUMN project_number INTEGER")
                conn.execute("ALTER TABLE memory_journal ADD COLUMN project_item_id INTEGER")
                conn.execute("ALTER TABLE memory_journal ADD COLUMN github_project_url TEXT")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_memory_journal_project_number ON memory_journal(project_number)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_memory_journal_project_item_id ON memory_journal(project_item_id)")
                conn.commit()
                print("Migration completed: GitHub Projects columns added", file=sys.stderr)
            
            # Migration: Add GitHub Issues columns
            cursor = conn.execute("PRAGMA table_info(memory_journal)")
            columns = {row[1] for row in cursor.fetchall()}
            
            if 'issue_number' not in columns:
                print("Running migration: Adding GitHub Issues columns to memory_journal table", file=sys.stderr)
                conn.execute("ALTER TABLE memory_journal ADD COLUMN issue_number INTEGER")
                conn.execute("ALTER TABLE memory_journal ADD COLUMN issue_url TEXT")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_memory_journal_issue_number ON memory_journal(issue_number)")
                conn.commit()
                print("Migration completed: GitHub Issues columns added", file=sys.stderr)
            
            # Migration: Add GitHub Pull Requests columns
            cursor = conn.execute("PRAGMA table_info(memory_journal)")
            columns = {row[1] for row in cursor.fetchall()}
            
            if 'pr_number' not in columns:
                print("Running migration: Adding GitHub Pull Requests columns to memory_journal table", file=sys.stderr)
                conn.execute("ALTER TABLE memory_journal ADD COLUMN pr_number INTEGER")
                conn.execute("ALTER TABLE memory_journal ADD COLUMN pr_url TEXT")
                conn.execute("ALTER TABLE memory_journal ADD COLUMN pr_status TEXT")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_memory_journal_pr_number ON memory_journal(pr_number)")
                conn.commit()
                print("Migration completed: GitHub Pull Requests columns added", file=sys.stderr)
            
            # Migration: Add share_with_team column (v2.0.0 - Team Collaboration)
            cursor = conn.execute("PRAGMA table_info(memory_journal)")
            columns = {row[1] for row in cursor.fetchall()}
            
            if 'share_with_team' not in columns:
                print("Running migration: Adding share_with_team column to memory_journal table", file=sys.stderr)
                conn.execute("ALTER TABLE memory_journal ADD COLUMN share_with_team INTEGER NOT NULL DEFAULT 0")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_memory_journal_share_with_team ON memory_journal(share_with_team)")
                conn.commit()
                print("Migration completed: share_with_team column added", file=sys.stderr)
            
            # Migration: Add GitHub Actions columns (v2.1.0 - GitHub Actions Integration)
            cursor = conn.execute("PRAGMA table_info(memory_journal)")
            columns = {row[1] for row in cursor.fetchall()}
            
            if 'workflow_run_id' not in columns:
                print("Running migration: Adding GitHub Actions columns to memory_journal table", file=sys.stderr)
                conn.execute("ALTER TABLE memory_journal ADD COLUMN workflow_run_id INTEGER")
                conn.execute("ALTER TABLE memory_journal ADD COLUMN workflow_name TEXT")
                conn.execute("ALTER TABLE memory_journal ADD COLUMN workflow_status TEXT")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_memory_journal_workflow_run_id ON memory_journal(workflow_run_id)")
                conn.commit()
                print("Migration completed: GitHub Actions columns added", file=sys.stderr)
        except sqlite3.Error as e:
            raise DatabaseMigrationError(f"Migration failed: {e}")

    def maintenance(self):
        """Perform database maintenance operations."""
        try:
            with self.get_connection() as conn:
                # Update query planner statistics
                conn.execute("ANALYZE")

                # Optimize database
                conn.execute("PRAGMA optimize")

                # Clean up unused space (VACUUM is expensive but thorough)
                # Only run if database is not too large
                db_size = os.path.getsize(self.db_path) if os.path.exists(self.db_path) else 0
                if db_size < DB_VACUUM_SIZE_THRESHOLD:
                    conn.execute("VACUUM")

                # Verify database integrity
                integrity_check = conn.execute("PRAGMA integrity_check").fetchone()
                if integrity_check[0] != "ok":
                    print(f"WARNING: Database integrity issue: {integrity_check[0]}", file=sys.stderr)
                    raise DatabaseIntegrityError(f"Database integrity check failed: {integrity_check[0]}")

                print("Database maintenance completed successfully", file=sys.stderr)
        except sqlite3.Error as e:
            raise DatabaseError(f"Maintenance operation failed: {e}")

    def get_connection(self):
        """Get database connection with proper settings."""
        try:
            conn = sqlite3.connect(self.db_path)

            # Apply consistent PRAGMA settings for all connections
            for pragma, value in DB_PRAGMA_SETTINGS.items():
                conn.execute(f"PRAGMA {pragma} = {value}")

            conn.row_factory = sqlite3.Row
            return conn
        except sqlite3.Error as e:
            raise DatabaseConnectionError(f"Failed to establish database connection: {e}")

    def validate_input(self, content: str, entry_type: str, tags: list[str], significance_type: Optional[str] = None) -> None:
        """
        Validate input parameters for security.
        
        Args:
            content: Entry content to validate
            entry_type: Entry type to validate
            tags: List of tags to validate
            significance_type: Optional significance type to validate
            
        Raises:
            ValidationError: If validation fails
        """
        # Validate content length
        if len(content) > self.MAX_CONTENT_LENGTH:
            raise ContentTooLongError(len(content), self.MAX_CONTENT_LENGTH)

        # Validate entry type
        if len(entry_type) > self.MAX_ENTRY_TYPE_LENGTH:
            raise ValidationError(f"Entry type exceeds maximum length of {self.MAX_ENTRY_TYPE_LENGTH} characters")

        # Validate tags
        for tag in tags:
            if len(tag) > self.MAX_TAG_LENGTH:
                raise TagTooLongError(tag, self.MAX_TAG_LENGTH)
            # Check for potentially dangerous characters
            if any(char in tag for char in ['<', '>', '"', "'", '&', '\x00']):
                raise InvalidCharactersError(tag, "Contains invalid characters: < > \" ' & or null byte")

        # Validate significance type if provided
        if significance_type and len(significance_type) > self.MAX_SIGNIFICANCE_TYPE_LENGTH:
            raise ValidationError(f"Significance type exceeds maximum length of {self.MAX_SIGNIFICANCE_TYPE_LENGTH} characters")

        # Note: We rely on parameterized queries for SQL injection prevention
        # No need for content warnings since we never execute user content as SQL
    
    def auto_create_tags(self, tag_names: List[str]) -> List[int]:
        """
        Auto-create tags if they don't exist, return tag IDs. Thread-safe with INSERT OR IGNORE.
        
        Args:
            tag_names: List of tag names to create/retrieve
            
        Returns:
            List of tag IDs corresponding to the tag names
        """
        tag_ids: list[int] = []

        with self.get_connection() as conn:
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
                    tag_ids.append(row['id'])

        return tag_ids


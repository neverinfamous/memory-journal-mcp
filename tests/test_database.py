"""
Test suite for Memory Journal MCP Server database operations.
"""

import sqlite3
import tempfile
import os
import json
from pathlib import Path

import pytest

# Import our database class
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from server import MemoryJournalDB


class TestMemoryJournalDB:
    """Test the MemoryJournalDB class."""
    
    def setup_method(self):
        """Set up test database for each test."""
        self.temp_db = tempfile.NamedTemporaryFile(delete=False, suffix='.db')
        self.temp_db.close()
        self.db = MemoryJournalDB(self.temp_db.name)
    
    def teardown_method(self):
        """Clean up after each test."""
        os.unlink(self.temp_db.name)
    
    def test_database_initialization(self):
        """Test that database initializes with proper schema."""
        with self.db.get_connection() as conn:
            # Check that main tables exist
            cursor = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
            tables = [row[0] for row in cursor.fetchall()]
            
            expected_tables = [
                'memory_journal',
                'tags', 
                'entry_tags',
                'memory_journal_relationships',
                'significant_entries',
                'relationship_types',
                'memory_journal_fts'
            ]
            
            for table in expected_tables:
                assert table in tables, f"Table {table} not found"
    
    def test_auto_create_tags(self):
        """Test automatic tag creation."""
        tag_names = ['consciousness', 'development', 'test']
        tag_ids = self.db.auto_create_tags(tag_names)
        
        assert len(tag_ids) == 3
        
        # Verify tags were created
        with self.db.get_connection() as conn:
            cursor = conn.execute("SELECT name FROM tags WHERE id IN (?, ?, ?)", tag_ids)
            created_tags = [row[0] for row in cursor.fetchall()]
            
            for tag_name in tag_names:
                assert tag_name in created_tags
    
    def test_auto_create_tags_existing(self):
        """Test that existing tags are reused."""
        # Create tags first time
        tag_ids_1 = self.db.auto_create_tags(['consciousness', 'test'])
        
        # Create same tags again
        tag_ids_2 = self.db.auto_create_tags(['consciousness', 'test', 'new'])
        
        # First two should be same IDs, third should be new
        assert tag_ids_1[0] == tag_ids_2[0]  # consciousness
        assert tag_ids_1[1] == tag_ids_2[1]  # test
        assert len(tag_ids_2) == 3  # new tag added
    
    def test_get_project_context(self):
        """Test project context gathering."""
        context = self.db.get_project_context()
        
        # Should always have these fields
        assert 'cwd' in context
        assert 'timestamp' in context
        
        # May or may not have git fields depending on test environment
        # Just verify it doesn't crash
        assert isinstance(context, dict)
    
    def test_foreign_keys_enabled(self):
        """Test that foreign key constraints are enabled."""
        with self.db.get_connection() as conn:
            cursor = conn.execute("PRAGMA foreign_keys")
            result = cursor.fetchone()
            assert result[0] == 1, "Foreign keys should be enabled"


if __name__ == "__main__":
    pytest.main([__file__])
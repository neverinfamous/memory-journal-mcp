#!/usr/bin/env python3
"""
Fix FTS table configuration
"""

import sqlite3
import os

def fix_fts_table():
    db_path = 'C:\\Users\\chris\\Desktop\\memory-journal-mcp\\memory_journal.db'
    
    if not os.path.exists(db_path):
        print(f"❌ Database not found at: {db_path}")
        return
    
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    
    print("🔧 Fixing FTS table configuration...")
    
    try:
        # Drop existing FTS table
        print("Dropping old FTS table...")
        conn.execute("DROP TABLE IF EXISTS memory_journal_fts")
        
        # Recreate with correct configuration
        print("Creating new FTS table...")
        conn.execute("""
            CREATE VIRTUAL TABLE memory_journal_fts USING fts5(
                content,
                entry_type,
                related_patterns,
                content='memory_journal',
                content_rowid='id'
            )
        """)
        
        # Populate FTS table with existing data
        print("Populating FTS table with existing entries...")
        conn.execute("""
            INSERT INTO memory_journal_fts(rowid, content, entry_type, related_patterns)
            SELECT id, content, entry_type, related_patterns 
            FROM memory_journal
        """)
        
        conn.commit()
        
        # Test the FTS table
        count = conn.execute("SELECT COUNT(*) FROM memory_journal_fts").fetchone()[0]
        print(f"✅ FTS table recreated with {count} entries")
        
        # Test a simple search
        result = conn.execute("""
            SELECT rowid FROM memory_journal_fts 
            WHERE memory_journal_fts MATCH 'testing' 
            LIMIT 1
        """).fetchall()
        print(f"✅ FTS search test passed, found {len(result)} results")
        
    except Exception as e:
        print(f"❌ Error fixing FTS table: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    fix_fts_table()

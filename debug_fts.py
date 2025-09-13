#!/usr/bin/env python3
import sqlite3
import sys
import os

# Add the src directory to path to import our modules
sys.path.insert(0, '/host/Users/chris/Desktop/memory-journal-mcp/src')

def check_fts_setup():
    db_path = 'C:\\Users\\chris\\Desktop\\memory-journal-mcp\\memory_journal.db'
    
    if not os.path.exists(db_path):
        print(f"❌ Database not found at: {db_path}")
        return
    
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    
    print("🔍 Checking FTS setup...")
    
    # Check if FTS table exists
    tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    table_names = [t[0] for t in tables]
    print(f"Tables: {table_names}")
    
    if 'memory_journal_fts' in table_names:
        print("✅ FTS table exists")
        
        # Check FTS table structure
        fts_info = conn.execute("PRAGMA table_info(memory_journal_fts)").fetchall()
        print("FTS columns:", [col[1] for col in fts_info])
        
        # Check if FTS has data
        count = conn.execute("SELECT COUNT(*) FROM memory_journal_fts").fetchone()[0]
        print(f"FTS entries: {count}")
        
        # Test simple FTS query
        try:
            result = conn.execute("SELECT * FROM memory_journal_fts WHERE memory_journal_fts MATCH 'testing' LIMIT 1").fetchall()
            print(f"✅ Simple FTS query works, found {len(result)} results")
        except Exception as e:
            print(f"❌ FTS query failed: {e}")
            
        # Test problematic query
        try:
            result = conn.execute("SELECT * FROM memory_journal_fts WHERE memory_journal_fts MATCH 'git-fix' LIMIT 1").fetchall()
            print(f"✅ Hyphenated query works, found {len(result)} results")
        except Exception as e:
            print(f"❌ Hyphenated query failed: {e}")
    else:
        print("❌ FTS table missing")
        
        # Check main table
        main_count = conn.execute("SELECT COUNT(*) FROM memory_journal").fetchone()[0]
        print(f"Main table entries: {main_count}")
    
    conn.close()

if __name__ == "__main__":
    check_fts_setup()
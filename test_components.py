#!/usr/bin/env python3
"""
Test script to isolate the hanging issue in the MCP server.
"""

import sys
import os
sys.path.insert(0, 'src')

from server import MemoryJournalDB
import tempfile
import json

def test_database_components():
    """Test each component individually to find the hang."""
    
    # Test with a temporary database
    temp_db = tempfile.NamedTemporaryFile(delete=False, suffix='.db')
    temp_db.close()
    
    try:
        print('1. Testing database initialization...')
        db = MemoryJournalDB(temp_db.name)
        print('   ✓ Database initialized')
        
        print('2. Testing context capture...')
        context = db.get_project_context()
        print(f'   ✓ Context captured: {len(context)} fields')
        print(f'   - cwd: {context.get("cwd", "N/A")[:50]}...')
        print(f'   - repo_name: {context.get("repo_name", "N/A")}')
        print(f'   - branch: {context.get("branch", "N/A")}')
        
        print('3. Testing tag creation...')
        tag_ids = db.auto_create_tags(['test', 'verification', 'debug'])
        print(f'   ✓ Created tags: {tag_ids}')
        
        print('4. Testing database connection...')
        with db.get_connection() as conn:
            cursor = conn.execute('SELECT COUNT(*) FROM memory_journal')
            count = cursor.fetchone()[0]
            print(f'   ✓ Database query successful: {count} entries')
            
            # Test inserting an entry
            print('5. Testing entry insertion...')
            cursor = conn.execute("""
                INSERT INTO memory_journal (
                    entry_type, content, is_personal, project_context, related_patterns
                ) VALUES (?, ?, ?, ?, ?)
            """, ('test_entry', 'Test content for debugging', 1, json.dumps(context), 'test,debug'))
            
            entry_id = cursor.lastrowid
            print(f'   ✓ Entry created with ID: {entry_id}')
            
            # Test tag linking
            print('6. Testing tag linking...')
            for tag_id in tag_ids:
                conn.execute(
                    "INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)",
                    (entry_id, tag_id)
                )
            print(f'   ✓ Linked {len(tag_ids)} tags to entry')
            
            # Test retrieval
            print('7. Testing entry retrieval...')
            cursor = conn.execute(
                "SELECT id, entry_type, content FROM memory_journal WHERE id = ?",
                (entry_id,)
            )
            retrieved = cursor.fetchone()
            print(f'   ✓ Retrieved entry: {retrieved[1]} - {retrieved[2][:30]}...')
        
        print('\n✅ All component tests passed!')
        return True
        
    except Exception as e:
        print(f'\n❌ Test failed: {e}')
        import traceback
        traceback.print_exc()
        return False
        
    finally:
        if os.path.exists(temp_db.name):
            os.unlink(temp_db.name)

if __name__ == "__main__":
    print("Testing Memory Journal MCP Server Components")
    print("=" * 50)
    success = test_database_components()
    print("=" * 50)
    print("✅ SUCCESS" if success else "❌ FAILED")

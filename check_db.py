import sqlite3

conn = sqlite3.connect('memory_journal.db')

print("=== ENTRIES ===")
cursor = conn.execute('SELECT id, entry_type, content, timestamp, is_personal FROM memory_journal ORDER BY timestamp DESC LIMIT 3')
for row in cursor.fetchall():
    print(f'Entry {row[0]}: {row[1]} - Personal: {bool(row[4])}')
    print(f'  Content: {row[2][:150]}...')
    print(f'  Time: {row[3]}')
    print()

print("=== TAGS ===")
cursor = conn.execute('SELECT name, usage_count FROM tags ORDER BY usage_count DESC LIMIT 10')
for row in cursor.fetchall():
    print(f'Tag: {row[0]} (used {row[1]} times)')

print("\n=== ENTRY-TAG RELATIONSHIPS ===")
cursor = conn.execute('''
    SELECT m.id, m.entry_type, t.name 
    FROM memory_journal m 
    JOIN entry_tags et ON m.id = et.entry_id 
    JOIN tags t ON et.tag_id = t.id 
    ORDER BY m.id
''')
for row in cursor.fetchall():
    print(f'Entry {row[0]} ({row[1]}) has tag: {row[2]}')

conn.close()

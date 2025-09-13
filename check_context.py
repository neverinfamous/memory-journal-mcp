import sqlite3
import json

conn = sqlite3.connect('memory_journal.db')

print("=== PROJECT CONTEXT ===")
cursor = conn.execute('SELECT id, project_context FROM memory_journal WHERE project_context IS NOT NULL')
for row in cursor.fetchall():
    print(f'Entry {row[0]} context:')
    if row[1]:
        try:
            context = json.loads(row[1])
            print(f'  - Repository: {context.get("repo_name", "N/A")}')
            print(f'  - Branch: {context.get("branch", "N/A")}')
            print(f'  - Working Dir: {context.get("cwd", "N/A")[:50]}...')
            print(f'  - Timestamp: {context.get("timestamp", "N/A")}')
        except:
            print(f'  - Raw context: {row[1][:100]}...')
    print()

conn.close()

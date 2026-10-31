import Database from 'better-sqlite3';
const db = new Database('C:\\Users\\chris\\Desktop\\memory-journal-mcp\\data\\mj-production.db');
const entries = db.prepare('SELECT id, session_id, entry_type, content, project_number, workspace_id, is_archived FROM memory_journal WHERE session_id IS NULL OR session_id = ""').all();
console.log(JSON.stringify(entries, null, 2));

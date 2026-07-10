import Database from 'better-sqlite3';
const db = new Database('C:/Users/chris/Desktop/memory-journal-mcp/data/mj-production.db');
db.pragma("key = 'adamic123'");
db.pragma("cipher = 'sqlcipher'");
const row = db.prepare('SELECT id, deleted_at, is_archived, content FROM memory_journal WHERE id = 3074').get();
console.log(JSON.stringify(row));

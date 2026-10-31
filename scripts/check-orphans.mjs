import Database from 'better-sqlite3';
import { resolve } from 'node:path';

function checkOrphans() {
    const defaultDbPath = resolve(process.cwd(), 'data/memory_journal.db');
    const dbPath = process.argv[2] || defaultDbPath;

    try {
        console.log(`Checking for orphaned entries in: ${dbPath}`);
        const db = new Database(dbPath, { readonly: true });
        
        const rows = db.prepare(`
            SELECT 
                id, 
                entry_type, 
                substr(content, 1, 50) as content_preview, 
                timestamp, 
                is_personal 
            FROM memory_journal 
            WHERE project_number IS NULL
        `).all();
        
        if (rows.length === 0) {
            console.log('\n✅ No orphaned entries found (project_number is strictly enforced).');
        } else {
            console.log(`\n⚠️ Found ${rows.length} orphaned entries without a project_number:`);
            console.log(JSON.stringify(rows, null, 2));
            console.log('\nRecommendation: Update these entries using the `update_entry` tool with a valid project_number, or use `batch_update_entries` for bulk assignment.');
        }
        
        db.close();
    } catch (e) {
        console.error(`\n❌ Error accessing database: ${e.message}`);
        console.log('Usage: node scripts/check-orphans.mjs [path/to/database.db]');
        process.exit(1);
    }
}

checkOrphans();

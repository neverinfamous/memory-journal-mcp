import { DatabaseAdapter } from './src/database/sqlite-adapter/index.js'

async function run() {
    const db = new DatabaseAdapter(':memory:')
    await db.initialize()
    
    db.createEntry({
        content: 'Improved error handling without breaking the API',
        entryType: 'bug_fix',
        tags: ['fts5-phrase-test'],
    })

    const result = db.searchEntries('error handling')
    console.log('Result count:', result.entries.length)
}

run().catch(console.error)

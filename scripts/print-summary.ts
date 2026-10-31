import { DatabaseAdapter } from '../src/database/sqlite-adapter/index.js'
import { getPrompt } from '../src/handlers/prompts/index.js'
import { GitHistoryClient } from '../src/git/git-client.js'
import * as fs from 'fs'

async function main() {
    const dbPath = './.mcp-journal.db'
    // Open the actual database
    const db = new DatabaseAdapter(dbPath)
    await db.initialize()
    
    try {
        const gitClient = new GitHistoryClient()
        const result = await getPrompt('session-summary', {}, db, undefined, undefined, gitClient)
        console.log(result.messages[0].content.text)
    } finally {
        db.close()
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
        if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`)
        if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`)
    }
}

main().catch(console.error)

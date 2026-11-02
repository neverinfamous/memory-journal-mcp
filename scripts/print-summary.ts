import { DatabaseAdapter } from '../src/database/sqlite-adapter/index.js'
import { getPrompt } from '../src/handlers/prompts/index.js'
import * as fs from 'node:fs'

async function main(): Promise<void> {
    const dbPath = './.mcp-journal.db'
    // Open the actual database
    const db = new DatabaseAdapter(dbPath)
    await db.initialize()

    try {
        const result = await getPrompt('session-summary', {}, db)
        console.log(result.messages[0]?.content.text ?? '')
    } finally {
        db.close()
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
        if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`)
        if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`)
    }
}

main().catch(console.error)

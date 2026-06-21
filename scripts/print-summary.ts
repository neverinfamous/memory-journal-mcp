import { DatabaseAdapter } from '../src/database/sqlite-adapter/index.js'
import { getPrompt } from '../src/handlers/prompts/index.js'

async function main() {
    // Open the actual database
    const db = new DatabaseAdapter('./.mcp-journal.db')
    await db.initialize()
    
    const result = await getPrompt('session-summary', {}, db)
    console.log(result.messages[0].content.text)
}

main().catch(console.error)

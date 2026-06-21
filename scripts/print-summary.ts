import { DatabaseAdapter } from '../src/database/sqlite-adapter/index.js'
import { getPrompt } from '../src/handlers/prompts/index.js'
import { GitHistoryClient } from '../src/git/git-client.js'

async function main() {
    // Open the actual database
    const db = new DatabaseAdapter('./.mcp-journal.db')
    await db.initialize()
    
    const gitClient = new GitHistoryClient()
    const result = await getPrompt('session-summary', {}, db, undefined, undefined, gitClient)
    console.log(result.messages[0].content.text)
}

main().catch(console.error)

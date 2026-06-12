import { test, expect } from 'vitest'
import { getCodeModeTools } from '../../src/handlers/tools/codemode/handler.js'
import { getBackupTools } from '../../src/handlers/tools/backup.js'
import { DatabaseAdapter } from '../../src/database/sqlite-adapter/database-adapter.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import * as path from 'path'

test('mj_execute_code with restore_backup', async () => {
    const db = new DatabaseAdapter(path.resolve('./test-db/journal-test-codemode.db'))
    await db.initialize()
    const runtime = new ServerRuntime()
    const config = { runtime, codemodeEnabled: true }
    const context = { db, config }
    
    // Inject dependencies into collectNonCodeModeTools via context
    // Actually getCodeModeTools will just execute what's provided
    const tools = getCodeModeTools(context)
    const execTool = tools.find(t => t.name === 'mj_execute_code')!
    
    const code = `
        const named = await mj.backup.backupJournal({ name: 'test-backup-vitest' })
        const restored = await mj.backup.restoreBackup({ filename: named.filename, confirm: true })
        return { named, restored }
    `
    
    const { callTool } = await import('../../src/handlers/tools/index.js')
    
    const result = await callTool('mj_execute_code', { code, timeout_ms: 5000, context: {} }, db, undefined, undefined, config, undefined)
    console.log(JSON.stringify(result, null, 2))
    expect((result as any).success).toBe(true)
})

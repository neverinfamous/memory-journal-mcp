import fs from 'node:fs'
import path from 'node:path'

export async function teardown() {
    try {
        const backupsDir = path.resolve(process.cwd(), 'backups')
        if (fs.existsSync(backupsDir)) {
            // Only delete if it's the root backups dir (safety check)
            if (backupsDir.endsWith('backups')) {
                fs.rmSync(backupsDir, { recursive: true, force: true })
            }
        }

        const edgeCasesDir = path.resolve(process.cwd(), 'test-backup-edge-cases')
        if (fs.existsSync(edgeCasesDir)) {
            if (edgeCasesDir.endsWith('test-backup-edge-cases')) {
                fs.rmSync(edgeCasesDir, { recursive: true, force: true })
            }
        }

        // Clean up root test databases that tests failed to clean up (e.g., due to missing db.close())
        const files = fs.readdirSync(process.cwd())
        for (const file of files) {
            const isTestDb = file.includes('test') || file.includes('uninit') || file.startsWith('memory_journal.db')
            if (isTestDb && (file.endsWith('.db') || file.endsWith('.db-wal') || file.endsWith('.db-shm'))) {
                try {
                    fs.unlinkSync(path.resolve(process.cwd(), file))
                } catch {
                    // Ignore locked files
                }
            }
        }
    } catch {
        // Silently ignore cleanup errors
    }
}

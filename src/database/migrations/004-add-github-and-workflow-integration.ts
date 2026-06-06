import type { Database } from 'better-sqlite3'
import { type Migration, addColumnIfNotExists } from './migration.js'

export const Migration004AddGithubAndWorkflowIntegration: Migration = {
    version: 4,
    name: '004-add-github-and-workflow-integration',
    up(db: Database): void {
        addColumnIfNotExists(db, 'memory_journal', 'project_number INTEGER', 'project_number')
        addColumnIfNotExists(db, 'memory_journal', 'project_owner TEXT', 'project_owner')
        addColumnIfNotExists(db, 'memory_journal', 'issue_number INTEGER', 'issue_number')
        addColumnIfNotExists(db, 'memory_journal', 'issue_url TEXT', 'issue_url')
        addColumnIfNotExists(db, 'memory_journal', 'pr_number INTEGER', 'pr_number')
        addColumnIfNotExists(db, 'memory_journal', 'pr_url TEXT', 'pr_url')
        addColumnIfNotExists(db, 'memory_journal', 'pr_status TEXT', 'pr_status')
        addColumnIfNotExists(db, 'memory_journal', 'workflow_run_id INTEGER', 'workflow_run_id')
        addColumnIfNotExists(db, 'memory_journal', 'workflow_name TEXT', 'workflow_name')
        addColumnIfNotExists(db, 'memory_journal', 'workflow_status TEXT', 'workflow_status')

        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_memory_journal_project ON memory_journal(project_number);
            CREATE INDEX IF NOT EXISTS idx_memory_journal_issue ON memory_journal(issue_number);
            CREATE INDEX IF NOT EXISTS idx_memory_journal_pr ON memory_journal(pr_number);
        `)
    },
}

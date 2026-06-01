import type { Database } from 'better-sqlite3'
import type { Migration } from './migration.js'

export const Migration004AddGithubAndWorkflowIntegration: Migration = {
    version: 4,
    name: '004-add-github-and-workflow-integration',
    up(db: Database): void {
        db.exec(`
            ALTER TABLE memory_journal ADD COLUMN project_number INTEGER;
            ALTER TABLE memory_journal ADD COLUMN project_owner TEXT;
            ALTER TABLE memory_journal ADD COLUMN issue_number INTEGER;
            ALTER TABLE memory_journal ADD COLUMN issue_url TEXT;
            ALTER TABLE memory_journal ADD COLUMN pr_number INTEGER;
            ALTER TABLE memory_journal ADD COLUMN pr_url TEXT;
            ALTER TABLE memory_journal ADD COLUMN pr_status TEXT;
            ALTER TABLE memory_journal ADD COLUMN workflow_run_id INTEGER;
            ALTER TABLE memory_journal ADD COLUMN workflow_name TEXT;
            ALTER TABLE memory_journal ADD COLUMN workflow_status TEXT;

            CREATE INDEX IF NOT EXISTS idx_memory_journal_project ON memory_journal(project_number);
            CREATE INDEX IF NOT EXISTS idx_memory_journal_issue ON memory_journal(issue_number);
            CREATE INDEX IF NOT EXISTS idx_memory_journal_pr ON memory_journal(pr_number);
        `)
    },
}

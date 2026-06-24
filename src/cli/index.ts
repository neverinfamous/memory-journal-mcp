#!/usr/bin/env node
import { createProgram, addServerOptions } from './program-options.js'
import { serveAction } from './commands/serve.js'
import { execAction } from './commands/exec.js'
import { backupAction, restoreAction, vacuumAction, pruneAction } from './commands/admin.js'
import { createEntryAction, updateEntryAction } from './commands/entry.js'
const program = createProgram()

// Setup default 'serve' command
const serveCmd = program
    .command('serve', { isDefault: true })
    .description('Start the Memory Journal MCP Server')

addServerOptions(serveCmd)
serveCmd.action(serveAction)

// Setup 'exec' command
const execCmd = program
    .command('exec <file>')
    .description('Execute a Code Mode script locally without starting a server')
addServerOptions(execCmd)
execCmd.action(execAction)

// Setup 'admin' command group
const adminCmd = program
    .command('admin')
    .description('Database administration utilities')

const backupCmd = adminCmd
    .command('backup')
    .description('Export the database to a timestamped backup file')
    .option('--dest <path>', 'Destination path or filename for the backup')
addServerOptions(backupCmd)
backupCmd.action(backupAction)

const restoreCmd = adminCmd
    .command('restore <file>')
    .description('Restore the database from a backup file')
addServerOptions(restoreCmd)
restoreCmd.action(restoreAction)

const vacuumCmd = adminCmd
    .command('vacuum')
    .description('Optimize database query planner and flush WAL')
addServerOptions(vacuumCmd)
vacuumCmd.action(vacuumAction)

const pruneCmd = adminCmd
    .command('prune')
    .description('Run autonomous database pruning')
    .option('--dry-run', 'Log candidates without modifying the database')
    .option('--exclude-tags <tags>', 'Comma-separated tags to exclude')
addServerOptions(pruneCmd)
pruneCmd.action(pruneAction)

// Setup 'entry' command group
const entryCmd = program
    .command('entry')
    .description('Manage journal entries')

const createEntryCmd = entryCmd
    .command('create')
    .description('Create a new journal entry directly in the database')
    .option('-f, --file <path>', 'Load markdown content from a file')
    .option('-c, --content <string>', 'Raw markdown content string')
    .option('-t, --type <type>', 'Entry type (e.g., retrospective, personal_reflection)')
    .option('--tags <tags>', 'Comma-separated tags (e.g., session-summary)')
    .option('--project <number>', 'Project number')
    .option('--trust-score <number>', 'Trust score (0.0 to 1.0)')
    .option('--impact-score <number>', 'Impact score (0.0 to 1.0)')
    .option('--validation-status <status>', 'Validation status (passed|none|failed)')
    .option('--session-id <id>', 'Session ID')
    .option('--related-to <ids>', 'Comma-separated entry IDs to relate to')
    .option('--relationships <json>', 'JSON string of relationships')
    .option('--auto-context <json>', 'JSON string for auto context')
    .option('--team', 'Route to team database')
addServerOptions(createEntryCmd)
createEntryCmd.action(createEntryAction)

const updateEntryCmd = entryCmd
    .command('update')
    .description('Update an existing journal entry')
    .option('--id <number>', 'ID of the entry to update')
    .option('--expected-version <number>', 'Expected version of the entry (for concurrent modification safety)')
    .option('-f, --file <path>', 'Load new markdown content from a file')
    .option('-c, --content <string>', 'Raw new markdown content string')
    .option('-t, --type <type>', 'Entry type (e.g., retrospective, personal_reflection)')
    .option('--tags <tags>', 'Comma-separated tags (e.g., session-summary)')
    .option('--project <number>', 'Project number')
    .option('--trust-score <number>', 'Trust score (0.0 to 1.0)')
    .option('--impact-score <number>', 'Impact score (0.0 to 1.0)')
    .option('--validation-status <status>', 'Validation status (passed|none|failed)')
    .option('--session-id <id>', 'Session ID')
    .option('--related-to <ids>', 'Comma-separated entry IDs to relate to')
    .option('--relationships <json>', 'JSON string of relationships')
    .option('--auto-context <json>', 'JSON string for auto context')
    .option('--team', 'Route to team database')
addServerOptions(updateEntryCmd)
updateEntryCmd.action(updateEntryAction)

program.parse()

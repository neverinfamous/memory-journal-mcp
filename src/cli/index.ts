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

program.addHelpText(
    'after',
    `
🤖 AI AGENT INSTRUCTIONS:
- This is an agent-native CLI. 
- ALWAYS use valid JSON strings for JSON arguments (e.g. \`--rel '[{"target_id":1,"relation_type":"relates_to"}]'\`).
- If you forget project details, DO NOT hallucinate. Query \`memory://agent-context/{repo}\`.`
)

// Setup 'exec' command
const execCmd = program
    .command('exec <file>')
    .description('Execute a Code Mode script locally without starting a server')
addServerOptions(execCmd)
execCmd.addHelpText(
    'after',
    `
🤖 AI AGENT INSTRUCTIONS:
- ALWAYS provide the path to a valid script file. Scripts execute within the same execution environment as Code Mode tools.
- Do NOT use this command to start the server. Use \`serve\` instead.`
)
execCmd.action(execAction)

// Setup 'admin' command group
const adminCmd = program
    .command('admin')
    .description('Database administration utilities')
adminCmd.addHelpText(
    'after',
    `
🤖 AI AGENT INSTRUCTIONS:
- These are dangerous administrative utilities. ALWAYS verify the target database before executing.`
)

const backupCmd = adminCmd
    .command('backup')
    .description('Export the database to a timestamped backup file')
    .option('--dest <path>', 'Destination path or filename for the backup')
addServerOptions(backupCmd)
backupCmd.addHelpText(
    'after',
    `
🤖 AI AGENT INSTRUCTIONS:
- If \`--dest\` is omitted, a timestamped backup will be created in the backups directory.`
)
backupCmd.action(backupAction)

const restoreCmd = adminCmd
    .command('restore <file>')
    .description('Restore the database from a backup file')
addServerOptions(restoreCmd)
restoreCmd.addHelpText(
    'after',
    `
🤖 AI AGENT INSTRUCTIONS:
- This will overwrite the CURRENT database. ALWAYS take a backup before running restore.`
)
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
pruneCmd.addHelpText(
    'after',
    `
🤖 AI AGENT INSTRUCTIONS:
- ALWAYS run with \`--dry-run\` first to verify what will be pruned.`
)
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
    .option('--title <title>', 'Optional title (will be prepended as an H1 to content if provided, for agent compatibility)')
    .option('-t, --type <type>', 'Entry type (e.g., retrospective, personal_reflection)')
    .option('--tags <tags>', 'Comma-separated tags (e.g., session-summary)')
    .option('--project <number>', 'Project number')
    .option('--trust, --trust-score <number>', 'Trust score (0.0 to 1.0)')
    .option('--impact, --impact-score <number>', 'Impact score (0.0 to 1.0)')
    .option('--validation-status <status>', 'Validation status (passed|none|failed)')
    .option('--session-id <id>', 'Session ID')
    .option('--related-to <ids>', 'Comma-separated entry IDs to relate to')
    .option('--rel, --relationships <json>', 'JSON string of relationships')
    .option('--rel-file <path>', 'Load relationships JSON from a file')
    .option('--auto-context <json>', 'JSON string for auto context')
    .option('--auto-context-file <path>', 'Load auto context JSON from a file')
    .option('--team', 'Route to team database')
addServerOptions(createEntryCmd)
createEntryCmd.addHelpText(
    'after',
    `
🤖 AI AGENT INSTRUCTIONS:
- MULTI-LINE CONTENT: ALWAYS write long content to a scratch file and use \`-f <path>\` instead of \`-c\` to prevent shell quoting failures.
- ALIASES: You may use shortened aliases (\`--impact\`, \`--trust\`, \`--rel\`) to prevent truncation errors.`
)
createEntryCmd.action(createEntryAction)

const updateEntryCmd = entryCmd
    .command('update')
    .description('Update an existing journal entry')
    .option('--id <number>', 'ID of the entry to update')
    .option('--expected-version <number>', 'Expected version of the entry (for concurrent modification safety)')
    .option('-f, --file <path>', 'Load new markdown content from a file')
    .option('-c, --content <string>', 'Raw new markdown content string')
    .option('--title <title>', 'Optional title (will be prepended as an H1 to content if provided, for agent compatibility)')
    .option('-t, --type <type>', 'Entry type (e.g., retrospective, personal_reflection)')
    .option('--tags <tags>', 'Comma-separated tags (e.g., session-summary)')
    .option('--project <number>', 'Project number')
    .option('--trust, --trust-score <number>', 'Trust score (0.0 to 1.0)')
    .option('--impact, --impact-score <number>', 'Impact score (0.0 to 1.0)')
    .option('--validation-status <status>', 'Validation status (passed|none|failed)')
    .option('--session-id <id>', 'Session ID')
    .option('--related-to <ids>', 'Comma-separated entry IDs to relate to')
    .option('--rel, --relationships <json>', 'JSON string of relationships')
    .option('--rel-file <path>', 'Load relationships JSON from a file')
    .option('--auto-context <json>', 'JSON string for auto context')
    .option('--auto-context-file <path>', 'Load auto context JSON from a file')
    .option('--team', 'Route to team database')
addServerOptions(updateEntryCmd)
updateEntryCmd.addHelpText(
    'after',
    `
🤖 AI AGENT INSTRUCTIONS:
- MULTI-LINE CONTENT: ALWAYS write long content to a scratch file and use \`-f <path>\` instead of \`-c\` to prevent shell quoting failures.
- ALIASES: You may use shortened aliases (\`--impact\`, \`--trust\`, \`--rel\`) to prevent truncation errors.`
)
updateEntryCmd.action(updateEntryAction)

program.parse()

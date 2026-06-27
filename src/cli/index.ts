#!/usr/bin/env node

import type { Command } from 'commander'
import { createProgram, addAgentInstructions, withGroup, withValidation } from './program.js'
import { 
    addServerOptions, addCoreOptions, addDatabaseOptions, 
    addCodeModeOptions, addAuditOptions, addPruningOptions,
    addWorkspaceOptions, addVectorOptions,
    addOutputOptions
} from './option-groups.js'
import { serveAction, serveSchema } from './commands/serve.js'
import { execAction, execSchema } from './commands/exec.js'
import { backupAction, restoreAction, vacuumAction, pruneAction, backupSchema, restoreSchema, vacuumSchema, pruneSchema } from './commands/admin.js'
import { createEntryAction, updateEntryAction, createEntrySchema, updateEntrySchema } from './commands/entry.js'
const program = createProgram()

// Setup default 'serve' command
const serveCmd = program
    .command('serve', { isDefault: true })
    .description('Start the Memory Journal MCP Server')

addServerOptions(serveCmd)
serveCmd.action(withValidation(serveSchema, serveAction))

addAgentInstructions(program,
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

addOutputOptions(execCmd)

addCoreOptions(execCmd)
addDatabaseOptions(execCmd)
addWorkspaceOptions(execCmd)
addVectorOptions(execCmd)
addCodeModeOptions(execCmd)
addAuditOptions(execCmd)
addAgentInstructions(execCmd,
    `
🤖 AI AGENT INSTRUCTIONS:
- ALWAYS provide the path to a valid script file. Scripts execute within the same execution environment as Code Mode tools.
- Do NOT use this command to start the server. Use \`serve\` instead.`
)
execCmd.action(withValidation(execSchema, execAction))

// Setup 'admin' command group
const adminCmd = program
    .command('admin')
    .description('Database administration utilities')
addAgentInstructions(adminCmd,
    `
🤖 AI AGENT INSTRUCTIONS:
- These are dangerous administrative utilities. ALWAYS verify the target database before executing.`
)

const backupCmd = adminCmd
    .command('backup')
    .description('Export the database to a timestamped backup file')

withGroup(backupCmd, 'Command Options', (cmd: Command) => {
    cmd.option('--dest <path>', 'Destination path or filename for the backup')
})
addOutputOptions(backupCmd)

addCoreOptions(backupCmd)
addDatabaseOptions(backupCmd)
addAgentInstructions(backupCmd,
    `
🤖 AI AGENT INSTRUCTIONS:
- If \`--dest\` is omitted, a timestamped backup will be created in the backups directory.`
)
backupCmd.action(withValidation(backupSchema, backupAction))

const restoreCmd = adminCmd
    .command('restore <file>')
    .description('Restore the database from a backup file')

addOutputOptions(restoreCmd)

addCoreOptions(restoreCmd)
addDatabaseOptions(restoreCmd)
addAgentInstructions(restoreCmd,
    `
🤖 AI AGENT INSTRUCTIONS:
- This will overwrite the CURRENT database. ALWAYS take a backup before running restore.`
)
restoreCmd.action(withValidation(restoreSchema, restoreAction))

const vacuumCmd = adminCmd
    .command('vacuum')
    .description('Optimize database query planner and flush WAL')

addOutputOptions(vacuumCmd)

addCoreOptions(vacuumCmd)
addDatabaseOptions(vacuumCmd)
vacuumCmd.action(withValidation(vacuumSchema, vacuumAction))

const pruneCmd = adminCmd
    .command('prune')
    .description('Run autonomous database pruning')

withGroup(pruneCmd, 'Command Options', (cmd: Command) => {
    cmd
        .option('--dry-run', 'Log candidates without modifying the database')
        .option('--exclude-tags <tags>', 'Comma-separated tags to exclude')
})
addOutputOptions(pruneCmd)

addCoreOptions(pruneCmd)
addDatabaseOptions(pruneCmd)
addPruningOptions(pruneCmd)
addAgentInstructions(pruneCmd,
    `
🤖 AI AGENT INSTRUCTIONS:
- ALWAYS run with \`--dry-run\` first to verify what will be pruned.`
)
pruneCmd.action(withValidation(pruneSchema, pruneAction))

// Setup 'entry' command group
const entryCmd = program
    .command('entry')
    .description('Manage journal entries')

const createEntryCmd = entryCmd
    .command('create')
    .description('Create a new journal entry directly in the database')

withGroup(createEntryCmd, 'Command Options', (cmd: Command) => {
    cmd
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
        .option('--metadata <path>', 'Load unified metadata JSON from a file (overrides individual flags)')
        .option('--team', 'Route to team database')
})
addOutputOptions(createEntryCmd)

addCoreOptions(createEntryCmd)
addDatabaseOptions(createEntryCmd)
addAgentInstructions(createEntryCmd,
    `
🤖 AI AGENT INSTRUCTIONS:
- METADATA PAYLOAD: ALWAYS prefer using \`--metadata <path>\` to pass tags, scores, auto_context, and relationships in a single JSON file.
- MULTI-LINE CONTENT: ALWAYS write long content to a scratch file and use \`-f <path>\` instead of \`-c\` to prevent shell quoting failures.`
)
createEntryCmd.action(withValidation(createEntrySchema, createEntryAction))

const updateEntryCmd = entryCmd
    .command('update')
    .description('Update an existing journal entry')

withGroup(updateEntryCmd, 'Command Options', (cmd: Command) => {
    cmd
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
        .option('--metadata <path>', 'Load unified metadata JSON from a file (overrides individual flags)')
        .option('--team', 'Route to team database')
})
addOutputOptions(updateEntryCmd)

addCoreOptions(updateEntryCmd)
addDatabaseOptions(updateEntryCmd)
addAgentInstructions(updateEntryCmd,
    `
🤖 AI AGENT INSTRUCTIONS:
- METADATA PAYLOAD: ALWAYS prefer using \`--metadata <path>\` to pass tags, scores, auto_context, and relationships in a single JSON file.
- MULTI-LINE CONTENT: ALWAYS write long content to a scratch file and use \`-f <path>\` instead of \`-c\` to prevent shell quoting failures.`
)
updateEntryCmd.action(withValidation(updateEntrySchema, updateEntryAction))

program.parse()

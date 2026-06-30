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
import { backupAction, restoreAction, vacuumAction, pruneAction, auditAction, rebuildIndexAction, backupSchema, restoreSchema, vacuumSchema, pruneSchema, auditSchema, rebuildIndexSchema } from './commands/admin.js'
import { createEntryAction, updateEntryAction, createEntrySchema, updateEntrySchema } from './commands/entry.js'
import { searchAction, searchSchema } from './commands/search.js'
import { visualizeAction, visualizeSchema } from './commands/visualize.js'
import { analyticsStatsAction, analyticsInsightsAction, analyticsSchema } from './commands/analytics.js'
import { exportJsonAction, exportMarkdownAction, importMarkdownAction, importExternalAction, exportJsonSchema, exportMarkdownSchema, importMarkdownSchema, importExternalSchema } from './commands/io.js'
const program = createProgram()

program
    .option('--json', 'Output help as structured JSON (agent-native)')

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
- If you forget project details, DO NOT hallucinate. Query \`memory://agent-context/{repo}\`.
- 🛠️ AUTONOMOUS HEALING: DO NOT attempt to run \`node .../build/index.js\`. ALWAYS use the global \`memory-journal-mcp\` wrapper or \`bun src/cli/index.ts\`.`
)

// Setup agent healing for 'project' hallucination
program
    .command('project [args...]', { hidden: true })
    .allowUnknownOption()
    .action(() => {
        process.stderr.write(`🛠️ AUTONOMOUS HEALING: The 'project' command does not exist. To find project IDs, query the MCP resource memory://agent-context/{repo}.\n`);
        process.exit(1);
    });

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

const auditCmd = adminCmd
    .command('audit')
    .description('Search operational telemetry audit logs')
withGroup(auditCmd, 'Command Options', (cmd: Command) => {
    cmd
        .option('--limit <number>', 'Maximum number of results to return')
        .option('--tool <string>', 'Filter by tool name')
        .option('--user <string>', 'Filter by user')
        .option('--category <string>', 'Filter by category')
        .option('--status <string>', 'Filter by status (success|error)')
})
addOutputOptions(auditCmd)
addCoreOptions(auditCmd)
addDatabaseOptions(auditCmd)
addAuditOptions(auditCmd)
auditCmd.action(withValidation(auditSchema, auditAction))

const rebuildIndexCmd = adminCmd
    .command('rebuild-index')
    .description('Rebuild semantic search vector index')
withGroup(rebuildIndexCmd, 'Command Options', (cmd: Command) => {
    cmd.option('--team', 'Rebuild index for team database')
})
addOutputOptions(rebuildIndexCmd)
addCoreOptions(rebuildIndexCmd)
addDatabaseOptions(rebuildIndexCmd)
rebuildIndexCmd.action(withValidation(rebuildIndexSchema, rebuildIndexAction))

// Setup 'entry' command group
const entryCmd = program
    .command('entry')
    .description('Manage journal entries')

const createEntryCmd = entryCmd
    .command('create [content]')
    .description('Create a new journal entry directly in the database')

withGroup(createEntryCmd, 'Command Options', (cmd: Command) => {
    cmd
        .option('-f, --file <path>', 'Load markdown content from a file')
        .option('-c, --content <string>', 'Raw markdown content string')
        .option('--title <title>', 'Optional title (will be prepended as an H1 to content if provided, for agent compatibility)')
        .option('-t, --type <type>', 'Entry type (e.g., retrospective, personal_reflection)')
        .option('--category <type>', 'Entry type (alias)')
        .option('--tags <tags>', 'Comma-separated tags (e.g., session-summary)')
        .option('--project, --project-number <number>', 'Project number')
        .option('--project_number <number>', 'Project number (alias)')
        .option('--trust, --trust-score <number>', 'Trust score (0.0 to 1.0)')
        .option('--trust_score <number>', 'Trust score (0.0 to 1.0) (alias)')
        .option('--impact, --impact-score <number>', 'Impact score (0.0 to 1.0)')
        .option('--impact_score <number>', 'Impact score (0.0 to 1.0) (alias)')
        .option('--validation-status <status>', 'Validation status (passed|none|failed)')
        .option('--session-id <id>', 'Session ID')
        .option('--session_id <id>', 'Session ID (alias)')
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
- MULTI-LINE CONTENT: ALWAYS write long content to a scratch file and use \`-f <path>\` instead of \`-c\` to prevent shell quoting failures.
- SNAKE_CASE FLAGS: Do not hallucinate snake_case CLI flags (like --project_number or --session_id). The CLI expects kebab-case (--project-number).`
)
createEntryCmd.action(withValidation(createEntrySchema, createEntryAction))

const updateEntryCmd = entryCmd
    .command('update [content]')
    .description('Update an existing journal entry')

withGroup(updateEntryCmd, 'Command Options', (cmd: Command) => {
    cmd
        .option('--id <number>', 'ID of the entry to update')
        .option('--expected-version <number>', 'Expected version of the entry (for concurrent modification safety)')
        .option('-f, --file <path>', 'Load new markdown content from a file')
        .option('-c, --content <string>', 'Raw new markdown content string')
        .option('--title <title>', 'Optional title (will be prepended as an H1 to content if provided, for agent compatibility)')
        .option('-t, --type <type>', 'Entry type (e.g., retrospective, personal_reflection)')
        .option('--category <type>', 'Entry type (alias)')
        .option('--tags <tags>', 'Comma-separated tags (e.g., session-summary)')
        .option('--project, --project-number <number>', 'Project number')
        .option('--project_number <number>', 'Project number (alias)')
        .option('--trust, --trust-score <number>', 'Trust score (0.0 to 1.0)')
        .option('--trust_score <number>', 'Trust score (0.0 to 1.0) (alias)')
        .option('--impact, --impact-score <number>', 'Impact score (0.0 to 1.0)')
        .option('--impact_score <number>', 'Impact score (0.0 to 1.0) (alias)')
        .option('--validation-status <status>', 'Validation status (passed|none|failed)')
        .option('--session-id <id>', 'Session ID')
        .option('--session_id <id>', 'Session ID (alias)')
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
- MULTI-LINE CONTENT: ALWAYS write long content to a scratch file and use \`-f <path>\` instead of \`-c\` to prevent shell quoting failures.
- SNAKE_CASE FLAGS: Do not hallucinate snake_case CLI flags (like --project_number or --session_id). The CLI expects kebab-case (--project-number).`
)
updateEntryCmd.action(withValidation(updateEntrySchema, updateEntryAction))

// Setup agent healing for 'delete' hallucination
entryCmd
    .command('delete [args...]', { hidden: true })
    .allowUnknownOption()
    .action(() => {
        process.stderr.write(`🛠️ AUTONOMOUS HEALING: The 'entry delete' command does not exist in the CLI. Deleting entries is an admin-level operation. Please use the MCP tool 'mj_execute_code' with 'db.admin.batchDeleteEntries({ entry_ids: [...] })' instead.\n`);
        process.exit(1);
    });

// Setup 'search' command
const searchCmd = program
    .command('search <query>')
    .description('Search journal entries')
withGroup(searchCmd, 'Command Options', (cmd: Command) => {
    cmd
        .option('--mode <mode>', 'Search mode: auto, fts, semantic, hybrid', 'auto')
        .option('--limit <number>', 'Maximum number of results to return', '50')
        .option('--team', 'Search team database')
})
addOutputOptions(searchCmd)
addCoreOptions(searchCmd)
addDatabaseOptions(searchCmd)
addAgentInstructions(searchCmd,
    `
🤖 AI AGENT INSTRUCTIONS:
- Search output defaults to a JSON representation since it is optimized for agents. No need to parse a table.`
)
searchCmd.action(withValidation(searchSchema, searchAction))

// Setup 'io' command group
const ioCmd = program
    .command('io')
    .description('Import and export tools')

const exportJsonCmd = ioCmd.command('export-json').description('Export database entries to a JSON file')
withGroup(exportJsonCmd, 'Command Options', (cmd: Command) => {
    cmd.option('--dest <path>', 'Destination file path (optional)')
})
addCoreOptions(exportJsonCmd)
addDatabaseOptions(exportJsonCmd)
addOutputOptions(exportJsonCmd)
exportJsonCmd.action(withValidation(exportJsonSchema, exportJsonAction))

const exportMarkdownCmd = ioCmd.command('export-markdown').description('Export entries to a directory of markdown files')
withGroup(exportMarkdownCmd, 'Command Options', (cmd: Command) => {
    cmd.option('--dir <path>', 'Destination directory for markdown files (required)')
})
addCoreOptions(exportMarkdownCmd)
addDatabaseOptions(exportMarkdownCmd)
addOutputOptions(exportMarkdownCmd)
exportMarkdownCmd.action(withValidation(exportMarkdownSchema, exportMarkdownAction))

const importMarkdownCmd = ioCmd.command('import-markdown').description('Import entries from a directory of markdown files')
withGroup(importMarkdownCmd, 'Command Options', (cmd: Command) => {
    cmd.option('--dir <path>', 'Source directory of markdown files (required)')
})
addCoreOptions(importMarkdownCmd)
addDatabaseOptions(importMarkdownCmd)
addOutputOptions(importMarkdownCmd)
importMarkdownCmd.action(withValidation(importMarkdownSchema, importMarkdownAction))

const importExternalCmd = ioCmd.command('import-external').description('Import entries from external knowledge bases')
withGroup(importExternalCmd, 'Command Options', (cmd: Command) => {
    cmd
        .option('--dir <path>', 'Source directory (required)')
        .option('--format <format>', 'External format: notion or obsidian (required)')
})
addCoreOptions(importExternalCmd)
addDatabaseOptions(importExternalCmd)
addOutputOptions(importExternalCmd)
importExternalCmd.action(withValidation(importExternalSchema, importExternalAction))

// Setup 'visualize' command
const visualizeCmd = program
    .command('visualize')
    .description('Generate Mermaid relationship graph')
withGroup(visualizeCmd, 'Command Options', (cmd: Command) => {
    cmd
        .option('--out <path>', 'Output file path (optional, will print to stdout if omitted)')
        .option('--team', 'Visualize team database')
})
addCoreOptions(visualizeCmd)
addDatabaseOptions(visualizeCmd)
addAgentInstructions(visualizeCmd,
    `
🤖 AI AGENT INSTRUCTIONS:
- ALWAYS use \`--out\` to write massive Mermaid diagrams to a file instead of raw stdout.`
)
visualizeCmd.action(withValidation(visualizeSchema, visualizeAction))

// Setup 'analytics' command group
const analyticsCmd = program
    .command('analytics')
    .description('Database analytics and insights')
addAgentInstructions(analyticsCmd,
    `
🤖 AI AGENT INSTRUCTIONS:
- Analytics commands return massive JSON objects optimized for automated consumption.`
)

const analyticsStatsCmd = analyticsCmd.command('stats').description('Get basic database statistics')
withGroup(analyticsStatsCmd, 'Command Options', (cmd: Command) => {
    cmd.option('--team', 'Get stats for team database')
})
addOutputOptions(analyticsStatsCmd)
addCoreOptions(analyticsStatsCmd)
addDatabaseOptions(analyticsStatsCmd)
analyticsStatsCmd.action(withValidation(analyticsSchema, analyticsStatsAction))

const analyticsInsightsCmd = analyticsCmd.command('insights').description('Get cross-project insights')
withGroup(analyticsInsightsCmd, 'Command Options', (cmd: Command) => {
    cmd.option('--team', 'Get insights for team database')
})
addOutputOptions(analyticsInsightsCmd)
addCoreOptions(analyticsInsightsCmd)
addDatabaseOptions(analyticsInsightsCmd)
analyticsInsightsCmd.action(withValidation(analyticsSchema, analyticsInsightsAction))

// Auto-heal snake_case flags hallucinatory arguments to kebab-case
const args = process.argv.map(arg => {
    if (arg.startsWith('--') && arg.includes('_')) {
        return arg.replace(/_/g, '-');
    }
    return arg;
});
program.parse(args)

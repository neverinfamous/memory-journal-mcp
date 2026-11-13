#!/usr/bin/env node

import type { Command } from 'commander'
import type { z } from 'zod'
import { createProgram, addAgentInstructions, withGroup, withValidation, normalizeCliArgv } from './program.js'
import {
    addServerOptions, addCoreOptions, addDatabaseOptions,
    addCodeModeOptions, addAuditOptions,
    addWorkspaceOptions, addWorkspaceScopeOptions, addVectorOptions,
    addOutputOptions
} from './option-groups.js'
import { serveAction, serveSchema } from './commands/serve.js'
import { execAction, execSchema } from './commands/exec.js'
import { searchAction, searchSchema } from './commands/search.js'
import { visualizeAction, visualizeSchema } from './commands/visualize.js'
import { analyticsStatsAction, analyticsInsightsAction, analyticsSchema } from './commands/analytics.js'
import { exportJsonAction, exportMarkdownAction, importMarkdownAction, importExternalAction, exportJsonSchema, exportMarkdownSchema, importMarkdownSchema, importExternalSchema } from './commands/io.js'
import { registerAdminCommands, registerProjectCommands } from './register-admin-commands.js'
import { registerEntryCommands } from './register-entry-commands.js'
const program = createProgram()

program
    .option('--json', 'Output help as structured JSON (agent-native)')

// Setup default 'serve' command
const serveCmd = program
    .command('serve [args...]', { isDefault: true })
    .description('Start the Memory Journal MCP Server')

addServerOptions(serveCmd)
serveCmd.action(withValidation(serveSchema, async (argsArray: string[], options: z.infer<typeof serveSchema>, cmd: Command) => {
    if (Array.isArray(argsArray) && argsArray.length > 0 && typeof argsArray[0] === 'string') {
        process.stderr.write(`🛠️ AUTONOMOUS HEALING: The 'serve' command does not take arguments. You passed: ${argsArray.join(' ')}. If you are trying to search or run prompts, use the MCP client or the 'search' CLI command.\n`);
        process.exit(1);
    }
    await serveAction(options, cmd);
}))

addAgentInstructions(program,
    `
🤖 AI AGENT INSTRUCTIONS:
- This is an agent-native CLI. 
- ALWAYS use valid JSON strings for JSON arguments (e.g. \`--rel '[{"target_id":1,"relation_type":"references"}]'\`).
- If you forget project details, DO NOT hallucinate. Query \`memory://agent-context/{+repo}\`.
- 🛠️ AUTONOMOUS HEALING: DO NOT attempt to run \`node .../build/index.js\`. ALWAYS use the global \`memory-journal-mcp\` wrapper or \`bun src/cli/index.ts\`.`
)

registerProjectCommands(program)

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

registerAdminCommands(program)
registerEntryCommands(program)

// Setup 'search' command
const searchCmd = program
    .command('search [query]')
    .description('Search journal entries')
withGroup(searchCmd, 'Command Options', (cmd: Command) => {
    cmd
        .option('-q, --query <string>', 'Search query (alias for positional argument)')
        .option('--term <string>', 'Search query (alias)')
        .option('--keyword <string>', 'Search query (alias)')
        .option('--mode <mode>', 'Search mode: auto, fts, semantic, hybrid', 'auto')
        .option('--limit <number>', 'Maximum number of results to return', '50')
        .option('--team', 'Search team database')
})
addOutputOptions(searchCmd)
addCoreOptions(searchCmd)
addDatabaseOptions(searchCmd)
addWorkspaceScopeOptions(searchCmd)
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
addWorkspaceScopeOptions(exportJsonCmd)
addOutputOptions(exportJsonCmd)
exportJsonCmd.action(withValidation(exportJsonSchema, exportJsonAction))

const exportMarkdownCmd = ioCmd.command('export-markdown').description('Export entries to a directory of markdown files')
withGroup(exportMarkdownCmd, 'Command Options', (cmd: Command) => {
    cmd.option('--dir <path>', 'Destination directory for markdown files (required)')
})
addCoreOptions(exportMarkdownCmd)
addDatabaseOptions(exportMarkdownCmd)
addWorkspaceScopeOptions(exportMarkdownCmd)
addOutputOptions(exportMarkdownCmd)
exportMarkdownCmd.action(withValidation(exportMarkdownSchema, exportMarkdownAction))

const importMarkdownCmd = ioCmd.command('import-markdown').description('Import entries from a directory of markdown files')
withGroup(importMarkdownCmd, 'Command Options', (cmd: Command) => {
    cmd.option('--dir <path>', 'Source directory of markdown files (required)')
})
addCoreOptions(importMarkdownCmd)
addDatabaseOptions(importMarkdownCmd)
addWorkspaceScopeOptions(importMarkdownCmd)
addOutputOptions(importMarkdownCmd)
importMarkdownCmd.action(withValidation(importMarkdownSchema, importMarkdownAction))

const importExternalCmd = ioCmd.command('import-external').description('Import entries from external knowledge bases')
withGroup(importExternalCmd, 'Command Options', (cmd: Command) => {
    cmd
        .option('--dir <path>', 'Source directory (required)')
        .option('--format <format>', 'External format: notion, obsidian, or logseq (required)')
})
addCoreOptions(importExternalCmd)
addDatabaseOptions(importExternalCmd)
addWorkspaceScopeOptions(importExternalCmd)
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
addWorkspaceScopeOptions(visualizeCmd)
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
addWorkspaceScopeOptions(analyticsStatsCmd)
analyticsStatsCmd.action(withValidation(analyticsSchema, analyticsStatsAction))

const analyticsInsightsCmd = analyticsCmd.command('insights').description('Get cross-project insights')
withGroup(analyticsInsightsCmd, 'Command Options', (cmd: Command) => {
    cmd.option('--team', 'Get insights for team database')
})
addOutputOptions(analyticsInsightsCmd)
addCoreOptions(analyticsInsightsCmd)
addDatabaseOptions(analyticsInsightsCmd)
addWorkspaceScopeOptions(analyticsInsightsCmd)
analyticsInsightsCmd.action(withValidation(analyticsSchema, analyticsInsightsAction))

// Setup alias for 'session' to 'search'
const sessionCmd = program
    .command('session [args...]')
    .description('Search for session summaries (Alias for search "session summary")')
withGroup(sessionCmd, 'Command Options', (cmd: Command) => {
    cmd
        .option('--mode <mode>', 'Search mode: auto, fts, semantic, hybrid', 'auto')
        .option('--limit <number>', 'Maximum number of results to return', '50')
        .option('--team', 'Search team database')
})
addOutputOptions(sessionCmd)
addCoreOptions(sessionCmd)
addDatabaseOptions(sessionCmd)
addWorkspaceScopeOptions(sessionCmd)
addAgentInstructions(sessionCmd,
    `
🤖 AI AGENT INSTRUCTIONS:
- This is a convenience alias. It behaves exactly like the 'search' command, but prepends 'session ' to your query if arguments are provided, or defaults to 'session summary'.`
)
sessionCmd.action(withValidation(searchSchema, async (args: string[], options: ReturnType<typeof searchSchema.parse>, command: Command) => {
    const query = args.length > 0 ? "session " + args.join(" ") : "session summary";
    await searchAction(query, options, command);
}))

program.parse(normalizeCliArgv(process.argv))

#!/usr/bin/env node

import type { Command } from 'commander'
import type { z } from 'zod'
import { createProgram, addAgentInstructions, withGroup, withValidation, normalizeCliArgv } from './program.js'
import {
    addServerOptions, addCoreOptions, addDatabaseOptions,
    addCodeModeOptions, addAuditOptions,
    addWorkspaceScopeOptions, addVectorOptions,
    addOutputOptions
} from './option-groups.js'
import { lazyAction } from './lazy-action.js'
import { formatCliError } from './commands/cli-output.js'
import {
    serverOptionsSchema,
    execOptionsSchema,
    searchOptionsSchema,
    visualizeOptionsSchema,
    analyticsOptionsSchema,
    ioExportJsonOptionsSchema,
    ioExportMarkdownOptionsSchema,
    ioImportMarkdownOptionsSchema,
    ioImportExternalOptionsSchema,
} from './schemas.js'
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
serveCmd.action(withValidation(serverOptionsSchema, async (argsArray: string[], options: z.infer<typeof serverOptionsSchema>, cmd: Command) => {
    if (Array.isArray(argsArray) && argsArray.length > 0 && typeof argsArray[0] === 'string') {
        process.stderr.write(`🛠️ AUTONOMOUS HEALING: The 'serve' command does not take arguments. You passed: ${argsArray.join(' ')}. If you are trying to search or run prompts, use the MCP client or the 'search' CLI command.\n`);
        process.exit(1);
    }
    const { serveAction } = await import('./commands/serve.js');
    await serveAction(options, cmd);
}))

addAgentInstructions(program,
    `
🤖 AI AGENT INSTRUCTIONS:
- This is an agent-native CLI. 
- ALWAYS use valid JSON strings for JSON arguments (e.g. \`--rel '[{"target_id":1,"relation_type":"references"}]'\`).
- If you forget project details, DO NOT hallucinate. Query \`memory://agent-context/{+repo}\`.
- 🛠️ AUTONOMOUS HEALING: DO NOT attempt to run \`node .../build/index.js\`. ALWAYS use the global \`memory-journal-mcp\` wrapper or \`pnpm exec tsx src/cli/index.ts\`.`
)

registerProjectCommands(program)

// Setup 'exec' command
const execCmd = program
    .command('exec <file>')
    .description('Execute a Code Mode script locally without starting a server')

addOutputOptions(execCmd)

addCoreOptions(execCmd)
addDatabaseOptions(execCmd)
addWorkspaceScopeOptions(execCmd)
addVectorOptions(execCmd)
addCodeModeOptions(execCmd)
addAuditOptions(execCmd)
addAgentInstructions(execCmd,
    `
🤖 AI AGENT INSTRUCTIONS:
- ALWAYS provide the path to a valid script file. Scripts execute within the same execution environment as Code Mode tools.
- Do NOT use this command to start the server. Use \`serve\` instead.`
)
execCmd.action(withValidation(execOptionsSchema, lazyAction(async () => (await import('./commands/exec.js')).execAction)))

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
searchCmd.action(withValidation(searchOptionsSchema, lazyAction(async () => (await import('./commands/search.js')).searchAction)))

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
exportJsonCmd.action(withValidation(ioExportJsonOptionsSchema, lazyAction(async () => (await import('./commands/io.js')).exportJsonAction)))

const exportMarkdownCmd = ioCmd.command('export-markdown').description('Export entries to a directory of markdown files')
withGroup(exportMarkdownCmd, 'Command Options', (cmd: Command) => {
    cmd.option('--dir <path>', 'Destination directory for markdown files (required)')
})
addCoreOptions(exportMarkdownCmd)
addDatabaseOptions(exportMarkdownCmd)
addWorkspaceScopeOptions(exportMarkdownCmd)
addOutputOptions(exportMarkdownCmd)
exportMarkdownCmd.action(withValidation(ioExportMarkdownOptionsSchema, lazyAction(async () => (await import('./commands/io.js')).exportMarkdownAction)))

const importMarkdownCmd = ioCmd.command('import-markdown').description('Import entries from a directory of markdown files')
withGroup(importMarkdownCmd, 'Command Options', (cmd: Command) => {
    cmd.option('--dir <path>', 'Source directory of markdown files (required)')
})
addCoreOptions(importMarkdownCmd)
addDatabaseOptions(importMarkdownCmd)
addWorkspaceScopeOptions(importMarkdownCmd)
addOutputOptions(importMarkdownCmd)
importMarkdownCmd.action(withValidation(ioImportMarkdownOptionsSchema, lazyAction(async () => (await import('./commands/io.js')).importMarkdownAction)))

const importExternalCmd = ioCmd.command('import-external').description('Import entries from external knowledge bases')
withGroup(importExternalCmd, 'Command Options', (cmd: Command) => {
    cmd
        .option('--dir <path>', 'Source directory (required)')
        .option('--format <format>', 'External format: notion, obsidian, or logseq (required)')
        .option('-l, --limit <number>', 'Maximum markdown files to import (default: 500)')
})
addCoreOptions(importExternalCmd)
addDatabaseOptions(importExternalCmd)
addWorkspaceScopeOptions(importExternalCmd)
addOutputOptions(importExternalCmd)
importExternalCmd.action(withValidation(ioImportExternalOptionsSchema, lazyAction(async () => (await import('./commands/io.js')).importExternalAction)))

// Setup 'visualize' command
const visualizeCmd = program
    .command('visualize')
    .description('Generate Mermaid relationship graph')
withGroup(visualizeCmd, 'Command Options', (cmd: Command) => {
    cmd
        .option('--out <path>', 'Output file path (optional, will print to stdout if omitted)')
        .option('--team', 'Visualize team database')
})
addOutputOptions(visualizeCmd)
addCoreOptions(visualizeCmd)
addDatabaseOptions(visualizeCmd)
addWorkspaceScopeOptions(visualizeCmd)
addAgentInstructions(visualizeCmd,
    `
🤖 AI AGENT INSTRUCTIONS:
- ALWAYS use \`--out\` to write massive Mermaid diagrams to a file instead of raw stdout.`
)
visualizeCmd.action(withValidation(visualizeOptionsSchema, lazyAction(async () => (await import('./commands/visualize.js')).visualizeAction)))

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
analyticsStatsCmd.action(withValidation(analyticsOptionsSchema, lazyAction(async () => (await import('./commands/analytics.js')).analyticsStatsAction)))

const analyticsInsightsCmd = analyticsCmd.command('insights').description('Get cross-project insights')
withGroup(analyticsInsightsCmd, 'Command Options', (cmd: Command) => {
    cmd.option('--team', 'Get insights for team database')
})
addOutputOptions(analyticsInsightsCmd)
addCoreOptions(analyticsInsightsCmd)
addDatabaseOptions(analyticsInsightsCmd)
addWorkspaceScopeOptions(analyticsInsightsCmd)
analyticsInsightsCmd.action(withValidation(analyticsOptionsSchema, lazyAction(async () => (await import('./commands/analytics.js')).analyticsInsightsAction)))

// Setup alias for 'session' to 'search'
const sessionCmd = program
    .command('session [args...]')
    .description('Search for session summaries (Alias for search "session summary")')
withGroup(sessionCmd, 'Command Options', (cmd: Command) => {
    cmd
        .option('-q, --query <string>', 'Additional session search terms')
        .option('--term <string>', 'Additional session search terms (alias)')
        .option('--keyword <string>', 'Additional session search terms (alias)')
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
sessionCmd.action(withValidation(searchOptionsSchema, async (args: string[], options: ReturnType<typeof searchOptionsSchema.parse>, command: Command) => {
    const { query: optQuery, term, keyword, ...rest } = options;
    const extra = optQuery ?? term ?? keyword;
    const terms = [...args, ...(extra !== undefined && extra !== '' ? [extra] : [])];
    const query = terms.length > 0 ? "session " + terms.join(" ") : "session summary";
    const { searchAction } = await import('./commands/search.js');
    await searchAction(query, rest, command);
}))

// Setup 'commit' command delegating directly to the vendored commit wrapper
program
    .command('commit [args...]')
    .description('Stage files, enforce commit safety/trailers, and optionally record a Memory Journal entry')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .action(async (commitArgs: string[]) => {
        const { main } = await import('../vendor/commit/commit.js')
        const rawTail = normalizeCliArgv(process.argv).slice(2)
        const valueTakingGlobalFlags = new Set<string>()
        for (const opt of program.options) {
            if (opt.required || opt.optional) {
                if (opt.short !== undefined) valueTakingGlobalFlags.add(opt.short)
                if (opt.long !== undefined) valueTakingGlobalFlags.add(opt.long)
            }
        }
        let commitIdx = -1
        for (let i = 0; i < rawTail.length; i++) {
            const token = rawTail[i]
            if (token === '--') break
            if (token === 'commit') {
                const prev = i > 0 ? rawTail[i - 1] : undefined
                if (prev === undefined || !valueTakingGlobalFlags.has(prev)) {
                    commitIdx = i
                    break
                }
            }
        }
        await main(commitIdx !== -1 ? rawTail.slice(commitIdx + 1) : commitArgs)
    })

void program.parseAsync(normalizeCliArgv(process.argv)).catch((err: unknown) => {
    process.stderr.write(`\x1b[31mError:\x1b[0m ${formatCliError(err)}\n`)
    process.exitCode = 1
})

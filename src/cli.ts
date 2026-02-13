/**
 * Memory Journal MCP Server - CLI Entry Point
 */

import { Command } from 'commander'
import { createServer } from './server/McpServer.js'
import { logger } from './utils/logger.js'
import pkg from '../package.json' with { type: 'json' }

const program = new Command()

program
    .name('memory-journal-mcp')
    .description('Project context management for AI-assisted development')
    .version(pkg.version)
    .option('--transport <type>', 'Transport type: stdio or http', 'stdio')
    .option('--port <number>', 'HTTP port (for http transport)', '3000')
    .option('--server-host <host>', 'Server bind host for HTTP transport (default: localhost)')
    .option('--stateless', 'Use stateless HTTP mode (no session management)')
    .option('--db <path>', 'Database path', './memory_journal.db')
    .option('--tool-filter <filter>', 'Tool filter string (e.g., "starter", "core,search")')
    .option('--default-project <number>', 'Default GitHub Project number')
    .option('--auto-rebuild-index', 'Rebuild vector index on server startup')
    .option('--log-level <level>', 'Log level: debug, info, warning, error', 'info')
    .action(
        async (options: {
            transport: string
            port: string
            serverHost?: string
            stateless?: boolean
            db: string
            toolFilter?: string
            defaultProject: string
            autoRebuildIndex?: boolean
            logLevel: string
        }) => {
            // Set log level
            logger.setLevel(options.logLevel as 'debug' | 'info' | 'warning' | 'error')

            // Resolve host: CLI flag > env var > default (localhost)
            const host =
                options.serverHost ?? process.env['MCP_HOST'] ?? process.env['HOST'] ?? undefined

            logger.info('Starting Memory Journal MCP Server', {
                module: 'CLI',
                transport: options.transport,
                stateless: options.stateless ?? false,
                db: options.db,
                ...(host ? { host } : {}),
            })

            try {
                await createServer({
                    transport: options.transport as 'stdio' | 'http',
                    port: parseInt(options.port, 10),
                    host,
                    statelessHttp: options.stateless === true,
                    dbPath: options.db,
                    toolFilter: options.toolFilter,
                    defaultProjectNumber: options.defaultProject
                        ? parseInt(options.defaultProject, 10)
                        : process.env['DEFAULT_PROJECT_NUMBER']
                          ? parseInt(process.env['DEFAULT_PROJECT_NUMBER'], 10)
                          : undefined,
                    autoRebuildIndex:
                        options.autoRebuildIndex ?? process.env['AUTO_REBUILD_INDEX'] === 'true',
                })
            } catch (error) {
                logger.error('Failed to start server', {
                    module: 'CLI',
                    error: error instanceof Error ? error.message : String(error),
                })
                process.exit(1)
            }
        }
    )

program.parse()

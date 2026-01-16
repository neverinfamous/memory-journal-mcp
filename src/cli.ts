/**
 * Memory Journal MCP Server - CLI Entry Point
 */

import { Command } from 'commander';
import { createServer } from './server/McpServer.js';
import { logger } from './utils/logger.js';

const program = new Command();

program
    .name('memory-journal-mcp')
    .description('Project context management for AI-assisted development')
    .version('3.1.5')
    .option('--transport <type>', 'Transport type: stdio or http', 'stdio')
    .option('--port <number>', 'HTTP port (for http transport)', '3000')
    .option('--db <path>', 'Database path', './memory_journal.db')
    .option('--tool-filter <filter>', 'Tool filter string (e.g., "starter", "core,search")')
    .option('--default-project <number>', 'Default GitHub Project number')
    .option('--log-level <level>', 'Log level: debug, info, warning, error', 'info')
    .action(async (options: {
        transport: string;
        port: string;
        db: string;
        toolFilter?: string;
        defaultProject: string;
        logLevel: string;
    }) => {
        // Set log level
        logger.setLevel(options.logLevel as 'debug' | 'info' | 'warning' | 'error');

        logger.info('Starting Memory Journal MCP Server', {
            module: 'CLI',
            transport: options.transport,
            db: options.db,
        });

        try {
            await createServer({
                transport: options.transport as 'stdio' | 'http',
                port: parseInt(options.port, 10),
                dbPath: options.db,
                toolFilter: options.toolFilter,
                defaultProjectNumber: options.defaultProject ? parseInt(options.defaultProject, 10) : (process.env['DEFAULT_PROJECT_NUMBER'] ? parseInt(process.env['DEFAULT_PROJECT_NUMBER'], 10) : undefined),
            });
        } catch (error) {
            logger.error('Failed to start server', {
                module: 'CLI',
                error: error instanceof Error ? error.message : String(error),
            });
            process.exit(1);
        }
    });

program.parse();

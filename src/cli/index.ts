#!/usr/bin/env node
import { createProgram, addServerOptions } from './program-options.js'
import { serveAction } from './commands/serve.js'
import { execAction } from './commands/exec.js'
import { backupAction, restoreAction, vacuumAction, pruneAction } from './commands/admin.js'

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

program.parse()

import type { Command } from 'commander'
import { addAgentInstructions, withGroup, withValidation } from './program.js'
import {
    addCoreOptions,
    addDatabaseOptions,
    addAuditOptions,
    addPruningOptions,
    addWorkspaceScopeOptions,
    addOutputOptions,
} from './option-groups.js'
import {
    backupAction,
    restoreAction,
    vacuumAction,
    pruneAction,
    auditAction,
    rebuildIndexAction,
    backupSchema,
    restoreSchema,
    vacuumSchema,
    pruneSchema,
    auditSchema,
    rebuildIndexSchema,
} from './commands/admin.js'
import {
    projectCreateAction,
    projectListAction,
    projectUpdateAction,
    projectDeleteAction,
} from './commands/project.js'

/**
 * [BOUNDARY] Registration for the `project` and `admin` command groups (split from
 * `cli/index.ts`, L1).
 */

export function registerProjectCommands(program: Command): void {
    const projectCmd = program
        .command('project')
        .description('Manage projects in the memory-journal-mcp global registry')

    const projectListCmd = projectCmd
        .command('list')
        .description('List all registered projects')
        .option('--json', 'Output as JSON')
    addCoreOptions(projectListCmd)
    projectListCmd.action(projectListAction)

    const projectCreateCmd = projectCmd
        .command('create <name>')
        .description('Register a new project in the global registry')
    withGroup(projectCreateCmd, 'Command Options', (cmd: Command) => {
        cmd
            .option('--path <path>', 'Absolute path to the local repository (required)')
            .option('--number <number>', 'GitHub Project number (optional)')
            .option('--skip-init', 'Skip automated database initialization entry')
    })
    addCoreOptions(projectCreateCmd)
    addDatabaseOptions(projectCreateCmd)
    addOutputOptions(projectCreateCmd)
    addAgentInstructions(projectCreateCmd,
        `
🤖 AI AGENT INSTRUCTIONS:
- Run this command first when initializing a new codebase.
- The command will AUTOMATICALLY initialize the project in the database. You no longer need to run a secondary 'entry create' command.`
    )
    projectCreateCmd.action(projectCreateAction)

    const projectUpdateCmd = projectCmd
        .command('update <name>')
        .description('Update an existing project in the registry')
    withGroup(projectUpdateCmd, 'Command Options', (cmd: Command) => {
        cmd
            .option('--path <path>', 'New absolute path to the local repository')
            .option('--number <number>', 'New GitHub Project number')
            .option('--rename <name>', 'Rename the project key (fails if the new key already exists)')
    })
    addOutputOptions(projectUpdateCmd)
    addCoreOptions(projectUpdateCmd)
    projectUpdateCmd.action(projectUpdateAction)

    const projectDeleteCmd = projectCmd
        .command('delete <name>')
        .alias('remove')
        .description('Remove a project from the global registry')
    addOutputOptions(projectDeleteCmd)
    addCoreOptions(projectDeleteCmd)
    projectDeleteCmd.action(projectDeleteAction)
}

function registerAdminStorageCommands(adminCmd: Command): void {
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
}

function registerAdminMaintenanceCommands(adminCmd: Command): void {
    const pruneCmd = adminCmd.command('prune').description('Run autonomous database pruning')
    withGroup(pruneCmd, 'Command Options', (cmd: Command) => {
        cmd
            .option('--dry-run', 'Log candidates without modifying the database')
            .option('--exclude-tags <tags>', 'Comma-separated tags to exclude')
            .option('--importance-threshold <n>', 'Importance score below which entries are prunable')
            .option('--all-workspaces', 'Explicitly confirm pruning across all workspaces when using --workspace "*"')
    })
    addOutputOptions(pruneCmd)
    addCoreOptions(pruneCmd)
    addDatabaseOptions(pruneCmd)
    addWorkspaceScopeOptions(pruneCmd)
    addPruningOptions(pruneCmd, false)
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
            .option('--category <string>', 'Filter by category (read|write|admin|team|audit)')
            .option('--status <string>', 'Filter by status (success|error)')
    })
    addOutputOptions(auditCmd)
    addCoreOptions(auditCmd)
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
    addWorkspaceScopeOptions(rebuildIndexCmd)
    rebuildIndexCmd.action(withValidation(rebuildIndexSchema, rebuildIndexAction))
}

export function registerAdminCommands(program: Command): void {
    const adminCmd = program.command('admin').description('Database administration utilities')
    addAgentInstructions(adminCmd,
        `
🤖 AI AGENT INSTRUCTIONS:
- These are dangerous administrative utilities. ALWAYS verify the target database before executing.`
    )
    registerAdminStorageCommands(adminCmd)
    registerAdminMaintenanceCommands(adminCmd)
}

import { Command } from 'commander'
import * as fs from 'node:fs'
import { createServer } from './server/mcp-server.js'
import { logger } from './utils/logger.js'
import pkg from '../package.json' with { type: 'json' }

// Smart Database Resolution: Check root, then test-server, then default to root
function resolveDbPath(envPath: string | undefined, defaultName: string, testName: string): string {
    if (envPath) return envPath
    const rootPath = `./${defaultName}`
    const testPath = `./test-server/${testName}`
    if (fs.existsSync(rootPath)) return rootPath
    if (fs.existsSync(testPath)) return testPath
    return rootPath // fallback to creating root if neither exist
}

const defaultDbPath = resolveDbPath(
    process.env['DB_PATH'],
    'memory_journal.db',
    'test-memory-journal.db'
)
const defaultTeamDbPath = process.env['TEAM_DB_PATH'] ? process.env['TEAM_DB_PATH'] : undefined

const program = new Command()

program
    .name('memory-journal-mcp')
    .description('Project context management for AI-assisted development')
    .version(pkg.version)
    .option('--transport <type>', 'Transport type: stdio or http', 'stdio')
    .option('--port <number>', 'HTTP port (for http transport)', '3000')
    .option('--server-host <host>', 'Server bind host for HTTP transport (default: localhost)')
    .option('--stateless', 'Use stateless HTTP mode (no session management)')
    .option(
        '--db <path>',
        'Database path (env: DB_PATH)',
        defaultDbPath
    )
    .option(
        '--team-db <path>',
        'Team database path (env: TEAM_DB_PATH)',
        defaultTeamDbPath
    )
    .option('--tool-filter <filter>', 'Tool filter string (e.g., "starter", "core,search")')
    .option('--default-project <number>', 'Default GitHub Project number')
    .option('--auto-rebuild-index', 'Rebuild vector index on server startup')
    .option('--cors-origin <origin>', 'CORS allowed origin for HTTP transport (default: *)')
    .option('--enable-hsts', 'Enable HSTS header for HTTP transport (use when behind HTTPS)')
    .option(
        '--auth-token <token>',
        'Bearer token for HTTP transport authentication (env: MCP_AUTH_TOKEN)'
    )
    .option('--log-level <level>', 'Log level: debug, info, warning, error', 'info')
    .option(
        '--backup-interval <minutes>',
        'Automated backup interval in minutes, HTTP only (0 = disabled)',
        '0'
    )
    .option('--keep-backups <count>', 'Max backups to retain during automated cleanup', '5')
    .option(
        '--vacuum-interval <minutes>',
        'Database optimize interval in minutes, HTTP only (0 = disabled)',
        '0'
    )
    .option(
        '--rebuild-index-interval <minutes>',
        'Vector index rebuild interval in minutes, HTTP only (0 = disabled)',
        '0'
    )
    .option(
        '--sandbox-mode <mode>',
        'Code Mode sandbox: "worker" (production, default) or "vm" (lightweight)',
        'worker'
    )
    .option('--oauth-enabled', 'Enable OAuth 2.1 authentication (env: OAUTH_ENABLED)')
    .option('--oauth-issuer <url>', 'OAuth issuer URL (env: OAUTH_ISSUER)')
    .option('--oauth-audience <audience>', 'OAuth audience (env: OAUTH_AUDIENCE)')
    .option('--oauth-jwks-uri <uri>', 'OAuth JWKS URI (env: OAUTH_JWKS_URI)')
    .option(
        '--oauth-clock-tolerance <seconds>',
        'OAuth clock tolerance in seconds (default: 60)',
        '60'
    )
    .option(
        '--instruction-level <level>',
        'Briefing depth: essential, standard, full (env: INSTRUCTION_LEVEL)',
        'standard'
    )
    // Briefing configuration
    .option(
        '--briefing-entries <count>',
        'Number of journal entries in briefing (env: BRIEFING_ENTRY_COUNT)',
        '3'
    )
    .option(
        '--briefing-include-team',
        'Include team DB entries in briefing (env: BRIEFING_INCLUDE_TEAM)'
    )
    .option(
        '--briefing-issues <count>',
        'Number of issues to list in briefing; 0 = count only (env: BRIEFING_ISSUE_COUNT)',
        '0'
    )
    .option(
        '--briefing-prs <count>',
        'Number of PRs to list in briefing; 0 = count only (env: BRIEFING_PR_COUNT)',
        '0'
    )
    .option(
        '--briefing-pr-status',
        'Show PR status breakdown in briefing (env: BRIEFING_PR_STATUS)'
    )
    .option(
        '--rules-file <path>',
        'Path to user rules file for awareness in briefing (env: RULES_FILE_PATH)'
    )
    .option(
        '--skills-dir <path>',
        'Path to skills directory for awareness in briefing (env: SKILLS_DIR_PATH)'
    )
    .option(
        '--briefing-workflows <count>',
        'Number of workflow runs to list in briefing; 0 = status only (env: BRIEFING_WORKFLOW_COUNT)',
        '0'
    )
    .option(
        '--briefing-workflow-status',
        'Show workflow run status breakdown in briefing (env: BRIEFING_WORKFLOW_STATUS)'
    )
    .option(
        '--briefing-copilot',
        'Aggregate Copilot review state across recent PRs in briefing (env: BRIEFING_COPILOT_REVIEWS)'
    )
    .action(
        async (options: {
            transport: string
            port: string
            serverHost?: string
            stateless?: boolean
            db: string
            teamDb?: string
            toolFilter?: string
            defaultProject: string
            autoRebuildIndex?: boolean
            corsOrigin?: string
            enableHsts?: boolean
            authToken?: string
            logLevel: string
            backupInterval: string
            keepBackups: string
            vacuumInterval: string
            rebuildIndexInterval: string
            sandboxMode: string
            oauthEnabled?: boolean
            oauthIssuer?: string
            oauthAudience?: string
            oauthJwksUri?: string
            oauthClockTolerance: string
            briefingEntries: string
            briefingIncludeTeam?: boolean
            briefingIssues: string
            briefingPrs: string
            briefingPrStatus?: boolean
            rulesFile?: string
            skillsDir?: string
            briefingWorkflows: string
            briefingWorkflowStatus?: boolean
            briefingCopilot?: boolean
            instructionLevel: string
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
                ...(options.teamDb ? { teamDb: options.teamDb } : {}),
                ...(host ? { host } : {}),
            })

            try {
                await createServer({
                    transport: options.transport as 'stdio' | 'http',
                    port: parseInt(options.port, 10),
                    host,
                    statelessHttp: options.stateless === true,
                    dbPath: options.db,
                    teamDbPath: options.teamDb,
                    toolFilter: options.toolFilter,
                    defaultProjectNumber: options.defaultProject
                        ? parseInt(options.defaultProject, 10)
                        : process.env['DEFAULT_PROJECT_NUMBER']
                          ? parseInt(process.env['DEFAULT_PROJECT_NUMBER'], 10)
                          : undefined,
                    autoRebuildIndex:
                        options.autoRebuildIndex ?? process.env['AUTO_REBUILD_INDEX'] === 'true',
                    corsOrigins: options.corsOrigin
                        ? options.corsOrigin.split(',').map((s) => s.trim())
                        : undefined,
                    enableHSTS:
                        options.enableHsts ?? process.env['MCP_ENABLE_HSTS'] === 'true',
                    authToken: options.authToken,
                    scheduler: {
                        backupIntervalMinutes: parseInt(options.backupInterval, 10),
                        keepBackups: parseInt(options.keepBackups, 10),
                        vacuumIntervalMinutes: parseInt(options.vacuumInterval, 10),
                        rebuildIndexIntervalMinutes: parseInt(options.rebuildIndexInterval, 10),
                    },
                    sandboxMode: options.sandboxMode as 'vm' | 'worker',
                    // OAuth 2.1
                    oauthEnabled:
                        options.oauthEnabled ?? process.env['OAUTH_ENABLED'] === 'true',
                    oauthIssuer: options.oauthIssuer ?? process.env['OAUTH_ISSUER'],
                    oauthAudience: options.oauthAudience ?? process.env['OAUTH_AUDIENCE'],
                    oauthJwksUri: options.oauthJwksUri ?? process.env['OAUTH_JWKS_URI'],
                    oauthClockTolerance: parseInt(options.oauthClockTolerance, 10),
                    // Briefing configuration
                    briefingConfig: {
                        entryCount: parseInt(
                            process.env['BRIEFING_ENTRY_COUNT'] ?? options.briefingEntries,
                            10
                        ),
                        includeTeam:
                            options.briefingIncludeTeam ??
                            process.env['BRIEFING_INCLUDE_TEAM'] === 'true',
                        issueCount: parseInt(
                            process.env['BRIEFING_ISSUE_COUNT'] ?? options.briefingIssues,
                            10
                        ),
                        prCount: parseInt(
                            process.env['BRIEFING_PR_COUNT'] ?? options.briefingPrs,
                            10
                        ),
                        prStatusBreakdown:
                            options.briefingPrStatus ??
                            process.env['BRIEFING_PR_STATUS'] === 'true',
                        rulesFilePath:
                            options.rulesFile ?? process.env['RULES_FILE_PATH'] ?? undefined,
                        skillsDirPath:
                            options.skillsDir ?? process.env['SKILLS_DIR_PATH'] ?? undefined,
                        workflowCount: parseInt(
                            process.env['BRIEFING_WORKFLOW_COUNT'] ?? options.briefingWorkflows,
                            10
                        ),
                        workflowStatusBreakdown:
                            options.briefingWorkflowStatus ??
                            process.env['BRIEFING_WORKFLOW_STATUS'] === 'true',
                        copilotReviews:
                            options.briefingCopilot ??
                            process.env['BRIEFING_COPILOT_REVIEWS'] === 'true',
                    },
                    instructionLevel: (
                        options.instructionLevel !== 'standard'
                            ? options.instructionLevel
                            : process.env['INSTRUCTION_LEVEL'] ?? 'standard'
                    ) as 'essential' | 'standard' | 'full',
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

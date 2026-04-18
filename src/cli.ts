import { Command } from 'commander'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import { createServer } from './server/mcp-server.js'
import { logger } from './utils/logger.js'
import { VERSION } from './version.js'
import type { ProjectRegistryEntry } from './types/index.js'
import { DEFAULT_AUDIT_LOG_MAX_SIZE_BYTES } from './audit/index.js'
import type { AuditConfig } from './audit/index.js'


function parseConfigIntRequired(value: string, name: string): number {
    const parsed = parseInt(value, 10)
    if (Number.isNaN(parsed)) {
        throw new Error(`Invalid required numeric configuration for ${name}: ${value}`)
    }
    return parsed
}



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
    .version(VERSION)
    .option('--transport <type>', 'Transport type: stdio or http', 'stdio')
    .option('--port <number>', 'HTTP port (for http transport)', '3000')
    .option('--server-host <host>', 'Server bind host for HTTP transport (default: localhost)')
    .option('--stateless', 'Use stateless HTTP mode (no session management)')
    .option('--db <path>', 'Database path (env: DB_PATH)', defaultDbPath)
    .option('--team-db <path>', 'Team database path (env: TEAM_DB_PATH)', defaultTeamDbPath)
    .option('--tool-filter <filter>', 'Tool filter string (e.g., "starter", "core,search")')
    .option('--default-project <number>', 'Default GitHub Project number')
    .option('--auto-rebuild-index', 'Rebuild vector index on server startup')
    .option('--cors-origin <origin>', 'CORS allowed origin for HTTP transport (default: none)')
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
        '--digest-interval <minutes>',
        'Analytics digest interval in minutes, HTTP only (0 = disabled; recommended: 1440 for daily)',
        '0'
    )

    .option(
        '--codemode-max-result-size <bytes>',
        'Maximum Code Mode result size in bytes (default: 102400 / 100KB, env: CODE_MODE_MAX_RESULT_SIZE)'
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
    .option('--oauth-allow-plaintext-loopback', 'Allow plaintext loopback OAuth issuer (env: OAUTH_ALLOW_PLAINTEXT_LOOPBACK)')
    .option('--trust-proxy', 'Trust reverse proxy headers (e.g. X-Forwarded-For env: TRUST_PROXY)')
    .option('--public-origin <url>', 'Public origin URL for webhook verification and OAuth redirects (env: PUBLIC_ORIGIN)')
    // Audit options
    .option(
        '--audit-log <path>',
        'Enable audit logging to the specified JSONL file path, or "stderr" for container mode (env: AUDIT_LOG_PATH)'
    )
    .option('--no-audit-redact', 'Disable redaction of tool arguments from audit entries (env: AUDIT_REDACT=false)')
    .option(
        '--audit-reads',
        'Enable audit logging for read-scoped tool calls (default: off, env: AUDIT_READS)'
    )
    .option(
        '--audit-log-max-size <bytes>',
        'Maximum audit log file size in bytes before rotation (default: 10485760 / 10MB, env: AUDIT_LOG_MAX_SIZE)',
        String(DEFAULT_AUDIT_LOG_MAX_SIZE_BYTES)
    )
    .option(
        '--instruction-level <level>',
        'Briefing depth: essential, standard, full (env: INSTRUCTION_LEVEL)',
        'standard'
    )
    .option(
        '--allowed-io-roots <paths>',
        'Comma-separated absolute paths or JSON array of paths for strict filesystem jailing (env: ALLOWED_IO_ROOTS)'
    )
    // Briefing configuration
    .option(
        '--briefing-entries <count>',
        'Number of journal entries in briefing (env: BRIEFING_ENTRY_COUNT)',
        '3'
    )
    .option(
        '--briefing-summaries <count>',
        'Number of session summaries to show in briefing (env: BRIEFING_SUMMARY_COUNT)',
        '1'
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
        '--briefing-milestones <count>',
        'Number of milestones to list in briefing; 0 = hide (env: BRIEFING_MILESTONE_COUNT)',
        '3'
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
    .option(
        '--workflow-summary <text>',
        'Workflow summary for memory://workflows resource (env: MEMORY_JOURNAL_WORKFLOW_SUMMARY)'
    )
    .option(
        '--flag-vocabulary <terms>',
        'Comma-separated flag vocabulary for Hush Protocol (env: FLAG_VOCABULARY, default: blocker,needs_review,help_requested,fyi)'
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
            digestInterval: string

            codemodeMaxResultSize?: string
            oauthEnabled?: boolean
            oauthIssuer?: string
            oauthAudience?: string
            oauthJwksUri?: string
            oauthClockTolerance: string
            oauthAllowPlaintextLoopback?: boolean
            trustProxy?: boolean
            publicOrigin?: string
            briefingEntries: string
            briefingSummaries: string
            briefingIncludeTeam?: boolean
            briefingIssues: string
            briefingPrs: string
            briefingPrStatus?: boolean
            briefingMilestones: string
            rulesFile?: string
            skillsDir?: string
            briefingWorkflows: string
            briefingWorkflowStatus?: boolean
            briefingCopilot?: boolean
            workflowSummary?: string
            flagVocabulary?: string
            instructionLevel: string
            allowedIoRoots?: string
            auditLog?: string
            auditRedact?: boolean
            auditReads?: boolean
            auditLogMaxSize: string
        }) => {
            // Set log level
            logger.setLevel(options.logLevel as 'debug' | 'info' | 'warning' | 'error')

            // Validate against default placeholder secrets
            const sensitiveEnvVars = ['GITHUB_TOKEN', 'MCP_AUTH_TOKEN', 'OAUTH_ISSUER', 'OAUTH_JWKS_URI']
            for (const envVar of sensitiveEnvVars) {
                if (process.env[envVar]?.startsWith('CHANGEME_')) {
                    logger.error(`FATAL: Insecure configuration detected. ${envVar} contains default placeholder value. Please update your environment variables.`, { module: 'CLI' })
                    process.exit(1)
                }
            }

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

            // Set CODE_MODE_MAX_RESULT_SIZE env var from CLI flag if provided
            const codemodeMaxResultSize =
                options.codemodeMaxResultSize ?? process.env['CODE_MODE_MAX_RESULT_SIZE']
            if (codemodeMaxResultSize) {
                process.env['CODE_MODE_MAX_RESULT_SIZE'] = codemodeMaxResultSize
            }

            try {

                // Build audit config from CLI options + env
                const auditLogPath = options.auditLog ?? process.env['AUDIT_LOG_PATH']
                const auditConfig: AuditConfig | undefined = auditLogPath
                    ? {
                          enabled: true,
                          logPath: auditLogPath,
                          redact: options.auditRedact ?? (process.env['AUDIT_REDACT'] ? process.env['AUDIT_REDACT'] === 'true' : true),
                          auditReads: options.auditReads ?? process.env['AUDIT_READS'] === 'true',
                          maxSizeBytes: parseConfigIntRequired(
                              process.env['AUDIT_LOG_MAX_SIZE'] ?? options.auditLogMaxSize,
                              'audit-log-max-size'
                          ),
                      }
                    : undefined

                await createServer({
                    transport: options.transport as 'stdio' | 'http',
                    port: parseConfigIntRequired(options.port, 'port'),
                    host,
                    statelessHttp: options.stateless === true,
                    dbPath: options.db,
                    teamDbPath: options.teamDb,
                    toolFilter: options.toolFilter,
                    defaultProjectNumber: options.defaultProject
                        ? parseConfigIntRequired(options.defaultProject, 'default-project')
                        : process.env['DEFAULT_PROJECT_NUMBER']
                          ? parseConfigIntRequired(process.env['DEFAULT_PROJECT_NUMBER'], 'DEFAULT_PROJECT_NUMBER')
                          : undefined,
                    autoRebuildIndex:
                        options.autoRebuildIndex ?? process.env['AUTO_REBUILD_INDEX'] === 'true',
                    corsOrigins: options.corsOrigin
                        ? options.corsOrigin.split(',').map((s) => s.trim())
                        : undefined,
                    enableHSTS: options.enableHsts ?? process.env['MCP_ENABLE_HSTS'] === 'true',
                    authToken: options.authToken,
                    scheduler: {
                        backupIntervalMinutes: parseConfigIntRequired(options.backupInterval, 'backup-interval'),
                        keepBackups: parseConfigIntRequired(options.keepBackups, 'keep-backups'),
                        vacuumIntervalMinutes: parseConfigIntRequired(options.vacuumInterval, 'vacuum-interval'),
                        rebuildIndexIntervalMinutes: parseConfigIntRequired(options.rebuildIndexInterval, 'rebuild-index-interval'),
                        digestIntervalMinutes: parseConfigIntRequired(options.digestInterval, 'digest-interval'),
                    },

                    // OAuth 2.1
                    oauthEnabled: options.oauthEnabled ?? process.env['OAUTH_ENABLED'] === 'true',
                    oauthIssuer: options.oauthIssuer ?? process.env['OAUTH_ISSUER'],
                    oauthAudience: options.oauthAudience ?? process.env['OAUTH_AUDIENCE'],
                    oauthJwksUri: options.oauthJwksUri ?? process.env['OAUTH_JWKS_URI'],
                    oauthClockTolerance: parseConfigIntRequired(
                        process.env['OAUTH_CLOCK_TOLERANCE'] ?? options.oauthClockTolerance,
                        'oauth-clock-tolerance'
                    ),
                    allowPlaintextLoopbackOAuth: options.oauthAllowPlaintextLoopback ?? (process.env['OAUTH_ALLOW_PLAINTEXT_LOOPBACK'] === 'true'),
                    trustProxy: options.trustProxy ?? (process.env['TRUST_PROXY'] === 'true'),
                    publicOrigin: options.publicOrigin ?? process.env['PUBLIC_ORIGIN'],
                    // Project Registry
                    projectRegistry: (() => {
                        const raw = process.env['PROJECT_REGISTRY']
                        if (!raw) return undefined
                        try {
                            // Zod validation for structural integrity
                            const registrySchema = z.record(
                                z.string(),
                                z.object({
                                    path: z.string().min(1),
                                    project_number: z.number().nullable().optional(),
                                }).loose()
                            )
                            const parsed: unknown = JSON.parse(raw)
                            const validated = registrySchema.parse(parsed) as Record<string, ProjectRegistryEntry>
                            for (const key of Object.keys(validated)) {
                                const entry = validated[key]
                                if (entry?.path && !path.isAbsolute(entry.path)) {
                                    throw new Error(`Project registry path must be an absolute path: ${entry.path}`)
                                }
                            }
                            return validated
                        } catch (e: unknown) {
                            const errName = e instanceof Error ? e.message : String(e)
                            throw new Error(
                                `Failed to parse PROJECT_REGISTRY environment variable. Must be valid JSON and safe paths: ${errName}`,
                                { cause: e }
                            )
                        }
                    })(),
                    // Allowed IO Roots
                    allowedIoRoots: (() => {
                        const raw = options.allowedIoRoots ?? process.env['ALLOWED_IO_ROOTS']
                        if (!raw) return undefined
                        try {
                            if (raw.trim().startsWith('[')) {
                                const parsed = JSON.parse(raw) as unknown
                                if (Array.isArray(parsed) && parsed.every(p => typeof p === 'string' && path.isAbsolute(p))) {
                                    return parsed as string[]
                                }
                                throw new Error('Must be an array of absolute paths')
                            }
                            const parts = raw.split(',').map(s => s.trim()).filter(Boolean)
                            if (parts.some(p => !path.isAbsolute(p))) {
                                throw new Error('All paths must be absolute')
                            }
                            return parts
                        } catch (e: unknown) {
                            const errName = e instanceof Error ? e.message : String(e)
                            throw new Error(`Invalid ALLOWED_IO_ROOTS configuration: ${errName}`, { cause: e })
                        }
                    })(),
                    // Briefing configuration
                    briefingConfig: {
                        entryCount: parseConfigIntRequired(
                            process.env['BRIEFING_ENTRY_COUNT'] ?? options.briefingEntries,
                            'briefing-entries'
                        ),
                        summaryCount: parseConfigIntRequired(
                            process.env['BRIEFING_SUMMARY_COUNT'] ?? options.briefingSummaries,
                            'briefing-summaries'
                        ),
                        includeTeam:
                            options.briefingIncludeTeam ??
                            process.env['BRIEFING_INCLUDE_TEAM'] === 'true',
                        issueCount: parseConfigIntRequired(
                            process.env['BRIEFING_ISSUE_COUNT'] ?? options.briefingIssues,
                            'briefing-issues'
                        ),
                        prCount: parseConfigIntRequired(
                            process.env['BRIEFING_PR_COUNT'] ?? options.briefingPrs,
                            'briefing-prs'
                        ),
                        prStatusBreakdown:
                            options.briefingPrStatus ??
                            process.env['BRIEFING_PR_STATUS'] === 'true',
                        milestoneCount: parseConfigIntRequired(
                            process.env['BRIEFING_MILESTONE_COUNT'] ?? options.briefingMilestones,
                            'briefing-milestones'
                        ),
                        rulesFilePath:
                            options.rulesFile ? path.resolve(process.cwd(), options.rulesFile) : (process.env['RULES_FILE_PATH'] ? path.resolve(process.cwd(), process.env['RULES_FILE_PATH']) : undefined),
                        skillsDirPath:
                            options.skillsDir ? path.resolve(process.cwd(), options.skillsDir) : (process.env['SKILLS_DIR_PATH'] ? path.resolve(process.cwd(), process.env['SKILLS_DIR_PATH']) : undefined),
                        workflowCount: parseConfigIntRequired(
                            process.env['BRIEFING_WORKFLOW_COUNT'] ?? options.briefingWorkflows,
                            'briefing-workflows'
                        ),
                        workflowStatusBreakdown:
                            options.briefingWorkflowStatus ??
                            process.env['BRIEFING_WORKFLOW_STATUS'] === 'true',
                        copilotReviews:
                            options.briefingCopilot ??
                            process.env['BRIEFING_COPILOT_REVIEWS'] === 'true',
                        workflowSummary:
                            options.workflowSummary ??
                            process.env['MEMORY_JOURNAL_WORKFLOW_SUMMARY'] ??
                            undefined,
                        defaultProjectNumber: options.defaultProject
                            ? parseConfigIntRequired(options.defaultProject, 'default-project')
                            : process.env['DEFAULT_PROJECT_NUMBER']
                              ? parseConfigIntRequired(process.env['DEFAULT_PROJECT_NUMBER'], 'DEFAULT_PROJECT_NUMBER')
                              : undefined,
                    },
                    instructionLevel: (options.instructionLevel !== 'standard'
                        ? options.instructionLevel
                        : (process.env['INSTRUCTION_LEVEL'] ?? 'standard')) as
                        | 'essential'
                        | 'standard'
                        | 'full',
                    auditConfig,
                    flagVocabulary: (() => {
                        const raw = options.flagVocabulary ?? process.env['FLAG_VOCABULARY']
                        if (!raw) return undefined
                        return raw
                            .split(',')
                            .map((s) => s.trim().toLowerCase())
                            .filter(Boolean)
                    })(),
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

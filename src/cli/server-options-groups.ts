import type { ConfigResolver } from '../utils/config-resolver.js'
import { isPlaceholderAuthToken } from '../utils/security-utils.js'
import { defaultDbPath, defaultTeamDbPath } from './default-paths.js'

export type CatchConfig = <T>(fn: () => T, fallback: T) => T

/** Canonical environment variable keys read across CLI server/admin option builders (`L5`). */
export const CANONICAL_SERVER_ENV_KEYS = [
    'MEMORY_JOURNAL_CONFIG',
    'DB_PATH',
    'TEST_DB_PATH',
    'TEAM_DB_PATH',
    'TEST_TEAM_DB_PATH',
    'DEFAULT_WORKSPACE_ID',
    'DEFAULT_PROJECT_NUMBER',
    'PROJECT_REGISTRY',
    'GITHUB_TOKEN',
    'LOG_LEVEL',
    'ALLOWED_IO_ROOTS',
    'MEMORY_JOURNAL_MCP_TOOL_FILTER',
    'TOOL_FILTER',
    'EMBEDDING_MODEL',
    'ADDITIONAL_TEAM_DBS',
    'TEAM_ADMIN',
    'TEAM_DEFAULT_ROLE',
    'MCP_AUTH_TOKEN',
    'MCP_AUTH_SCOPES',
    'CORS_ORIGIN',
    'MCP_ENABLE_HSTS',
    'OAUTH_ENABLED',
    'OAUTH_ISSUER',
    'OAUTH_AUDIENCE',
    'OAUTH_JWKS_URI',
    'OAUTH_CLOCK_TOLERANCE',
    'OAUTH_ALLOW_PLAINTEXT_LOOPBACK',
    'TRUST_PROXY',
    'PUBLIC_ORIGIN',
    'CODE_MODE_MAX_RESULT_SIZE',
    'CODEMODE_INTERNAL_FULL_ACCESS',
    'MAX_TOOL_INPUT_ELEMENTS',
    'MCP_AGENT_HEALING',
    'AUTO_REBUILD_INDEX',
    'MJ_METRICS_PORT',
    'METRICS_EXPORT',
    'PERSIST_METRICS',
    'METRICS_PATH',
    'AUDIT_LOG_PATH',
    'MEMORY_JOURNAL_AUDIT_LOG',
    'AUDIT_REDACT',
    'AUDIT_READS',
    'AUDIT_LOG_MAX_SIZE',
    'BRIEFING_ENTRY_COUNT',
    'BRIEFING_COMMIT_COUNT',
    'BRIEFING_SUMMARY_COUNT',
    'BRIEFING_INCLUDE_TEAM',
    'BRIEFING_ISSUE_COUNT',
    'BRIEFING_PR_COUNT',
    'BRIEFING_PR_STATUS',
    'BRIEFING_MILESTONE_COUNT',
    'BRIEFING_WORKFLOW_COUNT',
    'BRIEFING_WORKFLOW_STATUS',
    'BRIEFING_COPILOT',
    'BRIEFING_COPILOT_REVIEWS',
    'BRIEFING_GRAPH',
    'BRIEFING_INSIGHTS',
    'BRIEFING_IMPORTANCE_THRESHOLD',
    'RULES_FILE_PATH',
    'SKILLS_DIR_PATH',
    'MEMORY_JOURNAL_WORKFLOW_SUMMARY',
    'ARCHIVE_OLDER_THAN_DAYS',
    'PRUNE_OLDER_THAN_DAYS',
    'HARD_DELETE_OLDER_THAN_DAYS',
    'PRUNE_IMPORTANCE_THRESHOLD',
    'PRUNE_DRY_RUN',
    'PRUNE_EXCLUDE_TAGS',
    'INSTRUCTION_LEVEL',
    'TRANSPORT',
    'PORT',
    'MCP_HOST',
    'HOST',
    'STATELESS',
] as const

export function resolveDatabasePaths(
    resolver: ConfigResolver,
    catchConfig: CatchConfig
): { db: string | undefined; testDb: string | undefined; teamDb: string | undefined; testTeamDb: string | undefined } {
    const cliDb = catchConfig(
        () => (resolver.isCliProvided('db') ? resolver.resolve<string>('db') : undefined),
        undefined
    )
    const cliDatabase = catchConfig(
        () => (resolver.isCliProvided('database') ? resolver.resolve<string>('database') : undefined),
        undefined
    )
    const envDb = process.env['DB_PATH'] !== undefined && process.env['DB_PATH'] !== '' ? process.env['DB_PATH'] : undefined
    const hasExplicitDb = cliDb !== undefined || cliDatabase !== undefined || envDb !== undefined
    const configDbPath = catchConfig(() => resolver.resolve<string>('dbPath'), undefined)
    const fallbackDatabase = catchConfig(() => resolver.resolve<string>('database'), undefined)
    const rawDb = catchConfig(() => resolver.resolve<string>('db', 'DB_PATH'), defaultDbPath)
    let db = cliDb ?? cliDatabase ?? rawDb
    if (!hasExplicitDb && (db === defaultDbPath || db === undefined) && fallbackDatabase) {
        db = fallbackDatabase
    } else if (!hasExplicitDb && (db === defaultDbPath || db === undefined) && configDbPath) {
        db = configDbPath
    }

    const configTestDbPath = catchConfig(() => resolver.resolve<string>('testDbPath'), undefined)
    const rawTestDb = catchConfig(() => resolver.resolve<string>('testDb', 'TEST_DB_PATH'), undefined)
    const testDb = rawTestDb ?? configTestDbPath

    const cliTeamDb = catchConfig(
        () => (resolver.isCliProvided('teamDb') ? resolver.resolve<string>('teamDb') : undefined),
        undefined
    )
    const cliTeamDatabase = catchConfig(
        () => (resolver.isCliProvided('teamDatabase') ? resolver.resolve<string>('teamDatabase') : undefined),
        undefined
    )
    const envTeamDb =
        process.env['TEAM_DB_PATH'] !== undefined && process.env['TEAM_DB_PATH'] !== ''
            ? process.env['TEAM_DB_PATH']
            : undefined
    const hasExplicitTeamDb =
        cliTeamDb !== undefined || cliTeamDatabase !== undefined || envTeamDb !== undefined
    const configTeamDbPath = catchConfig(() => resolver.resolve<string>('teamDbPath'), undefined)
    const fallbackTeamDatabase = catchConfig(() => resolver.resolve<string>('teamDatabase'), undefined)
    const rawTeamDb = catchConfig(() => resolver.resolve<string>('teamDb', 'TEAM_DB_PATH'), defaultTeamDbPath)
    let teamDb = cliTeamDb ?? cliTeamDatabase ?? rawTeamDb
    if (!hasExplicitTeamDb && (teamDb === defaultTeamDbPath || teamDb === undefined) && fallbackTeamDatabase) {
        teamDb = fallbackTeamDatabase
    } else if (!hasExplicitTeamDb && (teamDb === defaultTeamDbPath || teamDb === undefined) && configTeamDbPath) {
        teamDb = configTeamDbPath
    }

    const configTestTeamDbPath = catchConfig(() => resolver.resolve<string>('testTeamDbPath'), undefined)
    const rawTestTeamDb = catchConfig(() => resolver.resolve<string>('testTeamDb', 'TEST_TEAM_DB_PATH'), undefined)
    const testTeamDb = rawTestTeamDb ?? configTestTeamDbPath

    return { db, testDb, teamDb, testTeamDb }
}

/**
 * Resolves `authToken` while preserving whitespace-only `MCP_AUTH_TOKEN` values
 * and rejecting explicit empty CLI `--auth-token ""` so downstream HTTP/metrics
 * startup checks fail closed rather than falling back to unauthenticated mode.
 */
export function resolveAuthTokenOption(resolver: ConfigResolver): string | undefined {
    if (resolver.isCliProvided('authToken')) {
        const cliVal = resolver.resolve<string>('authToken')
        if (cliVal !== undefined) {
            if (cliVal.trim() === '') {
                throw new Error('FATAL: Authentication token cannot be empty or whitespace-only.')
            }
            if (isPlaceholderAuthToken(cliVal)) {
                throw new Error(
                    'FATAL: Default or placeholder authentication token detected. Please configure a secure token.'
                )
            }
            return cliVal
        }
    }
    const rawEnv = process.env['MCP_AUTH_TOKEN']
    if (rawEnv !== undefined && rawEnv !== '') {
        if (rawEnv.trim() === '') {
            throw new Error('FATAL: Authentication token cannot be whitespace-only.')
        }
        if (isPlaceholderAuthToken(rawEnv)) {
            throw new Error(
                'FATAL: Default or placeholder MCP_AUTH_TOKEN detected. Please configure a secure token.'
            )
        }
        return rawEnv
    }
    const cfgVal = resolver.resolve<string>('authToken')
    if (typeof cfgVal === 'string' && cfgVal !== '') {
        if (cfgVal.trim() === '') {
            throw new Error('FATAL: Authentication token cannot be whitespace-only.')
        }
        if (isPlaceholderAuthToken(cfgVal)) {
            throw new Error(
                'FATAL: Default or placeholder authentication token detected in config. Please configure a secure token.'
            )
        }
        return cfgVal
    }
    return undefined
}

export function buildOAuthOptionsGroup(resolver: ConfigResolver, catchConfig: CatchConfig): {
    corsOrigins: string[] | undefined
    enableHSTS: boolean
    authToken: string | undefined
    oauthEnabled: boolean
    oauthIssuer: string | undefined
    oauthAudience: string | undefined
    oauthJwksUri: string | undefined
    oauthClockTolerance: number
    allowPlaintextLoopbackOAuth: boolean
    trustProxy: boolean
    publicOrigin: string | undefined
} {
    return {
        corsOrigins: catchConfig(() => resolver.resolveStringArray('corsOrigin', 'CORS_ORIGIN'), undefined),
        enableHSTS: catchConfig(() => resolver.resolveBool('enableHsts', 'MCP_ENABLE_HSTS') ?? false, false),
        authToken: catchConfig(() => resolveAuthTokenOption(resolver), undefined),
        oauthEnabled: catchConfig(() => resolver.resolveBool('oauthEnabled', 'OAUTH_ENABLED') ?? false, false),
        oauthIssuer: catchConfig(() => resolver.resolve<string>('oauthIssuer', 'OAUTH_ISSUER'), undefined),
        oauthAudience: catchConfig(() => resolver.resolve<string>('oauthAudience', 'OAUTH_AUDIENCE'), undefined),
        oauthJwksUri: catchConfig(() => resolver.resolve<string>('oauthJwksUri', 'OAUTH_JWKS_URI'), undefined),
        oauthClockTolerance: catchConfig(() => resolver.resolveInt('oauthClockTolerance', 'OAUTH_CLOCK_TOLERANCE', 0) ?? 60, 60),
        allowPlaintextLoopbackOAuth: catchConfig(() => resolver.resolveBool('oauthAllowPlaintextLoopback', 'OAUTH_ALLOW_PLAINTEXT_LOOPBACK') ?? false, false),
        trustProxy: catchConfig(() => resolver.resolveBool('trustProxy', 'TRUST_PROXY') ?? false, false),
        publicOrigin: catchConfig(() => resolver.resolve<string>('publicOrigin', 'PUBLIC_ORIGIN'), undefined),
    }
}

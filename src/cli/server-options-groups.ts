import type { ConfigResolver } from '../utils/config-resolver.js'
import { defaultDbPath, defaultTeamDbPath } from './option-groups.js'

export type CatchConfig = <T>(fn: () => T, fallback: T) => T

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
            return cliVal
        }
    }
    const rawEnv = process.env['MCP_AUTH_TOKEN']
    if (rawEnv !== undefined && rawEnv !== '') {
        if (rawEnv.trim() === '') {
            throw new Error('FATAL: Authentication token cannot be whitespace-only.')
        }
        return rawEnv
    }
    const cfgVal = resolver.resolve<string>('authToken')
    if (typeof cfgVal === 'string' && cfgVal !== '' && cfgVal.trim() === '') {
        throw new Error('FATAL: Authentication token cannot be whitespace-only.')
    }
    return cfgVal !== '' ? cfgVal : undefined
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

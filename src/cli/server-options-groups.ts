import { z } from 'zod'
import type { BriefingConfig } from '../handlers/resources/shared.js'
import type { ServerOptions } from '../server/mcp-server/types.js'
import type {
    BriefingConfigurableKey,
    ConfigCliEnvBaseline,
} from '../utils/config-manager-helpers.js'
import type { CliCommandLike, ConfigResolver } from '../utils/config-resolver.js'
import { isPlaceholderAuthToken } from '../utils/security-utils.js'
import { defaultDbPath, defaultTeamDbPath } from './default-paths.js'
import { parseImportanceThresholdOption } from './server-options-parsers.js'

export type CatchConfig = <T>(fn: () => T, fallback: T) => T

const teamDefaultRoleSchema = z.enum(['admin', 'member', 'viewer', 'denied'])
export type TeamDefaultRole = z.infer<typeof teamDefaultRoleSchema>

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

function resolveValidatedDatabaseKey(
    resolver: ConfigResolver,
    catchConfig: CatchConfig,
    cliKey: string,
    envKey?: string,
    fallback?: string
): string | undefined {
    const label = resolver.isCliProvided(cliKey)
        ? `--${cliKey.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
        : cliKey
    return catchConfig(() => {
        const val = resolver.resolve<unknown>(cliKey, envKey)
        if (val === undefined) return fallback
        if (typeof val !== 'string') {
            throw new Error(`Invalid ${label}: expected string path, got ${typeof val}.`)
        }
        const trimmed = val.trim()
        if (trimmed === '') {
            throw new Error(`Invalid blank ${label} database path.`)
        }
        return trimmed
    }, fallback)
}

function resolvePrimaryDatabasePath(
    resolver: ConfigResolver,
    catchConfig: CatchConfig,
    primaryKey: string,
    aliasKey: string,
    envKey: string,
    configPathKey: string,
    defaultPath: string | undefined
): string | undefined {
    const hasCliPrimary = resolver.isCliProvided(primaryKey)
    const cliPrimary = hasCliPrimary ? resolveValidatedDatabaseKey(resolver, catchConfig, primaryKey) : undefined
    const hasCliAlias = resolver.isCliProvided(aliasKey)
    const cliAlias = hasCliAlias ? resolveValidatedDatabaseKey(resolver, catchConfig, aliasKey) : undefined
    const rawEnv = process.env[envKey]?.trim()
    const hasExplicit = hasCliPrimary || hasCliAlias || (rawEnv !== undefined && rawEnv !== '')
    const configPath = resolveValidatedDatabaseKey(resolver, catchConfig, configPathKey)
    const fallbackAlias = hasCliAlias ? undefined : resolveValidatedDatabaseKey(resolver, catchConfig, aliasKey)
    const rawPrimary = hasCliPrimary
        ? defaultPath
        : defaultPath !== undefined
          ? resolveValidatedDatabaseKey(resolver, catchConfig, primaryKey, envKey, defaultPath)
          : resolveValidatedDatabaseKey(resolver, catchConfig, primaryKey, envKey)
    const resolved = cliPrimary ?? cliAlias ?? rawPrimary
    if (!hasExplicit && (resolved === defaultPath || resolved === undefined) && fallbackAlias) {
        return fallbackAlias
    }
    if (!hasExplicit && (resolved === defaultPath || resolved === undefined) && configPath) {
        return configPath
    }
    return resolved
}

function resolveOptionalDatabasePath(
    resolver: ConfigResolver,
    catchConfig: CatchConfig,
    cliKey: string,
    envKey: string,
    configPathKey: string
): string | undefined {
    const hasCli = resolver.isCliProvided(cliKey)
    const cliVal = hasCli ? resolveValidatedDatabaseKey(resolver, catchConfig, cliKey) : undefined
    const configPath = resolveValidatedDatabaseKey(resolver, catchConfig, configPathKey)
    const raw = hasCli ? undefined : resolveValidatedDatabaseKey(resolver, catchConfig, cliKey, envKey)
    return cliVal ?? raw ?? configPath
}

export function resolveDatabasePaths(
    resolver: ConfigResolver,
    catchConfig: CatchConfig
): { db: string | undefined; testDb: string | undefined; teamDb: string | undefined; testTeamDb: string | undefined } {
    return {
        db: resolvePrimaryDatabasePath(resolver, catchConfig, 'db', 'database', 'DB_PATH', 'dbPath', defaultDbPath),
        testDb: resolveOptionalDatabasePath(resolver, catchConfig, 'testDb', 'TEST_DB_PATH', 'testDbPath'),
        teamDb: resolvePrimaryDatabasePath(resolver, catchConfig, 'teamDb', 'teamDatabase', 'TEAM_DB_PATH', 'teamDbPath', defaultTeamDbPath),
        testTeamDb: resolveOptionalDatabasePath(resolver, catchConfig, 'testTeamDb', 'TEST_TEAM_DB_PATH', 'testTeamDbPath'),
    }
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

const BRIEFING_CLI_ENV_SOURCES: readonly {
    target: BriefingConfigurableKey
    cliKeys: readonly string[]
    envKeys: readonly string[]
}[] = [
    { target: 'commitCount', cliKeys: ['briefingCommits'], envKeys: ['BRIEFING_COMMIT_COUNT'] },
    { target: 'entryCount', cliKeys: ['briefingEntries'], envKeys: ['BRIEFING_ENTRY_COUNT'] },
    { target: 'summaryCount', cliKeys: ['briefingSummaries'], envKeys: ['BRIEFING_SUMMARY_COUNT'] },
    { target: 'includeTeam', cliKeys: ['briefingIncludeTeam'], envKeys: ['BRIEFING_INCLUDE_TEAM'] },
    { target: 'issueCount', cliKeys: ['briefingIssues'], envKeys: ['BRIEFING_ISSUE_COUNT'] },
    { target: 'prCount', cliKeys: ['briefingPrs', 'briefingPrCount'], envKeys: ['BRIEFING_PR_COUNT'] },
    { target: 'prStatusBreakdown', cliKeys: ['briefingPrStatus'], envKeys: ['BRIEFING_PR_STATUS'] },
    { target: 'milestoneCount', cliKeys: ['briefingMilestones'], envKeys: ['BRIEFING_MILESTONE_COUNT'] },
    { target: 'workflowCount', cliKeys: ['briefingWorkflows'], envKeys: ['BRIEFING_WORKFLOW_COUNT'] },
    { target: 'workflowStatusBreakdown', cliKeys: ['briefingWorkflowStatus'], envKeys: ['BRIEFING_WORKFLOW_STATUS'] },
    { target: 'copilotReviews', cliKeys: ['briefingCopilot'], envKeys: ['BRIEFING_COPILOT_REVIEWS', 'BRIEFING_COPILOT'] },
    { target: 'briefingImportanceThreshold', cliKeys: ['briefingImportanceThreshold'], envKeys: ['BRIEFING_IMPORTANCE_THRESHOLD'] },
    { target: 'graphPivots', cliKeys: ['briefingGraph'], envKeys: ['BRIEFING_GRAPH'] },
    { target: 'insights', cliKeys: ['briefingInsights'], envKeys: ['BRIEFING_INSIGHTS'] },
]

export function collectCliEnvBriefingOverrides(
    resolver: ConfigResolver,
    briefingConfig: BriefingConfig
): Partial<Record<BriefingConfigurableKey, number | boolean>> | undefined {
    const overrides: Partial<Record<BriefingConfigurableKey, number | boolean>> = {}
    let hasAny = false
    for (const { target, cliKeys, envKeys } of BRIEFING_CLI_ENV_SOURCES) {
        const fromCli = cliKeys.some((k) => resolver.isCliProvided(k))
        const fromEnv = envKeys.some((k) => {
            const raw = process.env[k]
            return raw !== undefined && raw.trim() !== ''
        })
        if (!fromCli && !fromEnv) continue
        const val = briefingConfig[target]
        if (typeof val === 'number' || typeof val === 'boolean') {
            overrides[target] = val
            hasAny = true
        }
    }
    return hasAny ? overrides : undefined
}

export function resolveInstructionLevelOption(
    resolver: ConfigResolver,
    catchConfig: CatchConfig
): 'essential' | 'detailed' | 'full' | undefined {
    return catchConfig((): 'essential' | 'detailed' | 'full' | undefined => {
        const raw = resolver.resolve<unknown>('instructionLevel', 'INSTRUCTION_LEVEL')
        if (raw === undefined || raw === null) return undefined
        if (typeof raw !== 'string') {
            throw new Error(`Invalid --instruction-level: expected string, got ${typeof raw}. Use essential, detailed, or full.`)
        }
        const trimmed = raw.trim()
        if (trimmed === '') {
            throw new Error('Invalid blank --instruction-level. Use essential, detailed, or full.')
        }
        if (trimmed === 'essential' || trimmed === 'detailed' || trimmed === 'full') return trimmed
        throw new Error(`Invalid --instruction-level '${raw}'. Use essential, detailed, or full.`)
    }, undefined)
}

export function resolveTeamDefaultRoleOption(
    resolver: ConfigResolver,
    catchConfig: CatchConfig
): TeamDefaultRole {
    return catchConfig((): TeamDefaultRole => {
        const raw = resolver.resolve<string>('teamDefaultRole', 'TEAM_DEFAULT_ROLE') ?? 'denied'
        const parsed = teamDefaultRoleSchema.safeParse(raw)
        if (!parsed.success) {
            throw new Error(`Invalid team default role '${raw}'. Use admin, member, viewer, or denied.`)
        }
        return parsed.data
    }, 'denied')
}

export function resolvePruneImportanceThresholdOption(
    resolver: ConfigResolver,
    catchConfig: CatchConfig
): number {
    return catchConfig(
        () =>
            parseImportanceThresholdOption(
                resolver.resolve<unknown>('pruneImportanceThreshold', 'PRUNE_IMPORTANCE_THRESHOLD'),
                'pruneImportanceThreshold',
                0.15
            ),
        0.15
    )
}

export function resolveMetricsExportOption(
    resolver: ConfigResolver,
    catchConfig: CatchConfig
): 'prometheus' | undefined {
    return catchConfig<'prometheus' | undefined>(() => {
        const raw = resolver.resolve<string>('metricsExport', 'METRICS_EXPORT')
        if (raw) {
            if (raw !== 'prometheus') throw new Error(`Unsupported metrics export format: ${raw}`)
            return 'prometheus'
        }
        return undefined
    }, undefined)
}

export function resolveMaxToolInputElementsOption(
    resolver: ConfigResolver,
    catchConfig: CatchConfig
): number | undefined {
    return catchConfig(() => {
        const raw = resolver.resolve<unknown>('maxToolInputElements', 'MAX_TOOL_INPUT_ELEMENTS')
        if (raw === undefined || raw === null) return undefined
        if (raw === Infinity || (typeof raw === 'string' && raw.trim().toLowerCase() === 'infinity')) {
            return Infinity
        }
        return resolver.resolveInt('maxToolInputElements', 'MAX_TOOL_INPUT_ELEMENTS', 0)
    }, undefined)
}

export function buildLifecycleOptionsGroup(resolver: ConfigResolver, catchConfig: CatchConfig): {
    archiveOlderThanDays: number
    pruneOlderThanDays: number
    hardDeleteOlderThanDays: number
    pruneImportanceThreshold: number
    pruneDryRun: boolean
    pruneExcludeTags: string[] | undefined
    metricsExport: ServerOptions['metricsExport']
    persistMetrics: boolean
    metricsPath: string | undefined
    metricsPort: number | undefined
} {
    return {
        archiveOlderThanDays: catchConfig(() => resolver.resolveNumber('archiveOlderThanDays', 'ARCHIVE_OLDER_THAN_DAYS', 0) ?? 0, 0),
        pruneOlderThanDays: catchConfig(() => resolver.resolveNumber('pruneOlderThanDays', 'PRUNE_OLDER_THAN_DAYS', 0) ?? 0, 0),
        hardDeleteOlderThanDays: catchConfig(() => resolver.resolveNumber('hardDeleteOlderThanDays', 'HARD_DELETE_OLDER_THAN_DAYS', 0) ?? 0, 0),
        pruneImportanceThreshold: resolvePruneImportanceThresholdOption(resolver, catchConfig),
        pruneDryRun: catchConfig(() => resolver.resolveBool('pruneDryRun', 'PRUNE_DRY_RUN') ?? false, false),
        pruneExcludeTags: catchConfig(() => resolver.resolveStringArray('pruneExcludeTags', 'PRUNE_EXCLUDE_TAGS'), undefined),
        metricsExport: resolveMetricsExportOption(resolver, catchConfig),
        persistMetrics: catchConfig(() => resolver.resolveBool('persistMetrics', 'PERSIST_METRICS') ?? false, false),
        metricsPath: catchConfig(() => resolver.resolve<string>('metricsPath', 'METRICS_PATH'), undefined),
        metricsPort: catchConfig(() => resolver.resolveInt('metricsPort', 'MJ_METRICS_PORT', 0, 65535), undefined),
    }
}

export function collectCliEnvServerBaseline(
    resolver: ConfigResolver,
    command: CliCommandLike,
    resolved: {
        toolFilter: string | undefined
        defaultWorkspaceId: string | undefined
        defaultProjectNumber: number | undefined
        projectRegistry: ServerOptions['projectRegistry']
        briefingOverrides: Partial<Record<BriefingConfigurableKey, number | boolean>> | undefined
    }
): ConfigCliEnvBaseline {
    const commandName = command.name()
    const allowWorkspaceAsDefault = commandName === 'serve' || commandName === 'memory-journal-mcp'
    const hasNonBlankEnv = (key: string): boolean => {
        const v = process.env[key]
        return v !== undefined && v.trim() !== ''
    }
    const toolFilterFromCliOrEnv =
        resolver.isCliProvided('toolFilter') || hasNonBlankEnv('MEMORY_JOURNAL_MCP_TOOL_FILTER')
    const wsFromCliOrEnv =
        resolver.isCliProvided('defaultWorkspaceId') ||
        (allowWorkspaceAsDefault && resolver.isCliProvided('workspace')) ||
        hasNonBlankEnv('DEFAULT_WORKSPACE_ID')
    const projFromCliOrEnv =
        resolver.isCliProvided('defaultProject') ||
        resolver.isCliProvided('defaultProjectNumber') ||
        hasNonBlankEnv('DEFAULT_PROJECT_NUMBER')
    const regFromCliOrEnv =
        resolver.isCliProvided('projectRegistry') || hasNonBlankEnv('PROJECT_REGISTRY')
    return {
        ...(toolFilterFromCliOrEnv && resolved.toolFilter !== undefined
            ? { rawToolFilter: resolved.toolFilter }
            : {}),
        ...(wsFromCliOrEnv && resolved.defaultWorkspaceId !== undefined
            ? { defaultWorkspaceId: resolved.defaultWorkspaceId }
            : {}),
        ...(projFromCliOrEnv && resolved.defaultProjectNumber !== undefined
            ? { defaultProjectNumber: resolved.defaultProjectNumber }
            : {}),
        ...(regFromCliOrEnv && resolved.projectRegistry !== undefined
            ? { projectRegistry: resolved.projectRegistry }
            : {}),
        ...(resolved.briefingOverrides !== undefined
            ? { briefingOverrides: resolved.briefingOverrides }
            : {}),
    }
}

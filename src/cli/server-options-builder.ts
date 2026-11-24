import * as path from 'node:path'
import type { AuditConfig } from '../audit/index.js'
import type { CliCommandLike, ConfigResolver } from '../utils/config-resolver.js'
import { defaultDbPath } from './default-paths.js'
import { activeProjectRegistry, pairStoredScope } from '../utils/write-scope.js'
import { isForbiddenProjectKey } from '../utils/project-registry-guards.js'
import { logger } from '../utils/logger.js'
import { parsePositiveProjectNumber } from '../utils/safe-positive-int.js'
import { parseByteSizeValue } from '../codemode/shared-context-parsers.js'
import type { ServerOptions } from '../server/mcp-server/types.js'
import {
    assertAdditionalTeamDbIsNotSymlink,
    parseAdditionalTeamDbsOption,
    parseAllowedIoRootsOption,
    parseImportanceThresholdOption,
    parseLogLevelOption,
    resolveUnconflictedDefaultProject,
    resolveUnconflictedDefaultWorkspace,
    resolveTransportOption,
    validateProjectRegistryObject,
} from './server-options-parsers.js'

import {
    buildLifecycleOptionsGroup,
    buildOAuthOptionsGroup,
    collectCliEnvBriefingOverrides,
    collectCliEnvServerBaseline,
    resolveDatabasePaths,
    resolveInstructionLevelOption,
    resolveMaxToolInputElementsOption,
    resolveTeamDefaultRoleOption,
    type CatchConfig,
} from './server-options-groups.js'

export { assertAdditionalTeamDbIsNotSymlink }

function resolveDefaultProjectNumberOption(
    resolver: ConfigResolver,
    catchConfig: CatchConfig
): number | undefined {
    const rejectBlank =
        resolver.isCliProvided('defaultProject') ||
        ((resolver.hasConfigFileKey('defaultProject') ||
            resolver.hasConfigFileKey('defaultProjectNumber')) &&
            (process.env['DEFAULT_PROJECT_NUMBER']?.trim() ?? '') === '')
    return catchConfig(() => {
        const configVal = resolver.resolveStringOrNumber('defaultProjectNumber')
        const raw =
            resolver.resolveStringOrNumber('defaultProject', 'DEFAULT_PROJECT_NUMBER') ?? configVal
        if (raw === undefined || raw === null) return undefined
        const str = String(raw).trim()
        if (str === '') {
            if (rejectBlank) throw new Error('Invalid blank --default-project / defaultProjectNumber.')
            return undefined
        }
        const parsed = parsePositiveProjectNumber(str.replace(/^p/i, ''))
        if (parsed === undefined || !/^p?[1-9]\d*$/i.test(str)) {
            throw new Error(
                `Invalid defaultProjectNumber '${str}'. Expected a positive integer.`
            )
        }
        return parsed
    }, undefined)
}

function resolveDefaultWorkspaceIdOption(
    resolver: ConfigResolver,
    catchConfig: CatchConfig,
    allowWorkspaceAsDefault: boolean
): string | undefined {
    return catchConfig(() => {
        if (allowWorkspaceAsDefault) {
            const ws = resolver.resolve('workspace')
            if (ws !== undefined && ws !== null && typeof ws !== 'string') {
                throw new Error(`Invalid workspace: expected string, got ${typeof ws}.`)
            }
            const trimmedWs = typeof ws === 'string' ? ws.trim() : undefined
            if (trimmedWs === '' && resolver.isCliProvided('workspace')) {
                throw new Error("Invalid workspace '': cannot be empty or whitespace.")
            }
            if (trimmedWs === '*') {
                throw new Error("Invalid workspace '*': default workspace cannot be a wildcard.")
            }
            if (trimmedWs !== undefined && trimmedWs !== '') return trimmedWs
        }
        const defWs = resolver.resolve('defaultWorkspaceId', 'DEFAULT_WORKSPACE_ID')
        if (defWs !== undefined && defWs !== null && typeof defWs !== 'string') {
            throw new Error(`Invalid defaultWorkspaceId: expected string, got ${typeof defWs}.`)
        }
        const trimmedDefWs = typeof defWs === 'string' ? defWs.trim() : undefined
        if (
            trimmedDefWs === '' &&
            (resolver.isCliProvided('defaultWorkspaceId') || resolver.hasConfigFileKey('defaultWorkspaceId'))
        ) {
            throw new Error("Invalid defaultWorkspaceId '': cannot be empty or whitespace.")
        }
        if (
            trimmedDefWs === '*' ||
            (trimmedDefWs !== undefined && trimmedDefWs !== '' && isForbiddenProjectKey(trimmedDefWs))
        ) {
            throw new Error(
                `Invalid defaultWorkspaceId '${trimmedDefWs}': cannot be '*' or a reserved key.`
            )
        }
        return trimmedDefWs !== undefined && trimmedDefWs !== '' ? trimmedDefWs : undefined
    }, undefined)
}

function resolveOptionalPathOption(
    resolver: ConfigResolver,
    cliKey: string,
    envKey: string
): string | undefined {
    const val = resolver.resolve(cliKey, envKey)
    if (val === undefined || val === null) return undefined
    if (typeof val !== 'string') {
        throw new Error(`Invalid ${cliKey}: expected string, got ${typeof val}`)
    }
    const trimmed = val.trim()
    if (trimmed === '') {
        if (resolver.isCliProvided(cliKey) || resolver.hasConfigFileKey(cliKey)) {
            throw new Error(`Invalid blank ${cliKey} path.`)
        }
        return undefined
    }
    return path.resolve(process.cwd(), trimmed)
}

/**
 * [INTENT] `briefingCopilot` historically read `BRIEFING_COPILOT_REVIEWS`; accept the key-aligned
 * `BRIEFING_COPILOT` too. The legacy name wins when both are non-blank (no behavior change).
 */
function resolveCopilotEnvKey(): string {
    const legacy = process.env['BRIEFING_COPILOT_REVIEWS']
    if (legacy !== undefined && legacy.trim() !== '') return 'BRIEFING_COPILOT_REVIEWS'
    const aligned = process.env['BRIEFING_COPILOT']
    return aligned !== undefined && aligned.trim() !== '' ? 'BRIEFING_COPILOT' : 'BRIEFING_COPILOT_REVIEWS'
}

const MAX_BRIEFING_COUNT = 100

function resolveBriefingPrCount(resolver: ConfigResolver): number {
    // [INVARIANT] Primary `briefingPrs` beats legacy `briefingPrCount` on CLI and config file.
    if (resolver.isCliProvided('briefingPrs')) {
        return resolver.resolveInt('briefingPrs', undefined, 0, MAX_BRIEFING_COUNT) ?? 0
    }
    if (resolver.isCliProvided('briefingPrCount')) {
        return resolver.resolveInt('briefingPrCount', undefined, 0, MAX_BRIEFING_COUNT) ?? 0
    }
    const envVal = process.env['BRIEFING_PR_COUNT']
    if (envVal !== undefined && envVal.trim() !== '') {
        return resolver.resolveInt('briefingPrCount', 'BRIEFING_PR_COUNT', 0, MAX_BRIEFING_COUNT) ?? 0
    }
    if (resolver.hasConfigFileKey('briefingPrs')) {
        return resolver.resolveInt('briefingPrs', undefined, 0, MAX_BRIEFING_COUNT) ?? 0
    }
    return (
        resolver.resolveInt('briefingPrCount', undefined, 0, MAX_BRIEFING_COUNT) ??
        resolver.resolveInt('briefingPrs', 'BRIEFING_PR_COUNT', 0, MAX_BRIEFING_COUNT) ??
        0
    )
}

function buildBriefingConfigOptions(
    resolver: ConfigResolver,
    catchConfig: CatchConfig,
    defaultProjectNumber: number | undefined,
    defaultWorkspaceId: string | undefined,
    projectRegistry: ServerOptions['projectRegistry']
): NonNullable<ServerOptions['briefingConfig']> {
    const rejectBlankThreshold =
        resolver.isCliProvided('briefingImportanceThreshold') ||
        resolver.hasConfigFileKey('briefingImportanceThreshold')
    return {
        commitCount: catchConfig(() => resolver.resolveInt('briefingCommits', 'BRIEFING_COMMIT_COUNT', 0, MAX_BRIEFING_COUNT) ?? 3, 3),
        entryCount: catchConfig(() => resolver.resolveInt('briefingEntries', 'BRIEFING_ENTRY_COUNT', 0, MAX_BRIEFING_COUNT) ?? 3, 3),
        summaryCount: catchConfig(() => resolver.resolveInt('briefingSummaries', 'BRIEFING_SUMMARY_COUNT', 0, MAX_BRIEFING_COUNT) ?? 1, 1),
        includeTeam: catchConfig(() => resolver.resolveBool('briefingIncludeTeam', 'BRIEFING_INCLUDE_TEAM') ?? false, false),
        issueCount: catchConfig(() => resolver.resolveInt('briefingIssues', 'BRIEFING_ISSUE_COUNT', 0, MAX_BRIEFING_COUNT) ?? 0, 0),
        prCount: catchConfig(() => resolveBriefingPrCount(resolver), 0),
        prStatusBreakdown: catchConfig(() => resolver.resolveBool('briefingPrStatus', 'BRIEFING_PR_STATUS') ?? false, false),
        milestoneCount: catchConfig(() => resolver.resolveInt('briefingMilestones', 'BRIEFING_MILESTONE_COUNT', 0, MAX_BRIEFING_COUNT) ?? 3, 3),
        rulesFilePath: catchConfig(() => resolveOptionalPathOption(resolver, 'rulesFile', 'RULES_FILE_PATH'), undefined),
        skillsDirPath: catchConfig(() => resolveOptionalPathOption(resolver, 'skillsDir', 'SKILLS_DIR_PATH'), undefined),
        workflowCount: catchConfig(() => resolver.resolveInt('briefingWorkflows', 'BRIEFING_WORKFLOW_COUNT', 0, MAX_BRIEFING_COUNT) ?? 0, 0),
        workflowStatusBreakdown: catchConfig(() => resolver.resolveBool('briefingWorkflowStatus', 'BRIEFING_WORKFLOW_STATUS') ?? false, false),
        copilotReviews: catchConfig(
            () => resolver.resolveBool('briefingCopilot', resolveCopilotEnvKey()) ?? false,
            false
        ),
        graphPivots: catchConfig(() => resolver.resolveBool('briefingGraph', 'BRIEFING_GRAPH') ?? true, true),
        insights: catchConfig(() => resolver.resolveBool('briefingInsights', 'BRIEFING_INSIGHTS') ?? true, true),
        workflowSummary: catchConfig(() => resolver.resolveString('workflowSummary', 'MEMORY_JOURNAL_WORKFLOW_SUMMARY'), undefined),
        defaultProjectNumber,
        defaultWorkspaceId,
        projectRegistry,
        briefingImportanceThreshold: catchConfig(
            () =>
                parseImportanceThresholdOption(
                    resolver.resolve(
                        'briefingImportanceThreshold',
                        'BRIEFING_IMPORTANCE_THRESHOLD'
                    ),
                    'briefingImportanceThreshold',
                    0.3,
                    { rejectBlank: rejectBlankThreshold }
                ),
            0.3
        ),
    }
}

function resolveEnvironmentOverrides(
    resolver: ConfigResolver,
    catchConfig: CatchConfig
): {
    envUpdates: Record<string, string>
    logLevel: ReturnType<typeof parseLogLevelOption> | undefined
} {
    const envUpdates: Record<string, string> = {}
    const rejectBlankMaxResult =
        resolver.isCliProvided('codemodeMaxResultSize') ||
        (resolver.hasConfigFileKey('codemodeMaxResultSize') &&
            (process.env['CODE_MODE_MAX_RESULT_SIZE']?.trim() ?? '') === '')
    const codemodeMaxResultSize = catchConfig(() => {
        const raw = resolver.resolveStringOrNumber(
            'codemodeMaxResultSize',
            'CODE_MODE_MAX_RESULT_SIZE'
        )
        if (raw === undefined || raw === null) return undefined
        if (typeof raw === 'string' && raw.trim() === '') {
            if (rejectBlankMaxResult) throw new Error('Invalid blank --codemode-max-result-size.')
            return undefined
        }
        const parsed = parseByteSizeValue(raw)
        if (parsed === undefined) {
            throw new Error(
                `Invalid codemodeMaxResultSize '${String(raw)}'. Expected a positive byte count or size string (e.g. '64kb', '2mb').`
            )
        }
        return Math.min(parsed, 50 * 1024 * 1024)
    }, undefined)
    if (codemodeMaxResultSize !== undefined) {
        envUpdates['CODE_MODE_MAX_RESULT_SIZE'] = String(codemodeMaxResultSize)
    }

    const metricsPort = catchConfig(
        () => resolver.resolveStringOrNumber('metricsPort', 'MJ_METRICS_PORT'),
        undefined
    )
    if (metricsPort !== undefined && String(metricsPort).trim() !== '') {
        envUpdates['MJ_METRICS_PORT'] = String(metricsPort).trim()
    }

    const rejectBlankAuthScopes =
        resolver.isCliProvided('authScopes') ||
        (resolver.hasConfigFileKey('authScopes') &&
            (process.env['MCP_AUTH_SCOPES']?.trim() ?? '') === '')
    const authScopes = catchConfig(() => {
        const val = resolver.resolveString('authScopes', 'MCP_AUTH_SCOPES')
        if (val === undefined) return undefined
        if (val.trim() === '') {
            if (rejectBlankAuthScopes) throw new Error('Invalid blank --auth-scopes.')
            return undefined
        }
        return val
    }, undefined)
    if (authScopes !== undefined) {
        envUpdates['MCP_AUTH_SCOPES'] = authScopes.trim()
    }

    const logLevel = catchConfig(
        () => parseLogLevelOption(resolver.resolve('logLevel', 'LOG_LEVEL')),
        undefined
    )
    return { envUpdates, logLevel }
}

function parseAuditLogPathOption(val: unknown): string {
    if (typeof val !== 'string') {
        throw new Error(`Invalid --audit-log: expected string path, got ${typeof val}.`)
    }
    const trimmed = val.trim()
    if (trimmed === '') {
        throw new Error('Invalid blank --audit-log path.')
    }
    return trimmed
}

function buildAuditConfigOption(resolver: ConfigResolver, catchConfig: CatchConfig): AuditConfig | undefined {
    const auditLogPath = catchConfig(
        () =>
            resolver.resolve<string>('auditLog', 'AUDIT_LOG_PATH', parseAuditLogPathOption) ??
            resolver.resolve<string>('auditLog', 'MEMORY_JOURNAL_AUDIT_LOG', parseAuditLogPathOption),
        undefined
    )
    if (!auditLogPath) return undefined
    return {
        enabled: true,
        logPath: auditLogPath,
        redact: catchConfig(() => resolver.resolveBool('auditRedact', 'AUDIT_REDACT') ?? true, true),
        auditReads: catchConfig(() => resolver.resolveBool('auditReads', 'AUDIT_READS') ?? false, false),
        maxSizeBytes: catchConfig(() => resolver.resolveInt('auditLogMaxSize', 'AUDIT_LOG_MAX_SIZE', 1024) ?? 10485760, 10485760),
    }
}

function resolveConfiguredDefaultScope(
    resolver: ConfigResolver,
    command: CliCommandLike,
    catchConfig: CatchConfig,
    projectRegistry: ServerOptions['projectRegistry']
): { defaultWorkspaceId: string | undefined; defaultProjectNumber: number | undefined } {
    const commandName = command.name()
    const allowWorkspaceAsDefault =
        commandName === 'serve' || commandName === 'memory-journal-mcp'
    let defaultProjectNumber = resolveDefaultProjectNumberOption(resolver, catchConfig)
    let defaultWorkspaceId = resolveDefaultWorkspaceIdOption(
        resolver,
        catchConfig,
        allowWorkspaceAsDefault
    )
    const wsFromCli =
        resolver.isCliProvided('defaultWorkspaceId') ||
        (allowWorkspaceAsDefault && resolver.isCliProvided('workspace'))
    const projectFromCli = resolver.isCliProvided('defaultProject')
    defaultWorkspaceId = resolveUnconflictedDefaultWorkspace(
        defaultWorkspaceId,
        defaultProjectNumber,
        projectRegistry,
        wsFromCli,
        projectFromCli
    )
    defaultProjectNumber = resolveUnconflictedDefaultProject(
        defaultWorkspaceId,
        defaultProjectNumber,
        projectRegistry,
        wsFromCli,
        projectFromCli
    )
    if (defaultWorkspaceId !== undefined && defaultProjectNumber !== undefined) {
        catchConfig(() => {
            const paired = pairStoredScope(
                defaultWorkspaceId,
                defaultProjectNumber,
                activeProjectRegistry(projectRegistry)
            )
            defaultWorkspaceId = paired.workspaceId
            if (typeof paired.projectNumber === 'number') {
                defaultProjectNumber = paired.projectNumber
            }
        }, undefined)
    }
    return { defaultWorkspaceId, defaultProjectNumber }
}

function assembleServerOptions(params: {
    resolver: ConfigResolver
    catchConfig: CatchConfig
    transport: 'stdio' | 'http'
    host: string | undefined
    db: string | undefined
    testDb: string | undefined
    teamDb: string | undefined
    testTeamDb: string | undefined
    instructionLevel: 'essential' | 'detailed' | 'full' | undefined
    projectRegistry: ServerOptions['projectRegistry']
    defaultWorkspaceId: string | undefined
    defaultProjectNumber: number | undefined
    toolFilter: string | undefined
    briefingConfig: NonNullable<ServerOptions['briefingConfig']>
    briefingOverrides: ServerOptions['briefingOverrides']
    cliEnvBaseline: NonNullable<ServerOptions['cliEnvBaseline']>
}): ServerOptions {
    const {
        resolver, catchConfig, transport, host, db, testDb, teamDb, testTeamDb,
        instructionLevel, projectRegistry, defaultWorkspaceId, defaultProjectNumber,
        toolFilter, briefingConfig, briefingOverrides, cliEnvBaseline,
    } = params
    return {
        transport,
        port: catchConfig(() => resolver.resolveInt('port', 'PORT', 1, 65535) ?? 3000, 3000),
        host,
        statelessHttp: catchConfig(() => resolver.resolveBool('stateless', 'STATELESS') ?? false, false),
        dbPath: db ?? defaultDbPath,
        testDbPath: testDb,
        teamDbPath: teamDb,
        testTeamDbPath: testTeamDb,
        teamDefaultRole: resolveTeamDefaultRoleOption(resolver, catchConfig),
        teamAdmin: catchConfig(() => resolver.resolveString('teamAdmin', 'TEAM_ADMIN'), undefined),
        toolFilter,
        defaultProjectNumber,
        defaultWorkspaceId,
        autoRebuildIndex: catchConfig(() => resolver.resolveBool('autoRebuildIndex', 'AUTO_REBUILD_INDEX') ?? false, false),
        codemodeInternalFullAccess: catchConfig(() => resolver.resolveBool('codemodeInternalFullAccess', 'CODEMODE_INTERNAL_FULL_ACCESS') ?? false, false),
        projectRegistry,
        additionalTeamDbs: catchConfig(() => parseAdditionalTeamDbsOption(resolver.resolve('additionalTeamDbs', 'ADDITIONAL_TEAM_DBS')), undefined),
        allowedIoRoots: catchConfig(() => parseAllowedIoRootsOption(resolver.resolve('allowedIoRoots', 'ALLOWED_IO_ROOTS')), undefined),
        briefingConfig,
        ...(briefingOverrides !== undefined ? { briefingOverrides } : {}),
        cliEnvBaseline,
        auditConfig: buildAuditConfigOption(resolver, catchConfig),
        embeddingModel: catchConfig(() => resolver.resolveString('embeddingModel', 'EMBEDDING_MODEL'), undefined),
        ...(instructionLevel !== undefined ? { instructionLevel } : {}),
        configFilePath: catchConfig(() => resolver.loadedConfigPath, undefined),
        maxToolInputElements: resolveMaxToolInputElementsOption(resolver, catchConfig),
        agentHealing: catchConfig(() => resolver.resolveBool('agentHealing', 'MCP_AGENT_HEALING') ?? true, true),
        ...buildOAuthOptionsGroup(resolver, catchConfig),
        ...buildLifecycleOptionsGroup(resolver, catchConfig),
    }
}

function resolveServerHostOption(resolver: ConfigResolver, catchConfig: CatchConfig): string | undefined {
    return catchConfig(() => {
        if (resolver.isCliProvided('serverHost')) {
            const explicitHost = resolver.resolveString('serverHost')
            if (explicitHost !== undefined) {
                const trimmed = explicitHost.trim()
                if (trimmed === '') throw new Error('Invalid blank --server-host.')
                return trimmed
            }
        }
        const rawMcpHost = process.env['MCP_HOST']
        if (rawMcpHost !== undefined && rawMcpHost.trim() !== '') {
            return rawMcpHost.trim()
        }
        const rawHostEnv = process.env['HOST']
        if (rawHostEnv !== undefined && rawHostEnv.trim() !== '') {
            return rawHostEnv.trim()
        }
        if (resolver.hasConfigFileKey('serverHost')) {
            const configHost = resolver.resolveString('serverHost')
            if (configHost !== undefined) {
                const trimmed = configHost.trim()
                if (trimmed === '') {
                    throw new Error('Invalid blank serverHost in configuration file.')
                }
                return trimmed
            }
        }
        return undefined
    }, undefined)
}

export function buildServerOptions(
    resolver: ConfigResolver,
    options: Record<string, unknown> & { team?: boolean | undefined },
    command: CliCommandLike,
    configErrors: string[]
): {
    serverOptions: ServerOptions
    transport: string
    db: string | undefined
    teamDb?: string | undefined
    host?: string | undefined
} {
    const catchConfig: CatchConfig = <T>(fn: () => T, fallback: T): T => {
        try {
            return fn()
        } catch (e) {
            configErrors.push(e instanceof Error ? e.message : String(e))
            return fallback
        }
    }

    const host = resolveServerHostOption(resolver, catchConfig)
    const transport = resolveTransportOption(resolver, catchConfig)
    const { db, testDb, teamDb, testTeamDb } = resolveDatabasePaths(resolver, catchConfig)
    const { envUpdates, logLevel } = resolveEnvironmentOverrides(resolver, catchConfig)
    const instructionLevel = resolveInstructionLevelOption(resolver, catchConfig)
    const projectRegistry = catchConfig(() => {
        const reg = validateProjectRegistryObject(resolver.resolve('projectRegistry', 'PROJECT_REGISTRY'))
        if (reg !== undefined) envUpdates['PROJECT_REGISTRY'] = JSON.stringify(reg)
        return reg
    }, undefined)
    const { defaultWorkspaceId, defaultProjectNumber } = resolveConfiguredDefaultScope(resolver, command, catchConfig, projectRegistry)
    const toolFilter = catchConfig(() => resolver.resolveString('toolFilter', 'MEMORY_JOURNAL_MCP_TOOL_FILTER'), undefined)
    const briefingConfig = buildBriefingConfigOptions(resolver, catchConfig, defaultProjectNumber, defaultWorkspaceId, projectRegistry)
    const briefingOverrides = collectCliEnvBriefingOverrides(resolver, briefingConfig)
    const cliEnvBaseline = collectCliEnvServerBaseline(resolver, command, {
        toolFilter, defaultWorkspaceId, defaultProjectNumber, projectRegistry, briefingOverrides,
    })
    const serverOptions = assembleServerOptions({
        resolver, catchConfig, transport, host, db, testDb, teamDb, testTeamDb,
        instructionLevel, projectRegistry, defaultWorkspaceId, defaultProjectNumber,
        toolFilter, briefingConfig, briefingOverrides, cliEnvBaseline,
    })

    if (options['dumpConfig'] !== true && configErrors.length === 0) {
        for (const [envKey, envVal] of Object.entries(envUpdates)) {
            process.env[envKey] = envVal
        }
        if (logLevel !== undefined) logger.setLevel(logLevel)
    }
    return { serverOptions, transport, db, teamDb, host }
}

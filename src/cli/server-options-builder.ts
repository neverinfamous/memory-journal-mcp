import * as path from 'node:path'
import { z } from 'zod'
import type { AuditConfig } from '../audit/index.js'
import type { CliCommandLike, ConfigResolver } from '../utils/config-resolver.js'
import { defaultDbPath } from './default-paths.js'
import { activeProjectRegistry, pairStoredScope } from '../utils/write-scope.js'
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
    parseProjectRegistryOption,
    resolveUnconflictedDefaultProject,
    resolveUnconflictedDefaultWorkspace,
} from './server-options-parsers.js'

import {
    buildOAuthOptionsGroup,
    resolveDatabasePaths,
    type CatchConfig,
} from './server-options-groups.js'

export { assertAdditionalTeamDbIsNotSymlink }

const transportSchema = z.enum(['stdio', 'http'])
const teamDefaultRoleSchema = z.enum(['admin', 'member', 'viewer', 'denied'])
type TeamDefaultRole = z.infer<typeof teamDefaultRoleSchema>

function resolveDefaultProjectNumberOption(
    resolver: ConfigResolver,
    catchConfig: CatchConfig
): number | undefined {
    return catchConfig(() => {
        const configVal = resolver.resolve<string | number>('defaultProjectNumber')
        const raw =
            resolver.resolve<string | number>('defaultProject', 'DEFAULT_PROJECT_NUMBER') ?? configVal
        if (raw === undefined || raw === null) return undefined
        const str = String(raw).trim()
        if (str === '') return undefined
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
            const ws = resolver.resolve<string>('workspace')
            const trimmedWs = ws !== undefined ? ws.trim() : undefined
            if (trimmedWs === '*') {
                throw new Error("Invalid workspace '*': default workspace cannot be a wildcard.")
            }
            if (trimmedWs !== undefined && trimmedWs !== '') return trimmedWs
        }
        const defWs = resolver.resolve<string>('defaultWorkspaceId', 'DEFAULT_WORKSPACE_ID')
        const trimmedDefWs = defWs !== undefined ? defWs.trim() : undefined
        if (trimmedDefWs === '*') {
            throw new Error(
                "Invalid defaultWorkspaceId '*': default workspace cannot be a wildcard."
            )
        }
        return trimmedDefWs !== undefined && trimmedDefWs !== '' ? trimmedDefWs : undefined
    }, undefined)
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

function buildBriefingConfigOptions(
    resolver: ConfigResolver,
    catchConfig: CatchConfig,
    defaultProjectNumber: number | undefined,
    defaultWorkspaceId: string | undefined,
    projectRegistry: ServerOptions['projectRegistry']
): NonNullable<ServerOptions['briefingConfig']> {
    return {
        commitCount: catchConfig(() => resolver.resolveInt('briefingCommits', 'BRIEFING_COMMIT_COUNT') ?? 3, 3),
        entryCount: catchConfig(() => resolver.resolveInt('briefingEntries', 'BRIEFING_ENTRY_COUNT') ?? 3, 3),
        summaryCount: catchConfig(() => resolver.resolveInt('briefingSummaries', 'BRIEFING_SUMMARY_COUNT') ?? 1, 1),
        includeTeam: catchConfig(() => resolver.resolveBool('briefingIncludeTeam', 'BRIEFING_INCLUDE_TEAM') ?? false, false),
        issueCount: catchConfig(() => resolver.resolveInt('briefingIssues', 'BRIEFING_ISSUE_COUNT') ?? 0, 0),
        prCount: catchConfig(() => {
            if (resolver.isCliProvided('briefingPrCount')) {
                return resolver.resolveInt('briefingPrCount') ?? 0
            }
            if (resolver.isCliProvided('briefingPrs')) {
                return resolver.resolveInt('briefingPrs') ?? 0
            }
            const envVal = process.env['BRIEFING_PR_COUNT']
            if (envVal !== undefined && envVal.trim() !== '') {
                return resolver.resolveInt('briefingPrCount', 'BRIEFING_PR_COUNT') ?? 0
            }
            // [INVARIANT] Primary file key `briefingPrs` beats legacy `briefingPrCount`, matching hot-reload
            // (`readBriefingConfigEntry`). `briefingPrs` has a Commander default, so probe the file explicitly.
            if (resolver.hasConfigFileKey('briefingPrs')) {
                return resolver.resolveInt('briefingPrs') ?? 0
            }
            return (
                resolver.resolveInt('briefingPrCount') ??
                resolver.resolveInt('briefingPrs', 'BRIEFING_PR_COUNT') ??
                0
            )
        }, 0),
        prStatusBreakdown: catchConfig(() => resolver.resolveBool('briefingPrStatus', 'BRIEFING_PR_STATUS') ?? false, false),
        milestoneCount: catchConfig(() => resolver.resolveInt('briefingMilestones', 'BRIEFING_MILESTONE_COUNT') ?? 3, 3),
        rulesFilePath: catchConfig(() => {
            const val = resolver.resolve<string>('rulesFile', 'RULES_FILE_PATH')
            return val ? path.resolve(process.cwd(), val) : undefined
        }, undefined),
        skillsDirPath: catchConfig(() => {
            const val = resolver.resolve<string>('skillsDir', 'SKILLS_DIR_PATH')
            return val ? path.resolve(process.cwd(), val) : undefined
        }, undefined),
        workflowCount: catchConfig(() => resolver.resolveInt('briefingWorkflows', 'BRIEFING_WORKFLOW_COUNT') ?? 0, 0),
        workflowStatusBreakdown: catchConfig(() => resolver.resolveBool('briefingWorkflowStatus', 'BRIEFING_WORKFLOW_STATUS') ?? false, false),
        copilotReviews: catchConfig(
            () => resolver.resolveBool('briefingCopilot', resolveCopilotEnvKey()) ?? false,
            false
        ),
        graphPivots: catchConfig(() => resolver.resolveBool('briefingGraph', 'BRIEFING_GRAPH') ?? true, true),
        insights: catchConfig(() => resolver.resolveBool('briefingInsights', 'BRIEFING_INSIGHTS') ?? true, true),
        workflowSummary: catchConfig(() => resolver.resolve<string>('workflowSummary', 'MEMORY_JOURNAL_WORKFLOW_SUMMARY'), undefined),
        defaultProjectNumber,
        defaultWorkspaceId,
        projectRegistry,
        briefingImportanceThreshold: catchConfig(
            () =>
                parseImportanceThresholdOption(
                    resolver.resolve<unknown>(
                        'briefingImportanceThreshold',
                        'BRIEFING_IMPORTANCE_THRESHOLD'
                    ),
                    'briefingImportanceThreshold',
                    0.3
                ),
            0.3
        ),
    }
}

function applyEnvironmentOverrides(
    resolver: ConfigResolver,
    options: Record<string, unknown>,
    catchConfig: CatchConfig
): void {
    const codemodeMaxResultSize = catchConfig(() => {
        const raw = resolver.resolve<string | number>(
            'codemodeMaxResultSize',
            'CODE_MODE_MAX_RESULT_SIZE'
        )
        if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
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
        process.env['CODE_MODE_MAX_RESULT_SIZE'] = String(codemodeMaxResultSize)
    }

    const metricsPort = catchConfig(() => resolver.resolve<string | number>('metricsPort', 'MJ_METRICS_PORT'), undefined)
    if (metricsPort !== undefined && String(metricsPort).trim() !== '') {
        process.env['MJ_METRICS_PORT'] = String(metricsPort).trim()
    }

    const authScopes = catchConfig(() => resolver.resolve<string>('authScopes', 'MCP_AUTH_SCOPES'), undefined)
    if (authScopes !== undefined && authScopes.trim() !== '') {
        process.env['MCP_AUTH_SCOPES'] = authScopes.trim()
    }

    if (options['dumpConfig'] !== true) {
        const logLevel = catchConfig(
            () => parseLogLevelOption(resolver.resolve<string>('logLevel', 'LOG_LEVEL')),
            undefined
        )
        if (logLevel !== undefined) {
            logger.setLevel(logLevel)
        }
    }
}

function buildAuditConfigOption(resolver: ConfigResolver, catchConfig: CatchConfig): AuditConfig | undefined {
    const auditLogPath = catchConfig(() => resolver.resolve<string>('auditLog', 'AUDIT_LOG_PATH'), undefined)
    if (!auditLogPath) return undefined
    return {
        enabled: true,
        logPath: auditLogPath,
        redact: catchConfig(() => resolver.resolveBool('auditRedact', 'AUDIT_REDACT') ?? true, true),
        auditReads: catchConfig(() => resolver.resolveBool('auditReads', 'AUDIT_READS') ?? false, false),
        maxSizeBytes: catchConfig(() => resolver.resolveInt('auditLogMaxSize', 'AUDIT_LOG_MAX_SIZE', 1024) ?? 10485760, 10485760),
    }
}

function resolveTransportOption(resolver: ConfigResolver, catchConfig: CatchConfig): 'stdio' | 'http' {
    return catchConfig((): 'stdio' | 'http' => {
        if (resolver.resolveBool('http')) return 'http'
        if (resolver.resolveBool('stdio')) return 'stdio'
        const raw = resolver.resolve<string>('transport', 'TRANSPORT') ?? 'stdio'
        const parsed = transportSchema.safeParse(raw)
        if (!parsed.success) {
            throw new Error(`Invalid transport '${raw}'. Use 'stdio' or 'http'.`)
        }
        return parsed.data
    }, 'stdio')
}

function resolveInstructionLevelOption(
    resolver: ConfigResolver,
    catchConfig: CatchConfig
): 'essential' | 'detailed' | 'full' | undefined {
    return catchConfig((): 'essential' | 'detailed' | 'full' | undefined => {
        const raw = resolver.resolve<string>('instructionLevel', 'INSTRUCTION_LEVEL')
        if (raw === undefined || raw.trim() === '') return undefined
        if (raw === 'essential' || raw === 'detailed' || raw === 'full') return raw
        throw new Error(`Invalid --instruction-level '${raw}'. Use essential, detailed, or full.`)
    }, undefined)
}

function resolveTeamDefaultRoleOption(resolver: ConfigResolver, catchConfig: CatchConfig): TeamDefaultRole {
    return catchConfig((): TeamDefaultRole => {
        const raw = resolver.resolve<string>('teamDefaultRole', 'TEAM_DEFAULT_ROLE') ?? 'denied'
        const parsed = teamDefaultRoleSchema.safeParse(raw)
        if (!parsed.success) {
            throw new Error(`Invalid team default role '${raw}'. Use admin, member, viewer, or denied.`)
        }
        return parsed.data
    }, 'denied')
}

function resolvePruneImportanceThresholdOption(resolver: ConfigResolver, catchConfig: CatchConfig): number {
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

function resolveMetricsExportOption(
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

function resolveMaxToolInputElementsOption(
    resolver: ConfigResolver,
    catchConfig: CatchConfig
): number | undefined {
    return catchConfig(() => {
        const raw = resolver.resolve<unknown>('maxToolInputElements', 'MAX_TOOL_INPUT_ELEMENTS')
        if (raw === undefined || raw === null || raw === '') return undefined
        if (raw === Infinity || (typeof raw === 'string' && raw.trim().toLowerCase() === 'infinity')) {
            return Infinity
        }
        return resolver.resolveInt('maxToolInputElements', 'MAX_TOOL_INPUT_ELEMENTS', 0)
    }, undefined)
}

function buildLifecycleOptionsGroup(resolver: ConfigResolver, catchConfig: CatchConfig): {
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

export function buildServerOptions(
    resolver: ConfigResolver,
    options: Record<string, unknown> & { team?: boolean },
    command: CliCommandLike,
    configErrors: string[]
): { serverOptions: ServerOptions; transport: string; db: string | undefined; teamDb?: string; host?: string } {
    const catchConfig: CatchConfig = <T>(fn: () => T, fallback: T): T => {
        try {
            return fn()
        } catch (e) {
            configErrors.push(e instanceof Error ? e.message : String(e))
            return fallback
        }
    }

    const host = catchConfig(() => resolver.resolve<string>('serverHost', 'MCP_HOST') ?? process.env['HOST'] ?? undefined, undefined)
    const transport = resolveTransportOption(resolver, catchConfig)
    const { db, testDb, teamDb, testTeamDb } = resolveDatabasePaths(resolver, catchConfig)
    applyEnvironmentOverrides(resolver, options, catchConfig)
    const instructionLevel = resolveInstructionLevelOption(resolver, catchConfig)
    const projectRegistry = catchConfig(() => parseProjectRegistryOption(resolver.resolve<unknown>('projectRegistry', 'PROJECT_REGISTRY')), undefined)
    const { defaultWorkspaceId, defaultProjectNumber } = resolveConfiguredDefaultScope(
        resolver,
        command,
        catchConfig,
        projectRegistry
    )

    const serverOptions: ServerOptions = {
        transport,
        port: catchConfig(() => resolver.resolveInt('port', 'PORT', 1, 65535) ?? 3000, 3000),
        host,
        statelessHttp: catchConfig(() => resolver.resolveBool('stateless', 'STATELESS') ?? false, false),
        dbPath: db ?? defaultDbPath,
        testDbPath: testDb,
        teamDbPath: teamDb,
        testTeamDbPath: testTeamDb,
        teamDefaultRole: resolveTeamDefaultRoleOption(resolver, catchConfig),
        teamAdmin: catchConfig(() => resolver.resolve<string>('teamAdmin', 'TEAM_ADMIN'), undefined),
        toolFilter: catchConfig(() => resolver.resolve<string>('toolFilter', 'MEMORY_JOURNAL_MCP_TOOL_FILTER'), undefined),
        defaultProjectNumber,
        defaultWorkspaceId,
        autoRebuildIndex: catchConfig(() => resolver.resolveBool('autoRebuildIndex', 'AUTO_REBUILD_INDEX') ?? false, false),
        codemodeInternalFullAccess: catchConfig(() => resolver.resolveBool('codemodeInternalFullAccess', 'CODEMODE_INTERNAL_FULL_ACCESS') ?? false, false),
        projectRegistry,
        additionalTeamDbs: catchConfig(() => parseAdditionalTeamDbsOption(resolver.resolve<unknown>('additionalTeamDbs', 'ADDITIONAL_TEAM_DBS')), undefined),
        allowedIoRoots: catchConfig(() => parseAllowedIoRootsOption(resolver.resolve<unknown>('allowedIoRoots', 'ALLOWED_IO_ROOTS')), undefined),
        briefingConfig: buildBriefingConfigOptions(
            resolver,
            catchConfig,
            defaultProjectNumber,
            defaultWorkspaceId,
            projectRegistry
        ),
        auditConfig: buildAuditConfigOption(resolver, catchConfig),
        embeddingModel: catchConfig(() => resolver.resolve<string>('embeddingModel', 'EMBEDDING_MODEL'), undefined),
        ...(instructionLevel !== undefined ? { instructionLevel } : {}),
        configFilePath: catchConfig(() => resolver.loadedConfigPath, undefined),
        maxToolInputElements: resolveMaxToolInputElementsOption(resolver, catchConfig),
        agentHealing: catchConfig(() => resolver.resolveBool('agentHealing', 'MCP_AGENT_HEALING') ?? true, true),
        ...buildOAuthOptionsGroup(resolver, catchConfig),
        ...buildLifecycleOptionsGroup(resolver, catchConfig),
    }

    return { serverOptions, transport, db, teamDb, host }
}

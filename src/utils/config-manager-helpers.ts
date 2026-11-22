import { validateProjectRegistryObject } from '../cli/server-options-parsers.js'
import type { ToolFilterConfig } from '../filtering/tool-filter.js'
import type { BriefingConfig } from '../handlers/resources/shared.js'
import { logger } from './logger.js'
import { isForbiddenProjectKey } from './project-registry-guards.js'
import { activeProjectRegistry, pairStoredScope } from './write-scope.js'
import {
    buildFallbackCliEnvBaseline,
    buildFileCliEnvBaseline,
    collectBriefingBaselines,
    readBriefingConfigEntry,
} from './config-manager-baselines.js'

export { readBriefingConfigEntry }

export interface DynamicConfig {
    rawToolFilter: string | undefined
    toolFilterConfig: ToolFilterConfig | null
    briefingConfig: BriefingConfig
    codemodeInternalFullAccess?: boolean | undefined
}

export interface ConfigCliEnvBaseline {
    rawToolFilter?: string | undefined
    defaultProjectNumber?: number | undefined
    defaultWorkspaceId?: string | undefined
    projectRegistry?: BriefingConfig['projectRegistry'] | undefined
}

export type BriefingConfigurableKey =
    | 'commitCount'
    | 'entryCount'
    | 'summaryCount'
    | 'includeTeam'
    | 'issueCount'
    | 'prCount'
    | 'prStatusBreakdown'
    | 'milestoneCount'
    | 'workflowCount'
    | 'workflowStatusBreakdown'
    | 'copilotReviews'
    | 'briefingImportanceThreshold'
    | 'graphPivots'
    | 'insights'

export type BriefingValueKind = 'number' | 'boolean' | 'unit'

export type BriefingBaselineMap = Record<BriefingConfigurableKey, number | boolean>

/** Config-file keys that map onto `BriefingConfig` fields, with expected value type and optional aliases. */
export const BRIEFING_CONFIG_KEY_MAP: Readonly<
    Record<
        string,
        {
            target: BriefingConfigurableKey
            kind: BriefingValueKind
            aliases?: readonly string[]
        }
    >
> = {
    briefingCommits: { target: 'commitCount', kind: 'number' },
    briefingEntries: { target: 'entryCount', kind: 'number' },
    briefingSummaries: { target: 'summaryCount', kind: 'number' },
    briefingIncludeTeam: { target: 'includeTeam', kind: 'boolean' },
    briefingIssues: { target: 'issueCount', kind: 'number' },
    briefingPrs: { target: 'prCount', kind: 'number', aliases: ['briefingPrCount'] },
    briefingPrStatus: { target: 'prStatusBreakdown', kind: 'boolean' },
    briefingMilestones: { target: 'milestoneCount', kind: 'number' },
    briefingWorkflows: { target: 'workflowCount', kind: 'number' },
    briefingWorkflowStatus: { target: 'workflowStatusBreakdown', kind: 'boolean' },
    briefingCopilot: { target: 'copilotReviews', kind: 'boolean' },
    briefingImportanceThreshold: { target: 'briefingImportanceThreshold', kind: 'unit' },
    briefingGraph: { target: 'graphPivots', kind: 'boolean' },
    briefingInsights: { target: 'insights', kind: 'boolean' },
}

export interface InitialBaselinesResult {
    cliEnvBaseline: ConfigCliEnvBaseline
    toolFilterFromFile: boolean
    codemodeBaseline: boolean | undefined
    initialBriefingBaseline: BriefingBaselineMap
    briefingKeysFromFile: Set<BriefingConfigurableKey>
    codemodeFromFile: boolean
    defaultWorkspaceIdFromFile: boolean
    defaultProjectNumberFromFile: boolean
}

export interface MutatedConfigFields {
    rawToolFilter?: boolean
    codemodeInternalFullAccess?: boolean
    defaultWorkspaceId?: boolean
    defaultProjectNumber?: boolean
    briefingKeys?: readonly BriefingConfigurableKey[]
}

export interface UpdateConfigOptions {
    mutatedFields?: MutatedConfigFields
}

export function isValidBriefingConfigValue(
    value: unknown,
    kind: BriefingValueKind
): boolean {
    if (kind === 'boolean') return typeof value === 'boolean'
    if (kind === 'unit') {
        return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    }
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Seed omitted scope fields (`defaultWorkspaceId`, `defaultProjectNumber`, `projectRegistry`)
 * on `initialConfig.briefingConfig` from the startup config file when present and compatible.
 */
export function seedInitialBriefingScopeFromFile(
    initialConfig: DynamicConfig,
    initialFile: Record<string, unknown> | null
): DynamicConfig {
    if (initialFile === null) return initialConfig
    const bc = { ...initialConfig.briefingConfig }
    let changed = false

    if (
        bc.projectRegistry === undefined &&
        'projectRegistry' in initialFile &&
        initialFile['projectRegistry'] !== undefined &&
        initialFile['projectRegistry'] !== null
    ) {
        try {
            const validated = validateProjectRegistryObject(initialFile['projectRegistry'])
            if (validated !== undefined) {
                bc.projectRegistry = validated
                changed = true
            }
        } catch (err: unknown) {
            logger.warning('Ignoring invalid projectRegistry in startup config file', {
                module: 'ConfigManager',
                error: err instanceof Error ? err.message : String(err),
            })
        }
    }

    const registry = activeProjectRegistry(bc.projectRegistry)
    const rawFileWs = initialFile['defaultWorkspaceId']
    const fileWs =
        typeof rawFileWs === 'string' && !isForbiddenProjectKey(rawFileWs)
            ? rawFileWs.trim()
            : undefined
    const rawFileProj = initialFile['defaultProjectNumber']
    const fileProj =
        typeof rawFileProj === 'number' && Number.isSafeInteger(rawFileProj) && rawFileProj > 0
            ? rawFileProj
            : undefined

    if (bc.defaultWorkspaceId === undefined && fileWs !== undefined) {
        try {
            const paired = pairStoredScope(fileWs, bc.defaultProjectNumber, registry)
            bc.defaultWorkspaceId = paired.workspaceId
            if (bc.defaultProjectNumber === undefined && typeof paired.projectNumber === 'number') {
                bc.defaultProjectNumber = paired.projectNumber
            }
            changed = true
        } catch {
            // Leave file defaultWorkspaceId unseeded when it conflicts with CLI project_number.
        }
    }

    if (bc.defaultProjectNumber === undefined && fileProj !== undefined) {
        try {
            const paired = pairStoredScope(bc.defaultWorkspaceId, fileProj, registry)
            if (typeof paired.projectNumber === 'number') {
                bc.defaultProjectNumber = paired.projectNumber
                if (bc.defaultWorkspaceId === undefined && paired.workspaceId !== undefined) {
                    bc.defaultWorkspaceId = paired.workspaceId
                }
                changed = true
            }
        } catch {
            // Leave file defaultProjectNumber unseeded when it conflicts with CLI workspace_id.
        }
    }

    return changed ? { ...initialConfig, briefingConfig: bc } : initialConfig
}

export function buildInitialBaselines(
    initialConfig: DynamicConfig,
    initialFile: Record<string, unknown> | null,
    explicitCliEnvBaseline?: ConfigCliEnvBaseline
): InitialBaselinesResult {
    const { initialBriefingBaseline, briefingKeysFromFile } = collectBriefingBaselines(
        initialConfig,
        initialFile,
        BRIEFING_CONFIG_KEY_MAP,
        isValidBriefingConfigValue
    )

    const hasFileCodemode =
        initialFile !== null &&
        'codemodeInternalFullAccess' in initialFile &&
        typeof initialFile['codemodeInternalFullAccess'] === 'boolean'
    const codemodeFromFile =
        hasFileCodemode &&
        initialFile['codemodeInternalFullAccess'] === initialConfig.codemodeInternalFullAccess
    const codemodeBaseline = codemodeFromFile ? undefined : initialConfig.codemodeInternalFullAccess

    let cliEnvBaseline: ConfigCliEnvBaseline
    let toolFilterFromFile: boolean
    if (explicitCliEnvBaseline !== undefined) {
        cliEnvBaseline = { ...explicitCliEnvBaseline }
        toolFilterFromFile =
            explicitCliEnvBaseline.rawToolFilter === undefined &&
            initialConfig.rawToolFilter !== undefined
    } else if (initialFile !== null) {
        const fromFile = buildFileCliEnvBaseline(initialConfig, initialFile)
        cliEnvBaseline = fromFile.cliEnvBaseline
        toolFilterFromFile = fromFile.toolFilterFromFile
    } else {
        cliEnvBaseline = buildFallbackCliEnvBaseline(initialConfig)
        toolFilterFromFile = false
    }

    const fileWsId =
        initialFile !== null &&
        typeof initialFile['defaultWorkspaceId'] === 'string' &&
        !isForbiddenProjectKey(initialFile['defaultWorkspaceId'])
            ? initialFile['defaultWorkspaceId'].trim()
            : undefined
    const defaultWorkspaceIdFromFile =
        fileWsId !== undefined &&
        cliEnvBaseline.defaultWorkspaceId === undefined &&
        initialConfig.briefingConfig.defaultWorkspaceId?.trim().toLowerCase() ===
            fileWsId.toLowerCase()

    const fileProjNum =
        initialFile !== null &&
        typeof initialFile['defaultProjectNumber'] === 'number' &&
        Number.isSafeInteger(initialFile['defaultProjectNumber']) &&
        initialFile['defaultProjectNumber'] > 0
            ? initialFile['defaultProjectNumber']
            : undefined
    const defaultProjectNumberFromFile =
        fileProjNum !== undefined &&
        cliEnvBaseline.defaultProjectNumber === undefined &&
        initialConfig.briefingConfig.defaultProjectNumber === fileProjNum

    return {
        cliEnvBaseline,
        toolFilterFromFile,
        codemodeBaseline,
        initialBriefingBaseline,
        briefingKeysFromFile,
        codemodeFromFile,
        defaultWorkspaceIdFromFile,
        defaultProjectNumberFromFile,
    }
}

export function reloadBriefingConfigKeys(
    parsed: Record<string, unknown>,
    bc: BriefingConfig,
    initialBriefingBaseline: BriefingBaselineMap
): boolean {
    let bcChanged = false
    for (const [key, mapping] of Object.entries(BRIEFING_CONFIG_KEY_MAP)) {
        const match = readBriefingConfigEntry(parsed, key, mapping.aliases)
        if (match === undefined) {
            const baselineVal = initialBriefingBaseline[mapping.target]
            if (bc[mapping.target] !== baselineVal) {
                Object.assign(bc, { [mapping.target]: baselineVal })
                bcChanged = true
            }
            continue
        }
        const value = match.value
        if (!isValidBriefingConfigValue(value, mapping.kind)) {
            logger.warning('Ignoring briefing config value with unexpected type or range', {
                module: 'ConfigManager',
                key: match.key,
                expected:
                    mapping.kind === 'number'
                        ? 'non-negative integer'
                        : mapping.kind === 'unit'
                          ? 'number in [0, 1]'
                          : mapping.kind,
            })
            continue
        }
        if (bc[mapping.target] !== value) {
            Object.assign(bc, { [mapping.target]: value })
            bcChanged = true
        }
    }
    return bcChanged
}

function parseReloadedProjectRegistry(
    parsed: Record<string, unknown>,
    bc: BriefingConfig,
    cliEnvBaseline: ConfigCliEnvBaseline
): { nextRegistry: BriefingConfig['projectRegistry'] | undefined; changed: boolean } {
    if ('projectRegistry' in parsed && parsed['projectRegistry'] !== undefined && parsed['projectRegistry'] !== null) {
        try {
            const validated = validateProjectRegistryObject(parsed['projectRegistry'])
            if (validated !== undefined && JSON.stringify(bc.projectRegistry) !== JSON.stringify(validated)) {
                bc.projectRegistry = validated
                return { nextRegistry: validated, changed: true }
            }
        } catch (err: unknown) {
            logger.warning('Ignoring invalid projectRegistry in reloaded config file', {
                module: 'ConfigManager',
                error: err instanceof Error ? err.message : String(err),
            })
        }
        return { nextRegistry: bc.projectRegistry, changed: false }
    }
    if (JSON.stringify(bc.projectRegistry) !== JSON.stringify(cliEnvBaseline.projectRegistry)) {
        if (cliEnvBaseline.projectRegistry !== undefined) {
            bc.projectRegistry = cliEnvBaseline.projectRegistry
        } else {
            delete bc.projectRegistry
        }
        return { nextRegistry: bc.projectRegistry, changed: true }
    }
    return { nextRegistry: bc.projectRegistry, changed: false }
}

export interface ReloadedBriefingScopeResult {
    changed: boolean
    scopeAccepted: boolean
    defaultWorkspaceIdFromFile: boolean
    defaultProjectNumberFromFile: boolean
}

function extractFileScopeInputs(parsed: Record<string, unknown>): {
    rawProjNum: unknown
    hasFileProjNum: boolean
    trimmedWs: string
    hasFileWsId: boolean
} {
    const rawProjNum = parsed['defaultProjectNumber']
    const hasFileProjNum =
        'defaultProjectNumber' in parsed &&
        typeof rawProjNum === 'number' &&
        Number.isSafeInteger(rawProjNum) &&
        rawProjNum > 0
    if ('defaultProjectNumber' in parsed && rawProjNum !== undefined && rawProjNum !== null && !hasFileProjNum) {
        logger.warning('Ignoring invalid defaultProjectNumber in reloaded config file', {
            module: 'ConfigManager',
        })
    }

    const rawWsId = parsed['defaultWorkspaceId']
    const trimmedWs = typeof rawWsId === 'string' ? rawWsId.trim() : ''
    let hasFileWsId = false
    if ('defaultWorkspaceId' in parsed && rawWsId !== undefined && rawWsId !== null) {
        if (trimmedWs === '*') {
            logger.warning("Ignoring wildcard defaultWorkspaceId '*' in reloaded config file", {
                module: 'ConfigManager',
            })
        } else if (isForbiddenProjectKey(trimmedWs)) {
            logger.warning('Ignoring forbidden defaultWorkspaceId key in reloaded config file', {
                module: 'ConfigManager',
            })
        } else if (trimmedWs !== '') {
            hasFileWsId = true
        }
    }
    return { rawProjNum, hasFileProjNum, trimmedWs, hasFileWsId }
}

/**
 * Reload `defaultWorkspaceId`, `defaultProjectNumber`, and `projectRegistry` without
 * cross-workspace CLI/file bleed, validating against `pairStoredScope`.
 */
export function applyReloadedBriefingScope(
    parsed: Record<string, unknown>,
    bc: BriefingConfig,
    cliEnvBaseline: ConfigCliEnvBaseline
): ReloadedBriefingScopeResult {
    const regOutcome = parseReloadedProjectRegistry(parsed, bc, cliEnvBaseline)
    let changed = regOutcome.changed
    const { rawProjNum, hasFileProjNum, trimmedWs, hasFileWsId } = extractFileScopeInputs(parsed)

    const candidateWs = hasFileWsId
        ? trimmedWs
        : !hasFileProjNum || cliEnvBaseline.defaultProjectNumber === rawProjNum
          ? cliEnvBaseline.defaultWorkspaceId
          : undefined
    const candidateProj =
        hasFileProjNum && typeof rawProjNum === 'number'
            ? rawProjNum
            : !hasFileWsId || cliEnvBaseline.defaultWorkspaceId === trimmedWs
              ? cliEnvBaseline.defaultProjectNumber
              : undefined

    try {
        const paired = pairStoredScope(candidateWs, candidateProj, activeProjectRegistry(regOutcome.nextRegistry))
        const nextWsId = paired.workspaceId
        const nextProjNum = typeof paired.projectNumber === 'number' ? paired.projectNumber : undefined
        if (bc.defaultProjectNumber !== nextProjNum) {
            if (nextProjNum !== undefined) bc.defaultProjectNumber = nextProjNum
            else delete bc.defaultProjectNumber
            changed = true
        }
        if (bc.defaultWorkspaceId !== nextWsId) {
            if (nextWsId !== undefined) bc.defaultWorkspaceId = nextWsId
            else delete bc.defaultWorkspaceId
            changed = true
        }
        return {
            changed,
            scopeAccepted: true,
            defaultWorkspaceIdFromFile: hasFileWsId,
            defaultProjectNumberFromFile: hasFileProjNum,
        }
    } catch (err: unknown) {
        logger.warning('Ignoring conflicting workspace/project scope in reloaded config file', {
            module: 'ConfigManager',
            error: err instanceof Error ? err.message : String(err),
        })
        return {
            changed,
            scopeAccepted: false,
            defaultWorkspaceIdFromFile: false,
            defaultProjectNumberFromFile: false,
        }
    }
}

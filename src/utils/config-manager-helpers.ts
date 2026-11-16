import { validateProjectRegistryObject } from '../cli/server-options-parsers.js'
import type { ToolFilterConfig } from '../filtering/tool-filter.js'
import { DEFAULT_BRIEFING_CONFIG, type BriefingConfig } from '../handlers/resources/shared.js'
import { logger } from './logger.js'
import { activeProjectRegistry, pairStoredScope } from './write-scope.js'

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

export type BriefingBaselineMap = Record<BriefingConfigurableKey, number | boolean>

/** Config-file keys that map onto `BriefingConfig` fields, with the expected value type. */
export const BRIEFING_CONFIG_KEY_MAP: Readonly<
    Record<string, { target: BriefingConfigurableKey; kind: 'number' | 'boolean' }>
> = {
    briefingEntries: { target: 'entryCount', kind: 'number' },
    briefingSummaries: { target: 'summaryCount', kind: 'number' },
    briefingIncludeTeam: { target: 'includeTeam', kind: 'boolean' },
    briefingIssues: { target: 'issueCount', kind: 'number' },
    briefingPrs: { target: 'prCount', kind: 'number' },
    briefingPrStatus: { target: 'prStatusBreakdown', kind: 'boolean' },
    briefingMilestones: { target: 'milestoneCount', kind: 'number' },
    briefingWorkflows: { target: 'workflowCount', kind: 'number' },
    briefingWorkflowStatus: { target: 'workflowStatusBreakdown', kind: 'boolean' },
    briefingCopilot: { target: 'copilotReviews', kind: 'boolean' },
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

function buildDefaultBriefingBaseline(): BriefingBaselineMap {
    return {
        entryCount: DEFAULT_BRIEFING_CONFIG.entryCount ?? 3,
        summaryCount: DEFAULT_BRIEFING_CONFIG.summaryCount ?? 1,
        includeTeam: DEFAULT_BRIEFING_CONFIG.includeTeam ?? false,
        issueCount: DEFAULT_BRIEFING_CONFIG.issueCount ?? 0,
        prCount: DEFAULT_BRIEFING_CONFIG.prCount ?? 0,
        prStatusBreakdown: DEFAULT_BRIEFING_CONFIG.prStatusBreakdown ?? false,
        milestoneCount: DEFAULT_BRIEFING_CONFIG.milestoneCount ?? 3,
        workflowCount: DEFAULT_BRIEFING_CONFIG.workflowCount ?? 0,
        workflowStatusBreakdown: DEFAULT_BRIEFING_CONFIG.workflowStatusBreakdown ?? false,
        copilotReviews: DEFAULT_BRIEFING_CONFIG.copilotReviews ?? false,
    }
}

export function isValidBriefingConfigValue(
    value: unknown,
    kind: 'number' | 'boolean'
): boolean {
    if (kind === 'boolean') return typeof value === 'boolean'
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
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
        typeof rawFileWs === 'string' && rawFileWs.trim() !== '' && rawFileWs.trim() !== '*'
            ? rawFileWs.trim()
            : undefined
    const rawFileProj = initialFile['defaultProjectNumber']
    const fileProj =
        typeof rawFileProj === 'number' && Number.isInteger(rawFileProj) && rawFileProj > 0
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
    const defaults = buildDefaultBriefingBaseline()
    const initialBriefingBaseline: BriefingBaselineMap = { ...defaults }
    const briefingKeysFromFile = new Set<BriefingConfigurableKey>()

    for (const [fileKey, { target, kind }] of Object.entries(BRIEFING_CONFIG_KEY_MAP)) {
        const hasFileVal =
            initialFile !== null &&
            fileKey in initialFile &&
            isValidBriefingConfigValue(initialFile[fileKey], kind)
        if (hasFileVal) briefingKeysFromFile.add(target)
        const curVal = initialConfig.briefingConfig[target]
        const fromFile = hasFileVal && initialFile[fileKey] === curVal
        if (!fromFile && curVal !== undefined) {
            initialBriefingBaseline[target] = curVal
        }
    }

    const hasFileCodemode =
        initialFile !== null &&
        'codemodeInternalFullAccess' in initialFile &&
        typeof initialFile['codemodeInternalFullAccess'] === 'boolean'
    const codemodeFromFile =
        hasFileCodemode &&
        initialFile['codemodeInternalFullAccess'] === initialConfig.codemodeInternalFullAccess
    const codemodeBaseline = codemodeFromFile ? undefined : initialConfig.codemodeInternalFullAccess
    const defaultWorkspaceIdFromFile =
        initialFile !== null &&
        typeof initialFile['defaultWorkspaceId'] === 'string' &&
        initialFile['defaultWorkspaceId'].trim() !== '' &&
        initialFile['defaultWorkspaceId'].trim() !== '*'
    const defaultProjectNumberFromFile =
        initialFile !== null &&
        typeof initialFile['defaultProjectNumber'] === 'number' &&
        Number.isInteger(initialFile['defaultProjectNumber']) &&
        initialFile['defaultProjectNumber'] > 0

    if (explicitCliEnvBaseline !== undefined) {
        return {
            cliEnvBaseline: { ...explicitCliEnvBaseline },
            toolFilterFromFile:
                explicitCliEnvBaseline.rawToolFilter === undefined &&
                initialConfig.rawToolFilter !== undefined,
            codemodeBaseline,
            initialBriefingBaseline,
            briefingKeysFromFile,
            codemodeFromFile: hasFileCodemode,
            defaultWorkspaceIdFromFile,
            defaultProjectNumberFromFile,
        }
    }

    if (initialFile !== null) {
        const fileToolFilter =
            typeof initialFile['toolFilter'] === 'string' &&
            initialFile['toolFilter'].trim() !== ''
                ? initialFile['toolFilter']
                : undefined
        const toolFilterFromFile =
            fileToolFilter !== undefined && initialConfig.rawToolFilter === fileToolFilter
        const fileProjNum =
            typeof initialFile['defaultProjectNumber'] === 'number'
                ? initialFile['defaultProjectNumber']
                : undefined
        const fileWsId =
            typeof initialFile['defaultWorkspaceId'] === 'string'
                ? initialFile['defaultWorkspaceId']
                : undefined
        const fileRegistry =
            typeof initialFile['projectRegistry'] === 'object' &&
            initialFile['projectRegistry'] !== null &&
            !Array.isArray(initialFile['projectRegistry'])
                ? initialFile['projectRegistry']
                : undefined
        return {
            cliEnvBaseline: {
                ...(!toolFilterFromFile && initialConfig.rawToolFilter !== undefined
                    ? { rawToolFilter: initialConfig.rawToolFilter }
                    : {}),
                ...(initialConfig.briefingConfig.defaultProjectNumber !== undefined &&
                initialConfig.briefingConfig.defaultProjectNumber !== fileProjNum
                    ? { defaultProjectNumber: initialConfig.briefingConfig.defaultProjectNumber }
                    : {}),
                ...(initialConfig.briefingConfig.defaultWorkspaceId !== undefined &&
                initialConfig.briefingConfig.defaultWorkspaceId !== fileWsId
                    ? { defaultWorkspaceId: initialConfig.briefingConfig.defaultWorkspaceId }
                    : {}),
                ...(initialConfig.briefingConfig.projectRegistry !== undefined &&
                JSON.stringify(initialConfig.briefingConfig.projectRegistry) !==
                    JSON.stringify(fileRegistry)
                    ? { projectRegistry: initialConfig.briefingConfig.projectRegistry }
                    : {}),
            },
            toolFilterFromFile,
            codemodeBaseline,
            initialBriefingBaseline,
            briefingKeysFromFile,
            codemodeFromFile: hasFileCodemode,
            defaultWorkspaceIdFromFile,
            defaultProjectNumberFromFile,
        }
    }

    return {
        cliEnvBaseline: {
            ...(initialConfig.rawToolFilter !== undefined
                ? { rawToolFilter: initialConfig.rawToolFilter }
                : {}),
            ...(initialConfig.briefingConfig.defaultProjectNumber !== undefined
                ? { defaultProjectNumber: initialConfig.briefingConfig.defaultProjectNumber }
                : {}),
            ...(initialConfig.briefingConfig.defaultWorkspaceId !== undefined
                ? { defaultWorkspaceId: initialConfig.briefingConfig.defaultWorkspaceId }
                : {}),
            ...(initialConfig.briefingConfig.projectRegistry !== undefined
                ? { projectRegistry: initialConfig.briefingConfig.projectRegistry }
                : {}),
        },
        toolFilterFromFile: false,
        codemodeBaseline,
        initialBriefingBaseline,
        briefingKeysFromFile,
        codemodeFromFile: hasFileCodemode,
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
        if (!(key in parsed) || parsed[key] === undefined || parsed[key] === null) {
            const baselineVal = initialBriefingBaseline[mapping.target]
            if (bc[mapping.target] !== baselineVal) {
                Object.assign(bc, { [mapping.target]: baselineVal })
                bcChanged = true
            }
            continue
        }
        const value = parsed[key]
        if (!isValidBriefingConfigValue(value, mapping.kind)) {
            logger.warning('Ignoring briefing config value with unexpected type or range', {
                module: 'ConfigManager',
                key,
                expected: mapping.kind === 'number' ? 'non-negative integer' : mapping.kind,
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

/**
 * Reload `defaultWorkspaceId`, `defaultProjectNumber`, and `projectRegistry` without
 * cross-workspace CLI/file bleed, validating against `pairStoredScope`.
 */
export function applyReloadedBriefingScope(
    parsed: Record<string, unknown>,
    bc: BriefingConfig,
    cliEnvBaseline: ConfigCliEnvBaseline
): boolean {
    const regOutcome = parseReloadedProjectRegistry(parsed, bc, cliEnvBaseline)
    let changed = regOutcome.changed

    const rawProjNum = parsed['defaultProjectNumber']
    const hasFileProjNum =
        'defaultProjectNumber' in parsed &&
        typeof rawProjNum === 'number' &&
        Number.isInteger(rawProjNum) &&
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
        } else if (trimmedWs !== '') {
            hasFileWsId = true
        }
    }

    const candidateWs = hasFileWsId
        ? trimmedWs
        : !hasFileProjNum || cliEnvBaseline.defaultProjectNumber === rawProjNum
          ? cliEnvBaseline.defaultWorkspaceId
          : undefined
    const candidateProj = hasFileProjNum
        ? rawProjNum
        : !hasFileWsId || cliEnvBaseline.defaultWorkspaceId === trimmedWs
          ? cliEnvBaseline.defaultProjectNumber
          : undefined

    try {
        const paired = pairStoredScope(candidateWs, candidateProj, activeProjectRegistry(regOutcome.nextRegistry))
        const nextWsId = paired.workspaceId
        const nextProjNum = typeof paired.projectNumber === 'number' ? paired.projectNumber : undefined
        if (bc.defaultProjectNumber !== nextProjNum) {
            if (nextProjNum !== undefined) {
                bc.defaultProjectNumber = nextProjNum
            } else {
                delete bc.defaultProjectNumber
            }
            changed = true
        }
        if (bc.defaultWorkspaceId !== nextWsId) {
            if (nextWsId !== undefined) {
                bc.defaultWorkspaceId = nextWsId
            } else {
                delete bc.defaultWorkspaceId
            }
            changed = true
        }
    } catch (err: unknown) {
        logger.warning('Ignoring conflicting workspace/project scope in reloaded config file', {
            module: 'ConfigManager',
            error: err instanceof Error ? err.message : String(err),
        })
    }

    return changed
}

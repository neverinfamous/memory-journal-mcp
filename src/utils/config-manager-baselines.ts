import { DEFAULT_BRIEFING_CONFIG } from '../handlers/resources/shared.js'
import { isForbiddenProjectKey } from './project-registry-guards.js'
import type {
    BriefingBaselineMap,
    BriefingConfigurableKey,
    BriefingValueKind,
    ConfigCliEnvBaseline,
    DynamicConfig,
} from './config-manager-helpers.js'

/** Look up a briefing config entry by primary file key (`briefingPrs`) before legacy aliases (`briefingPrCount`). */
export function readBriefingConfigEntry(
    obj: Record<string, unknown>,
    primaryKey: string,
    aliases?: readonly string[]
): { key: string; value: unknown } | undefined {
    if (Object.hasOwn(obj, primaryKey) && obj[primaryKey] !== undefined && obj[primaryKey] !== null) {
        return { key: primaryKey, value: obj[primaryKey] }
    }
    if (aliases !== undefined) {
        for (const alias of aliases) {
            if (Object.hasOwn(obj, alias) && obj[alias] !== undefined && obj[alias] !== null) {
                return { key: alias, value: obj[alias] }
            }
        }
    }
    return undefined
}

export type BriefingKeyMapping = Readonly<
    Record<
        string,
        {
            target: BriefingConfigurableKey
            kind: BriefingValueKind
            aliases?: readonly string[]
        }
    >
>

function buildDefaultBriefingBaseline(): BriefingBaselineMap {
    return {
        commitCount: DEFAULT_BRIEFING_CONFIG.commitCount ?? 3,
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
        briefingImportanceThreshold: DEFAULT_BRIEFING_CONFIG.briefingImportanceThreshold ?? 0.3,
        graphPivots: DEFAULT_BRIEFING_CONFIG.graphPivots ?? true,
        insights: DEFAULT_BRIEFING_CONFIG.insights ?? true,
    }
}

/** Collect initial briefing key baselines, file provenance, and initial valid file values. */
export function collectBriefingBaselines(
    initialConfig: DynamicConfig,
    initialFile: Record<string, unknown> | null,
    keyMap: BriefingKeyMapping,
    isValidValue: (value: unknown, kind: BriefingValueKind) => value is number | boolean,
    explicitBriefingOverrides?: Partial<Record<BriefingConfigurableKey, number | boolean>>
): {
    initialBriefingBaseline: BriefingBaselineMap
    briefingKeysFromFile: Set<BriefingConfigurableKey>
    lastFileBriefingValues: Map<BriefingConfigurableKey, number | boolean>
} {
    const initialBriefingBaseline: BriefingBaselineMap = { ...buildDefaultBriefingBaseline() }
    const briefingKeysFromFile = new Set<BriefingConfigurableKey>()
    const lastFileBriefingValues = new Map<BriefingConfigurableKey, number | boolean>()

    for (const [fileKey, { target, kind, aliases }] of Object.entries(keyMap)) {
        const match =
            initialFile !== null
                ? readBriefingConfigEntry(initialFile, fileKey, aliases)
                : undefined
        const fileVal = match?.value
        const hasFileVal = isValidValue(fileVal, kind)
        if (hasFileVal) {
            lastFileBriefingValues.set(target, fileVal)
        }
        const explicitOverride = explicitBriefingOverrides?.[target]
        const curVal = initialConfig.briefingConfig[target]
        const fromFile = explicitOverride === undefined && hasFileVal && fileVal === curVal
        if (fromFile) {
            briefingKeysFromFile.add(target)
        } else if (explicitOverride !== undefined && isValidValue(explicitOverride, kind)) {
            initialBriefingBaseline[target] = explicitOverride
        } else if (curVal !== undefined && isValidValue(curVal, kind)) {
            initialBriefingBaseline[target] = curVal
        }
    }

    return { initialBriefingBaseline, briefingKeysFromFile, lastFileBriefingValues }
}

/** Compute the CLI/env baseline when a startup config file was present. */
export function buildFileCliEnvBaseline(
    initialConfig: DynamicConfig,
    initialFile: Record<string, unknown>
): { cliEnvBaseline: ConfigCliEnvBaseline; toolFilterFromFile: boolean } {
    const fileToolFilter =
        typeof initialFile['toolFilter'] === 'string' && initialFile['toolFilter'].trim() !== ''
            ? initialFile['toolFilter']
            : undefined
    const toolFilterFromFile =
        fileToolFilter !== undefined && initialConfig.rawToolFilter === fileToolFilter
    const fileProjNum =
        typeof initialFile['defaultProjectNumber'] === 'number'
            ? initialFile['defaultProjectNumber']
            : undefined
    const fileWsId =
        typeof initialFile['defaultWorkspaceId'] === 'string' &&
        !isForbiddenProjectKey(initialFile['defaultWorkspaceId'])
            ? initialFile['defaultWorkspaceId'].trim()
            : undefined
    const wsCameFromFile =
        fileWsId !== undefined &&
        initialConfig.briefingConfig.defaultWorkspaceId?.trim().toLowerCase() ===
            fileWsId.toLowerCase()
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
            ...(initialConfig.briefingConfig.defaultWorkspaceId !== undefined && !wsCameFromFile
                ? { defaultWorkspaceId: initialConfig.briefingConfig.defaultWorkspaceId }
                : {}),
            ...(initialConfig.briefingConfig.projectRegistry !== undefined &&
            JSON.stringify(initialConfig.briefingConfig.projectRegistry) !==
                JSON.stringify(fileRegistry)
                ? { projectRegistry: initialConfig.briefingConfig.projectRegistry }
                : {}),
        },
        toolFilterFromFile,
    }
}

/** Build the CLI/env baseline when no startup config file existed. */
export function buildFallbackCliEnvBaseline(initialConfig: DynamicConfig): ConfigCliEnvBaseline {
    const rawWs = initialConfig.briefingConfig.defaultWorkspaceId?.trim()
    const validWs = rawWs !== undefined && !isForbiddenProjectKey(rawWs) ? rawWs : undefined
    return {
        ...(initialConfig.rawToolFilter !== undefined
            ? { rawToolFilter: initialConfig.rawToolFilter }
            : {}),
        ...(initialConfig.briefingConfig.defaultProjectNumber !== undefined
            ? { defaultProjectNumber: initialConfig.briefingConfig.defaultProjectNumber }
            : {}),
        ...(validWs !== undefined ? { defaultWorkspaceId: validWs } : {}),
        ...(initialConfig.briefingConfig.projectRegistry !== undefined
            ? { projectRegistry: initialConfig.briefingConfig.projectRegistry }
            : {}),
    }
}

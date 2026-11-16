import { DEFAULT_BRIEFING_CONFIG } from '../handlers/resources/shared.js'
import type {
    BriefingBaselineMap,
    BriefingConfigurableKey,
    ConfigCliEnvBaseline,
    DynamicConfig,
} from './config-manager-helpers.js'

export type BriefingKeyMapping = Readonly<
    Record<string, { target: BriefingConfigurableKey; kind: 'number' | 'boolean' }>
>

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

/** Collect initial briefing key baselines and track which briefing keys came from the startup file. */
export function collectBriefingBaselines(
    initialConfig: DynamicConfig,
    initialFile: Record<string, unknown> | null,
    keyMap: BriefingKeyMapping,
    isValidValue: (value: unknown, kind: 'number' | 'boolean') => boolean
): {
    initialBriefingBaseline: BriefingBaselineMap
    briefingKeysFromFile: Set<BriefingConfigurableKey>
} {
    const initialBriefingBaseline: BriefingBaselineMap = { ...buildDefaultBriefingBaseline() }
    const briefingKeysFromFile = new Set<BriefingConfigurableKey>()

    for (const [fileKey, { target, kind }] of Object.entries(keyMap)) {
        const hasFileVal =
            initialFile !== null &&
            fileKey in initialFile &&
            isValidValue(initialFile[fileKey], kind)
        if (hasFileVal) briefingKeysFromFile.add(target)
        const curVal = initialConfig.briefingConfig[target]
        const fromFile = hasFileVal && initialFile[fileKey] === curVal
        if (!fromFile && curVal !== undefined) {
            initialBriefingBaseline[target] = curVal
        }
    }

    return { initialBriefingBaseline, briefingKeysFromFile }
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
    }
}

/** Build the CLI/env baseline when no startup config file existed. */
export function buildFallbackCliEnvBaseline(initialConfig: DynamicConfig): ConfigCliEnvBaseline {
    return {
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
    }
}

/** Update briefing/scope provenance flags from a freshly reloaded config object. */
export function syncBriefingProvenanceFromFile(
    parsed: Record<string, unknown>,
    briefingKeysFromFile: Set<BriefingConfigurableKey>,
    keyMap: BriefingKeyMapping,
    isValidValue: (value: unknown, kind: 'number' | 'boolean') => boolean
): { defaultWorkspaceIdFromFile: boolean; defaultProjectNumberFromFile: boolean } {
    for (const [fileKey, { target, kind }] of Object.entries(keyMap)) {
        if (fileKey in parsed && isValidValue(parsed[fileKey], kind)) {
            briefingKeysFromFile.add(target)
        } else {
            briefingKeysFromFile.delete(target)
        }
    }
    return {
        defaultWorkspaceIdFromFile:
            typeof parsed['defaultWorkspaceId'] === 'string' &&
            parsed['defaultWorkspaceId'].trim() !== '' &&
            parsed['defaultWorkspaceId'].trim() !== '*',
        defaultProjectNumberFromFile:
            typeof parsed['defaultProjectNumber'] === 'number' &&
            Number.isInteger(parsed['defaultProjectNumber']) &&
            parsed['defaultProjectNumber'] > 0,
    }
}

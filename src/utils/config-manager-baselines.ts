import { DEFAULT_BRIEFING_CONFIG } from '../handlers/resources/shared.js'
import {
    readBriefingConfigEntry,
    type BriefingBaselineMap,
    type BriefingConfigurableKey,
    type BriefingValueKind,
    type ConfigCliEnvBaseline,
    type DynamicConfig,
} from './config-manager-helpers.js'

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

/** Collect initial briefing key baselines and track which briefing keys came from the startup file. */
export function collectBriefingBaselines(
    initialConfig: DynamicConfig,
    initialFile: Record<string, unknown> | null,
    keyMap: BriefingKeyMapping,
    isValidValue: (value: unknown, kind: BriefingValueKind) => boolean
): {
    initialBriefingBaseline: BriefingBaselineMap
    briefingKeysFromFile: Set<BriefingConfigurableKey>
} {
    const initialBriefingBaseline: BriefingBaselineMap = { ...buildDefaultBriefingBaseline() }
    const briefingKeysFromFile = new Set<BriefingConfigurableKey>()

    for (const [fileKey, { target, kind, aliases }] of Object.entries(keyMap)) {
        const match =
            initialFile !== null
                ? readBriefingConfigEntry(initialFile, fileKey, aliases)
                : undefined
        const hasFileVal = match !== undefined && isValidValue(match.value, kind)
        const curVal = initialConfig.briefingConfig[target]
        const fromFile = hasFileVal && match.value === curVal
        if (fromFile) {
            briefingKeysFromFile.add(target)
        } else if (curVal !== undefined) {
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
        typeof initialFile['defaultWorkspaceId'] === 'string' &&
        initialFile['defaultWorkspaceId'].trim() !== '' &&
        initialFile['defaultWorkspaceId'].trim() !== '*'
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

/** Update briefing provenance flags from a freshly reloaded config object. */
export function syncBriefingProvenanceFromFile(
    parsed: Record<string, unknown>,
    briefingKeysFromFile: Set<BriefingConfigurableKey>,
    keyMap: BriefingKeyMapping,
    isValidValue: (value: unknown, kind: BriefingValueKind) => boolean
): void {
    for (const [fileKey, { target, kind, aliases }] of Object.entries(keyMap)) {
        const match = readBriefingConfigEntry(parsed, fileKey, aliases)
        if (match !== undefined && isValidValue(match.value, kind)) {
            briefingKeysFromFile.add(target)
        } else {
            briefingKeysFromFile.delete(target)
        }
    }
}

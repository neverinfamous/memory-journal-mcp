import {
    BRIEFING_CONFIG_KEY_MAP,
    type BriefingConfigurableKey,
    type DynamicConfig,
} from './config-manager-helpers.js'

export interface PersistProvenanceFlags {
    toolFilter: boolean
    codemode: boolean
    defaultWorkspaceId: boolean
    defaultProjectNumber: boolean
    briefingKeys: ReadonlySet<BriefingConfigurableKey>
}

export function applyPersistableConfigKeys(
    parsed: Record<string, unknown>,
    config: DynamicConfig,
    provenance: PersistProvenanceFlags
): void {
    if (provenance.toolFilter) {
        if (config.rawToolFilter !== undefined && config.rawToolFilter.trim() !== '') {
            parsed['toolFilter'] = config.rawToolFilter
        } else {
            delete parsed['toolFilter']
        }
    }
    if (provenance.codemode && config.codemodeInternalFullAccess !== undefined) {
        parsed['codemodeInternalFullAccess'] = config.codemodeInternalFullAccess
    }
    for (const [fileKey, mapping] of Object.entries(BRIEFING_CONFIG_KEY_MAP)) {
        if (!provenance.briefingKeys.has(mapping.target)) continue
        const val = config.briefingConfig[mapping.target]
        if (val === undefined) continue
        const existingAlias = mapping.aliases?.find((alias) => alias in parsed)
        if (existingAlias !== undefined && !(fileKey in parsed)) {
            parsed[existingAlias] = val
        } else {
            parsed[fileKey] = val
        }
    }
    if (provenance.defaultWorkspaceId) {
        if (config.briefingConfig.defaultWorkspaceId !== undefined) {
            parsed['defaultWorkspaceId'] = config.briefingConfig.defaultWorkspaceId
        } else {
            delete parsed['defaultWorkspaceId']
        }
    }
    if (provenance.defaultProjectNumber) {
        if (config.briefingConfig.defaultProjectNumber !== undefined) {
            parsed['defaultProjectNumber'] = config.briefingConfig.defaultProjectNumber
        } else {
            delete parsed['defaultProjectNumber']
        }
    }
}

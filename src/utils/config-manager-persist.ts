import * as fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import { stringify as stringifyYaml } from 'yaml'
import { assertSafeConfigWriteTargetSync } from './config-file-safety.js'
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
            for (const alias of mapping.aliases ?? []) {
                if (alias !== fileKey) Reflect.deleteProperty(parsed, alias)
            }
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

export function serializeConfigObject(
    parsed: Record<string, unknown>,
    isYaml: boolean
): string {
    if (!isYaml) return JSON.stringify(parsed, null, 2)
    return (stringifyYaml as (value: unknown) => string)(parsed)
}

export function writeTempAndRenameConfig(
    targetPath: string,
    serialized: string
): void {
    assertSafeConfigWriteTargetSync(targetPath)
    const tmpPath = `${targetPath}.${String(process.pid)}.${randomBytes(8).toString('hex')}.tmp`
    try {
        fs.writeFileSync(tmpPath, serialized, { encoding: 'utf-8', flag: 'wx', mode: 0o600 })
        fs.chmodSync(tmpPath, 0o600)
        fs.renameSync(tmpPath, targetPath)
    } catch (writeErr: unknown) {
        try {
            fs.rmSync(tmpPath, { force: true })
        } catch {
            // [SIDE-EFFECT] Best-effort temp cleanup; the original error is reported below.
        }
        throw writeErr
    }
}

import * as fs from 'node:fs'
import { randomBytes } from 'node:crypto'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { assertSafeConfigWriteTargetSync, readSafeRegularConfigTextSync } from './config-file-safety.js'
import { invalidateRegistryFileCache, RegistryConfigError } from './registry-config-file.js'
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
        const existingAlias = mapping.aliases?.find((alias) => Object.hasOwn(parsed, alias))
        if (existingAlias !== undefined && !Object.hasOwn(parsed, fileKey)) {
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

export function parseRawConfigObjectFromFile(
    configPath: string,
    isYaml: boolean
): Record<string, unknown> | null {
    try {
        const loaded = readSafeRegularConfigTextSync(configPath)
        if (loaded === undefined) return null
        const content = loaded.content
        const raw: unknown = isYaml
            ? (parseYaml as (text: string) => unknown)(content)
            : JSON.parse(content)
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            return null
        }
        return raw as Record<string, unknown>
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        throw new RegistryConfigError(`Configuration file could not be parsed: ${message}`)
    }
}

export function writeTempAndRenameConfig(
    targetPath: string,
    serialized: string
): void {
    assertSafeConfigWriteTargetSync(targetPath)
    const tmpPath = `${targetPath}.${String(process.pid)}.${randomBytes(8).toString('hex')}.tmp`
    let wroteTemp = false
    try {
        fs.writeFileSync(tmpPath, serialized, { encoding: 'utf-8', flag: 'wx', mode: 0o600 })
        wroteTemp = true
        fs.chmodSync(tmpPath, 0o600)
        invalidateRegistryFileCache(targetPath)
        fs.renameSync(tmpPath, targetPath)
    } catch (writeErr: unknown) {
        if (wroteTemp) {
            try {
                fs.rmSync(tmpPath, { force: true })
            } catch {
                // [SIDE-EFFECT] Best-effort temp cleanup; the original error is reported below.
            }
        }
        throw writeErr
    }
}

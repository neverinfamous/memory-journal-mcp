import { validateProjectRegistryObject } from '../cli/server-options-parsers.js'
import type { BriefingConfig } from '../handlers/resources/shared.js'
import { logger } from './logger.js'
import { isForbiddenProjectKey } from './project-registry-guards.js'
import { activeProjectRegistry, pairStoredScope } from './write-scope.js'
import type { ConfigCliEnvBaseline } from './config-manager-helpers.js'

function parseReloadedProjectRegistry(
    parsed: Record<string, unknown>,
    bc: BriefingConfig,
    cliEnvBaseline: ConfigCliEnvBaseline
): { nextRegistry: BriefingConfig['projectRegistry'] | undefined; changed: boolean } {
    if (
        'projectRegistry' in parsed &&
        parsed['projectRegistry'] !== undefined &&
        parsed['projectRegistry'] !== null
    ) {
        try {
            const validated = validateProjectRegistryObject(parsed['projectRegistry'])
            if (
                validated !== undefined &&
                JSON.stringify(bc.projectRegistry) !== JSON.stringify(validated)
            ) {
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
    if (
        'defaultProjectNumber' in parsed &&
        rawProjNum !== undefined &&
        rawProjNum !== null &&
        !hasFileProjNum
    ) {
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
            : !hasFileWsId ||
                cliEnvBaseline.defaultWorkspaceId?.trim().toLowerCase() ===
                    trimmedWs.toLowerCase()
              ? cliEnvBaseline.defaultProjectNumber
              : undefined

    try {
        const paired = pairStoredScope(
            candidateWs,
            candidateProj,
            activeProjectRegistry(regOutcome.nextRegistry)
        )
        const nextWsId = paired.workspaceId
        const nextProjNum =
            typeof paired.projectNumber === 'number' ? paired.projectNumber : undefined
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

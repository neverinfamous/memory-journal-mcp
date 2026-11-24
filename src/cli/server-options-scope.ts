import type { CliCommandLike, ConfigResolver } from '../utils/config-resolver.js'
import { isForbiddenProjectKey } from '../utils/project-registry-guards.js'
import { parsePositiveProjectNumber } from '../utils/safe-positive-int.js'
import { activeProjectRegistry, pairStoredScope } from '../utils/write-scope.js'
import type { ServerOptions } from '../server/mcp-server/types.js'
import type { CatchConfig } from './server-options-groups.js'
import {
    resolveUnconflictedDefaultProject,
    resolveUnconflictedDefaultWorkspace,
} from './server-options-parsers.js'

export function resolveDefaultProjectNumberOption(
    resolver: ConfigResolver,
    catchConfig: CatchConfig
): number | undefined {
    const rejectBlank =
        resolver.isCliProvided('defaultProject') ||
        ((resolver.hasConfigFileKey('defaultProject') ||
            resolver.hasConfigFileKey('defaultProjectNumber')) &&
            (process.env['DEFAULT_PROJECT_NUMBER']?.trim() ?? '') === '')
    return catchConfig(() => {
        const configVal = resolver.resolveStringOrNumber('defaultProjectNumber')
        const raw =
            resolver.resolveStringOrNumber('defaultProject', 'DEFAULT_PROJECT_NUMBER') ?? configVal
        if (raw === undefined || raw === null) return undefined
        const str = String(raw).trim()
        if (str === '') {
            if (rejectBlank) throw new Error('Invalid blank --default-project / defaultProjectNumber.')
            return undefined
        }
        const parsed = parsePositiveProjectNumber(str.replace(/^p/i, ''))
        if (parsed === undefined || !/^p?[1-9]\d*$/i.test(str)) {
            throw new Error(
                `Invalid defaultProjectNumber '${str}'. Expected a positive integer.`
            )
        }
        return parsed
    }, undefined)
}

function validateWorkspaceCandidate(
    raw: unknown,
    label: string,
    rejectBlank: boolean
): string | undefined {
    if (raw === undefined || raw === null) return undefined
    if (typeof raw !== 'string') {
        throw new Error(`Invalid ${label}: expected string, got ${typeof raw}.`)
    }
    const trimmed = raw.trim()
    if (trimmed === '') {
        if (rejectBlank) throw new Error(`Invalid ${label} '': cannot be empty or whitespace.`)
        return undefined
    }
    if (trimmed === '*' || isForbiddenProjectKey(trimmed)) {
        throw new Error(`Invalid ${label} '${trimmed}': cannot be '*' or a reserved key.`)
    }
    return trimmed
}

function resolveWorkspaceFromCliEnvConfig(
    resolver: ConfigResolver,
    allowWorkspaceAsDefault: boolean
): string | undefined {
    if (allowWorkspaceAsDefault && resolver.isCliProvided('workspace')) {
        const ws = validateWorkspaceCandidate(resolver.resolve('workspace'), 'workspace', true)
        if (ws !== undefined) return ws
    }
    if (resolver.isCliProvided('defaultWorkspaceId')) {
        const cliDefWs = validateWorkspaceCandidate(resolver.resolve('defaultWorkspaceId'), 'defaultWorkspaceId', true)
        if (cliDefWs !== undefined) return cliDefWs
    }
    const rawEnv = process.env['DEFAULT_WORKSPACE_ID']
    if (rawEnv !== undefined && rawEnv !== '') {
        return validateWorkspaceCandidate(rawEnv, 'DEFAULT_WORKSPACE_ID', true)
    }
    if (resolver.hasConfigFileKey('defaultWorkspaceId')) {
        const cfgDefWs = validateWorkspaceCandidate(resolver.resolve('defaultWorkspaceId'), 'defaultWorkspaceId', true)
        if (cfgDefWs !== undefined) return cfgDefWs
    }
    if (allowWorkspaceAsDefault && resolver.hasConfigFileKey('workspace')) {
        const cfgWs = validateWorkspaceCandidate(resolver.resolve('workspace'), 'workspace', true)
        if (cfgWs !== undefined) return cfgWs
    }
    return undefined
}

/**
 * Resolve default workspace with strict CLI > Env > Config precedence:
 * `--workspace` (when allowed) -> `--default-workspace-id` -> `DEFAULT_WORKSPACE_ID` ->
 * `config.defaultWorkspaceId` -> `config.workspace` (when allowed).
 */
export function resolveDefaultWorkspaceIdOption(
    resolver: ConfigResolver,
    catchConfig: CatchConfig,
    allowWorkspaceAsDefault: boolean
): string | undefined {
    return catchConfig(() => resolveWorkspaceFromCliEnvConfig(resolver, allowWorkspaceAsDefault), undefined)
}

function pairConfiguredScope(
    catchConfig: CatchConfig,
    defaultWorkspaceId: string | undefined,
    defaultProjectNumber: number | undefined,
    projectRegistry: ServerOptions['projectRegistry']
): { defaultWorkspaceId: string | undefined; defaultProjectNumber: number | undefined } {
    if (defaultWorkspaceId === undefined || defaultProjectNumber === undefined) {
        return { defaultWorkspaceId, defaultProjectNumber }
    }
    let nextWs: string | undefined = defaultWorkspaceId
    let nextProj: number | undefined = defaultProjectNumber
    catchConfig(() => {
        const paired = pairStoredScope(
            defaultWorkspaceId,
            defaultProjectNumber,
            activeProjectRegistry(projectRegistry)
        )
        nextWs = paired.workspaceId
        if (typeof paired.projectNumber === 'number') nextProj = paired.projectNumber
    }, undefined)
    return { defaultWorkspaceId: nextWs, defaultProjectNumber: nextProj }
}

export function resolveConfiguredDefaultScope(
    resolver: ConfigResolver,
    command: CliCommandLike,
    catchConfig: CatchConfig,
    projectRegistry: ServerOptions['projectRegistry']
): { defaultWorkspaceId: string | undefined; defaultProjectNumber: number | undefined } {
    const commandName = command.name()
    const allowWorkspaceAsDefault = commandName === 'serve' || commandName === 'memory-journal-mcp'
    const initialProj = resolveDefaultProjectNumberOption(resolver, catchConfig)
    const initialWs = resolveDefaultWorkspaceIdOption(resolver, catchConfig, allowWorkspaceAsDefault)
    const wsFromCli =
        resolver.isCliProvided('defaultWorkspaceId') ||
        (allowWorkspaceAsDefault && resolver.isCliProvided('workspace'))
    const projFromCli = resolver.isCliProvided('defaultProject')
    const wsRank =
        initialWs === undefined
            ? 0
            : wsFromCli
              ? 3
              : (process.env['DEFAULT_WORKSPACE_ID']?.trim() ?? '') !== ''
                ? 2
                : 1
    const projRank =
        initialProj === undefined
            ? 0
            : projFromCli
              ? 3
              : (process.env['DEFAULT_PROJECT_NUMBER']?.trim() ?? '') !== ''
                ? 2
                : 1
    const unconflictedWs = resolveUnconflictedDefaultWorkspace(
        initialWs, initialProj, projectRegistry, wsRank > projRank, projRank > wsRank
    )
    const unconflictedProj = resolveUnconflictedDefaultProject(
        unconflictedWs, initialProj, projectRegistry, wsRank > projRank, projRank > wsRank
    )
    return pairConfiguredScope(catchConfig, unconflictedWs, unconflictedProj, projectRegistry)
}

export function resolveServerHostOption(
    resolver: ConfigResolver,
    catchConfig: CatchConfig
): string | undefined {
    return catchConfig(() => {
        if (resolver.isCliProvided('serverHost')) {
            const explicitHost = resolver.resolveString('serverHost')
            if (explicitHost !== undefined) {
                const trimmed = explicitHost.trim()
                if (trimmed === '') throw new Error('Invalid blank --server-host.')
                return trimmed
            }
        }
        const rawMcpHost = process.env['MCP_HOST']
        if (rawMcpHost !== undefined && rawMcpHost.trim() !== '') {
            return rawMcpHost.trim()
        }
        const rawHostEnv = process.env['HOST']
        if (rawHostEnv !== undefined && rawHostEnv.trim() !== '') {
            return rawHostEnv.trim()
        }
        if (resolver.hasConfigFileKey('serverHost')) {
            const configHost = resolver.resolveString('serverHost')
            if (configHost !== undefined) {
                const trimmed = configHost.trim()
                if (trimmed === '') {
                    throw new Error('Invalid blank serverHost in configuration file.')
                }
                return trimmed
            }
        }
        return undefined
    }, undefined)
}

export function resolveToolFilterOption(
    resolver: ConfigResolver,
    catchConfig: CatchConfig
): string | undefined {
    return catchConfig(() => {
        if (resolver.isCliProvided('toolFilter')) {
            const cliVal = resolver.resolveString('toolFilter')
            if (cliVal !== undefined) {
                const trimmed = cliVal.trim()
                if (trimmed === '') throw new Error('Invalid blank --tool-filter.')
                return trimmed
            }
        }
        const rawEnv = process.env['MEMORY_JOURNAL_MCP_TOOL_FILTER']
        if (rawEnv !== undefined && rawEnv !== '') {
            const trimmed = rawEnv.trim()
            if (trimmed === '') {
                throw new Error('Invalid blank MEMORY_JOURNAL_MCP_TOOL_FILTER environment variable.')
            }
            return trimmed
        }
        if (resolver.hasConfigFileKey('toolFilter')) {
            const cfgVal = resolver.resolveString('toolFilter')
            if (cfgVal !== undefined) {
                const trimmed = cfgVal.trim()
                if (trimmed === '') throw new Error('Invalid blank toolFilter in configuration file.')
                return trimmed
            }
        }
        return undefined
    }, undefined)
}

export function resolveOAuthJwksUriOption(resolver: ConfigResolver): string | undefined {
    if (resolver.isCliProvided('oauthJwksUri')) {
        const cliVal = resolver.resolveString('oauthJwksUri')
        if (cliVal !== undefined) {
            const trimmed = cliVal.trim()
            if (trimmed === '') throw new Error('Invalid blank --oauth-jwks-uri.')
            return trimmed
        }
    }
    const rawEnv = process.env['OAUTH_JWKS_URI']
    if (rawEnv !== undefined && rawEnv !== '') {
        const trimmed = rawEnv.trim()
        if (trimmed === '') {
            throw new Error('Invalid blank OAUTH_JWKS_URI environment variable.')
        }
        return trimmed
    }
    if (typeof resolver.hasConfigFileKey === 'function' && resolver.hasConfigFileKey('oauthJwksUri')) {
        const cfgVal = resolver.resolveString('oauthJwksUri')
        if (cfgVal !== undefined) {
            const trimmed = cfgVal.trim()
            if (trimmed === '') throw new Error('Invalid blank oauthJwksUri in configuration file.')
            return trimmed
        }
    }
    const fallbackVal = resolver.resolveString('oauthJwksUri', 'OAUTH_JWKS_URI')
    return fallbackVal !== undefined && fallbackVal.trim() !== '' ? fallbackVal.trim() : undefined
}

function parseCorsOriginsValue(
    raw: unknown,
    label: string,
    allowEmptyAsEmptyArray: boolean
): string[] {
    if (typeof raw === 'string') {
        if (raw === '' && allowEmptyAsEmptyArray) return []
        if (raw.trim() === '') {
            throw new Error(`Invalid ${label}: value cannot be empty or whitespace.`)
        }
        const list = raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        if (list.length === 0) {
            throw new Error(`Invalid ${label}: value cannot be empty or whitespace.`)
        }
        return list
    }
    if (Array.isArray(raw)) {
        if (raw.length === 0 && allowEmptyAsEmptyArray) return []
        const list = raw
            .map((item) => {
                if (typeof item !== 'string') {
                    throw new Error(`Invalid ${label}: entries must be strings.`)
                }
                return item.trim()
            })
            .filter(Boolean)
        if (list.length === 0) {
            throw new Error(`Invalid ${label}: value cannot be empty or whitespace.`)
        }
        return list
    }
    throw new Error(`Invalid ${label}: expected string or string array.`)
}

export function resolveCorsOriginsOption(resolver: ConfigResolver): string[] | undefined {
    if (resolver.isCliProvided('corsOrigin')) {
        const cliVal = resolver.resolve('corsOrigin')
        if (cliVal !== undefined) return parseCorsOriginsValue(cliVal, '--cors-origin', false)
    }
    const rawCorsEnv = process.env['CORS_ORIGIN']
    if (rawCorsEnv !== undefined && rawCorsEnv !== '') {
        return parseCorsOriginsValue(rawCorsEnv, 'CORS_ORIGIN', false)
    }
    if (typeof resolver.hasConfigFileKey === 'function' && resolver.hasConfigFileKey('corsOrigin')) {
        const cfgVal = resolver.resolve('corsOrigin')
        if (cfgVal !== undefined) {
            return parseCorsOriginsValue(cfgVal, 'corsOrigin in configuration file', true)
        }
    }
    const rawAmbientEnv = process.env['MCP_CORS_ORIGIN']
    if (rawAmbientEnv !== undefined && rawAmbientEnv !== '') {
        return parseCorsOriginsValue(rawAmbientEnv, 'MCP_CORS_ORIGIN', false)
    }
    return undefined
}

import {
    DUMMY_DIR_LIST_TOOL_NAMES,
    DUMMY_FILE_VIEW_TOOL_NAMES,
    DUMMY_GET_PROMPT_TOOL_NAMES,
    DUMMY_GREP_SEARCH_TOOL_NAMES,
} from '../../../handlers/tools/core/dummy-healing.js'
import { applyArgInterceptions } from '../../../handlers/tools/arg-interceptions.js'
import {
    captureActiveProjectRegistryState,
    restoreActiveProjectRegistryState,
    setActiveProjectRegistry,
} from '../../../codemode/normalizers/project-alias-helpers.js'
import type { BriefingConfig } from '../../../handlers/resources/shared.js'
import type { ToolHandlerConfig } from '../../../types/index.js'
import { logAgentIssue } from '../../../utils/issue-logger.js'
import { parseCanonicalPositiveInt } from '../../../utils/safe-positive-int.js'
import type { ServerRuntime } from '../../../utils/maintenance-lock.js'
import {
    findCanonicalRegistryKey,
    loadProjectRegistryFromConfig,
} from '../../../utils/workspace-resolver.js'
import type { ServerOptions } from '../types.js'
import { formatTokenEstimatedError, type ToolCallParams } from './call-interceptor-helpers.js'
import {
    isCreateWorkspaceScopeTool,
    resolveMcpCreateWorkspaceScope,
} from './create-scope-interceptor.js'
import type { resolveActiveBriefingConfig } from './register-tools-helpers.js'
import { ALREADY_HEALED_ARGS } from './healed-args-marker.js'

export { ALREADY_HEALED_ARGS }

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const UPPERCASE_RE = /[A-Z]/

const ALIASED_EXECUTE_CODE_NAMES = new Set([
    'mysql_execute_code',
    'mysqlExecuteCode',
    'execute_code',
    'executeCode',
    'mjExecuteCode',
    'mj_eval',
    'eval_code',
    'run_code',
    'exec_code',
    'code_execute',
])

const EXECUTE_CODE_TOOL_NAMES = new Set(['mj_execute_code', ...ALIASED_EXECUTE_CODE_NAMES])
const GET_PROMPT_TOOL_NAMES = new Set(DUMMY_GET_PROMPT_TOOL_NAMES)

const ALIASED_LIST_PROJECTS_NAMES = new Set([
    'listProjects',
    'list-projects',
    'get_projects',
    'getProjects',
    'get-projects',
    'mj_list_projects',
    'mjListProjects',
    'mj_get_projects',
    'mjGetProjects',
    'mj_admin_list_projects',
    'mj_admin_get_projects',
])

const ALIASED_GET_PROJECT_NAMES = new Set([
    'getProject',
    'get-project',
    'mj_get_project',
    'mjGetProject',
    'mj_admin_get_project',
])

const ALIASED_GREP_SEARCH_NAMES = new Set(DUMMY_GREP_SEARCH_TOOL_NAMES)
const ALIASED_VIEW_FILE_NAMES = new Set(
    DUMMY_FILE_VIEW_TOOL_NAMES.filter((name) => name !== 'cat')
)
const ALIASED_LIST_DIR_NAMES = new Set(
    DUMMY_DIR_LIST_TOOL_NAMES.filter((name) => name !== 'ls' && name !== 'dir')
)

const EXECUTE_CODE_OPAQUE_KEYS = new Set(['context'])
const GET_PROMPT_OPAQUE_KEYS = new Set(['arguments'])

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toSnakeKey(key: string): string {
    if (!UPPERCASE_RE.test(key)) return key
    return key
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase()
}

function resolveOpaqueTopLevelKeys(toolName: string | undefined): ReadonlySet<string> | undefined {
    if (toolName === undefined || toolName === '') return undefined
    if (EXECUTE_CODE_TOOL_NAMES.has(toolName)) return EXECUTE_CODE_OPAQUE_KEYS
    if (GET_PROMPT_TOOL_NAMES.has(toolName)) return GET_PROMPT_OPAQUE_KEYS
    return undefined
}

const OPAQUE_ANY_DEPTH_KEYS = new Set(['auto_context', 'prompt'])

function needsSnakeCaseNormalization(
    value: unknown,
    depth: number,
    opaqueTopLevelKeys?: ReadonlySet<string>
): boolean {
    if (depth > 12) return false
    if (Array.isArray(value)) {
        return value.some((item) => needsSnakeCaseNormalization(item, depth + 1))
    }
    if (!isPlainRecord(value)) return false
    for (const k in value) {
        if (!Object.hasOwn(value, k)) continue
        if (FORBIDDEN_KEYS.has(k)) return true
        if (UPPERCASE_RE.test(k)) return true
        if (
            OPAQUE_ANY_DEPTH_KEYS.has(k) ||
            (depth === 0 && opaqueTopLevelKeys?.has(k) === true)
        ) {
            continue
        }
        if (needsSnakeCaseNormalization(value[k], depth + 1)) return true
    }
    return false
}

/**
 * Recursively normalize camelCase/PascalCase object keys to snake_case while honoring
 * explicit `snake_case` precedence, undefined collisions, and opaque bag fields.
 */
export function deepCamelToSnake(
    obj: unknown,
    depth = 0,
    opaqueTopLevelKeys?: ReadonlySet<string>
): unknown {
    if (depth > 12) return obj
    if (Array.isArray(obj)) {
        if (depth === 0 && !needsSnakeCaseNormalization(obj, 0, opaqueTopLevelKeys)) return obj
        return obj.map((item) => deepCamelToSnake(item, depth + 1))
    }
    if (!isPlainRecord(obj)) return obj
    if (depth === 0 && !needsSnakeCaseNormalization(obj, 0, opaqueTopLevelKeys)) return obj

    const newObj: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
        if (FORBIDDEN_KEYS.has(k)) continue
        const snakeKey = toSnakeKey(k)
        if (FORBIDDEN_KEYS.has(snakeKey)) continue
        if (k !== snakeKey && Object.hasOwn(obj, snakeKey) && obj[snakeKey] !== undefined) {
            continue
        }
        if (v === undefined && Object.hasOwn(newObj, snakeKey) && newObj[snakeKey] !== undefined) {
            continue
        }
        if (
            k !== snakeKey &&
            v === undefined &&
            (Object.hasOwn(obj, snakeKey) || Object.hasOwn(newObj, snakeKey))
        ) {
            continue
        }
        if (
            OPAQUE_ANY_DEPTH_KEYS.has(snakeKey) ||
            (depth === 0 && opaqueTopLevelKeys?.has(snakeKey) === true)
        ) {
            newObj[snakeKey] = v
            continue
        }
        newObj[snakeKey] = deepCamelToSnake(v, depth + 1)
    }
    return newObj
}

function isSingleSlashRepoSlug(value: string): boolean {
    if (
        value.includes('\\') ||
        value.startsWith('/') ||
        value.startsWith('./') ||
        value.startsWith('../') ||
        /^[A-Za-z]:/.test(value)
    ) {
        return false
    }
    const parts = value.split('/')
    return parts.length === 2 && parts[0] !== '' && parts[1] !== ''
}

function safeRegistryLookup(
    registry: Record<string, { path?: string | undefined; project_number?: number | undefined } | undefined>,
    key: string
): { path?: string | undefined; project_number?: number | undefined } | undefined {
    return Object.hasOwn(registry, key) && !FORBIDDEN_KEYS.has(key) ? registry[key] : undefined
}

function resolveRegistryCandidate(
    strVal: string,
    registry: Record<string, { path?: string | undefined; project_number?: number | undefined } | undefined>
): { canonicalKey: string; entry: { path?: string | undefined; project_number?: number | undefined } | undefined } {
    const trimmedPath = strVal.trim().replace(/[\\/]+$/, '')
    if (isSingleSlashRepoSlug(trimmedPath)) {
        const directSlugKey = findCanonicalRegistryKey(trimmedPath, registry)
        const canonicalKey = directSlugKey ?? trimmedPath
        return { canonicalKey, entry: safeRegistryLookup(registry, canonicalKey) }
    }
    const candidate =
        trimmedPath.includes('/') || trimmedPath.includes('\\')
            ? (trimmedPath.split(/[\\/]/).pop() ?? strVal)
            : trimmedPath || strVal
    const canonicalKey = findCanonicalRegistryKey(candidate, registry) ?? candidate
    return {
        canonicalKey,
        entry: safeRegistryLookup(registry, canonicalKey) ?? safeRegistryLookup(registry, strVal),
    }
}

function resolveProjectNumberFromHint(
    toolArgs: Record<string, unknown>,
    options: ServerOptions
): void {
    // [INVARIANT] A `repo`/`project` string is only a lookup hint: `project_number` is assigned
    // solely after it resolves to a valid positive integer (H3). Unresolved hints never leak
    // into `project_number` as raw strings.
    let repoHint: string | undefined
    if (toolArgs['project_number'] === undefined) {
        const hasExplicitOwner =
            typeof toolArgs['owner'] === 'string' && toolArgs['owner'].trim() !== ''
        const repoStr =
            !hasExplicitOwner && typeof toolArgs['repo'] === 'string'
                ? toolArgs['repo']
                : typeof toolArgs['project'] === 'string'
                  ? toolArgs['project']
                  : undefined
        if (repoStr !== undefined && repoStr.trim() !== '') repoHint = repoStr
    }
    const rawProject = toolArgs['project_number']
    if (typeof rawProject === 'string') {
        const parsed = parseCanonicalPositiveInt(rawProject)
        if (parsed !== undefined) toolArgs['project_number'] = parsed
        return
    }
    if (repoHint === undefined) return
    const parsedHint = parseCanonicalPositiveInt(repoHint)
    if (parsedHint !== undefined) {
        toolArgs['project_number'] = parsedHint
        return
    }

    const strVal = repoHint
    const registry = options.projectRegistry ?? loadProjectRegistryFromConfig()
    if (registry === undefined) return

    const { canonicalKey, entry } = resolveRegistryCandidate(strVal, registry)
    const rawWorkspace = toolArgs['workspace_id']
    const workspaceMissing = rawWorkspace === undefined
    const existingWorkspace =
        typeof rawWorkspace === 'string' && rawWorkspace.trim() !== ''
            ? (findCanonicalRegistryKey(rawWorkspace, registry) ?? rawWorkspace.trim())
            : undefined
    const sameWorkspace = existingWorkspace?.toLowerCase() === canonicalKey.toLowerCase()
    // A repo-name project_number may fill a missing workspace, not a different concrete one.
    // Explicit workspace `default` stays on that workspace.
    if (entry?.project_number !== undefined && (workspaceMissing || sameWorkspace)) {
        toolArgs['project_number'] = entry.project_number
    }
    if (workspaceMissing && entry !== undefined) {
        toolArgs['workspace_id'] = canonicalKey
    }
}

export function resolveToolNameAlias(currentName: string | undefined): string | undefined {
    if (currentName === undefined || currentName === '') return undefined
    if (ALIASED_EXECUTE_CODE_NAMES.has(currentName)) return 'mj_execute_code'
    if (currentName === 'create_entry_minimal') return 'create_entry'
    if (ALIASED_LIST_PROJECTS_NAMES.has(currentName)) return 'list_projects'
    if (ALIASED_GET_PROJECT_NAMES.has(currentName)) return 'get_project'
    if (ALIASED_GREP_SEARCH_NAMES.has(currentName)) return 'grep_search'
    if (ALIASED_VIEW_FILE_NAMES.has(currentName)) return 'view_file'
    if (ALIASED_LIST_DIR_NAMES.has(currentName)) return 'list_dir'
    return undefined
}

function applyToolNameAlias(reqParams: ToolCallParams, toolArgs: Record<string, unknown>): void {
    const aliased = resolveToolNameAlias(reqParams.name)
    if (aliased === undefined) return
    if (reqParams.name === 'create_entry_minimal' && toolArgs['entry_type'] === undefined) {
        toolArgs['entry_type'] = 'personal_reflection'
    }
    reqParams.name = aliased
}

const PROJECT_REGISTRY_TOOL_NAMES = new Set([
    'get_project',
    'list_projects',
    'register_project',
    'update_project',
    'delete_project',
])

export function normalizeAndAliasToolCall(
    reqParams: ToolCallParams,
    options: ServerOptions
): void {
    if (!isPlainRecord(reqParams.arguments)) {
        return
    }
    const opaqueKeys = resolveOpaqueTopLevelKeys(reqParams.name)
    const normalized = deepCamelToSnake(reqParams.arguments, 0, opaqueKeys)
    if (!isPlainRecord(normalized)) {
        return
    }
    reqParams.arguments = normalized
    applyToolNameAlias(reqParams, reqParams.arguments)
    if (!PROJECT_REGISTRY_TOOL_NAMES.has(reqParams.name ?? '')) {
        resolveProjectNumberFromHint(reqParams.arguments, options)
    }
}

export function applyCreateWorkspaceScope(
    reqParams: ToolCallParams | undefined,
    customToolHandlerConfig: ToolHandlerConfig,
    liveBriefing: BriefingConfig,
    runtime: ServerRuntime
): void {
    if (
        reqParams === undefined ||
        !isCreateWorkspaceScopeTool(reqParams.name) ||
        !isPlainRecord(reqParams.arguments)
    ) {
        return
    }
    resolveMcpCreateWorkspaceScope(reqParams.name, reqParams.arguments, {
        ...customToolHandlerConfig,
        briefingConfig: liveBriefing,
        runtime,
        ...(liveBriefing.projectRegistry !== undefined
            ? { projectRegistry: liveBriefing.projectRegistry }
            : {}),
        ...(liveBriefing.defaultProjectNumber !== undefined
            ? { defaultProjectNumber: liveBriefing.defaultProjectNumber }
            : {}),
        ...(liveBriefing.defaultWorkspaceId !== undefined
            ? { defaultWorkspaceId: liveBriefing.defaultWorkspaceId }
            : {}),
    })
}

function runArgInterceptionForCall(
    params: ToolCallParams,
    inputArg: unknown,
    projectRegistry?: ServerOptions['projectRegistry']
): ReturnType<typeof formatTokenEstimatedError> | undefined {
    const toolName = params.name
    if (toolName === undefined || toolName === '') return undefined

    const prevRegistryState = captureActiveProjectRegistryState()
    setActiveProjectRegistry(projectRegistry)
    let intercept: ReturnType<typeof applyArgInterceptions>
    try {
        intercept = applyArgInterceptions(toolName, [inputArg])
    } finally {
        restoreActiveProjectRegistryState(prevRegistryState)
    }

    if ('error' in intercept) {
        const errorResult = intercept.error
        const errorMsg =
            typeof errorResult['error'] === 'string' ? errorResult['error'] : 'Validation Error'
        logAgentIssue({
            source: 'MCP',
            action: toolName,
            input: inputArg,
            error: errorMsg,
        })
        return formatTokenEstimatedError(errorResult, true)
    }

    const normalizedArgs = intercept.args?.[0]
    if (isPlainRecord(normalizedArgs)) {
        params.arguments = normalizedArgs
    }
    return undefined
}

/**
 * Coerce/heal raw incoming MCP `tools/call` params using live briefing context.
 */
export function healIncomingToolCallParams(
    params: ToolCallParams,
    options: ServerOptions,
    liveBriefing: ReturnType<typeof resolveActiveBriefingConfig>
): ReturnType<typeof formatTokenEstimatedError> | undefined {
    const rawArgs: unknown = params.arguments
    if (
        rawArgs === undefined ||
        rawArgs === null ||
        (typeof rawArgs !== 'object' && !Array.isArray(rawArgs))
    ) {
        params.arguments = {}
    }
    const healerOptions: ServerOptions = {
        transport: options.transport,
        dbPath: options.dbPath,
        ...(liveBriefing.projectRegistry !== undefined
            ? { projectRegistry: liveBriefing.projectRegistry }
            : {}),
    }

    if (Array.isArray(params.arguments)) {
        const errResp = runArgInterceptionForCall(
            params,
            params.arguments,
            liveBriefing.projectRegistry
        )
        if (errResp !== undefined) return errResp
    }
    normalizeAndAliasToolCall(params, healerOptions)
    const errResp = runArgInterceptionForCall(params, params.arguments, liveBriefing.projectRegistry)
    if (errResp !== undefined) return errResp
    if (isPlainRecord(params.arguments)) {
        ALREADY_HEALED_ARGS.add(params.arguments)
    }
    return undefined
}

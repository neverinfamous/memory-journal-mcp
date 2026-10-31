import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import type { ToolDefinition, ToolContext } from '../../../types/index.js'
import { VERSION } from '../../../version.js'
import { getCoreTools } from './tools.js'
import { getSearchTools } from '../search/index.js'
import { getAdminTools } from '../admin/index.js'
import { getCodeModeTools } from '../codemode/handler.js'
import { safeString } from '../schemas.js'
import { getPrompt, getPrompts } from '../../prompts/index.js'
import { readResource, getResources } from '../../resources/index.js'
import {
    assertSafeDirectoryPath,
    assertSafeFilePath,
    PathTraversalError,
} from '../../../utils/security-utils.js'

export const DUMMY_DOTTED_TOOL_NAMES = [
    'mj.core.createEntry',
    'mj.core.create_entry',
    'mj.core.searchEntries',
    'mj.core.search_entries',
    'mj.core.getRecentEntries',
    'mj.core.get_recent_entries',
    'mj.core.getEntryById',
    'mj.core.get_entry_by_id',
    'mj.core.updateEntry',
    'mj.core.update_entry',
    'mj.core.deleteEntry',
    'mj.core.delete_entry',
    'mj.core.listProjects',
    'mj.core.list_projects',
    'mj.core.getProjects',
    'mj.core.get_projects',
    'mj.core.getProject',
    'mj.core.get_project',
    'mj.admin.listProjects',
    'mj.admin.list_projects',
    'mj.admin.getProjects',
    'mj.admin.get_projects',
    'mj.admin.getProject',
    'mj.admin.get_project',
    'mj.projects.listProjects',
    'mj.projects.list_projects',
    'mj.projects.list',
    'mj.projects',
    'mj.admin.listProjects',
    'mj.admin.list_projects',
]

export const DUMMY_PROMPT_TOOL_NAMES = [
    'load-briefing',
    'load_briefing',
    'loadBriefing',
    'briefing',
    'session-summary',
    'session_summary',
    'sessionSummary',
    'mj_session_summary',
    'team-session-summary',
    'team_session_summary',
    'prepare-standup',
    'prepare_standup',
    'prepare-retro',
    'prepare_retro',
    'weekly-digest',
    'weekly_digest',
    'git-impact-search',
    'git_impact_search',
    'git-velocity-report',
    'git_velocity_report',
    'git-audit-trust',
    'git_audit_trust',
]

export const DUMMY_RESOURCE_TOOL_NAMES = [
    'read_resource',
    'mj_read_resource',
    'memory_read_resource',
    'memoryReadResource',
    'memory_journal_read_resource',
    'readResource',
    'read-resource',
    'get_resource',
    'getResource',
    'get-resource',
    'memory_get_resource',
    'memoryGetResource',
    'mj_get_resource',
    'mjGetResource',
    'read_memory_resource',
]

export const DUMMY_LIST_RESOURCE_TOOL_NAMES = [
    'list_resources',
    'listResources',
    'list-resources',
    'mj_list_resources',
    'mjListResources',
    'memory_list_resources',
    'memoryListResources',
    'memory_journal_list_resources',
    'get_resources',
    'getResources',
    'get-resources',
    'memory_get_resources',
    'memoryGetResources',
]

export const DUMMY_LIST_PROMPT_TOOL_NAMES = [
    'list_prompts',
    'listPrompts',
    'list-prompts',
    'mj_list_prompts',
    'mjListPrompts',
    'memory_list_prompts',
    'memoryListPrompts',
    'memory_journal_list_prompts',
    'get_prompts',
    'getPrompts',
]

export const DUMMY_LIST_TOOL_NAMES = [
    'list_tools',
    'listTools',
    'list-tools',
    'mj_list_tools',
    'mjListTools',
    'memory_list_tools',
    'memoryListTools',
    'memory_journal_list_tools',
    'get_tools',
    'getTools',
]

export const DUMMY_GET_PROMPT_TOOL_NAMES = [
    'get_prompt',
    'getPrompt',
    'mj_get_prompt',
    'mjGetPrompt',
    'memory_get_prompt',
    'memoryGetPrompt',
    'memory_journal_get_prompt',
    'read_prompt',
    'readPrompt',
]

export const DUMMY_SQL_EXECUTION_TOOL_NAMES = [
    'sqlite_execute_code',
    'sqlite_execute_query',
    'sqlite_query',
    'execute_sql',
    'sql_query',
    'query_database',
    'execute_query',
    'execute_code',
    'exec_code',
    'run_code',
    'eval_code',
    'mj_execute_sql',
    'mj_sqlite_execute_code',
    'better_sqlite3',
    'better-sqlite3',
    'sqlite3',
    'child_process',
    'cp',
]

export const DUMMY_ENTRY_CREATION_TOOL_NAMES = [
    'add_journal_entry',
    'mj_add_journal_entry',
    'add_entry',
    'mj_add_entry',
    'insert_entry',
    'mj_insert_entry',
    'create_journal_entry',
    'mj_create_journal_entry',
    'log_entry',
    'mj_log_entry',
    'log_journal',
    'mj_log_journal',
    'save_entry',
    'mj_save_entry',
    'append_entry',
    'mj_append_entry',
    'add_journal',
    'mj_add_journal',
    'create_memory',
    'mj_create_memory',
    'write_entry',
    'mj_write_entry',
    'new_entry',
    'mj_new_entry',
    'record_entry',
    'mj_record_entry',
]

export const DUMMY_SERVER_INFO_TOOL_NAMES = [
    'server_info',
    'serverInfo',
    'server-info',
    'mj_server_info',
    'get_server_info',
    'getServerInfo',
    'server_health',
    'serverHealth',
    'server-health',
    'mj_server_health',
    'get_server_health',
    'getServerHealth',
    'health_check',
    'healthCheck',
    'health-check',
    'server_status',
    'serverStatus',
    'server-status',
    'status',
    'health',
]
export const DUMMY_PROJECT_TOOL_NAMES = [
    'list_projects',
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
    'get_project',
    'getProject',
    'get-project',
    'mj_get_project',
    'mjGetProject',
    'mj_admin_get_project',
]

export const DUMMY_ADAPTER_TOOL_NAMES = [
    'list_adapters',
    'listAdapters',
    'list-adapters',
    'mj_list_adapters',
    'mjListAdapters',
    'get_adapters',
    'getAdapters',
    'get-adapters',
    'adapters',
]

export const DUMMY_GREP_SEARCH_TOOL_NAMES = [
    'grep_search',
    'grepSearch',
    'grep',
    'file_search',
    'fileSearch',
    'find_in_files',
    'findInFiles',
    'search_files',
    'searchFiles',
]

export const DUMMY_FILE_VIEW_TOOL_NAMES = [
    'view_file',
    'viewFile',
    'read_file',
    'readFile',
    'cat',
    'get_file',
    'getFile',
]

export const DUMMY_DIR_LIST_TOOL_NAMES = [
    'list_dir',
    'listDir',
    'read_dir',
    'readDir',
    'ls',
    'dir',
]

export const DUMMY_HEALING_TOOL_NAMES = new Set<string>([
    'create_entry',
    ...DUMMY_ENTRY_CREATION_TOOL_NAMES,
    'search_entries',
    'get_recent_entries',
    'get_entry_by_id',
    'update_entry',
    'delete_entry',
    ...DUMMY_RESOURCE_TOOL_NAMES,
    ...DUMMY_LIST_RESOURCE_TOOL_NAMES,
    ...DUMMY_PROMPT_TOOL_NAMES,
    ...DUMMY_LIST_PROMPT_TOOL_NAMES,
    ...DUMMY_LIST_TOOL_NAMES,
    ...DUMMY_GET_PROMPT_TOOL_NAMES,
    ...DUMMY_SQL_EXECUTION_TOOL_NAMES,
    ...DUMMY_SERVER_INFO_TOOL_NAMES,
    ...DUMMY_PROJECT_TOOL_NAMES,
    ...DUMMY_ADAPTER_TOOL_NAMES,
    ...DUMMY_GREP_SEARCH_TOOL_NAMES,
    ...DUMMY_FILE_VIEW_TOOL_NAMES,
    ...DUMMY_DIR_LIST_TOOL_NAMES,
    'mj_core_create_entry',
    'mj_core_search_entries',
    'mj_core_get_recent_entries',
    'mj_core_get_entry_by_id',
    'mj_core_update_entry',
    'mj_core_delete_entry',
    'mj_admin_get_project',
    'mj_admin_list_projects',
    ...DUMMY_DOTTED_TOOL_NAMES,
])

export interface GrepMatch {
    file: string
    line: number
    text: string
}

export function searchDirectory(
    dir: string,
    query: string,
    options: {
        filePattern?: string
        caseInsensitive?: boolean
        isRegex?: boolean
        maxResults?: number
    }
): GrepMatch[] {
    const results: GrepMatch[] = []
    const maxResults = typeof options.maxResults === 'number' ? options.maxResults : 500

    let matcher: RegExp
    try {
        if (options.isRegex === true) {
            matcher = new RegExp(query, options.caseInsensitive === true ? 'i' : '')
        } else {
            const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            matcher = new RegExp(escaped, options.caseInsensitive === true ? 'i' : '')
        }
    } catch {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        matcher = new RegExp(escaped, options.caseInsensitive === true ? 'i' : '')
    }

    const IGNORED_DIRS = new Set(['node_modules', '.git', '.test-output', 'dist', '.cache', 'coverage', '.turbo'])

    function traverse(currentDir: string): void {
        if (results.length >= maxResults) return
        let entries: fs.Dirent[]
        try {
            entries = fs.readdirSync(currentDir, { withFileTypes: true })
        } catch {
            return
        }

        for (const entry of entries) {
            if (results.length >= maxResults) break
            const fullPath = path.join(currentDir, entry.name)

            if (entry.isDirectory()) {
                if (!IGNORED_DIRS.has(entry.name)) {
                    traverse(fullPath)
                }
            } else if (entry.isFile()) {
                if (options.filePattern !== undefined && options.filePattern.length > 0) {
                    const pattern = options.filePattern.toLowerCase()
                    const name = entry.name.toLowerCase()
                    if (pattern.startsWith('*.')) {
                        const ext = pattern.slice(1)
                        if (!name.endsWith(ext)) continue
                    } else {
                        const cleanPattern = pattern.replace(/^\*+/, '').replace(/\*+$/, '')
                        if (cleanPattern.length > 0 && !name.includes(cleanPattern)) {
                            continue
                        }
                    }
                }

                try {
                    const content = fs.readFileSync(fullPath, 'utf-8')
                    if (content.length > 2 * 1024 * 1024) continue
                    const lines = content.split('\n')
                    for (let i = 0; i < lines.length; i++) {
                        if (results.length >= maxResults) break
                        const line = lines[i]
                        if (typeof line === 'string' && matcher.test(line)) {
                            results.push({
                                file: fullPath,
                                line: i + 1,
                                text: line.trimEnd(),
                            })
                        }
                    }
                } catch {
                    // Skip unreadable or locked files
                }
            }
        }
    }

    traverse(dir)
    return results
}

function extractUriFromArgs(args: Record<string, unknown>): string | undefined {
    let uri = typeof args['uri'] === 'string' ? args['uri'] : (typeof args['Uri'] === 'string' ? args['Uri'] : (typeof args['_uri'] === 'string' ? args['_uri'] : undefined))
    if (!uri) {
        for (const key of ['resourceUri', 'resource_uri', 'resource', 'Resource', 'url', 'Url', 'path', 'Path', 'name', 'Name', 'target', 'Target', 'ServerName', 'server_name']) {
            const rawVal = args[key]
            if (typeof rawVal === 'string' && rawVal.trim()) {
                const val = rawVal.trim()
                if (key === 'ServerName' || key === 'server_name') {
                    if (val === 'memory-journal-mcp' || val === 'memory-journal') {
                        continue
                    }
                }
                uri = val
                break
            }
        }
    }
    if (uri && !uri.includes('://')) {
        if (uri.startsWith('briefing') || uri.startsWith('recent') || uri.startsWith('agent-') || uri.startsWith('statistics') || uri.startsWith('insights') || uri.startsWith('help') || uri.startsWith('health') || uri.startsWith('team') || uri.startsWith('git') || uri.startsWith('tools')) {
            uri = `memory://${uri}`
        } else {
            uri = `memory://briefing/${uri}`
        }
    }
    return uri
}

export function getDummyHealingTools(context?: ToolContext): ToolDefinition[] {
    const handleReadResource = async (params: unknown, toolName: string): Promise<unknown> => {
        const args = (params ?? {}) as Record<string, unknown>
        let uri = extractUriFromArgs(args)
        if (!uri && context) {
            uri = 'memory://briefing'
        }

        if (context && uri) {
            try {
                const res = await readResource(
                    uri,
                    context.db,
                    context.vectorManager,
                    context.config?.filterConfig,
                    context.github,
                    undefined,
                    context.teamDb,
                    context.config?.briefingConfig,
                    context.config?.runtime
                )
                return {
                    success: true,
                    data: res.data,
                    _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool instead of an MCP resource read. The resource '${uri}' was resolved successfully.`
                }
            } catch (err) {
                return {
                    success: false,
                    error: `Failed to read resource '${uri}': ${err instanceof Error ? err.message : String(err)}`,
                    code: 'RESOURCE_ERROR',
                    category: 'resource',
                    recoverable: true
                }
            }
        }

        const hint = uri ? ` Requested URI: ${uri}.` : ''
        return {
            success: false,
            error: `🛠️ AUTONOMOUS HEALING: '${toolName}' is an MCP protocol resource method, not an MCP tool.${hint} Use native agent tool 'read_resource' / 'read_file', or query via 'mj_execute_code'.`,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true
        }
    }

    const handlePrompt = async (params: unknown, promptName: string): Promise<unknown> => {
        const rawArgs = (params ?? {}) as Record<string, unknown>
        const stringArgs: Record<string, string> = {}
        for (const [k, v] of Object.entries(rawArgs)) {
            if (typeof v === 'string') stringArgs[k] = v
            else if (typeof v === 'number' || typeof v === 'boolean') stringArgs[k] = String(v)
        }

        const canonicalPromptName = promptName
            .replace(/^mj_/, '')
            .replace(/_/g, '-')
            .replace(/([a-z])([A-Z])/g, '$1-$2')
            .toLowerCase()

        if (canonicalPromptName === 'load-briefing' || canonicalPromptName === 'briefing') {
            if (!stringArgs['projects']) {
                const fallbackProject = stringArgs['project'] ?? stringArgs['name'] ?? stringArgs['target'] ?? stringArgs['repo'] ?? stringArgs['workspace'] ?? ''
                stringArgs['projects'] = fallbackProject
            }
        }

        if (context) {
            try {
                const result = await getPrompt(
                    canonicalPromptName === 'briefing' ? 'load-briefing' : canonicalPromptName,
                    stringArgs,
                    context.db,
                    context.teamDb,
                    context.github,
                    context.config?.briefingConfig
                )
                return {
                    success: true,
                    data: result,
                    messages: result.messages,
                    _healing_note: `🛠️ AUTONOMOUS HEALING: '${promptName}' is an MCP Prompt, but was invoked directly as an MCP tool. The prompt was evaluated and returned successfully.`
                }
            } catch (err) {
                return {
                    success: false,
                    error: `Failed to execute prompt '${promptName}': ${err instanceof Error ? err.message : String(err)}`,
                    code: 'PROMPT_ERROR',
                    category: 'prompt',
                    recoverable: true
                }
            }
        }

        return {
            success: false,
            error: `🛠️ AUTONOMOUS HEALING: '${promptName}' is an MCP Prompt, not an MCP Tool. Please fetch it via the Prompts API or use the 'prompts/list' endpoint.`,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true
        }
    }

    const handleListResources = (toolName: string): unknown => {
        return {
            success: true,
            resources: getResources(),
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool instead of an MCP protocol request (resources/list). The available resources were returned successfully.`
        }
    }

    const handleListPrompts = (toolName: string): unknown => {
        return {
            success: true,
            prompts: getPrompts(),
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool instead of an MCP protocol request (prompts/list). The available prompts were returned successfully.`
        }
    }

    const handleListTools = (toolName: string): unknown => {
        let toolsList: { name: string; title?: string; description?: string; group?: string }[] = []
        if (context) {
            toolsList = [
                ...getCoreTools(context),
                ...getSearchTools(context),
                ...getAdminTools(context),
            ].map(t => ({
                name: t.name,
                title: t.title,
                description: t.description,
                group: t.group
            }))
        }
        return {
            success: true,
            tools: toolsList,
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool instead of an MCP protocol request (tools/list). The available tools were returned successfully.`
        }
    }

    const handleServerInfo = async (_params: unknown, toolName: string): Promise<unknown> => {
        let healthData: Record<string, unknown> | undefined
        if (context) {
            try {
                const res = await readResource(
                    'memory://health',
                    context.db,
                    context.vectorManager,
                    context.config?.filterConfig,
                    context.github,
                    undefined,
                    context.teamDb,
                    context.config?.briefingConfig,
                    context.config?.runtime
                )
                if (typeof res.data === 'object' && res.data !== null) {
                    healthData = res.data as Record<string, unknown>
                }
            } catch {
                // Fallback to manual db status if readResource fails
            }
        }

        const dbHealth = healthData ?? context?.db.getHealthStatus()

        return {
            success: true,
            status: 'healthy',
            server: {
                name: 'memory-journal-mcp',
                version: VERSION,
                description: 'Memory Journal MCP Server with Code Mode & Semantic Search',
            },
            runtime: {
                nodeVersion: process.version,
                platform: process.platform,
                uptimeSeconds: Math.floor(process.uptime()),
            },
            ...(healthData !== undefined ? { health: healthData } : {}),
            ...(dbHealth !== undefined ? { database: dbHealth } : {}),
            capabilities: {
                codemode: true,
                resources: true,
                prompts: true,
                tools: true,
            },
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool. Returned server diagnostic information and health status successfully.`,
        }
    }

    const handleListAdapters = (toolName: string): unknown => {
        const adapters = [
            {
                name: 'sqlite',
                type: 'database',
                driver: 'better-sqlite3',
                status: 'connected',
                primary: true,
                description: 'Primary SQLite storage engine for journal entries, tags, and relationships',
            },
            {
                name: 'sqlite-vec',
                type: 'vector',
                driver: 'sqlite-vec',
                status: context?.vectorManager !== undefined && context.vectorManager !== null ? 'connected' : 'ready',
                description: 'Native vector embeddings and semantic search engine',
            },
            {
                name: 'team',
                type: 'database',
                driver: 'better-sqlite3',
                status: context?.teamDb !== undefined && context.teamDb !== null ? 'connected' : 'disabled',
                description: 'Collaborative team journal database adapter',
            },
            {
                name: 'github',
                type: 'integration',
                driver: 'octokit / gh',
                status: context?.github !== undefined && context.github !== null ? 'connected' : 'disabled',
                description: 'GitHub synchronization and issue tracking adapter',
            },
        ]

        return {
            success: true,
            adapters,
            default_adapter: 'sqlite',
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool. Returned registered database and service adapters successfully.`,
        }
    }

    const handleGrepSearch = async (params: unknown, toolName: string): Promise<unknown> => {
        const raw = (params ?? {}) as Record<string, unknown>
        const rawArgs: Record<string, unknown> = { ...raw }
        for (const [k, v] of Object.entries(raw)) {
            const stripped = k.replace(/^_+/, '')
            if (stripped.length > 0 && rawArgs[stripped] === undefined) {
                rawArgs[stripped] = v
            }
        }
        const query = typeof rawArgs['query'] === 'string' ? rawArgs['query'] :
            (typeof rawArgs['Query'] === 'string' ? rawArgs['Query'] :
            (typeof rawArgs['pattern'] === 'string' ? rawArgs['pattern'] :
            (typeof rawArgs['text'] === 'string' ? rawArgs['text'] :
            (typeof rawArgs['search'] === 'string' ? rawArgs['search'] :
            (typeof rawArgs['q'] === 'string' ? rawArgs['q'] : '')))))

        const rawPath = typeof rawArgs['search_path'] === 'string' ? rawArgs['search_path'] :
            (typeof rawArgs['SearchPath'] === 'string' ? rawArgs['SearchPath'] :
            (typeof rawArgs['searchPath'] === 'string' ? rawArgs['searchPath'] :
            (typeof rawArgs['path'] === 'string' ? rawArgs['path'] :
            (typeof rawArgs['Path'] === 'string' ? rawArgs['Path'] :
            (typeof rawArgs['dir'] === 'string' ? rawArgs['dir'] :
            (typeof rawArgs['directory'] === 'string' ? rawArgs['directory'] :
            (typeof rawArgs['cwd'] === 'string' ? rawArgs['cwd'] : undefined)))))))

        const filePattern = typeof rawArgs['file_pattern'] === 'string' ? rawArgs['file_pattern'] :
            (typeof rawArgs['FilePattern'] === 'string' ? rawArgs['FilePattern'] :
            (typeof rawArgs['filePattern'] === 'string' ? rawArgs['filePattern'] : undefined))

        const caseInsensitive = rawArgs['case_insensitive'] === true || rawArgs['CaseInsensitive'] === true || rawArgs['caseInsensitive'] === true || rawArgs['ignore_case'] === true
        const isRegex = rawArgs['is_regex'] === true || rawArgs['IsRegex'] === true || rawArgs['isRegex'] === true

        const allowedRoots = context?.config?.allowedIoRoots ?? []
        let searchPath = rawPath
        if (typeof searchPath === 'string' && searchPath.trim() !== '') {
            searchPath = path.resolve(searchPath.trim())
        }

        if (typeof searchPath === 'string') {
            try {
                assertSafeDirectoryPath(searchPath, allowedRoots)
            } catch (err) {
                return {
                    success: false,
                    error: `Failed to execute grep search on '${searchPath}': ${err instanceof Error ? err.message : String(err)}`,
                    code: err instanceof PathTraversalError ? 'PATH_TRAVERSAL' : 'SEARCH_ERROR',
                    category: err instanceof PathTraversalError ? 'validation' : 'search',
                    recoverable: false,
                }
            }
        }

        if (typeof searchPath === 'string' && fs.existsSync(searchPath)) {
            try {
                const stat = fs.statSync(searchPath)
                const targetDir = stat.isDirectory() ? searchPath : path.dirname(searchPath)
                if (stat.isFile()) {
                    assertSafeFilePath(searchPath, allowedRoots)
                }
                const targetPattern = stat.isFile() && filePattern === undefined ? path.basename(searchPath) : filePattern

                const matches = searchDirectory(targetDir, query, {
                    filePattern: targetPattern,
                    caseInsensitive,
                    isRegex,
                })

                return {
                    success: true,
                    matches,
                    totalMatches: matches.length,
                    searchPath: targetDir,
                    _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' is an agent-native tool, but was invoked directly as an MCP tool. The search was performed on the filesystem and results returned successfully.`,
                }
            } catch (err) {
                return {
                    success: false,
                    error: `Failed to execute grep search on '${searchPath}': ${err instanceof Error ? err.message : String(err)}`,
                    code: err instanceof PathTraversalError ? 'PATH_TRAVERSAL' : 'SEARCH_ERROR',
                    category: err instanceof PathTraversalError ? 'validation' : 'search',
                    recoverable: !(err instanceof PathTraversalError),
                }
            }
        }

        // If search_path is not a directory or not provided, route to search_entries if query is present
        if (context && query.trim() !== '') {
            const searchTools = getSearchTools(context)
            const searchTool = searchTools.find((t: ToolDefinition) => t.name === 'search_entries')
            if (searchTool) {
                try {
                    const searchResult = await Promise.resolve(searchTool.handler({ query }))
                    if (typeof searchResult === 'object' && searchResult !== null && (searchResult as Record<string, unknown>)['success'] !== false) {
                        return {
                            success: true,
                            ...(searchResult as Record<string, unknown>),
                            _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was invoked as an MCP tool without a local directory path. It was automatically routed to journal 'search_entries' and executed successfully.`,
                        }
                    }
                } catch {
                    // Fall through to empty matches
                }
            }
        }

        return {
            success: true,
            matches: [],
            totalMatches: 0,
            _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was executed, but directory was not found or yielded 0 matches. For codebase search, provide a valid 'search_path'. For journal search, use 'search_entries'.`,
        }
    }

    const handleViewFile = (params: unknown, toolName: string): unknown => {
        const raw = (params ?? {}) as Record<string, unknown>
        const rawArgs: Record<string, unknown> = { ...raw }
        for (const [k, v] of Object.entries(raw)) {
            const stripped = k.replace(/^_+/, '')
            if (stripped.length > 0 && rawArgs[stripped] === undefined) {
                rawArgs[stripped] = v
            }
        }
        const targetPath = typeof rawArgs['path'] === 'string' ? rawArgs['path'] :
            (typeof rawArgs['Path'] === 'string' ? rawArgs['Path'] :
            (typeof rawArgs['target_file'] === 'string' ? rawArgs['target_file'] :
            (typeof rawArgs['targetFile'] === 'string' ? rawArgs['targetFile'] :
            (typeof rawArgs['target'] === 'string' ? rawArgs['target'] :
            (typeof rawArgs['Target'] === 'string' ? rawArgs['Target'] :
            (typeof rawArgs['absolute_path'] === 'string' ? rawArgs['absolute_path'] :
            (typeof rawArgs['AbsolutePath'] === 'string' ? rawArgs['AbsolutePath'] :
            (typeof rawArgs['file'] === 'string' ? rawArgs['file'] :
            (typeof rawArgs['File'] === 'string' ? rawArgs['File'] :
            (typeof rawArgs['filename'] === 'string' ? rawArgs['filename'] :
            (typeof rawArgs['fileName'] === 'string' ? rawArgs['fileName'] : undefined)))))))))))

        if (targetPath === undefined || targetPath.trim() === '') {
            return {
                success: false,
                error: `🛠️ AUTONOMOUS HEALING: '${toolName}' requires a valid file path parameter ('path' or 'AbsolutePath').`,
                code: 'VALIDATION_ERROR',
                category: 'validation',
                recoverable: true,
            }
        }

        if (targetPath.includes('://')) {
            return handleReadResource(params, toolName)
        }

        const resolved = path.resolve(targetPath.trim())
        const allowedRoots = context?.config?.allowedIoRoots ?? []
        try {
            assertSafeFilePath(resolved, allowedRoots)
        } catch (err) {
            return {
                success: false,
                error: err instanceof Error ? err.message : String(err),
                code: err instanceof PathTraversalError ? 'PATH_TRAVERSAL' : 'VALIDATION_ERROR',
                category: 'validation',
                recoverable: false,
            }
        }

        if (!fs.existsSync(resolved)) {
            return {
                success: false,
                error: `🛠️ AUTONOMOUS HEALING: File not found at '${targetPath}'.`,
                code: 'NOT_FOUND',
                category: 'filesystem',
                recoverable: true,
            }
        }

        try {
            const content = fs.readFileSync(resolved, 'utf-8')
            const startLine = typeof rawArgs['start_line'] === 'number' ? rawArgs['start_line'] : (typeof rawArgs['StartLine'] === 'number' ? rawArgs['StartLine'] : undefined)
            const endLine = typeof rawArgs['end_line'] === 'number' ? rawArgs['end_line'] : (typeof rawArgs['EndLine'] === 'number' ? rawArgs['EndLine'] : undefined)

            let outputContent = content
            if (startLine !== undefined || endLine !== undefined) {
                const lines = content.split('\n')
                const start = Math.max(1, startLine ?? 1) - 1
                const end = Math.min(lines.length, endLine ?? lines.length)
                outputContent = lines.slice(start, end).join('\n')
            }

            return {
                success: true,
                path: resolved,
                content: outputContent,
                _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' is an agent-native tool, but was invoked directly as an MCP tool. File read successfully from disk.`,
            }
        } catch (err) {
            return {
                success: false,
                error: `Failed to read file '${targetPath}': ${err instanceof Error ? err.message : String(err)}`,
                code: 'IO_ERROR',
                category: 'filesystem',
                recoverable: true,
            }
        }
    }

    const handleListDir = (params: unknown, toolName: string): unknown => {
        const raw = (params ?? {}) as Record<string, unknown>
        const rawArgs: Record<string, unknown> = { ...raw }
        for (const [k, v] of Object.entries(raw)) {
            const stripped = k.replace(/^_+/, '')
            if (stripped.length > 0 && rawArgs[stripped] === undefined) {
                rawArgs[stripped] = v
            }
        }
        const targetDir = typeof rawArgs['dir_path'] === 'string' ? rawArgs['dir_path'] :
            (typeof rawArgs['dirPath'] === 'string' ? rawArgs['dirPath'] :
            (typeof rawArgs['path'] === 'string' ? rawArgs['path'] :
            (typeof rawArgs['Path'] === 'string' ? rawArgs['Path'] :
            (typeof rawArgs['directory'] === 'string' ? rawArgs['directory'] :
            (typeof rawArgs['Directory'] === 'string' ? rawArgs['Directory'] :
            (typeof rawArgs['target'] === 'string' ? rawArgs['target'] :
            (typeof rawArgs['Target'] === 'string' ? rawArgs['Target'] : undefined)))))))

        const dirToRead = typeof targetDir === 'string' && targetDir.trim() !== '' ? path.resolve(targetDir.trim()) : process.cwd()
        const allowedRoots = context?.config?.allowedIoRoots ?? []
        try {
            assertSafeDirectoryPath(dirToRead, allowedRoots)
        } catch (err) {
            return {
                success: false,
                error: err instanceof Error ? err.message : String(err),
                code: err instanceof PathTraversalError ? 'PATH_TRAVERSAL' : 'VALIDATION_ERROR',
                category: 'validation',
                recoverable: false,
            }
        }

        if (!fs.existsSync(dirToRead)) {
            return {
                success: false,
                error: `🛠️ AUTONOMOUS HEALING: Directory not found at '${dirToRead}'.`,
                code: 'NOT_FOUND',
                category: 'filesystem',
                recoverable: true,
            }
        }

        try {
            const dirents = fs.readdirSync(dirToRead, { withFileTypes: true })
            const entries = dirents.map(d => ({
                name: d.name,
                isDirectory: d.isDirectory(),
                isFile: d.isFile(),
            }))

            return {
                success: true,
                path: dirToRead,
                entries,
                _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' is an agent-native tool, but was invoked directly as an MCP tool. Directory listed successfully from disk.`,
            }
        } catch (err) {
            return {
                success: false,
                error: `Failed to list directory '${dirToRead}': ${err instanceof Error ? err.message : String(err)}`,
                code: 'IO_ERROR',
                category: 'filesystem',
                recoverable: true,
            }
        }
    }

    const handleGetPrompt = async (params: unknown, toolName: string): Promise<unknown> => {
        const rawArgs = (params ?? {}) as Record<string, unknown>
        const targetPromptName = typeof rawArgs['name'] === 'string' ? rawArgs['name'] : (typeof rawArgs['prompt'] === 'string' ? rawArgs['prompt'] : (typeof rawArgs['prompt_name'] === 'string' ? rawArgs['prompt_name'] : 'load-briefing'))
        const nestedArgs = (typeof rawArgs['arguments'] === 'object' && rawArgs['arguments'] !== null ? rawArgs['arguments'] : rawArgs) as Record<string, unknown>
        const stringArgs: Record<string, string> = {}
        for (const [k, v] of Object.entries(nestedArgs)) {
            if (k !== 'name' && k !== 'prompt' && k !== 'prompt_name' && k !== 'arguments') {
                if (typeof v === 'string') stringArgs[k] = v
                else if (typeof v === 'number' || typeof v === 'boolean') stringArgs[k] = String(v)
            }
        }
        if (context) {
            try {
                const result = await getPrompt(
                    targetPromptName,
                    stringArgs,
                    context.db,
                    context.teamDb,
                    context.github,
                    context.config?.briefingConfig
                )
                return {
                    success: true,
                    data: result,
                    messages: result.messages,
                    _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was called as an MCP tool instead of an MCP protocol request (prompts/get). The prompt '${targetPromptName}' was evaluated successfully.`
                }
            } catch (err) {
                return {
                    success: false,
                    error: `Failed to execute prompt '${targetPromptName}': ${err instanceof Error ? err.message : String(err)}`,
                    code: 'PROMPT_ERROR',
                    category: 'prompt',
                    recoverable: true
                }
            }
        }
        return {
            success: false,
            error: `🛠️ AUTONOMOUS HEALING: '${toolName}' is an MCP Prompt protocol method. Context is not initialized.`,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true
        }
    }

    const handleCreateEntry = async (params: unknown, toolName: string): Promise<unknown> => {
        const rawArgs = (params ?? {}) as Record<string, unknown>
        const args: Record<string, unknown> = { ...rawArgs }

        // Normalize topic -> tags
        if (args['topic'] !== undefined && args['tags'] === undefined) {
            args['tags'] = [args['topic']]
        } else if (args['topic'] !== undefined && Array.isArray(args['tags'])) {
            const existingTags = args['tags'] as unknown[]
            args['tags'] = [...existingTags, args['topic']]
        }

        // Normalize type -> entry_type
        if (args['type'] !== undefined && args['entry_type'] === undefined) {
            args['entry_type'] = args['type']
        }
        if (args['category'] !== undefined && args['entry_type'] === undefined) {
            args['entry_type'] = args['category']
        }

        // Unwrap nested 'entry' object if provided
        if (typeof args['entry'] === 'object' && args['entry'] !== null && !Array.isArray(args['entry'])) {
            const nested = args['entry'] as Record<string, unknown>
            delete args['entry']
            for (const [k, v] of Object.entries(nested)) {
                if (args[k] === undefined && v !== undefined) {
                    args[k] = v
                }
            }
        }

        // Normalize text / description / message / body / instructions / details / entry -> content
        if (args['content'] === undefined) {
            const alt = args['entry'] ?? args['text'] ?? args['description'] ?? args['message'] ?? args['body'] ?? args['instructions'] ?? args['details'] ?? args['notes'] ?? args['summary'] ?? args['markdown'] ?? args['post'] ?? args['journal_entry'] ?? args['journalEntry'] ?? args['entry_text'] ?? args['entryText']
            if (typeof alt === 'string') {
                args['content'] = alt
            }
        }
        delete args['entry']
        delete args['text']
        delete args['description']
        delete args['message']
        delete args['body']
        delete args['instructions']
        delete args['details']
        delete args['notes']
        delete args['summary']
        delete args['markdown']
        delete args['post']
        delete args['journal_entry']
        delete args['journalEntry']
        delete args['entry_text']
        delete args['entryText']

        // Normalize title / heading / subject / name -> content or title
        const rawTitle = args['title'] ?? args['heading'] ?? args['subject'] ?? args['name']
        if (rawTitle !== undefined && rawTitle !== null) {
            const titleStr = safeString(rawTitle).trim()
            if (titleStr !== '') {
                const cleanTitle = titleStr.replace(/^#+\s*/, '')
                const currentContent = safeString(args['content']).trim()
                if (args['content'] === undefined || args['content'] === null || currentContent === '') {
                    args['content'] = `# ${cleanTitle}`
                } else if (!currentContent.startsWith(`# ${cleanTitle}`)) {
                    args['content'] = `# ${cleanTitle}\n\n${currentContent}`
                }
            }
            delete args['title']
            delete args['heading']
            delete args['subject']
            delete args['name']
        }

        // Normalize project -> project_number / workspace_id
        if (args['project'] !== undefined) {
            if (args['project_number'] === undefined) {
                if (typeof args['project'] === 'number') {
                    args['project_number'] = args['project']
                } else if (typeof args['project'] === 'string') {
                    const parsedNum = Number(args['project'])
                    if (!Number.isNaN(parsedNum) && args['project'].trim() !== '') {
                        args['project_number'] = parsedNum
                    } else if (args['workspace_id'] === undefined || args['workspace_id'] === 'default') {
                        args['workspace_id'] = args['project']
                    }
                }
            }
            delete args['project']
        }
        if (args['project_id'] !== undefined) {
            if (args['project_number'] === undefined && typeof args['project_id'] === 'number') {
                args['project_number'] = args['project_id']
            }
            delete args['project_id']
        }
        if (args['projectId'] !== undefined) {
            if (args['project_number'] === undefined && typeof args['projectId'] === 'number') {
                args['project_number'] = args['projectId']
            }
            delete args['projectId']
        }

        // Normalize confidence / trust -> trust_score
        if (args['confidence'] !== undefined) {
            if (args['trust_score'] === undefined) {
                args['trust_score'] = typeof args['confidence'] === 'string' ? Number(args['confidence']) : args['confidence']
            }
            delete args['confidence']
        }
        if (args['trust'] !== undefined) {
            if (args['trust_score'] === undefined) {
                args['trust_score'] = typeof args['trust'] === 'string' ? Number(args['trust']) : args['trust']
            }
            delete args['trust']
        }
        if (args['trustScore'] !== undefined) {
            if (args['trust_score'] === undefined) {
                args['trust_score'] = typeof args['trustScore'] === 'string' ? Number(args['trustScore']) : args['trustScore']
            }
            delete args['trustScore']
        }

        // Normalize impact / impactScore -> impact_score
        if (args['impact'] !== undefined) {
            if (args['impact_score'] === undefined) {
                args['impact_score'] = typeof args['impact'] === 'string' ? Number(args['impact']) : args['impact']
            }
            delete args['impact']
        }
        if (args['impactScore'] !== undefined) {
            if (args['impact_score'] === undefined) {
                args['impact_score'] = typeof args['impactScore'] === 'string' ? Number(args['impactScore']) : args['impactScore']
            }
            delete args['impactScore']
        }

        // Normalize validation / validationStatus -> validation_status
        if (args['validation'] !== undefined) {
            if (args['validation_status'] === undefined) {
                args['validation_status'] = args['validation']
            }
            delete args['validation']
        }
        if (args['validationStatus'] !== undefined) {
            if (args['validation_status'] === undefined) {
                args['validation_status'] = args['validationStatus']
            }
            delete args['validationStatus']
        }
        if (args['validation_status'] !== undefined && args['validation_status'] !== null) {
            const vs = typeof args['validation_status'] === 'string' ? args['validation_status'].trim().toLowerCase() : args['validation_status']
            if (vs === true || vs === 'pass' || vs === 'success' || vs === 'ok' || vs === 'passed' || vs === 'validated' || vs === 'valid' || vs === 'verified' || vs === 'true' || vs === '1') {
                args['validation_status'] = 'passed'
            } else if (vs === false || vs === 'fail' || vs === 'failed' || vs === 'error' || vs === 'failing' || vs === 'false' || vs === '0') {
                args['validation_status'] = 'failed'
            } else if (vs === 'none' || vs === 'null' || vs === 'undefined' || vs === 'skip' || vs === 'skipped' || vs === 'unknown' || vs === 'pending') {
                args['validation_status'] = 'none'
            } else if (typeof vs === 'string' && !['passed', 'none', 'failed'].includes(vs)) {
                args['validation_status'] = 'none'
            }
        }

        // Normalize workspace aliases
        if (args['workspace'] !== undefined) {
            if (args['workspace_id'] === undefined) {
                args['workspace_id'] = args['workspace']
            }
            delete args['workspace']
        }
        if (args['repo'] !== undefined) {
            if (args['workspace_id'] === undefined) {
                args['workspace_id'] = args['repo']
            }
            delete args['repo']
        }
        if (args['repository'] !== undefined) {
            if (args['workspace_id'] === undefined) {
                args['workspace_id'] = args['repository']
            }
            delete args['repository']
        }

        if (context) {
            const coreTools = getCoreTools(context)
            const createTool = coreTools.find((t: ToolDefinition) => t.name === 'create_entry')
            if (createTool) {
                const result = await Promise.resolve(createTool.handler(args))
                if (typeof result === 'object' && result !== null) {
                    return {
                        ...(result as Record<string, unknown>),
                        _healing_note: `🛠️ AUTONOMOUS HEALING: '${toolName}' was invoked directly as an MCP tool. The entry was created successfully. In Code Mode, prefer using 'mj_execute_code' with 'mj.core.createEntry({ ... })'.`
                    }
                }
                return result
            }
        }
        return {
            success: false,
            error: `🛠️ AUTONOMOUS HEALING: '${toolName}' is not directly active in Code Mode. Use 'mj_execute_code' with 'mj.core.createEntry({ ... })'.`,
            code: 'VALIDATION_ERROR',
            category: 'validation',
            recoverable: true
        }
    }

    return [
        ...['create_entry', ...DUMMY_ENTRY_CREATION_TOOL_NAMES].map((name): ToolDefinition => ({
            name,
            title: `Create Entry (${name} Fallback)`,
            description: `Fallback handler for \`${name}\` when called directly as an MCP tool.`,
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: false, openWorldHint: false },
            handler: async (params: unknown) => handleCreateEntry(params, name),
        })),
        {
            name: 'search_entries',
            title: 'Search Entries (Code Mode Fallback)',
            description: 'Fallback handler for `search_entries` when called directly in Code Mode.',
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: async (params: unknown) => {
                const args = (params ?? {}) as Record<string, unknown>
                if (context) {
                    const searchTools = getSearchTools(context)
                    const searchTool = searchTools.find((t: ToolDefinition) => t.name === 'search_entries')
                    if (searchTool) {
                        const result = await Promise.resolve(searchTool.handler(args))
                        if (typeof result === 'object' && result !== null) {
                            return {
                                ...(result as Record<string, unknown>),
                                _healing_note: '🛠️ AUTONOMOUS HEALING: `search_entries` was invoked directly while in Code Mode. Search completed successfully. In Code Mode, prefer using `mj_execute_code` with `mj.search.searchEntries({ ... })`.'
                            }
                        }
                        return result
                    }
                }
                return {
                    success: false,
                    error: '🛠️ AUTONOMOUS HEALING: `search_entries` is not directly active in Code Mode. Use `mj_execute_code` with `mj.search.searchEntries({ ... })`.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true
                }
            },
        },
        {
            name: 'get_recent_entries',
            title: 'Get Recent Entries (Code Mode Fallback)',
            description: 'Fallback handler for `get_recent_entries` when called directly in Code Mode.',
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: async (params: unknown) => {
                const args = (params ?? {}) as Record<string, unknown>
                if (context) {
                    const coreTools = getCoreTools(context)
                    const tool = coreTools.find((t: ToolDefinition) => t.name === 'get_recent_entries')
                    if (tool) {
                        return await Promise.resolve(tool.handler(args))
                    }
                }
                return {
                    success: false,
                    error: '🛠️ AUTONOMOUS HEALING: `get_recent_entries` is not directly active in Code Mode. Use `mj_execute_code` with `mj.core.getRecentEntries({ ... })`.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true
                }
            },
        },
        {
            name: 'get_entry_by_id',
            title: 'Get Entry By ID (Code Mode Fallback)',
            description: 'Fallback handler for `get_entry_by_id` when called directly in Code Mode.',
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: async (params: unknown) => {
                const args = (params ?? {}) as Record<string, unknown>
                if (context) {
                    const coreTools = getCoreTools(context)
                    const tool = coreTools.find((t: ToolDefinition) => t.name === 'get_entry_by_id')
                    if (tool) {
                        return await Promise.resolve(tool.handler(args))
                    }
                }
                return {
                    success: false,
                    error: '🛠️ AUTONOMOUS HEALING: `get_entry_by_id` is not directly active in Code Mode. Use `mj_execute_code` with `mj.core.getEntryById({ ... })`.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true
                }
            },
        },
        {
            name: 'update_entry',
            title: 'Update Entry (Code Mode Fallback)',
            description: 'Fallback handler for `update_entry` when called directly in Code Mode.',
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: false, openWorldHint: false },
            handler: async (params: unknown) => {
                const args = (params ?? {}) as Record<string, unknown>
                if (context) {
                    const coreTools = getCoreTools(context)
                    const tool = coreTools.find((t: ToolDefinition) => t.name === 'update_entry')
                    if (tool) {
                        return await Promise.resolve(tool.handler(args))
                    }
                }
                return {
                    success: false,
                    error: '🛠️ AUTONOMOUS HEALING: `update_entry` is not directly active in Code Mode. Use `mj_execute_code` with `mj.core.updateEntry({ ... })`.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true
                }
            },
        },
        {
            name: 'delete_entry',
            title: 'Delete Entry (Code Mode Fallback)',
            description: 'Fallback handler for `delete_entry` when called directly in Code Mode.',
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: false, openWorldHint: false },
            handler: async (params: unknown) => {
                const args = (params ?? {}) as Record<string, unknown>
                if (context) {
                    const coreTools = getCoreTools(context)
                    const tool = coreTools.find((t: ToolDefinition) => t.name === 'delete_entry')
                    if (tool) {
                        return await Promise.resolve(tool.handler(args))
                    }
                }
                return {
                    success: false,
                    error: '🛠️ AUTONOMOUS HEALING: `delete_entry` is not directly active in Code Mode. Use `mj_execute_code` with `mj.core.deleteEntry({ ... })`.',
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true
                }
            },
        },
        ...DUMMY_RESOURCE_TOOL_NAMES.map((name): ToolDefinition => ({
            name,
            title: `Read Resource (${name} Autonomous Fallback)`,
            description: `Fallback handler for \`${name}\` when invoked as an MCP tool instead of a protocol resource read.`,
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: (params: unknown) => handleReadResource(params, name),
        })),
        ...DUMMY_PROMPT_TOOL_NAMES.map((name): ToolDefinition => ({
            name,
            title: `Prompt Fallback (${name})`,
            description: `Fallback handler for \`${name}\` when invoked as an MCP tool instead of an MCP prompt.`,
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: (params: unknown) => handlePrompt(params, name),
        })),
        ...['mj_core_create_entry', 'mj_core_search_entries', 'mj_core_get_recent_entries', 'mj_core_get_entry_by_id', 'mj_core_update_entry', 'mj_core_delete_entry', 'mj_admin_get_project', 'mj_admin_list_projects'].map((name): ToolDefinition => ({
            name,
            title: `Code Mode Function Fallback (${name})`,
            description: `Fallback handler for \`${name}\` when called directly as an MCP tool.`,
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: false, openWorldHint: false },
            handler: async (params: unknown) => {
                const args = (params ?? {}) as Record<string, unknown>
                if (context) {
                    if (name === 'mj_core_create_entry') {
                        const tool = getCoreTools(context).find(t => t.name === 'create_entry')
                        if (tool) {
                            const res = await Promise.resolve(tool.handler(args))
                            return typeof res === 'object' && res !== null ? { ...(res as Record<string, unknown>), _healing_note: `🛠️ AUTONOMOUS HEALING: '${name}' was routed to 'create_entry' and executed successfully.` } : res
                        }
                    } else if (name === 'mj_core_search_entries') {
                        const tool = getSearchTools(context).find(t => t.name === 'search_entries')
                        if (tool) {
                            const res = await Promise.resolve(tool.handler(args))
                            return typeof res === 'object' && res !== null ? { ...(res as Record<string, unknown>), _healing_note: `🛠️ AUTONOMOUS HEALING: '${name}' was routed to 'search_entries' and executed successfully.` } : res
                        }
                    } else if (name === 'mj_core_get_recent_entries') {
                        const tool = getCoreTools(context).find(t => t.name === 'get_recent_entries')
                        if (tool) {
                            const res = await Promise.resolve(tool.handler(args))
                            return typeof res === 'object' && res !== null ? { ...(res as Record<string, unknown>), _healing_note: `🛠️ AUTONOMOUS HEALING: '${name}' was routed to 'get_recent_entries' and executed successfully.` } : res
                        }
                    } else if (name === 'mj_core_get_entry_by_id') {
                        const tool = getCoreTools(context).find(t => t.name === 'get_entry_by_id')
                        if (tool) {
                            const res = await Promise.resolve(tool.handler(args))
                            return typeof res === 'object' && res !== null ? { ...(res as Record<string, unknown>), _healing_note: `🛠️ AUTONOMOUS HEALING: '${name}' was routed to 'get_entry_by_id' and executed successfully.` } : res
                        }
                    } else if (name === 'mj_core_update_entry') {
                        const tool = getCoreTools(context).find(t => t.name === 'update_entry')
                        if (tool) {
                            const res = await Promise.resolve(tool.handler(args))
                            return typeof res === 'object' && res !== null ? { ...(res as Record<string, unknown>), _healing_note: `🛠️ AUTONOMOUS HEALING: '${name}' was routed to 'update_entry' and executed successfully.` } : res
                        }
                    } else if (name === 'mj_core_delete_entry') {
                        const tool = getCoreTools(context).find(t => t.name === 'delete_entry')
                        if (tool) {
                            const res = await Promise.resolve(tool.handler(args))
                            return typeof res === 'object' && res !== null ? { ...(res as Record<string, unknown>), _healing_note: `🛠️ AUTONOMOUS HEALING: '${name}' was routed to 'delete_entry' and executed successfully.` } : res
                        }
                    } else if (name === 'mj_admin_get_project') {
                        const tool = getAdminTools(context).find(t => t.name === 'get_project')
                        if (tool) {
                            const res = await Promise.resolve(tool.handler(args))
                            return typeof res === 'object' && res !== null ? { ...(res as Record<string, unknown>), _healing_note: `🛠️ AUTONOMOUS HEALING: '${name}' was routed to 'get_project' and executed successfully.` } : res
                        }
                    } else if (name === 'mj_admin_list_projects') {
                        const tool = getAdminTools(context).find(t => t.name === 'list_projects')
                        if (tool) {
                            const res = await Promise.resolve(tool.handler(args))
                            return typeof res === 'object' && res !== null ? { ...(res as Record<string, unknown>), _healing_note: `🛠️ AUTONOMOUS HEALING: '${name}' was routed to 'list_projects' and executed successfully.` } : res
                        }
                    }
                }
                const canonical = name.replace(/^mj_/, '').replace('_', '.')
                return {
                    success: false,
                    error: `🛠️ AUTONOMOUS HEALING: '${name}' is a Code Mode function, not a top-level MCP tool. Use 'mj_execute_code' with JavaScript (e.g. return await ${canonical}({ ... })).`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true
                }
            }
        })),
        ...DUMMY_DOTTED_TOOL_NAMES.map((name): ToolDefinition => ({
            name,
            title: `Code Mode Dotted Function Fallback (${name})`,
            description: `Fallback handler for \`${name}\` when called directly as an MCP tool.`,
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: false, openWorldHint: false },
            handler: async (params: unknown) => {
                const args = (params ?? {}) as Record<string, unknown>
                if (context) {
                    if (name.includes('createEntry') || name.includes('create_entry')) {
                        const tool = getCoreTools(context).find(t => t.name === 'create_entry')
                        if (tool) {
                            const res = await Promise.resolve(tool.handler(args))
                            return typeof res === 'object' && res !== null ? { ...(res as Record<string, unknown>), _healing_note: `🛠️ AUTONOMOUS HEALING: '${name}' was routed to 'create_entry' and executed successfully.` } : res
                        }
                    } else if (name.includes('searchEntries') || name.includes('search_entries')) {
                        const tool = getSearchTools(context).find(t => t.name === 'search_entries')
                        if (tool) {
                            const res = await Promise.resolve(tool.handler(args))
                            return typeof res === 'object' && res !== null ? { ...(res as Record<string, unknown>), _healing_note: `🛠️ AUTONOMOUS HEALING: '${name}' was routed to 'search_entries' and executed successfully.` } : res
                        }
                    } else if (name.includes('getRecentEntries') || name.includes('get_recent_entries')) {
                        const tool = getCoreTools(context).find(t => t.name === 'get_recent_entries')
                        if (tool) {
                            const res = await Promise.resolve(tool.handler(args))
                            return typeof res === 'object' && res !== null ? { ...(res as Record<string, unknown>), _healing_note: `🛠️ AUTONOMOUS HEALING: '${name}' was routed to 'get_recent_entries' and executed successfully.` } : res
                        }
                    } else if (name.includes('getEntryById') || name.includes('get_entry_by_id')) {
                        const tool = getCoreTools(context).find(t => t.name === 'get_entry_by_id')
                        if (tool) {
                            const res = await Promise.resolve(tool.handler(args))
                            return typeof res === 'object' && res !== null ? { ...(res as Record<string, unknown>), _healing_note: `🛠️ AUTONOMOUS HEALING: '${name}' was routed to 'get_entry_by_id' and executed successfully.` } : res
                        }
                    } else if (name.includes('updateEntry') || name.includes('update_entry')) {
                        const tool = getCoreTools(context).find(t => t.name === 'update_entry')
                        if (tool) {
                            const res = await Promise.resolve(tool.handler(args))
                            return typeof res === 'object' && res !== null ? { ...(res as Record<string, unknown>), _healing_note: `🛠️ AUTONOMOUS HEALING: '${name}' was routed to 'update_entry' and executed successfully.` } : res
                        }
                    } else if (name.includes('deleteEntry') || name.includes('delete_entry')) {
                        const tool = getCoreTools(context).find(t => t.name === 'delete_entry')
                        if (tool) {
                            const res = await Promise.resolve(tool.handler(args))
                            return typeof res === 'object' && res !== null ? { ...(res as Record<string, unknown>), _healing_note: `🛠️ AUTONOMOUS HEALING: '${name}' was routed to 'delete_entry' and executed successfully.` } : res
                        }
                    } else if (name.includes('getProject') || name.includes('get_project')) {
                        const tool = getAdminTools(context).find(t => t.name === 'get_project')
                        if (tool) {
                            const res = await Promise.resolve(tool.handler(args))
                            return typeof res === 'object' && res !== null ? { ...(res as Record<string, unknown>), _healing_note: `🛠️ AUTONOMOUS HEALING: '${name}' was routed to 'get_project' and executed successfully.` } : res
                        }
                    } else if (name.includes('listProjects') || name.includes('list_projects')) {
                        const tool = getAdminTools(context).find(t => t.name === 'list_projects')
                        if (tool) {
                            const res = await Promise.resolve(tool.handler(args))
                            return typeof res === 'object' && res !== null ? { ...(res as Record<string, unknown>), _healing_note: `🛠️ AUTONOMOUS HEALING: '${name}' was routed to 'list_projects' and executed successfully.` } : res
                        }
                    }
                }
                return {
                    success: false,
                    error: `🛠️ AUTONOMOUS HEALING: '${name}' is a Code Mode JavaScript function, not a top-level MCP tool. Use 'mj_execute_code' with JavaScript (e.g. return await ${name}({ ... })).`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true
                }
            }
        })),
        ...DUMMY_LIST_RESOURCE_TOOL_NAMES.map((name): ToolDefinition => ({
            name,
            title: `List Resources Fallback (${name})`,
            description: `Fallback handler for \`${name}\` when called directly as an MCP tool.`,
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: () => handleListResources(name),
        })),
        ...DUMMY_LIST_PROMPT_TOOL_NAMES.map((name): ToolDefinition => ({
            name,
            title: `List Prompts Fallback (${name})`,
            description: `Fallback handler for \`${name}\` when called directly as an MCP tool.`,
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: () => handleListPrompts(name),
        })),
        ...DUMMY_LIST_TOOL_NAMES.map((name): ToolDefinition => ({
            name,
            title: `List Tools Fallback (${name})`,
            description: `Fallback handler for \`${name}\` when called directly as an MCP tool.`,
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: () => handleListTools(name),
        })),
        ...DUMMY_GET_PROMPT_TOOL_NAMES.map((name): ToolDefinition => ({
            name,
            title: `Get Prompt Fallback (${name})`,
            description: `Fallback handler for \`${name}\` when called directly as an MCP tool.`,
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: async (params: unknown) => handleGetPrompt(params, name),
        })),
        ...DUMMY_SQL_EXECUTION_TOOL_NAMES.map((name): ToolDefinition => ({
            name,
            title: `SQL / Code Mode Execution Fallback (${name})`,
            description: `Fallback handler for \`${name}\` when called directly as an MCP tool. Routes automatically to \`mj_execute_code\`.`,
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: false, openWorldHint: false },
            handler: async (params: unknown) => {
                if (context) {
                    const codemodeTools = getCodeModeTools(context)
                    const codemodeTool = codemodeTools.find((t: ToolDefinition) => t.name === 'mj_execute_code')
                    if (codemodeTool) {
                        const res = await Promise.resolve(codemodeTool.handler(params))
                        if (typeof res === 'object' && res !== null) {
                            return {
                                ...(res as Record<string, unknown>),
                                _healing_note: `🛠️ AUTONOMOUS HEALING: '${name}' was called as an MCP tool. It was automatically translated and executed via Code Mode ('mj_execute_code').`,
                            }
                        }
                        return res
                    }
                }
                return {
                    success: false,
                    error: `🛠️ AUTONOMOUS HEALING: '${name}' was called, but direct SQLite execution tools are not active in memory-journal-mcp. Use 'mj_execute_code' with JavaScript (e.g. return await mj.core.getRecentEntries({ limit: 10 })).`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true,
                }
            },
        })),
        ...DUMMY_SERVER_INFO_TOOL_NAMES.map((name): ToolDefinition => ({
            name,
            title: `Server Info & Health Diagnostics Fallback (${name})`,
            description: `Fallback handler for \`${name}\` when called directly as an MCP tool. Returns server metadata, runtime status, and diagnostics.`,
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: async (params: unknown) => handleServerInfo(params, name),
        })),
        ...DUMMY_PROJECT_TOOL_NAMES.map((name): ToolDefinition => ({
            name,
            title: `Project Tool Fallback (${name})`,
            description: `Fallback handler for \`${name}\` when called directly as an MCP tool. Returns project registry info.`,
            group: 'admin',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: async (params: unknown) => {
                const args = (params ?? {}) as Record<string, unknown>;
                const isGetter = name.toLowerCase().includes('get_project') || name.toLowerCase().includes('getproject') && !name.toLowerCase().includes('projects');
                const targetTool = isGetter ? 'get_project' : 'list_projects';
                
                if (context) {
                    const tool = getAdminTools(context).find(t => t.name === targetTool);
                    if (tool) {
                        const res = await Promise.resolve(tool.handler(args));
                        return typeof res === 'object' && res !== null ? { ...(res as Record<string, unknown>), _healing_note: `🛠️ AUTONOMOUS HEALING: '${name}' was routed to '${targetTool}' and executed successfully.` } : res;
                    }
                }
                return {
                    success: false,
                    error: `🛠️ AUTONOMOUS HEALING: '${name}' failed because admin tools are not available.`,
                    code: 'VALIDATION_ERROR',
                    category: 'validation',
                    recoverable: true
                };
            }
        })),
        ...DUMMY_ADAPTER_TOOL_NAMES.map((name): ToolDefinition => ({
            name,
            title: `List Adapters Fallback (${name})`,
            description: `Fallback handler for \`${name}\` when called directly as an MCP tool. Returns available database and service adapters.`,
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: () => handleListAdapters(name),
        })),
        ...DUMMY_GREP_SEARCH_TOOL_NAMES.map((name): ToolDefinition => ({
            name,
            title: `Grep Search Fallback (${name})`,
            description: `Fallback handler for \`${name}\` when called directly as an MCP tool. Performs filesystem search or routes to journal search.`,
            group: 'search',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: async (params: unknown) => handleGrepSearch(params, name),
        })),
        ...DUMMY_FILE_VIEW_TOOL_NAMES.map((name): ToolDefinition => ({
            name,
            title: `View File Fallback (${name})`,
            description: `Fallback handler for \`${name}\` when called directly as an MCP tool. Reads file content from disk.`,
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: (params: unknown) => handleViewFile(params, name),
        })),
        ...DUMMY_DIR_LIST_TOOL_NAMES.map((name): ToolDefinition => ({
            name,
            title: `List Directory Fallback (${name})`,
            description: `Fallback handler for \`${name}\` when called directly as an MCP tool. Lists directory entries from disk.`,
            group: 'core',
            inputSchema: z.any(),
            outputSchema: z.any(),
            annotations: { readOnlyHint: true, openWorldHint: false },
            handler: (params: unknown) => handleListDir(params, name),
        }))
    ]
}

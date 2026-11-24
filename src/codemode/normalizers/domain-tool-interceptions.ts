import { healIncludeArchivedField } from '../../handlers/tools/schemas/hallucination-healer-fields.js'
import { isRecord } from './shared-utils.js'
import { applyGithubAndBackupInterceptions } from './github-and-backup-interceptions.js'

const IO_METHODS = [
    'export_entries', 'exportEntries', 'team_export_entries', 'teamExportEntries',
    'export_markdown', 'exportMarkdown', 'team_export_markdown', 'teamExportMarkdown',
    'import_markdown', 'importMarkdown', 'team_import_markdown', 'teamImportMarkdown',
    'import_external', 'importExternal', 'team_import_external', 'teamImportExternal',
]

const ANALYTICS_METHODS = [
    'get_statistics', 'getStatistics', 'get_cross_project_insights', 'getCrossProjectInsights',
    'team_get_statistics', 'teamGetStatistics', 'team_get_cross_project_insights', 'teamGetCrossProjectInsights',
    'get_collaboration_matrix', 'getCollaborationMatrix', 'team_get_collaboration_matrix', 'teamGetCollaborationMatrix',
]

function validationErr(error: string, suggestion: string): { error: Record<string, unknown> } {
    return { error: { success: false, error, code: 'VALIDATION_ERROR', category: 'validation', suggestion, recoverable: true } }
}

function remapKeys(obj: Record<string, unknown>, fromKeys: string[], targetKey: string): void {
    for (const k of fromKeys) {
        if (obj[k] !== undefined && obj[targetKey] === undefined) {
            obj[targetKey] = obj[k]
            Reflect.deleteProperty(obj, k)
        }
    }
}

const CONTEXT_PARAM_KEYS = ['maxTokens', 'max_tokens', 'temperature', 'model', 'top_p', 'topP'] as const
const ANALYTICS_FORBIDDEN_KEYS = ['q', 'query', 'search', 'text', 'message', 'description', 'path', 'keep', 'mode'] as const
const STATISTICS_METHOD_NAMES = new Set(['get_statistics', 'getStatistics', 'team_get_statistics', 'teamGetStatistics'])
const CROSS_PROJECT_METHOD_NAMES = new Set(['get_cross_project_insights', 'getCrossProjectInsights'])

function hasAnyKey(obj: Record<string, unknown>, keys: readonly string[]): boolean {
    return keys.some((k) => obj[k] !== undefined)
}

function applyConfigInterceptions(
    rawObj: Record<string, unknown>
): { obj: Record<string, unknown> } | { error: Record<string, unknown> } {
    const obj = isRecord(rawObj['config']) ? { ...rawObj, ...rawObj['config'] } : rawObj
    if (obj !== rawObj) delete obj['config']

    if (
        obj['update_notes'] !== undefined ||
        obj['notes'] !== undefined ||
        (obj['text'] !== undefined && obj['tool_filter'] === undefined && obj['briefing'] === undefined)
    ) {
        return validationErr(
            'update_configuration is for changing server configuration (tool_filter, briefing). To create journal entries or update notes, use mj.core.createEntry({ ... }).',
            "Use mj.core.createEntry({ content: '...', project_number: 1 }) instead."
        )
    }

    const hasContextParam = CONTEXT_PARAM_KEYS.find((k) => k in obj)
    if (hasContextParam !== undefined) {
        return validationErr(
            `Unrecognized key: "${hasContextParam}". update_configuration is for configuring the memory-journal-mcp server and does not support changing LLM context parameters.`,
            `Remove '${hasContextParam}' from the payload. Only tool_filter and briefing preferences are supported.`
        )
    }
    return { obj }
}

function applyAnalyticsInterceptions(
    methodName: string,
    rawObj: Record<string, unknown>
): { obj: Record<string, unknown> } | { error: Record<string, unknown> } {
    if (hasAnyKey(rawObj, ANALYTICS_FORBIDDEN_KEYS)) {
        return validationErr(
            `${methodName} does not support search queries, content parameters, or modes. It returns analytical data.`,
            'Remove these parameters. Use search_entries or team_search if you want to find specific content.'
        )
    }

    if (CROSS_PROJECT_METHOD_NAMES.has(methodName) && rawObj['limit'] !== undefined) {
        return validationErr('get_cross_project_insights does not accept a limit parameter. It analyzes all projects.', 'Remove the limit parameter.')
    }

    if (STATISTICS_METHOD_NAMES.has(methodName)) {
        const timeVal = rawObj['time'] ?? rawObj['timeframe'] ?? rawObj['period']
        if (timeVal !== undefined) {
            const obj = { ...rawObj }
            if (obj['group_by'] === undefined && typeof timeVal === 'string') {
                const lower = timeVal.toLowerCase()
                obj['group_by'] = lower === 'day' || lower === 'week' || lower === 'month' ? lower : 'month'
            }
            delete obj['time']
            delete obj['timeframe']
            delete obj['period']
            return { obj }
        }
    }

    return { obj: rawObj }
}

export function applyDomainToolInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    const singleObj = args.length === 1 && isRecord(args[0]) ? args[0] : undefined

    if (singleObj !== undefined && ['update_configuration', 'updateConfiguration', 'config', 'configure'].includes(methodName)) {
        const configRes = applyConfigInterceptions(singleObj)
        if ('error' in configRes) return configRes
        args[0] = configRes.obj
    }

    if (singleObj !== undefined && IO_METHODS.includes(methodName)) {
        const ioRes = applyIoInterceptions(methodName, singleObj)
        if ('error' in ioRes) return ioRes
        args[0] = ioRes.obj
    }

    if (
        singleObj !== undefined &&
        ['team_get_vector_index_stats', 'teamGetVectorIndexStats', 'get_vector_index_stats', 'getVectorIndexStats'].includes(methodName)
    ) {
        const obj = { ...singleObj }
        args[0] = obj
        if (hasAnyKey(obj, ['q', 'query', 'search', 'text', 'message', 'description', 'path'])) {
            return validationErr(`${methodName} does not support search queries. It returns overall index statistics.`, 'Remove the search query parameter.')
        }
    }

    if (
        ['rebuild_vector_index', 'rebuildVectorIndex', 'team_rebuild_vector_index', 'teamRebuildVectorIndex'].includes(methodName) &&
        args.length === 1 &&
        (typeof args[0] === 'boolean' || typeof args[0] === 'string' || typeof args[0] === 'number')
    ) {
        const personalRebuild = methodName === 'rebuild_vector_index' || methodName === 'rebuildVectorIndex'
        if (!personalRebuild || typeof args[0] !== 'number') {
            return validationErr(
                `${methodName} does not accept that positional value.`,
                personalRebuild
                    ? 'Pass a project number or an object with project_number.'
                    : 'Call team_rebuild_vector_index with no arguments.'
            )
        }
        args[0] = { project_number: args[0] }
    }

    if (
        singleObj !== undefined &&
        ['list_deleted_entries', 'listDeletedEntries', 'team_list_deleted_entries', 'teamListDeletedEntries'].includes(methodName)
    ) {
        const obj = { ...singleObj }
        args[0] = obj
        if (hasAnyKey(obj, ['q', 'query', 'search', 'text', 'message', 'description', 'path', 'mode'])) {
            return validationErr(`${methodName} does not support search queries, path, or mode. It returns all deleted entries.`, 'Remove these parameters.')
        }
        remapKeys(obj, ['keep'], 'limit')
        if (obj['project_id'] !== undefined) {
            obj['project_number'] ??= obj['project_id']
            delete obj['project_id']
        }
    }

    if (singleObj !== undefined && ANALYTICS_METHODS.includes(methodName)) {
        const analyticsRes = applyAnalyticsInterceptions(methodName, singleObj)
        if ('error' in analyticsRes) return analyticsRes
        args[0] = analyticsRes.obj
    }

    const ghBkRes = applyGithubAndBackupInterceptions(methodName, args)
    if ('error' in ghBkRes) return ghBkRes
    args = ghBkRes.args

    return applyMiscToolInterceptions(methodName, args)
}

function applyIoInterceptions(
    methodName: string,
    rawObj: Record<string, unknown>
): { obj: Record<string, unknown> } | { error: Record<string, unknown> } {
    const obj = { ...rawObj }
    remapKeys(obj, ['keep'], 'limit')

    if (hasAnyKey(obj, ['q', 'query', 'text', 'search', 'message', 'description'])) {
        return validationErr(
            `${methodName} does not support text search or content parameters. It only exports/imports data.`,
            'To search for specific text, use search_entries (or team_search). Otherwise, remove the search/content parameters.'
        )
    }

    if (obj['mode'] !== undefined) {
        return validationErr(`${methodName} does not support the 'mode' parameter.`, 'Remove the mode parameter.')
    }

    if (['export_entries', 'exportEntries', 'team_export_entries', 'teamExportEntries'].includes(methodName)) {
        if (hasAnyKey(obj, ['path', 'output_dir', 'file'])) {
            return validationErr(
                'export_entries returns the exported data directly and does not write to disk.',
                'Use export_markdown if you want to save files to a directory, or remove path/output_dir.'
            )
        }
    }

    const isExportMd = [
        'export_markdown',
        'exportMarkdown',
        'team_export_markdown',
        'teamExportMarkdown',
    ].includes(methodName)
    const isImportMd = [
        'import_markdown',
        'importMarkdown',
        'team_import_markdown',
        'teamImportMarkdown',
    ].includes(methodName)
    const isExternal = [
        'import_external',
        'importExternal',
        'team_import_external',
        'teamImportExternal',
    ].includes(methodName)

    for (const key of ['path', 'file', 'filepath', 'dir', 'folder', 'target', 'source']) {
        if (obj[key] !== undefined) {
            let didMap = false
            if (isExportMd) {
                if (obj['output_dir'] === undefined) obj['output_dir'] = obj[key]
                didMap = true
            } else if ((isImportMd || isExternal) && !(key === 'source' && isExternal)) {
                if (obj['source_dir'] === undefined) obj['source_dir'] = obj[key]
                didMap = true
            }
            if (didMap) Reflect.deleteProperty(obj, key)
        }
    }

    if (isExternal) {
        if (obj['url'] !== undefined || obj['link'] !== undefined) {
            return validationErr(
                'import_external does not download from URLs. It imports from a local directory (source_dir).',
                'Provide a local directory path in source_dir.'
            )
        }
        remapKeys(obj, ['format', 'source'], 'source_format')
    }

    return { obj }
}

function coerceRecentCursorToOffset(obj: Record<string, unknown>): void {
    if (typeof obj['cursor'] !== 'string') return
    const trimmed = obj['cursor'].trim()
    if (!/^(?:0|[1-9]\d*)$/.test(trimmed)) return
    const parsed = Number(trimmed)
    if (!Number.isSafeInteger(parsed) || String(parsed) !== trimmed) return
    if (obj['offset'] === undefined) obj['offset'] = parsed
    delete obj['cursor']
}

function applyEntryLinkRecentTagInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    if (args.length !== 1 || !isRecord(args[0])) return { args }
    if (['link_entries', 'linkEntries', 'team_link_entries', 'teamLinkEntries'].includes(methodName)) {
        const obj = { ...args[0] }
        args[0] = obj
        remapKeys(obj, ['source', 'from', 'source_id', 'from_id'], 'from_entry_id')
        remapKeys(obj, ['target', 'to', 'target_id', 'to_id', 'dest'], 'to_entry_id')
        remapKeys(obj, ['type', 'rel'], 'relationship_type')
        remapKeys(obj, ['notes', 'message', 'text'], 'description')
    } else if (['get_recent_entries', 'getRecentEntries', 'team_get_recent', 'teamGetRecent'].includes(methodName)) {
        const obj = { ...args[0] }
        args[0] = obj
        healIncludeArchivedField(obj)
        coerceRecentCursorToOffset(obj)
        if (hasAnyKey(obj, ['q', 'query', 'search'])) {
            return validationErr(
                `${methodName} does not support search queries. It only returns the most recent entries.`,
                'To search for specific text, use team_search (or search_entries) instead.'
            )
        }
        remapKeys(obj, ['keep'], 'limit')
    } else if (['list_tags', 'listTags', 'team_list_tags', 'teamListTags'].includes(methodName)) {
        const obj = { ...args[0] }
        args[0] = obj
        if (hasAnyKey(obj, ['q', 'query', 'search', 'path', 'mode', 'keep'])) {
            return validationErr(`${methodName} does not support search queries, path, mode, or keep. It returns all tags.`, 'Remove these parameters.')
        }
    }
    return { args }
}

function applyAuditMergeTestGetByIdInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    if (args.length !== 1 || !isRecord(args[0])) return { args }
    if (['test_simple', 'testSimple', 'test_error_handling', 'testErrorHandling'].includes(methodName)) {
        const obj = { ...args[0] }
        args[0] = obj
        remapKeys(obj, ['text', 'description'], 'message')
        if (methodName === 'test_error_handling' || methodName === 'testErrorHandling') {
            remapKeys(obj, ['type'], 'error_type')
        }
    } else if (['merge_tags', 'mergeTags', 'team_merge_tags', 'teamMergeTags'].includes(methodName)) {
        const obj = { ...args[0] }
        args[0] = obj
        if (obj['source_tags'] !== undefined && obj['source_tag'] === undefined) {
            if (Array.isArray(obj['source_tags'])) {
                if (obj['source_tags'].length > 1) {
                    return validationErr(
                        'merge_tags only accepts a single source_tag, not multiple source_tags.',
                        'Provide a single tag string for source_tag. To merge multiple tags, call this tool multiple times.'
                    )
                }
                obj['source_tag'] = obj['source_tags'][0]
            } else {
                obj['source_tag'] = obj['source_tags']
            }
            delete obj['source_tags']
        }
        remapKeys(obj, ['old_tag', 'from'], 'source_tag')
        remapKeys(obj, ['new_tag', 'to'], 'target_tag')
        if (typeof obj['source_tag'] === 'string' && obj['source_tag'].includes(',')) {
            return validationErr(
                'merge_tags only accepts a single source_tag string, not a comma-separated list.',
                'Provide a single tag string for source_tag. To merge multiple tags, call this tool multiple times.'
            )
        }
    } else if (methodName === 'search_audit_log' || methodName === 'searchAuditLog') {
        const obj = { ...args[0] }
        args[0] = obj
        remapKeys(obj, ['keep'], 'limit')
        remapKeys(obj, ['tool', 'action'], 'tool_name')
        remapKeys(obj, ['success'], 'status')
        remapKeys(obj, ['target_user'], 'user')
        if (typeof obj['limit'] === 'string') {
            const trimmed = obj['limit'].trim()
            if (/^[1-9]\d*$/.test(trimmed)) {
                const parsed = Number(trimmed)
                if (Number.isSafeInteger(parsed) && String(parsed) === trimmed) obj['limit'] = parsed
            }
        }
    } else if (['get_entry_by_id', 'getEntryById', 'team_get_entry_by_id', 'teamGetEntryById'].includes(methodName)) {
        const obj = { ...args[0] }
        args[0] = obj
        if (obj['entry_id'] === undefined && obj['entryId'] === undefined && obj['id'] === undefined && typeof obj['uri'] === 'string') {
            const match = /^memory:\/\/(?:entries|entry)\/([1-9]\d*)$/i.exec(obj['uri'].trim())
            if (match?.[1] !== undefined) {
                const parsed = Number(match[1])
                if (Number.isSafeInteger(parsed) && String(parsed) === match[1]) {
                    obj['entry_id'] = parsed
                    delete obj['uri']
                }
            }
        }
    }
    return { args }
}

const ALIAS_SYNONYMS = ['text', 'message', 'description', 'name', 'from', 'source']
const CANONICAL_ALIAS_SYNONYMS = ['target', 'to', 'canonical', 'dest']

function applyAuthorAliasInterception(methodName: string, obj: Record<string, unknown>): void {
    const isResolve = methodName === 'team_resolve_author' || methodName === 'teamResolveAuthor'
    const isRemove = methodName === 'team_remove_author_alias' || methodName === 'teamRemoveAuthorAlias'
    const isAdd = methodName === 'team_add_author_alias' || methodName === 'teamAddAuthorAlias'
    const searchTarget = isResolve ? 'author' : isRemove ? 'alias' : 'canonical_author'

    for (const key of ['q', 'query', 'search']) {
        if (obj[key] !== undefined) {
            if (obj[searchTarget] === undefined) obj[searchTarget] = obj[key]
            Reflect.deleteProperty(obj, key)
        }
    }
    if (isResolve) {
        remapKeys(obj, ALIAS_SYNONYMS, 'author')
        return
    }
    if (isRemove) {
        remapKeys(obj, ALIAS_SYNONYMS, 'alias')
        return
    }
    if (isAdd) {
        remapKeys(obj, ALIAS_SYNONYMS, 'alias')
    }
    remapKeys(obj, CANONICAL_ALIAS_SYNONYMS, 'canonical_author')
    if (obj['author'] !== undefined) {
        if (obj['canonical_author'] === undefined) obj['canonical_author'] = obj['author']
        Reflect.deleteProperty(obj, 'author')
    }
}

function applyTeamMemberAndAliasInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } {
    if (args.length !== 1 || !isRecord(args[0])) return { args }
    if (
        [
            'team_add_member', 'teamAddMember', 'team_update_member_role', 'teamUpdateMemberRole',
            'team_remove_member', 'teamRemoveMember', 'team_get_member', 'teamGetMember',
        ].includes(methodName)
    ) {
        const obj = { ...args[0] }
        args[0] = obj
        remapKeys(
            obj,
            ['path', 'target', 'target_user', 'user', 'name', 'account', 'username', 'member'],
            'author'
        )
        remapKeys(obj, ['keep', 'mode', 'type', 'level', 'permission'], 'role')
    } else if (
        [
            'team_add_author_alias', 'teamAddAuthorAlias', 'team_remove_author_alias', 'teamRemoveAuthorAlias',
            'team_list_author_aliases', 'teamListAuthorAliases', 'team_resolve_author', 'teamResolveAuthor',
            'team_consolidate_authors', 'teamConsolidateAuthors',
        ].includes(methodName)
    ) {
        const obj = { ...args[0] }
        args[0] = obj
        applyAuthorAliasInterception(methodName, obj)
    }
    return { args }
}

function applyMiscToolInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    const firstRes = applyEntryLinkRecentTagInterceptions(methodName, args)
    if ('error' in firstRes) return firstRes
    const secondRes = applyAuditMergeTestGetByIdInterceptions(methodName, firstRes.args)
    if ('error' in secondRes) return secondRes
    return applyTeamMemberAndAliasInterceptions(methodName, secondRes.args)
}

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

function hasAnyKey(obj: Record<string, unknown>, keys: string[]): boolean {
    return keys.some((k) => obj[k] !== undefined)
}

export function applyDomainToolInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    if (['update_configuration', 'updateConfiguration', 'config', 'configure'].includes(methodName)) {
        if (args.length === 1 && isRecord(args[0])) {
            let obj = { ...args[0] }
            if (isRecord(obj['config'])) {
                obj = { ...obj, ...obj['config'] }
                delete obj['config']
            }
            args[0] = obj

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

            const hasContextParam = ['maxTokens', 'max_tokens', 'temperature', 'model', 'top_p', 'topP'].find((k) => k in obj)
            if (hasContextParam !== undefined) {
                return validationErr(
                    `Unrecognized key: "${hasContextParam}". update_configuration is for configuring the memory-journal-mcp server and does not support changing LLM context parameters.`,
                    `Remove '${hasContextParam}' from the payload. Only tool_filter and briefing preferences are supported.`
                )
            }
        }
    }

    if (IO_METHODS.includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const ioRes = applyIoInterceptions(methodName, args[0])
        if ('error' in ioRes) return ioRes
        args[0] = ioRes.obj
    }

    if (
        ['team_get_vector_index_stats', 'teamGetVectorIndexStats', 'get_vector_index_stats', 'getVectorIndexStats'].includes(methodName) &&
        args.length === 1 &&
        isRecord(args[0])
    ) {
        const obj = { ...args[0] }
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
        args[0] = {}
    }

    if (
        ['list_deleted_entries', 'listDeletedEntries', 'team_list_deleted_entries', 'teamListDeletedEntries'].includes(methodName) &&
        args.length === 1 &&
        isRecord(args[0])
    ) {
        const obj = { ...args[0] }
        args[0] = obj
        if (hasAnyKey(obj, ['q', 'query', 'search', 'text', 'message', 'description', 'path', 'mode'])) {
            return validationErr(`${methodName} does not support search queries, path, or mode. It returns all deleted entries.`, 'Remove these parameters.')
        }
        remapKeys(obj, ['keep'], 'limit')
        if ((methodName === 'list_deleted_entries' || methodName === 'listDeletedEntries') && obj['project_number'] !== undefined) {
            delete obj['project_number']
        }
        if (obj['project_id'] !== undefined) delete obj['project_id']
    }

    if (ANALYTICS_METHODS.includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] }
        args[0] = obj

        if (hasAnyKey(obj, ['q', 'query', 'search', 'text', 'message', 'description', 'path', 'keep', 'mode'])) {
            return validationErr(
                `${methodName} does not support search queries, content parameters, or modes. It returns analytical data.`,
                'Remove these parameters. Use search_entries or team_search if you want to find specific content.'
            )
        }

        if (methodName.includes('get_statistics') || methodName.includes('getStatistics')) {
            const timeVal = obj['time'] ?? obj['timeframe'] ?? obj['period']
            if (timeVal !== undefined) {
                if (obj['group_by'] === undefined && typeof timeVal === 'string') {
                    const lower = timeVal.toLowerCase()
                    obj['group_by'] = ['day', 'week', 'month'].includes(lower) ? lower : 'month'
                }
                delete obj['time']
                delete obj['timeframe']
                delete obj['period']
            }
        }

        if ((methodName.includes('get_cross_project_insights') || methodName.includes('getCrossProjectInsights')) && obj['limit'] !== undefined) {
            return validationErr('get_cross_project_insights does not accept a limit parameter. It analyzes all projects.', 'Remove the limit parameter.')
        }
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

    const isExportMd =
        methodName.includes('export_markdown') ||
        methodName.includes('exportMarkdown') ||
        methodName.includes('teamExportMarkdown') ||
        methodName.includes('team_export_markdown')
    const isExternal =
        methodName.includes('import_external') ||
        methodName.includes('importExternal') ||
        methodName.includes('teamImportExternal') ||
        methodName.includes('team_import_external')

    for (const key of ['path', 'file', 'filepath', 'dir', 'folder', 'target', 'source']) {
        if (obj[key] !== undefined) {
            let didMap = false
            if (isExportMd) {
                if (obj['output_dir'] === undefined) obj['output_dir'] = obj[key]
                didMap = true
            } else if (methodName.toLowerCase().includes('import') && !(key === 'source' && isExternal)) {
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

function applyMiscToolInterceptions(
    methodName: string,
    args: unknown[]
): { args: unknown[] } | { error: Record<string, unknown> } {
    if (['link_entries', 'linkEntries', 'team_link_entries', 'teamLinkEntries'].includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] }
        args[0] = obj
        remapKeys(obj, ['source', 'from', 'source_id', 'from_id'], 'from_entry_id')
        remapKeys(obj, ['target', 'to', 'target_id', 'to_id', 'dest'], 'to_entry_id')
        remapKeys(obj, ['type', 'rel'], 'relationship_type')
        remapKeys(obj, ['notes', 'message', 'text'], 'description')
    }

    if (['get_recent_entries', 'getRecentEntries', 'team_get_recent', 'teamGetRecent'].includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] }
        args[0] = obj
        if (hasAnyKey(obj, ['q', 'query', 'search'])) {
            return validationErr(
                `${methodName} does not support search queries. It only returns the most recent entries.`,
                'To search for specific text, use team_search (or search_entries) instead.'
            )
        }
        remapKeys(obj, ['keep'], 'limit')
    }

    if (['list_tags', 'listTags', 'team_list_tags', 'teamListTags'].includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] }
        args[0] = obj
        if (hasAnyKey(obj, ['q', 'query', 'search', 'path', 'mode', 'keep'])) {
            return validationErr(`${methodName} does not support search queries, path, mode, or keep. It returns all tags.`, 'Remove these parameters.')
        }
    }

    if (['test_simple', 'testSimple', 'test_error_handling', 'testErrorHandling'].includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] }
        args[0] = obj
        remapKeys(obj, ['text', 'description'], 'message')
        if (methodName === 'test_error_handling' || methodName === 'testErrorHandling') {
            remapKeys(obj, ['type'], 'error_type')
        }
    }

    if (['merge_tags', 'mergeTags', 'team_merge_tags', 'teamMergeTags'].includes(methodName) && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] }
        args[0] = obj
        if (obj['source_tags'] !== undefined && obj['source_tag'] === undefined) {
            obj['source_tag'] = Array.isArray(obj['source_tags']) ? obj['source_tags'][0] : obj['source_tags']
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
    }

    if ((methodName === 'search_audit_log' || methodName === 'searchAuditLog') && args.length === 1 && isRecord(args[0])) {
        const obj = { ...args[0] }
        args[0] = obj
        remapKeys(obj, ['keep'], 'limit')
        if (typeof obj['limit'] === 'string') {
            const parsed = parseInt(obj['limit'], 10)
            if (!isNaN(parsed)) obj['limit'] = parsed
        }
    }

    if (
        [
            'team_add_member', 'teamAddMember', 'team_update_member_role', 'teamUpdateMemberRole',
            'team_remove_member', 'teamRemoveMember', 'team_get_member', 'teamGetMember',
        ].includes(methodName) &&
        args.length === 1 &&
        isRecord(args[0])
    ) {
        const obj = { ...args[0] }
        args[0] = obj
        remapKeys(obj, ['path', 'target', 'user', 'name', 'account', 'username', 'member'], 'author')
        remapKeys(obj, ['keep', 'mode', 'type', 'level', 'permission'], 'role')
    }

    if (
        [
            'team_add_author_alias', 'teamAddAuthorAlias', 'team_remove_author_alias', 'teamRemoveAuthorAlias',
            'team_list_author_aliases', 'teamListAuthorAliases', 'team_resolve_author', 'teamResolveAuthor',
            'team_consolidate_authors', 'teamConsolidateAuthors',
        ].includes(methodName) &&
        args.length === 1 &&
        isRecord(args[0])
    ) {
        const obj = { ...args[0] }
        args[0] = obj
        for (const key of ['q', 'query', 'search']) {
            if (obj[key] !== undefined) {
                if (obj['canonical_author'] === undefined && obj['author'] === undefined && obj['alias'] === undefined) {
                    obj['canonical_author'] = obj[key]
                    obj['author'] = obj[key]
                    obj['alias'] = obj[key]
                }
                Reflect.deleteProperty(obj, key)
            }
        }
        remapKeys(obj, ['text', 'message', 'description', 'name', 'from', 'source'], 'alias')
        remapKeys(obj, ['target', 'to', 'canonical', 'dest'], 'canonical_author')
        if (obj['author'] !== undefined && obj['canonical_author'] === undefined && obj['alias'] === undefined) {
            obj['canonical_author'] = obj['author']
        }
    }

    return { args }
}

/**
 * Hoisted method-name lookup sets for `domain-tool-interceptions.ts` (O(1) dispatch).
 */

export const CONFIG_METHODS: ReadonlySet<string> = new Set([
    'update_configuration', 'updateConfiguration', 'config', 'configure',
])

export const IO_METHODS: ReadonlySet<string> = new Set([
    'export_entries', 'exportEntries', 'team_export_entries', 'teamExportEntries',
    'export_markdown', 'exportMarkdown', 'team_export_markdown', 'teamExportMarkdown',
    'import_markdown', 'importMarkdown', 'team_import_markdown', 'teamImportMarkdown',
    'import_external', 'importExternal', 'team_import_external', 'teamImportExternal',
])

export const EXPORT_ENTRY_METHODS: ReadonlySet<string> = new Set([
    'export_entries', 'exportEntries', 'team_export_entries', 'teamExportEntries',
])

export const EXPORT_MD_METHODS: ReadonlySet<string> = new Set([
    'export_markdown', 'exportMarkdown', 'team_export_markdown', 'teamExportMarkdown',
])

export const IMPORT_MD_METHODS: ReadonlySet<string> = new Set([
    'import_markdown', 'importMarkdown', 'team_import_markdown', 'teamImportMarkdown',
])

export const IMPORT_EXTERNAL_METHODS: ReadonlySet<string> = new Set([
    'import_external', 'importExternal', 'team_import_external', 'teamImportExternal',
])

export const VECTOR_STATS_METHODS: ReadonlySet<string> = new Set([
    'team_get_vector_index_stats', 'teamGetVectorIndexStats',
    'get_vector_index_stats', 'getVectorIndexStats',
])

export const REBUILD_METHODS: ReadonlySet<string> = new Set([
    'rebuild_vector_index', 'rebuildVectorIndex',
    'team_rebuild_vector_index', 'teamRebuildVectorIndex',
])

export const LIST_DELETED_METHODS: ReadonlySet<string> = new Set([
    'list_deleted_entries', 'listDeletedEntries',
    'team_list_deleted_entries', 'teamListDeletedEntries',
])

export const ANALYTICS_METHODS: ReadonlySet<string> = new Set([
    'get_statistics', 'getStatistics', 'get_cross_project_insights', 'getCrossProjectInsights',
    'team_get_statistics', 'teamGetStatistics', 'team_get_cross_project_insights', 'teamGetCrossProjectInsights',
    'get_collaboration_matrix', 'getCollaborationMatrix', 'team_get_collaboration_matrix', 'teamGetCollaborationMatrix',
])

export const LINK_METHODS: ReadonlySet<string> = new Set([
    'link_entries', 'linkEntries', 'team_link_entries', 'teamLinkEntries',
])

export const RECENT_METHODS: ReadonlySet<string> = new Set([
    'get_recent_entries', 'getRecentEntries', 'team_get_recent', 'teamGetRecent',
])

export const TAG_LIST_METHODS: ReadonlySet<string> = new Set([
    'list_tags', 'listTags', 'team_list_tags', 'teamListTags',
])

export const TEST_TOOL_METHODS: ReadonlySet<string> = new Set([
    'test_simple', 'testSimple', 'test_error_handling', 'testErrorHandling',
])

export const MERGE_TAG_METHODS: ReadonlySet<string> = new Set([
    'merge_tags', 'mergeTags', 'team_merge_tags', 'teamMergeTags',
])

export const GET_ENTRY_BY_ID_METHODS: ReadonlySet<string> = new Set([
    'get_entry_by_id', 'getEntryById', 'team_get_entry_by_id', 'teamGetEntryById',
])

export const TEAM_MEMBER_METHODS: ReadonlySet<string> = new Set([
    'team_add_member', 'teamAddMember', 'team_update_member_role', 'teamUpdateMemberRole',
    'team_remove_member', 'teamRemoveMember', 'team_get_member', 'teamGetMember',
])

export const TEAM_ALIAS_METHODS: ReadonlySet<string> = new Set([
    'team_add_author_alias', 'teamAddAuthorAlias', 'team_remove_author_alias', 'teamRemoveAuthorAlias',
    'team_list_author_aliases', 'teamListAuthorAliases', 'team_resolve_author', 'teamResolveAuthor',
    'team_consolidate_authors', 'teamConsolidateAuthors',
])

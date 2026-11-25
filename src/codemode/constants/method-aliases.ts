/**
 * memory-journal-mcp - Method Aliases
 *
 * Aliases for common naming shortcuts within each group.
 * Maps alias name -> canonical method name.
 */

import { createNullProtoRecord } from '../../utils/type-guards.js'

function mapToTarget(keys: readonly string[], target: string): Record<string, string> {
    const out = createNullProtoRecord<string>()
    for (const k of keys) out[k] = target
    return out
}

function nullProtoRecord<T = string>(
    ...sources: (Record<string, T> | undefined)[]
): Record<string, T> {
    const out = createNullProtoRecord<T>()
    for (const src of sources) {
        if (src === undefined) continue
        for (const k of Object.keys(src)) {
            const val = src[k]
            if (val !== undefined) out[k] = val
        }
    }
    return out
}

const SHARED_PROJECT_ALIASES: Record<string, string> = nullProtoRecord(
    mapToTarget(
        [
            'getProject', 'getProjectByName', 'get_project_by_name', 'getProjectByNumber',
            'get_project_by_number', 'findProject', 'find_project', 'mj_get_project', 'mjGetProject',
        ],
        'getProject'
    ),
    mapToTarget(
        ['listProjects', 'list_projects', 'mj_list_projects', 'mjListProjects', 'projects'],
        'listProjects'
    )
)

const SHARED_HEALTH_ALIASES: Record<string, string> = mapToTarget(
    [
        'serverInfo', 'server_info', 'serverHealth', 'server_health', 'health', 'status',
        'adapters', 'list_adapters', 'listAdapters', 'get_adapters', 'getAdapters',
    ],
    'getStatistics'
)

const SHARED_GREP_SEARCH_ALIASES: Record<string, string> = mapToTarget(
    [
        'grep', 'grepSearch', 'grep_search', 'fileSearch', 'file_search',
        'findInFiles', 'find_in_files', 'find', 'search', 'query', 'queryEntries', 'query_entries',
    ],
    'searchEntries'
)

export const METHOD_ALIASES: Record<string, Record<string, string>> = nullProtoRecord()
Object.assign(METHOD_ALIASES, {
    core: nullProtoRecord(
        mapToTarget(
            [
                'create', 'add', 'newEntry', 'addEntry', 'insert', 'write', 'log', 'record', 'note',
                'save', 'quick', 'createEntryMinimal',
                'appendInsight', 'writeQuery', 'updateMemory', 'update_memory', 'createMemory',
                'create_memory', 'addMemory', 'add_memory', 'saveMemory', 'save_memory',
                'recordMemory', 'record_memory', 'setMemory', 'set_memory', 'updateJournal',
                'update_journal', 'sessionSummary', 'append', 'appendEntry', 'append_entry',
                'logJournal', 'log_journal', 'logEntry', 'log_entry', 'insertJournal',
                'insert_journal', 'addJournal', 'add_journal', 'saveJournalEntry',
                'save_journal_entry', 'createJournalEntry', 'create_journal_entry', 'create_entry',
                'mj_create_entry', 'mjCreateEntry', 'add_entry', 'mj_add_entry', 'mjAddEntry',
            ],
            'createEntry'
        ),
        mapToTarget(
            ['get', 'getEntry', 'fetch', 'read', 'get_entry_by_id', 'view_file', 'viewFile'],
            'getEntryById'
        ),
        mapToTarget(
            [
                'recent', 'getRecent', 'list', 'entries', 'all', 'latest', 'get_recent_entries',
                'select', 'sql', 'executeSql', 'execSql', 'execute_sql', 'exec_sql',
                'fetchEntries', 'getAll', 'list_dir', 'listDir',
            ],
            'getRecentEntries'
        ),
        mapToTarget(['tags', 'getTags', 'get_tags', 'list_tags'], 'listTags'),
        mapToTarget(
            ['read_resource', 'readResource', 'memory_read_resource', 'memoryReadResource', 'get_resource', 'getResource'],
            'readResource'
        ),
        mapToTarget(['history', 'revisions', 'get_entry_history'], 'getEntryHistory'),
        mapToTarget(
            ['mark_anchors_stale', 'markStale', 'updateAnchors', 'updateAnchorStatus', 'update_anchor_status'],
            'markAnchorsStale'
        ),
        mapToTarget(
            ['schema', 'getSchema', 'get_schema', 'database', 'getDatabase', 'get_database', 'getDb', 'get_db'],
            'maintenanceUnavailable'
        ),
        SHARED_PROJECT_ALIASES,
        SHARED_HEALTH_ALIASES,
        SHARED_GREP_SEARCH_ALIASES,
        {
            listEntries: 'searchEntries',
            create_entry_minimal: 'createEntry',
            search_audit_log: 'searchAuditLog',
            update: 'updateEntry',
            delete: 'deleteEntry',
            updateEntry: 'updateEntry',
            deleteEntry: 'deleteEntry',
            update_entry: 'updateEntry',
            delete_entry: 'deleteEntry',
        }
    ),
    search: nullProtoRecord(
        SHARED_GREP_SEARCH_ALIASES,
        mapToTarget(
            [
                'lookup', 'findEntries', 'find_entries', 'listEntries', 'list_entries', 'entries',
                'readQuery', 'read_query', 'select', 'sql', 'executeSql', 'execSql', 'sqlQuery',
                'querySql', 'execute_sql', 'exec_sql', 'search_entries',
            ],
            'searchEntries'
        ),
        {
            byDate: 'searchByDateRange',
            similar: 'semanticSearch',
            stats: 'getVectorIndexStats',
            deleted: 'listDeletedEntries',
            trash: 'listDeletedEntries',
            crossSearch: 'crossTeamSearch',
            search_by_date_range: 'searchByDateRange',
            semantic_search: 'semanticSearch',
            get_vector_index_stats: 'getVectorIndexStats',
            list_deleted_entries: 'listDeletedEntries',
            cross_team_search: 'crossTeamSearch',
        }
    ),
    analytics: nullProtoRecord(
        mapToTarget(
            [
                'stats', 'getStats', 'statistics', 'tables',
                'getTables', 'get_tables', 'describe', 'databaseInfo', 'getDatabaseInfo',
                'get_database_info', 'db', 'dbStats', 'getDbStats', 'get_db_stats', 'dbInfo', 'getDbInfo',
                'get_db_info', 'get_statistics',
            ],
            'getStatistics'
        ),
        mapToTarget(
            ['schema', 'getSchema', 'get_schema', 'database', 'getDatabase', 'get_database', 'getDb', 'get_db'],
            'maintenanceUnavailable'
        ),
        SHARED_HEALTH_ALIASES,
        mapToTarget(
            ['insights', 'getInsights', 'getProjects', 'listProjects', 'list_projects', 'projects', 'get_cross_project_insights'],
            'getCrossProjectInsights'
        )
    ),
    relationships: nullProtoRecord(
        {
            link: 'linkEntries',
            graph: 'visualizeRelationships',
            link_entries: 'linkEntries',
            visualize_relationships: 'visualizeRelationships',
        },
        mapToTarget(
            [
                'getEntryRelationships',
                'get_entry_relationships',
                'getRelationships',
                'get_relationships',
                'listRelationships',
                'list_relationships',
                'relationships',
            ],
            'visualizeRelationships'
        )
    ),
    io: nullProtoRecord({
        dump: 'exportEntries',
        md: 'exportMarkdown',
        importMd: 'importMarkdown',
        importNotion: 'importExternal',
        importObsidian: 'importExternal',
        export_entries: 'exportEntries',
        export_markdown: 'exportMarkdown',
        import_markdown: 'importMarkdown',
        import_external: 'importExternal',
    }),
    admin: nullProtoRecord(
        mapToTarget(
            [
                'edit', 'update', 'editEntry', 'modifyEntry', 'modify', 'updateMemory',
                'update_memory', 'setMemory', 'set_memory', 'updateJournal', 'update_journal',
                'saveMemory', 'save_memory', 'update_entry',
            ],
            'updateEntry'
        ),
        mapToTarget(['remove', 'delete', 'removeEntry', 'delete_entry'], 'deleteEntry'),
        mapToTarget(['restore', 'restoreEntry', 'restore_entry'], 'restoreEntry'),
        mapToTarget(
            ['batchCreate', 'bulkCreate', 'createEntries', 'batchCreateEntry', 'batch_create_entries'],
            'batchCreateEntries'
        ),
        mapToTarget(['batchUpdate', 'bulkUpdate', 'updateEntries', 'batch_update_entries'], 'batchUpdateEntries'),
        mapToTarget(['batchDelete', 'bulkDelete', 'deleteEntries', 'batch_delete_entries'], 'batchDeleteEntries'),
        mapToTarget(['config', 'configure', 'update_configuration'], 'updateConfiguration'),
        mapToTarget(['auditLog', 'audit', 'search_audit_log'], 'searchAuditLog'),
        SHARED_PROJECT_ALIASES,
        SHARED_HEALTH_ALIASES,
        {
            rebuild: 'rebuildVectorIndex',
            rebuild_vector_index: 'rebuildVectorIndex',
            addVector: 'addToVectorIndex',
            add_to_vector_index: 'addToVectorIndex',
            mergeTags: 'mergeTags',
            merge_tags: 'mergeTags',
            registerProject: 'registerProject',
            register_project: 'registerProject',
            updateProject: 'updateProject',
            update_project: 'updateProject',
            deleteProject: 'deleteProject',
            removeProject: 'deleteProject',
            delete_project: 'deleteProject',
            prune: 'runAutoPrune',
            autoPrune: 'runAutoPrune',
            auto_prune: 'runAutoPrune',
        }
    ),
    github: nullProtoRecord({
        issues: 'getGithubIssues',
        issue: 'getGithubIssue',
        prs: 'getGithubPrs',
        pr: 'getGithubPr',
        context: 'getGithubContext',
        kanban: 'getKanbanBoard',
        moveKanban: 'moveKanbanItem',
        addKanban: 'addKanbanItem',
        deleteKanban: 'deleteKanbanItem',
        milestones: 'getGithubMilestones',
        milestone: 'getGithubMilestone',
        createMilestone: 'createGithubMilestone',
        updateMilestone: 'updateGithubMilestone',
        deleteMilestone: 'deleteGithubMilestone',
        repoInsights: 'getRepoInsights',
        createIssue: 'createGithubIssueWithEntry',
        closeIssue: 'closeGithubIssueWithEntry',
        copilotReviews: 'getCopilotReviews',
        get_github_issues: 'getGithubIssues',
        get_github_issue: 'getGithubIssue',
        get_github_prs: 'getGithubPrs',
        get_github_pr: 'getGithubPr',
        get_github_context: 'getGithubContext',
        get_kanban_board: 'getKanbanBoard',
        move_kanban_item: 'moveKanbanItem',
        add_kanban_item: 'addKanbanItem',
        delete_kanban_item: 'deleteKanbanItem',
        get_github_milestones: 'getGithubMilestones',
        get_github_milestone: 'getGithubMilestone',
        create_github_milestone: 'createGithubMilestone',
        update_github_milestone: 'updateGithubMilestone',
        delete_github_milestone: 'deleteGithubMilestone',
        get_repo_insights: 'getRepoInsights',
        create_github_issue_with_entry: 'createGithubIssueWithEntry',
        close_github_issue_with_entry: 'closeGithubIssueWithEntry',
        get_copilot_reviews: 'getCopilotReviews',
    }),
    backup: nullProtoRecord({
        save: 'backupJournal',
        create: 'backupJournal',
        backup: 'backupJournal',
        list: 'listBackups',
        restore: 'restoreBackup',
        cleanup: 'cleanupBackups',
        backup_journal: 'backupJournal',
        list_backups: 'listBackups',
        restore_backup: 'restoreBackup',
        cleanup_backups: 'cleanupBackups',
    }),
    team: nullProtoRecord(
        mapToTarget(
            [
                'create', 'createEntry', 'create_entry', 'addEntry', 'sessionSummary',
                'teamSessionSummary', 'team_create_entry',
            ],
            'teamCreateEntry'
        ),
        mapToTarget(
            [
                'recent', 'getRecent', 'getRecentEntries', 'get_recent_entries', 'listEntries',
                'teamListEntries', 'list', 'entries', 'teamList', 'team_get_recent',
            ],
            'teamGetRecent'
        ),
        mapToTarget(
            ['get', 'read', 'getEntryById', 'get_entry_by_id', 'team_get_entry_by_id'],
            'teamGetEntryById'
        ),
        mapToTarget(['tags', 'listTags', 'list_tags', 'team_list_tags'], 'teamListTags'),
        mapToTarget(
            ['find', 'search', 'searchEntries', 'search_entries', 'team_search'],
            'teamSearch'
        ),
        mapToTarget(
            ['byDate', 'searchByDateRange', 'search_by_date_range', 'team_search_by_date_range'],
            'teamSearchByDateRange'
        ),
        mapToTarget(
            ['update', 'edit', 'updateEntry', 'update_entry', 'team_update_entry'],
            'teamUpdateEntry'
        ),
        mapToTarget(
            ['delete', 'remove', 'deleteEntry', 'delete_entry', 'team_delete_entry'],
            'teamDeleteEntry'
        ),
        mapToTarget(
            ['restore', 'teamRestore', 'restoreEntry', 'restore_entry', 'team_restore_entry'],
            'teamRestoreEntry'
        ),
        mapToTarget(
            ['trash', 'deleted', 'listDeletedEntries', 'list_deleted_entries', 'team_list_deleted_entries'],
            'teamListDeletedEntries'
        ),
        mapToTarget(['mergeTags', 'merge_tags', 'team_merge_tags'], 'teamMergeTags'),
        mapToTarget(
            [
                'batchCreate', 'batchCreateEntries', 'batch_create_entries', 'bulkCreate',
                'createEntries', 'batchCreateEntry', 'team_batch_create_entries',
            ],
            'teamBatchCreateEntries'
        ),
        mapToTarget(
            [
                'batchUpdate', 'batchUpdateEntries', 'batch_update_entries', 'bulkUpdate',
                'updateEntries', 'team_batch_update_entries',
            ],
            'teamBatchUpdateEntries'
        ),
        mapToTarget(
            [
                'batchDelete', 'batchDeleteEntries', 'batch_delete_entries', 'bulkDelete',
                'deleteEntries', 'team_batch_delete_entries',
            ],
            'teamBatchDeleteEntries'
        ),
        mapToTarget(['stats', 'getStatistics', 'get_statistics', 'team_get_statistics'], 'teamGetStatistics'),
        mapToTarget(['link', 'linkEntries', 'link_entries', 'team_link_entries'], 'teamLinkEntries'),
        mapToTarget(
            ['graph', 'visualizeRelationships', 'visualize_relationships', 'team_visualize_relationships'],
            'teamVisualizeRelationships'
        ),
        mapToTarget(
            ['export', 'exportEntries', 'export_entries', 'team_export_entries'],
            'teamExportEntries'
        ),
        mapToTarget(
            ['exportMarkdown', 'export_markdown', 'md', 'team_export_markdown'],
            'teamExportMarkdown'
        ),
        mapToTarget(
            ['importMarkdown', 'importMd', 'import_markdown', 'team_import_markdown'],
            'teamImportMarkdown'
        ),
        mapToTarget(
            ['importNotion', 'importObsidian', 'importExternal', 'import_external', 'team_import_external'],
            'teamImportExternal'
        ),
        mapToTarget(['backup', 'backupJournal', 'backup_journal', 'team_backup'], 'teamBackup'),
        mapToTarget(['listBackups', 'list_backups', 'team_list_backups'], 'teamListBackups'),
        mapToTarget(['semanticSearch', 'semantic_search', 'team_semantic_search'], 'teamSemanticSearch'),
        mapToTarget(
            ['vectorStats', 'getVectorIndexStats', 'get_vector_index_stats', 'team_get_vector_index_stats'],
            'teamGetVectorIndexStats'
        ),
        mapToTarget(
            ['rebuildIndex', 'rebuildVectorIndex', 'rebuild_vector_index', 'team_rebuild_vector_index'],
            'teamRebuildVectorIndex'
        ),
        mapToTarget(
            ['addToIndex', 'addToVectorIndex', 'add_to_vector_index', 'team_add_to_vector_index'],
            'teamAddToVectorIndex'
        ),
        mapToTarget(
            [
                'insights', 'searchProjects', 'listProjects', 'getProjects',
                'getCrossProjectInsights', 'get_cross_project_insights', 'team_get_cross_project_insights',
            ],
            'teamGetCrossProjectInsights'
        ),
        mapToTarget(
            ['collaborationMatrix', 'getCollaborationMatrix', 'get_collaboration_matrix', 'team_get_collaboration_matrix'],
            'teamGetCollaborationMatrix'
        ),
        mapToTarget(['addMember', 'add_member', 'team_add_member'], 'teamAddMember'),
        mapToTarget(['removeMember', 'remove_member', 'team_remove_member'], 'teamRemoveMember'),
        mapToTarget(
            ['updateRole', 'changeRole', 'setRole', 'updateMemberRole', 'update_member_role', 'team_update_member_role'],
            'teamUpdateMemberRole'
        ),
        mapToTarget(['members', 'listMembers', 'list_members', 'team_list_members'], 'teamListMembers'),
        mapToTarget(['getMember', 'get_member', 'team_get_member'], 'teamGetMember'),
        mapToTarget(
            ['addAlias', 'addAuthorAlias', 'add_author_alias', 'team_add_author_alias'],
            'teamAddAuthorAlias'
        ),
        mapToTarget(
            ['removeAlias', 'removeAuthorAlias', 'remove_author_alias', 'team_remove_author_alias'],
            'teamRemoveAuthorAlias'
        ),
        mapToTarget(
            ['aliases', 'listAliases', 'listAuthorAliases', 'list_author_aliases', 'team_list_author_aliases'],
            'teamListAuthorAliases'
        ),
        mapToTarget(['resolveAuthor', 'resolve_author', 'team_resolve_author'], 'teamResolveAuthor'),
        mapToTarget(
            ['consolidate', 'consolidateAuthors', 'consolidate_authors', 'team_consolidate_authors'],
            'teamConsolidateAuthors'
        )
    ),
    git: nullProtoRecord({
        history: 'getCommitHistory',
        log: 'getCommitHistory',
        commits: 'getCommitHistory',
        search: 'searchCommits',
        find: 'searchCommits',
        release: 'getReleaseInfo',
        unreleased: 'getUnreleasedCommits',
        analyze: 'analyzeCommitPatterns',
        get_commit_history: 'getCommitHistory',
        search_commits: 'searchCommits',
        get_release_info: 'getReleaseInfo',
        get_unreleased_commits: 'getUnreleasedCommits',
        analyze_commit_patterns: 'analyzeCommitPatterns',
        check_entry_staleness: 'checkEntryStaleness',
        staleness: 'checkEntryStaleness',
        checkStaleness: 'checkEntryStaleness',
        mark_anchors_stale: 'markAnchorsStale',
        markAnchorsStale: 'markAnchorsStale',
        markStale: 'markAnchorsStale',
    }),
})

/**
 * memory-journal-mcp - Method Aliases
 *
 * Aliases for common naming shortcuts within each group.
 * Maps alias name -> canonical method name.
 */

function mapToTarget(keys: readonly string[], target: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const k of keys) out[k] = target
    return out
}

const SHARED_PROJECT_ALIASES: Record<string, string> = {
    ...mapToTarget(
        [
            'getProject', 'getProjectByName', 'get_project_by_name', 'getProjectByNumber',
            'get_project_by_number', 'findProject', 'find_project', 'mj_get_project', 'mjGetProject',
        ],
        'getProject'
    ),
    ...mapToTarget(
        ['listProjects', 'list_projects', 'mj_list_projects', 'mjListProjects', 'projects'],
        'listProjects'
    ),
}

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

export const METHOD_ALIASES: Record<string, Record<string, string>> = {
    core: {
        ...mapToTarget(
            [
                'create', 'add', 'newEntry', 'addEntry', 'insert', 'write', 'log', 'record', 'note',
                'save', 'execute', 'executeCode', 'execute_code', 'quick', 'createEntryMinimal',
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
        ...mapToTarget(
            ['get', 'getEntry', 'fetch', 'read', 'get_entry_by_id', 'viewFile', 'view_file', 'readFile', 'read_file'],
            'getEntryById'
        ),
        ...mapToTarget(
            [
                'recent', 'getRecent', 'list', 'entries', 'all', 'latest', 'get_recent_entries',
                'select', 'sql', 'executeSql', 'execSql', 'execute_sql', 'exec_sql',
                'fetchEntries', 'getAll', 'listDir', 'list_dir',
            ],
            'getRecentEntries'
        ),
        ...mapToTarget(['tags', 'getTags', 'get_tags', 'list_tags'], 'listTags'),
        ...mapToTarget(
            ['read_resource', 'readResource', 'memory_read_resource', 'memoryReadResource', 'get_resource', 'getResource'],
            'readResource'
        ),
        ...mapToTarget(['history', 'revisions', 'get_entry_history'], 'getEntryHistory'),
        ...mapToTarget(['schema', 'getSchema', 'get_schema', 'database', 'getDatabase', 'get_database', 'getDb', 'get_db'], 'getStatistics'),
        ...SHARED_PROJECT_ALIASES,
        ...SHARED_HEALTH_ALIASES,
        ...SHARED_GREP_SEARCH_ALIASES,
        listEntries: 'searchEntries',
        create_entry_minimal: 'createEntryMinimal',
        search_audit_log: 'searchAuditLog',
        update: 'updateEntry',
        delete: 'deleteEntry',
        updateEntry: 'updateEntry',
        deleteEntry: 'deleteEntry',
        update_entry: 'updateEntry',
        delete_entry: 'deleteEntry',
    },
    search: {
        ...SHARED_GREP_SEARCH_ALIASES,
        ...mapToTarget(
            [
                'lookup', 'findEntries', 'find_entries', 'listEntries', 'list_entries', 'entries',
                'readQuery', 'read_query', 'select', 'sql', 'executeSql', 'execSql', 'sqlQuery',
                'querySql', 'execute_sql', 'exec_sql', 'search_entries',
            ],
            'searchEntries'
        ),
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
    },
    analytics: {
        ...mapToTarget(
            [
                'stats', 'getStats', 'statistics', 'schema', 'getSchema', 'get_schema', 'tables',
                'getTables', 'get_tables', 'describe', 'databaseInfo', 'getDatabaseInfo',
                'get_database_info', 'database', 'getDatabase', 'get_database', 'getDb', 'get_db',
                'db', 'dbStats', 'getDbStats', 'get_db_stats', 'dbInfo', 'getDbInfo',
                'get_db_info', 'get_statistics',
            ],
            'getStatistics'
        ),
        ...SHARED_HEALTH_ALIASES,
        ...mapToTarget(
            ['insights', 'getInsights', 'getProjects', 'listProjects', 'list_projects', 'projects', 'get_cross_project_insights'],
            'getCrossProjectInsights'
        ),
    },
    relationships: {
        link: 'linkEntries',
        graph: 'visualizeRelationships',
        link_entries: 'linkEntries',
        visualize_relationships: 'visualizeRelationships',
    },
    io: {
        dump: 'exportEntries',
        md: 'exportMarkdown',
        importMd: 'importMarkdown',
        importNotion: 'importExternal',
        importObsidian: 'importExternal',
        export_entries: 'exportEntries',
        export_markdown: 'exportMarkdown',
        import_markdown: 'importMarkdown',
        import_external: 'importExternal',
    },
    admin: {
        ...mapToTarget(
            [
                'edit', 'update', 'editEntry', 'modifyEntry', 'modify', 'updateMemory',
                'update_memory', 'setMemory', 'set_memory', 'updateJournal', 'update_journal',
                'saveMemory', 'save_memory', 'update_entry',
            ],
            'updateEntry'
        ),
        ...mapToTarget(['remove', 'delete', 'removeEntry', 'delete_entry'], 'deleteEntry'),
        ...mapToTarget(['restore', 'restoreEntry', 'restore_entry'], 'restoreEntry'),
        ...mapToTarget(
            ['batchCreate', 'bulkCreate', 'createEntries', 'batchCreateEntry', 'batch_create_entries'],
            'batchCreateEntries'
        ),
        ...mapToTarget(['batchUpdate', 'bulkUpdate', 'updateEntries', 'batch_update_entries'], 'batchUpdateEntries'),
        ...mapToTarget(['batchDelete', 'bulkDelete', 'deleteEntries', 'batch_delete_entries'], 'batchDeleteEntries'),
        ...mapToTarget(['config', 'configure', 'update_configuration'], 'updateConfiguration'),
        ...mapToTarget(['auditLog', 'audit', 'search_audit_log'], 'searchAuditLog'),
        ...SHARED_PROJECT_ALIASES,
        ...SHARED_HEALTH_ALIASES,
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
    },
    github: {
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
    },
    backup: {
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
    },
    team: {
        ...mapToTarget(
            ['create', 'createEntry', 'create_entry', 'addEntry', 'sessionSummary', 'teamSessionSummary'],
            'teamCreateEntry'
        ),
        ...mapToTarget(
            ['recent', 'listEntries', 'teamListEntries', 'list', 'entries', 'teamList'],
            'teamGetRecent'
        ),
        ...mapToTarget(
            ['batchCreate', 'batchCreateEntries', 'bulkCreate', 'createEntries', 'batchCreateEntry'],
            'teamBatchCreateEntries'
        ),
        ...mapToTarget(['batchUpdate', 'batchUpdateEntries', 'bulkUpdate', 'updateEntries'], 'teamBatchUpdateEntries'),
        ...mapToTarget(['batchDelete', 'batchDeleteEntries', 'bulkDelete', 'deleteEntries'], 'teamBatchDeleteEntries'),
        ...mapToTarget(
            ['insights', 'searchProjects', 'listProjects', 'getProjects'],
            'teamGetCrossProjectInsights'
        ),
        ...mapToTarget(['updateRole', 'changeRole', 'setRole'], 'teamUpdateMemberRole'),
        find: 'teamSearch',
        search: 'teamSearch',
        get: 'teamGetEntryById',
        read: 'teamGetEntryById',
        tags: 'teamListTags',
        byDate: 'teamSearchByDateRange',
        update: 'teamUpdateEntry',
        edit: 'teamUpdateEntry',
        delete: 'teamDeleteEntry',
        restore: 'teamRestoreEntry',
        teamRestore: 'teamRestoreEntry',
        mergeTags: 'teamMergeTags',
        stats: 'teamGetStatistics',
        link: 'teamLinkEntries',
        linkEntries: 'teamLinkEntries',
        graph: 'teamVisualizeRelationships',
        visualizeRelationships: 'teamVisualizeRelationships',
        export: 'teamExportEntries',
        exportEntries: 'teamExportEntries',
        exportMarkdown: 'teamExportMarkdown',
        md: 'teamExportMarkdown',
        importMarkdown: 'teamImportMarkdown',
        importMd: 'teamImportMarkdown',
        importNotion: 'teamImportExternal',
        importObsidian: 'teamImportExternal',
        importExternal: 'teamImportExternal',
        trash: 'teamListDeletedEntries',
        deleted: 'teamListDeletedEntries',
        backup: 'teamBackup',
        listBackups: 'teamListBackups',
        semanticSearch: 'teamSemanticSearch',
        vectorStats: 'teamGetVectorIndexStats',
        rebuildIndex: 'teamRebuildVectorIndex',
        addToIndex: 'teamAddToVectorIndex',
        collaborationMatrix: 'teamGetCollaborationMatrix',
        addMember: 'teamAddMember',
        removeMember: 'teamRemoveMember',
        members: 'teamListMembers',
        listMembers: 'teamListMembers',
        getMember: 'teamGetMember',
        addAlias: 'teamAddAuthorAlias',
        removeAlias: 'teamRemoveAuthorAlias',
        aliases: 'teamListAuthorAliases',
        listAliases: 'teamListAuthorAliases',
        resolveAuthor: 'teamResolveAuthor',
        consolidate: 'teamConsolidateAuthors',
        consolidateAuthors: 'teamConsolidateAuthors',
    },
    git: {
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
    },
}

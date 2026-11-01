/**
 * memory-journal-mcp - Examples and Parameter Constants
 *
 * - GROUP_EXAMPLES: help() output per group
 * - POSITIONAL_PARAM_MAP: positional -> named arg mapping
 * - GROUP_PREFIX_MAP: tool name prefix stripping rules
 * - KEEP_PREFIX_GROUPS: groups that retain their prefix in method names
 */

// =============================================================================
// Group Examples (for help())
// =============================================================================

/**
 * Usage examples for each group's help() output
 */
export const GROUP_EXAMPLES: Record<string, string[]> = {
    core: [
        'mj.core.createEntry({ content: "Implemented Code Mode" })',
        'mj.core.getEntryById({ entry_id: 1 })',
        'mj.core.getRecentEntries({ limit: 10 })',
        'mj.core.createEntryMinimal({ content: "Quick note" })',
        'mj.core.listTags()',
    ],
    search: [
        'mj.search.searchEntries({ query: "performance" })',
        'mj.search.searchEntries({ query: "performance", mode: "hybrid" })',
        'mj.search.searchByDateRange({ start_date: "2026-03-01", end_date: "2026-03-11" })',
        'mj.search.semanticSearch({ query: "authentication patterns" })',
        'mj.search.semanticSearch({ entry_id: 42 })',
    ],
    analytics: [
        'mj.analytics.getStatistics()',
        'mj.analytics.getCrossProjectInsights()',
        'mj.analytics.getProjects()',
    ],
    relationships: [
        'mj.relationships.linkEntries({ from_entry_id: 1, to_entry_id: 2, relationship_type: "implements" })',
        'mj.relationships.visualizeRelationships({ entry_id: 1 })',
    ],
    io: [
        'mj.io.exportEntries({ format: "json" })',
        'mj.io.exportMarkdown({ output_dir: "./export" })',
        'mj.io.importMarkdown({ source_dir: "./import" })',
        'mj.io.importExternal({ source_dir: "./import", source_format: "notion" })',
    ],
    admin: [
        'mj.admin.updateEntry({ entry_id: 1, content: "Updated content" })',
        'mj.admin.deleteEntry({ entry_id: 1 })',
        'mj.admin.restoreEntry({ entry_id: 1 })',
        'mj.admin.mergeTags({ source_tag: "old", target_tag: "new" })',
        'mj.admin.batchCreateEntries({ entries: [{ content: "First" }, { content: "Second" }] })',
        'mj.admin.rebuildVectorIndex()',
        'mj.admin.addToVectorIndex({ entry_id: 1 })',
    ],
    github: [
        'mj.github.getGithubIssues({ state: "open" })',
        'mj.github.getGithubPrs({ state: "open" })',
        'mj.github.getKanbanBoard({ project_number: 1 })',
        'mj.github.addKanbanItem({ project_number: 1, issue_number: 123 })',
        'mj.github.getGithubMilestones()',
        'mj.github.getRepoInsights()',
    ],
    backup: [
        'mj.backup.backupJournal()',
        'mj.backup.listBackups()',
        'mj.backup.restoreBackup({ filename: "backup-2026-03-11.db" })',
    ],
    team: [
        'mj.team.teamCreateEntry({ content: "Team update" })',
        'mj.team.teamGetRecent({ limit: 5 })',
        'mj.team.teamSearch({ query: "release" })',
        'mj.team.teamGetEntryById({ entry_id: 1 })',
        'mj.team.teamListTags()',
        'mj.team.teamUpdateEntry({ entry_id: 1, content: "Updated" })',
        'mj.team.teamRestoreEntry({ entry_id: 1 })',
        'mj.team.teamBatchCreateEntries({ entries: [{ content: "Team A" }] })',
        'mj.team.teamGetStatistics()',
        'mj.team.teamExportEntries({ format: "json" })',
        'mj.team.teamBackup()',
        'mj.team.teamSemanticSearch({ query: "deployment" })',
        'mj.team.teamGetCrossProjectInsights()',
    ],
    git: [
        'mj.git.getCommitHistory({ maxCount: 10 })',
        'mj.git.searchCommits({ query: "fix" })',
        'mj.git.getReleaseInfo()',
        'mj.git.getUnreleasedCommits()',
        'mj.git.analyzeCommitPatterns({ maxCount: 20 })',
    ],
}

// =============================================================================
// Positional Parameter Mapping
// =============================================================================

/**
 * Maps method names to their parameter names for positional argument support.
 * Single string = first positional arg maps to this key.
 * Array = multiple positional args map to these keys in order.
 *
 * Enables:
 * - `mj.core.createEntry("My note")` -> `{ content: "My note" }`
 * - `mj.search.searchEntries("performance")` -> `{ query: "performance" }`
 */
export const POSITIONAL_PARAM_MAP: Record<string, string | string[]> = {
    // Core
    createEntry: 'content',
    getEntryById: 'entry_id',
    getRecentEntries: 'limit',
    createEntryMinimal: 'content',
    testSimple: 'message',
    writeQuery: 'content',
    getEntryHistory: 'entry_id',

    // Search
    searchEntries: 'query',
    searchByDateRange: ['start_date', 'end_date'],
    semanticSearch: 'query',
    crossTeamSearch: 'query',
    listDeletedEntries: 'limit',

    // Relationships
    linkEntries: ['from_entry_id', 'to_entry_id', 'relationship_type'],
    link_entries: ['from_entry_id', 'to_entry_id', 'relationship_type'],
    visualizeRelationships: 'entry_id',
    visualize_relationships: 'entry_id',

    // Export
    exportEntries: 'format',
    exportMarkdown: 'output_dir',
    importMarkdown: 'source_dir',
    importExternal: 'source_dir',

    // Admin
    updateEntry: 'entry_id',
    deleteEntry: 'entry_id',
    restoreEntry: 'entry_id',
    addToVectorIndex: 'entry_id',
    mergeTags: ['source_tag', 'target_tag'],
    batchCreateEntries: 'entries',
    batchUpdateEntries: 'updates',
    batchDeleteEntries: 'entry_ids',
    searchAuditLog: 'tool_name',
    updateConfiguration: 'tool_filter',
    registerProject: ['name', 'absolute_path', 'project_number'],
    updateProject: ['name', 'new_name', 'absolute_path', 'project_number'],
    deleteProject: 'name',
    getProject: 'name',
    getProjectByName: 'name',
    get_project_by_name: 'name',
    getProjectByNumber: 'name',
    get_project_by_number: 'name',
    findProject: 'name',
    find_project: 'name',

    // GitHub
    getGithubIssue: 'issue_number',
    getGithubPr: 'pr_number',
    getKanbanBoard: 'project_number',
    moveKanbanItem: ['item_id', 'target_status'],
    addKanbanItem: 'issue_number',
    deleteKanbanItem: 'item_id',
    getGithubMilestone: 'milestone_number',
    createGithubMilestone: 'title',
    updateGithubMilestone: 'milestone_number',
    deleteGithubMilestone: 'milestone_number',
    createGithubIssueWithEntry: 'title',
    closeGithubIssueWithEntry: 'issue_number',
    getCopilotReviews: 'pr_number',

    // Backup
    backupJournal: 'name',
    restoreBackup: ['filename', 'confirm'],
    cleanupBackups: 'keep_count',

    // Team
    teamCreateEntry: 'content',
    teamGetRecent: 'limit',
    teamSearch: 'query',
    teamGetEntryById: 'entry_id',
    teamSearchByDateRange: ['start_date', 'end_date'],
    teamUpdateEntry: 'entry_id',
    teamDeleteEntry: 'entry_id',
    teamRestoreEntry: 'entry_id',
    teamMergeTags: ['source_tag', 'target_tag'],
    teamBatchCreateEntries: 'entries',
    teamBatchUpdateEntries: 'updates',
    teamBatchDeleteEntries: 'entry_ids',
    teamLinkEntries: ['from_entry_id', 'to_entry_id', 'relationship_type'],
    teamVisualizeRelationships: 'entry_id',
    teamExportEntries: 'format',
    teamExportMarkdown: 'output_dir',
    teamImportMarkdown: 'source_dir',
    teamImportExternal: 'source_dir',
    teamSemanticSearch: 'query',
    teamAddToVectorIndex: 'entry_id',
    teamAddAuthorAlias: ['alias', 'canonical_author'],
    teamRemoveAuthorAlias: 'alias',
    teamListAuthorAliases: 'canonical_author',
    teamResolveAuthor: 'author',
    teamConsolidateAuthors: 'canonical_author',

    // Team Members
    teamAddMember: ['author', 'role'],
    teamRemoveMember: 'author',
    teamUpdateMemberRole: ['author', 'role'],
    teamGetMember: 'author',

    // Git
    getCommitHistory: 'maxCount',
    searchCommits: 'query',
    getReleaseInfo: 'ref',
    analyzeCommitPatterns: 'maxCount',
}

// =============================================================================
// Tool Name -> Method Name Conversion
// =============================================================================

/**
 * Map group name to the prefix used in tool names.
 */
export const GROUP_PREFIX_MAP: Record<string, string> = {
    core: '',
    search: '',
    analytics: '',
    relationships: '',
    io: '',
    admin: '',
    github: '',
    backup: '',
    team: '',
    git: '',
    codemode: 'mj_',
}

/**
 * Groups where the prefix should be kept in the method name.
 */
export const KEEP_PREFIX_GROUPS = new Set(['github', 'team'])

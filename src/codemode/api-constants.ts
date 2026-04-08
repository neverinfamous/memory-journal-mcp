/**
 * memory-journal-mcp - Code Mode API Constants
 *
 * Static constant maps for the sandbox API:
 * - METHOD_ALIASES: shorthand names within each group
 * - GROUP_EXAMPLES: help() output per group
 * - POSITIONAL_PARAM_MAP: positional → named arg mapping
 * - GROUP_PREFIX_MAP: tool name prefix stripping rules
 * - KEEP_PREFIX_GROUPS: groups that retain their prefix in method names
 */

// =============================================================================
// Method Aliases
// =============================================================================

/**
 * Aliases for common naming shortcuts within each group.
 * Maps alias name → canonical method name.
 */
export const METHOD_ALIASES: Record<string, Record<string, string>> = {
    core: {
        create: 'createEntry',
        get: 'getEntryById',
        recent: 'getRecentEntries',
        getRecent: 'getRecentEntries',
        quick: 'createEntryMinimal',
        tags: 'listTags',
    },
    search: {
        find: 'searchEntries',
        byDate: 'searchByDateRange',
        similar: 'semanticSearch',
        stats: 'getVectorStats',
    },
    analytics: {
        stats: 'getStatistics',
        insights: 'getCrossProjectInsights',
    },
    relationships: {
        link: 'linkEntries',
        graph: 'visualizeRelationships',
    },
    io: {
        dump: 'exportEntries',
        md: 'exportMarkdown',
        importMd: 'importMarkdown',
    },
    admin: {
        edit: 'updateEntry',
        remove: 'deleteEntry',
        rebuild: 'rebuildVectorIndex',
        addVector: 'addToVectorIndex',
        mergeTags: 'mergeTags',
    },
    github: {
        issues: 'getGithubIssues',
        issue: 'getGithubIssue',
        prs: 'getGithubPrs',
        pr: 'getGithubPr',
        context: 'getGithubContext',
        kanban: 'getKanbanBoard',
        moveKanban: 'moveKanbanItem',
        milestones: 'getGithubMilestones',
        milestone: 'getGithubMilestone',
        createMilestone: 'createGithubMilestone',
        updateMilestone: 'updateGithubMilestone',
        deleteMilestone: 'deleteGithubMilestone',
        repoInsights: 'getRepoInsights',
        createIssue: 'createGithubIssueWithEntry',
        closeIssue: 'closeGithubIssueWithEntry',
    },
    backup: {
        save: 'backupJournal',
        list: 'listBackups',
        restore: 'restoreBackup',
        cleanup: 'cleanupBackups',
    },
    team: {
        create: 'teamCreateEntry',
        recent: 'teamGetRecent',
        find: 'teamSearch',
        get: 'teamGetEntryById',
        tags: 'teamListTags',
        byDate: 'teamSearchByDateRange',
        update: 'teamUpdateEntry',
        remove: 'teamDeleteEntry',
        mergeTags: 'teamMergeTags',
        stats: 'teamGetStatistics',
        link: 'teamLinkEntries',
        graph: 'teamVisualizeRelationships',
        export: 'teamExportEntries',
        backup: 'teamBackup',
        listBackups: 'teamListBackups',
        semanticSearch: 'teamSemanticSearch',
        vectorStats: 'teamGetVectorIndexStats',
        rebuildIndex: 'teamRebuildVectorIndex',
        addToIndex: 'teamAddToVectorIndex',
        insights: 'teamGetCrossProjectInsights',
    },
}

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
    analytics: ['mj.analytics.getStatistics()', 'mj.analytics.getCrossProjectInsights()'],
    relationships: [
        'mj.relationships.linkEntries({ from_entry_id: 1, to_entry_id: 2, relationship_type: "implements" })',
        'mj.relationships.visualizeRelationships({ entry_id: 1 })',
    ],
    io: [
        'mj.io.exportEntries({ format: "json" })',
        'mj.io.exportMarkdown({ output_dir: "./export" })',
        'mj.io.importMarkdown({ source_dir: "./import" })',
    ],
    admin: [
        'mj.admin.updateEntry({ entry_id: 1, content: "Updated content" })',
        'mj.admin.deleteEntry({ entry_id: 1 })',
        'mj.admin.mergeTags({ source_tag: "old", target_tag: "new" })',
        'mj.admin.rebuildVectorIndex()',
        'mj.admin.addToVectorIndex({ entry_id: 1 })',
    ],
    github: [
        'mj.github.getGithubIssues({ state: "open" })',
        'mj.github.getGithubPrs({ state: "open" })',
        'mj.github.getKanbanBoard({ project_number: 1 })',
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
        'mj.team.teamGetStatistics()',
        'mj.team.teamExportEntries({ format: "json" })',
        'mj.team.teamBackup()',
        'mj.team.teamSemanticSearch({ query: "deployment" })',
        'mj.team.teamGetCrossProjectInsights()',
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
 * - `mj.core.createEntry("My note")` → `{ content: "My note" }`
 * - `mj.search.searchEntries("performance")` → `{ query: "performance" }`
 */
export const POSITIONAL_PARAM_MAP: Record<string, string | string[]> = {
    // Core
    createEntry: 'content',
    getEntryById: 'entry_id',
    getRecentEntries: 'limit',
    createEntryMinimal: 'content',
    testSimple: 'message',

    // Search
    searchEntries: 'query',
    searchByDateRange: ['start_date', 'end_date'],
    semanticSearch: 'query',

    // Analytics (no positional — uses empty params)

    // Relationships
    linkEntries: ['from_entry_id', 'to_entry_id', 'relationship_type'],
    visualizeRelationships: 'entry_id',

    // Export
    exportEntries: 'format',

    // Admin
    updateEntry: 'entry_id',
    deleteEntry: 'entry_id',
    addToVectorIndex: 'entry_id',
    mergeTags: ['source_tag', 'target_tag'],

    // GitHub
    getGithubIssue: 'issue_number',
    getGithubPr: 'pr_number',
    getKanbanBoard: 'project_number',
    moveKanbanItem: ['item_id', 'status'],
    getGithubMilestone: 'milestone_number',
    createGithubMilestone: 'title',
    updateGithubMilestone: 'milestone_number',
    deleteGithubMilestone: 'milestone_number',
    createGithubIssueWithEntry: 'title',
    closeGithubIssueWithEntry: 'issue_number',

    // Backup
    restoreBackup: 'filename',
    cleanupBackups: 'keep_count',

    // Team
    teamCreateEntry: 'content',
    teamGetRecent: 'limit',
    teamSearch: 'query',
    teamGetEntryById: 'entry_id',
    teamSearchByDateRange: ['start_date', 'end_date'],
    teamUpdateEntry: 'entry_id',
    teamDeleteEntry: 'entry_id',
    teamMergeTags: ['source_tag', 'target_tag'],
    teamLinkEntries: ['from_entry_id', 'to_entry_id', 'relationship_type'],
    teamVisualizeRelationships: 'entry_id',
    teamExportEntries: 'format',
    teamSemanticSearch: 'query',
    teamAddToVectorIndex: 'entry_id',
}

// =============================================================================
// Tool Name → Method Name Conversion
// =============================================================================

/**
 * Map group name to the prefix used in tool names.
 * When a tool is in a group, its name typically starts with a group-related prefix.
 * For memory-journal-mcp, tool names are flat (no server prefix like "sqlite_").
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
    codemode: 'mj_',
}

/**
 * Groups where the prefix should be kept in the method name.
 * For memory-journal-mcp, github and team tools have meaningful prefixes
 * (e.g., `get_github_issues`, `team_create_entry`).
 */
export const KEEP_PREFIX_GROUPS = new Set(['github', 'team'])

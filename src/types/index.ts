/**
 * Memory Journal MCP Server - Type Definitions
 *
 * Core types for the MCP server including tools, resources, prompts,
 * database entities, and filtering.
 */

// ============================================================================
// Tool Filtering Types
// ============================================================================

/**
 * Tool group identifiers for Memory Journal
 */
export type ToolGroup =
    | 'core' // Entry CRUD: create, get_by_id, get_recent, create_minimal, test_simple
    | 'search' // Search: search_entries, search_by_date_range, semantic_search
    | 'analytics' // Analytics: get_statistics, get_cross_project_insights
    | 'relationships' // Relationships: link_entries, visualize_relationships
    | 'export' // Export: export_entries
    | 'admin' // Admin: update_entry, delete_entry
    | 'github' // Reserved for future GitHub-specific tools
    | 'backup' // Backup: backup_journal, list_backups, restore_backup

/**
 * Meta-group identifiers for common multi-group selections
 */
export type MetaGroup =
    | 'starter' // core + search (~8 tools)
    | 'essential' // core only (~5 tools)
    | 'full' // all groups (~16 tools)
    | 'readonly' // everything except admin

/**
 * Tool filter rule
 */
export interface ToolFilterRule {
    /** Rule type: include or exclude */
    type: 'include' | 'exclude'

    /** Target: group name or tool name */
    target: string

    /** Whether target is a group (true) or individual tool (false) */
    isGroup: boolean
}

/**
 * Parsed tool filter configuration
 */
export interface ToolFilterConfig {
    /** Original filter string */
    raw: string

    /** Parsed rules in order */
    rules: ToolFilterRule[]

    /** Set of enabled tool names after applying rules */
    enabledTools: Set<string>
}

// ============================================================================
// MCP 2025-11-25 Annotations
// ============================================================================

/**
 * MCP Tool Annotations (MCP Spec 2025-11-25)
 *
 * Behavioral hints for AI clients to understand tool characteristics.
 */
export interface ToolAnnotations {
    /** Tool does not modify state (idempotent reads) */
    readOnlyHint?: boolean

    /** Tool may permanently delete/destroy data */
    destructiveHint?: boolean

    /** Repeated calls with same args produce same result */
    idempotentHint?: boolean

    /** Tool interacts with external services (network, APIs) */
    openWorldHint?: boolean
}

/**
 * MCP Resource Annotations (MCP Spec 2025-11-25)
 */
export interface ResourceAnnotations {
    /** Intended audience: 'user' or 'assistant' */
    audience?: ('user' | 'assistant')[]

    /** Importance level from 0.0 (optional) to 1.0 (required) */
    priority?: number

    /** ISO 8601 timestamp of last modification */
    lastModified?: string
}

/**
 * MCP Icon Definition (MCP Spec 2025-11-25)
 *
 * Icons can be added to servers, tools, resources, and prompts for
 * visual representation in client interfaces.
 */
export interface McpIcon {
    /** Icon source - URL or data URI */
    src: string

    /** MIME type (e.g., 'image/svg+xml', 'image/png') */
    mimeType?: string

    /** Size descriptors (e.g., ['48x48'], ['any']) */
    sizes?: string[]
}

// ============================================================================
// Tool, Resource, Prompt Definitions
// ============================================================================

/**
 * Tool definition for registration
 */
export interface ToolDefinition {
    /** Unique tool name */
    name: string

    /** Human-readable display title (MCP 2025-11-25) */
    title: string

    /** Human-readable description */
    description: string

    /** Tool group for filtering */
    group: ToolGroup

    /** Zod schema for input validation */
    inputSchema: unknown

    /** Zod schema for output validation (MCP 2025-11-25 outputSchema) */
    outputSchema?: unknown

    /** Behavioral hints for AI clients */
    annotations: ToolAnnotations

    /** Tool handler function */
    handler: (params: unknown) => Promise<unknown>
}

/**
 * Resource definition for MCP
 */
export interface ResourceDefinition {
    /** Resource URI template */
    uri: string

    /** Human-readable name */
    name: string

    /** Human-readable display title */
    title: string

    /** Description */
    description: string

    /** MIME type */
    mimeType: string

    /** Resource metadata annotations */
    annotations?: ResourceAnnotations

    /** Resource handler - NOTE: db is passed at runtime, not in the definition */
    handler: (uri: string) => Promise<unknown>
}

/**
 * Prompt definition for MCP
 */
export interface PromptDefinition {
    /** Prompt name */
    name: string

    /** Description */
    description: string

    /** Argument definitions */
    arguments?: {
        name: string
        description: string
        required?: boolean
    }[]

    /** Prompt handler */
    handler: (args: Record<string, string>) => Promise<unknown>
}

// ============================================================================
// Database Entity Types
// ============================================================================

/**
 * Entry types for journal entries
 */
export type EntryType =
    | 'personal_reflection'
    | 'project_decision'
    | 'technical_achievement'
    | 'bug_fix'
    | 'feature_implementation'
    | 'code_review'
    | 'meeting_notes'
    | 'learning'
    | 'research'
    | 'planning'
    | 'retrospective'
    | 'standup'
    | 'other'

/**
 * Significance types for important entries
 */
export type SignificanceType =
    | 'milestone'
    | 'breakthrough'
    | 'technical_breakthrough'
    | 'decision'
    | 'lesson_learned'
    | 'blocker_resolved'
    | 'release'
    | null

/**
 * Relationship types between entries
 */
export type RelationshipType =
    | 'evolves_from'
    | 'references'
    | 'implements'
    | 'clarifies'
    | 'response_to'

/**
 * Journal entry entity
 */
export interface JournalEntry {
    id: number
    entryType: EntryType
    content: string
    timestamp: string
    isPersonal: boolean
    significanceType: SignificanceType
    autoContext: string | null
    deletedAt: string | null
    tags: string[]
}

/**
 * Tag entity
 */
export interface Tag {
    id: number
    name: string
    usageCount: number
}

/**
 * Relationship entity
 */
export interface Relationship {
    id: number
    fromEntryId: number
    toEntryId: number
    relationshipType: RelationshipType
    description: string | null
    createdAt: string
}

/**
 * Embedding entity for vector search
 */
export interface Embedding {
    entryId: number
    embedding: Float32Array
    modelName: string
}

// ============================================================================
// GitHub Integration Types
// ============================================================================

/**
 * GitHub project information
 */
export interface GitHubProject {
    number: number
    title: string
    url: string
    state: 'OPEN' | 'CLOSED'
}

/**
 * GitHub issue information
 */
export interface GitHubIssue {
    number: number
    title: string
    url: string
    state: 'OPEN' | 'CLOSED'
}

/**
 * GitHub pull request information
 */
export interface GitHubPullRequest {
    number: number
    title: string
    url: string
    state: 'OPEN' | 'CLOSED' | 'MERGED'
}

/**
 * GitHub workflow run information
 */
export interface GitHubWorkflowRun {
    id: number
    name: string
    status: 'queued' | 'in_progress' | 'completed'
    conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null
    url: string
    headBranch: string
    headSha: string
    createdAt: string
    updatedAt: string
}

/**
 * Auto-captured project context
 */
export interface ProjectContext {
    repoName: string | null
    branch: string | null
    commit: string | null
    remoteUrl: string | null
    projects: GitHubProject[]
    issues: GitHubIssue[]
    pullRequests: GitHubPullRequest[]
    workflowRuns: GitHubWorkflowRun[]
}

// ============================================================================
// GitHub Projects v2 Kanban Types
// ============================================================================

/**
 * Status option for single-select field in Projects v2
 */
export interface ProjectV2StatusOption {
    id: string
    name: string
    color?: string
}

/**
 * Project item in a Kanban board
 */
export interface ProjectV2Item {
    id: string
    title: string
    url: string
    type: 'ISSUE' | 'PULL_REQUEST' | 'DRAFT_ISSUE'
    status: string | null
    number?: number
    labels?: string[]
    assignees?: string[]
    createdAt: string
    updatedAt: string
}

/**
 * Kanban column (grouped by Status)
 */
export interface KanbanColumn {
    status: string
    statusOptionId: string
    items: ProjectV2Item[]
}

/**
 * Full Kanban board response
 */
export interface KanbanBoard {
    projectId: string
    projectNumber: number
    projectTitle: string
    statusFieldId: string
    statusOptions: ProjectV2StatusOption[]
    columns: KanbanColumn[]
    totalItems: number
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Server configuration
 */
export interface ServerConfig {
    /** Path to SQLite database file */
    dbPath: string

    /** GitHub personal access token */
    githubToken?: string

    /** GitHub organization token (for org projects) */
    githubOrgToken?: string

    /** Default organization name */
    defaultOrg?: string

    /** Tool filter string */
    toolFilter?: string

    /** Default GitHub Project number for auto-assignment */
    defaultProjectNumber?: number

    /** Enable semantic search */
    enableSemanticSearch: boolean

    /** Sentence transformer model name */
    modelName: string
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Partial<ServerConfig> = {
    dbPath: './memory_journal.db',
    enableSemanticSearch: true,
    modelName: 'all-MiniLM-L6-v2',
}

// ============================================================================
// Backup Types
// ============================================================================

/**
 * Backup file information
 */
export interface BackupInfo {
    /** Backup filename */
    filename: string

    /** Full path to backup file */
    path: string

    /** File size in bytes */
    sizeBytes: number

    /** Backup creation time (ISO 8601) */
    createdAt: string
}

// ============================================================================
// Health Status Types
// ============================================================================

/**
 * Server health and diagnostics status
 */
export interface HealthStatus {
    /** Database statistics */
    database: {
        path: string
        sizeBytes: number
        entryCount: number
        deletedEntryCount: number
        relationshipCount: number
        tagCount: number
    }

    /** Backup information */
    backups: {
        directory: string
        count: number
        lastBackup: {
            filename: string
            createdAt: string
            sizeBytes: number
        } | null
    }

    /** Vector search index status */
    vectorIndex: {
        available: boolean
        itemCount: number
        modelName: string | null
    } | null

    /** Tool filter configuration */
    toolFilter: {
        active: boolean
        enabledCount: number
        totalCount: number
        filterString: string | null
    }

    /** Health check timestamp (ISO 8601) */
    timestamp: string
}

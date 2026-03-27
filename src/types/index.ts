/**
 * Memory Journal MCP Server - Type Definitions
 *
 * Barrel file re-exporting all types from sub-modules, plus types
 * that depend on external imports (SqliteAdapter, VectorSearchManager, etc.).
 */

import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import type { VectorSearchManager } from '../vector/vector-search-manager.js'
import type { GitHubIntegration } from '../github/github-integration/index.js'
import type { ProgressContext } from '../utils/progress-utils.js'

// Re-export sub-module types
export type { ToolGroup, MetaGroup, ToolFilterRule, ToolFilterConfig } from './filtering.js'
export { ErrorCategory } from './error-types.js'
export type { ErrorResponse, ErrorContext } from './error-types.js'
export {
    MemoryJournalMcpError,
    ConnectionError,
    QueryError,
    ValidationError,
    ResourceNotFoundError,
    ConfigurationError,
    PermissionError,
} from './errors.js'
export type {
    EntryType,
    SignificanceType,
    RelationshipType,
    JournalEntry,
    Tag,
    Relationship,
    Embedding,
    ImportanceBreakdown,
    ImportanceResult,
} from './entities.js'
export type {
    GitHubProject,
    GitHubIssue,
    GitHubPullRequest,
    GitHubMilestone,
    GitHubWorkflowRun,
    GitHubReview,
    GitHubReviewComment,
    CopilotReviewSummary,
    ProjectContext,
    RepoStats,
    TrafficData,
    TrafficReferrer,
    PopularPath,
    ProjectV2StatusOption,
    ProjectV2Item,
    KanbanColumn,
    KanbanBoard,
} from './github.js'

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

import type { ToolGroup } from './filtering.js'

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
    handler: (params: unknown) => unknown
}

/**
 * Shape returned by `getTools()` for MCP SDK registration.
 * Derived from `ToolDefinition` but excludes internal fields (group, handler).
 */
export interface ToolRegistration {
    name: string
    /** Human-readable display title (MCP 2025-11-25) */
    title?: string
    description: string
    inputSchema: unknown
    outputSchema?: unknown
    annotations: ToolAnnotations
    icons?: { iconUrl: string; title: string; description: string }
}

export interface ProjectRegistryEntry {
    path: string
    project_number?: number
}

/**
 * Tool handler configuration options
 */
export interface ToolHandlerConfig {
    /** Default GitHub Project number for auto-assignment */
    defaultProjectNumber?: number
    /** Project registry mapping dynamic repo IDs to local paths and kanban boards */
    projectRegistry?: Record<string, ProjectRegistryEntry>
}

/**
 * Tool execution context passed to all tool group modules
 */
export interface ToolContext {
    /** Database adapter */
    db: IDatabaseAdapter
    /** Team database adapter (optional, requires TEAM_DB_PATH) */
    teamDb?: IDatabaseAdapter
    /** Vector search manager (optional) */
    vectorManager?: VectorSearchManager
    /** Team vector search manager (optional, bound to team DB) */
    teamVectorManager?: VectorSearchManager
    /** GitHub integration (optional) */
    github?: GitHubIntegration
    /** Handler configuration */
    config?: ToolHandlerConfig
    /** Progress reporting context */
    progress?: ProgressContext
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

    /** Project registry mapping dynamic repo IDs to local paths and kanban boards */
    projectRegistry?: Record<string, ProjectRegistryEntry>

    /** Enable semantic search */
    enableSemanticSearch: boolean

    /** Sentence transformer model name */
    modelName: string

    /** Briefing depth for AI client instructions */
    instructionLevel?: 'essential' | 'standard' | 'full'
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

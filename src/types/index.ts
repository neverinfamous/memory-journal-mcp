/**
 * Memory Journal MCP Server - Type Definitions
 *
 * Barrel file re-exporting all types from sub-modules, plus types
 * that depend on external imports (SqliteAdapter, VectorSearchManager, etc.).
 */

import type { IDatabaseAdapter } from '../database/core/interfaces.js'
import type { VectorSearchManager } from '../vector/vector-search-manager/index.js'
import type { GitHubIntegration } from '../github/github-integration/index.js'
import type { ProgressContext } from '../utils/progress-utils.js'

// Re-export sub-module types
export type { ToolGroup, MetaGroup, ToolFilterRule, ToolFilterConfig } from './filtering.js'
export type { ErrorCategory, ErrorResponse, ErrorContext } from './error-types.js'
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
    EntryRevision,
    Anchor,
    AnchorStatus,
    CreateEntryInput,
    CreateTeamEntryInput,
} from './entities.js'
export { ENTRY_TYPES, RELATIONSHIP_TYPES, SIGNIFICANCE_TYPES } from './entities.js'
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

import type { ToolGroup, ToolFilterConfig } from './filtering.js'

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

    /** Security capabilities required to execute this tool */
    capabilities?: {
        requiresTeamScope?: boolean
        requiresAdminScope?: boolean
        mutatesState?: boolean
    }

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
    title?: string | undefined
    description: string
    inputSchema: unknown
    outputSchema?: unknown
    annotations: ToolAnnotations
    icons?: { iconUrl: string; title: string; description: string } | undefined
}

export interface ProjectRegistryEntry {
    path: string
    project_number?: number | undefined
}

/**
 * Tool handler configuration options
 */
import type { ServerRuntime } from '../utils/maintenance-lock.js'
import type { SubscriptionManager } from '../server/subscription-manager.js'
import type { BriefingConfig } from '../handlers/resources/shared.js'

export interface ToolHandlerConfig {
    /** Default GitHub Project number for auto-assignment */
    defaultProjectNumber?: number | undefined
    /** Default workspace ID for isolating journal entries */
    defaultWorkspaceId?: string | undefined
    /** Project registry mapping dynamic repo IDs to local paths and kanban boards */
    projectRegistry?: Record<string, ProjectRegistryEntry> | undefined
    /** Additional team database mappings (label -> path) for cross-team discovery */
    additionalTeamDbs?: Record<string, string> | undefined

    /** Allowlisted roots for file IO */
    allowedIoRoots?: string[] | undefined
    /**
     * SEC-1.1: Central dispatch function for Code Mode.
     * Routes sandbox tool calls through callTool() so OAuth scope checks,
     * maintenance-mode guards, and audit interception apply to inner calls.
     * When absent, Code Mode falls back to calling raw tool handlers directly.
     */
    dispatch?: ((name: string, args: Record<string, unknown>) => Promise<unknown>) | undefined
    /**
     * SEC-1.2: Active tool filter for Code Mode universe scoping.
     * When set, Code Mode only exposes tools that are in filterConfig.enabledTools,
     * ensuring operators' --tool-filter restrictions are enforced inside the sandbox.
     */
    filterConfig?: ToolFilterConfig | null | undefined
    /**
     * Server runtime context for tracking instance-bound globals (Audit logger, Maintenance Lock).
     */
    /** Server auth configuration passed down for strict security gates */
    authEnabled?: boolean | undefined
    oauthEnabled?: boolean | undefined
    codemodeEnabled?: boolean | undefined
    codemodeInternalFullAccess?: boolean | undefined
    /** Enable autonomous MCP tool and parameter healing/interception (default: true) */
    agentHealing?: boolean | undefined
    /** Default role for un-registered authors (default: denied) */
    teamDefaultRole?: 'admin' | 'member' | 'viewer' | 'denied' | undefined
    /** Admin author to bootstrap if team_members table is empty */
    teamAdmin?: string | undefined
    /**
     * Server runtime context for tracking instance-bound globals (Audit logger, Maintenance Lock).
     */
    runtime?: ServerRuntime | undefined
    /**
     * Optional subscription manager for triggering real-time MCP notifications.
     */
    subscriptionManager?: SubscriptionManager | undefined
    /** Optional briefing configuration for Code Mode dynamic resolution. */
    briefingConfig?: BriefingConfig | undefined
    /** Server-configured auto-prune archive age threshold (days) */
    archiveOlderThanDays?: number | undefined
    /** Server-configured auto-prune soft-delete age threshold (days) */
    pruneOlderThanDays?: number | undefined
    /** Server-configured auto-prune hard-delete age threshold (days) */
    hardDeleteOlderThanDays?: number | undefined
    /** Server-configured auto-prune importance threshold (0.0-1.0) */
    pruneImportanceThreshold?: number | undefined
    /** Tags skipped by archive, soft-delete, and hard-delete */
    pruneExcludeTags?: string[] | undefined
    /** Maximum number of array elements and object properties allowed across a tool input payload */
    maxToolInputElements?: number | undefined
}

/**
 * Tool execution context passed to all tool group modules
 */
export interface ToolContext {
    /** Database adapter */
    db: IDatabaseAdapter
    /** Team database adapter (optional, requires TEAM_DB_PATH) */
    teamDb?: IDatabaseAdapter | undefined
    /** Vector search manager (optional) */
    vectorManager?: VectorSearchManager | undefined
    /** Team vector search manager (optional, bound to team DB) */
    teamVectorManager?: VectorSearchManager | undefined
    /** GitHub integration (optional) */
    github?: GitHubIntegration | undefined
    /** Handler configuration */
    config?: ToolHandlerConfig | undefined
    /** Progress reporting context */
    progress?: ProgressContext | undefined
    /** Authentication context injected by transport */
    auth?: { sub?: string | undefined; subject?: string | undefined; scopes?: string[] | undefined } | undefined
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

    /** Security capabilities required to read this resource */
    capabilities?: {
        requiresTeamScope?: boolean
        requiresAdminScope?: boolean
        requiresAuditScope?: boolean
    }

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

export type { ServerConfig, BackupInfo, HealthStatus } from './server-and-health.js'
export { DEFAULT_CONFIG } from './server-and-health.js'

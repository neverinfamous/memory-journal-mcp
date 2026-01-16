/**
 * memory-journal-mcp - Public API
 *
 * Exports the main components for programmatic use.
 */

// Server
export { createServer, SqliteAdapter } from './server/McpServer.js'

// Types
export type {
    ToolGroup,
    MetaGroup,
    ToolFilterRule,
    ToolFilterConfig,
    ToolAnnotations,
    ResourceAnnotations,
    ToolDefinition,
    ResourceDefinition,
    PromptDefinition,
    EntryType,
    SignificanceType,
    RelationshipType,
    JournalEntry,
    Tag,
    Relationship,
    Embedding,
    GitHubProject,
    GitHubIssue,
    GitHubPullRequest,
    GitHubWorkflowRun,
    ProjectContext,
    ServerConfig,
} from './types/index.js'

export { DEFAULT_CONFIG } from './types/index.js'

// Filtering
export {
    TOOL_GROUPS,
    META_GROUPS,
    getAllToolNames,
    getToolGroup,
    parseToolFilter,
    isToolEnabled,
    filterTools,
    getToolFilterFromEnv,
    calculateTokenSavings,
    getFilterSummary,
} from './filtering/ToolFilter.js'

// Logger
export { logger } from './utils/logger.js'

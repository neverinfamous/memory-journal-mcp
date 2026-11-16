import type { ProjectRegistryEntry } from './index.js'

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

    /** Default workspace ID for isolating journal entries */
    defaultWorkspaceId?: string

    /** Project registry mapping dynamic repo IDs to local paths and kanban boards */
    projectRegistry?: Record<string, ProjectRegistryEntry>

    /** Enable semantic search */
    enableSemanticSearch: boolean

    /** Sentence transformer model name */
    modelName: string

    /** Default role for un-registered authors (default: denied) */
    teamDefaultRole?: 'admin' | 'member' | 'viewer' | 'denied'

    /** Admin author to bootstrap if team_members table is empty */
    teamAdmin?: string

    /** Whether to persist metrics to disk across server restarts */
    persistMetrics?: boolean

    /** Custom path to the metrics JSON file. If not provided, it is derived from dbPath */
    metricsPath?: string
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Partial<ServerConfig> = {
    dbPath: './memory_journal.db',
    enableSemanticSearch: true,
    modelName: 'all-MiniLM-L6-v2',
    persistMetrics: false,
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
        itemCount: number | null
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

import type { BriefingConfig } from '../../handlers/resources/shared.js'
import type { ProjectRegistryEntry } from '../../types/index.js'
import type { AuditConfig } from '../../audit/index.js'
import type { SchedulerOptions } from '../scheduler.js'

export interface ServerOptions {
    transport: 'stdio' | 'http'
    port?: number
    host?: string
    dbPath: string
    testDbPath?: string
    teamDbPath?: string
    testTeamDbPath?: string
    teamDefaultRole?: 'admin' | 'member' | 'viewer' | 'denied'
    teamAdmin?: string
    toolFilter?: string
    defaultProjectNumber?: number
    defaultWorkspaceId?: string
    autoRebuildIndex?: boolean
    statelessHttp?: boolean
    corsOrigins?: string[]
    authToken?: string
    enableHSTS?: boolean
    scheduler?: SchedulerOptions

    // OAuth 2.1 options
    oauthEnabled?: boolean
    oauthIssuer?: string
    oauthAudience?: string
    oauthJwksUri?: string
    oauthClockTolerance?: number
    allowPlaintextLoopbackOAuth?: boolean
    trustProxy?: boolean
    publicOrigin?: string
    // Briefing configuration
    briefingConfig?: BriefingConfig
    // Project Registry
    projectRegistry?: Record<string, ProjectRegistryEntry>
    // Additional team database mappings (label -> path)
    additionalTeamDbs?: Record<string, string>

    // Audit configuration
    auditConfig?: AuditConfig

    // Allowlisted roots for file IO
    allowedIoRoots?: string[]
    // Admin override for Code Mode
    codemodeInternalFullAccess?: boolean
    // Auto-prune
    autoPruneIntervalMinutes?: number
    archiveOlderThanDays?: number
    pruneOlderThanDays?: number
    hardDeleteOlderThanDays?: number
    pruneImportanceThreshold?: number
    pruneDryRun?: boolean
    pruneExcludeTags?: string[]
    // Embedding model
    embeddingModel?: string
    // Metrics export
    metricsExport?: 'prometheus'
    metricsPort?: number
    // Metrics persistence
    persistMetrics?: boolean
    metricsPath?: string
    configFilePath?: string
}

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
export type McpServerFactory = () => McpServer

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { ServerRuntime } from '../../utils/maintenance-lock.js'
import type { VectorSearchManager } from '../../vector/vector-search-manager/index.js'
import type { GitHubIntegration } from '../../github/github-integration/index.js'
import type { ConfigManager } from '../../utils/config-manager.js'
import type { Scheduler } from '../scheduler.js'

export interface ServerContext {
    db: IDatabaseAdapter;
    testDb?: IDatabaseAdapter;
    teamDb?: IDatabaseAdapter;
    testTeamDb?: IDatabaseAdapter;
    runtime: ServerRuntime;
    vectorManager: VectorSearchManager;
    teamVectorManager?: VectorSearchManager;
    github: GitHubIntegration;
    configManager: ConfigManager;
    scheduler: Scheduler | null;
    allowedIoRoots: string[];
    activeMetricsPath?: string;
}

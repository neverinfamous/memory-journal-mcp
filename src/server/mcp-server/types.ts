import type { BriefingConfig } from '../../handlers/resources/shared.js'
import type {
    BriefingConfigurableKey,
    ConfigCliEnvBaseline,
} from '../../utils/config-manager-helpers.js'
import type { ProjectRegistryEntry } from '../../types/index.js'
import type { AuditConfig } from '../../audit/index.js'

export interface ServerOptions {
    transport: 'stdio' | 'http'
    port?: number | undefined
    host?: string | undefined
    dbPath: string
    testDbPath?: string | undefined
    teamDbPath?: string | undefined
    testTeamDbPath?: string | undefined
    teamDefaultRole?: 'admin' | 'member' | 'viewer' | 'denied' | undefined
    teamAdmin?: string | undefined
    toolFilter?: string | undefined
    defaultProjectNumber?: number | undefined
    defaultWorkspaceId?: string | undefined
    autoRebuildIndex?: boolean | undefined
    statelessHttp?: boolean | undefined
    corsOrigins?: string[] | undefined
    authToken?: string | undefined
    enableHSTS?: boolean | undefined

    // OAuth 2.1 options
    oauthEnabled?: boolean | undefined
    oauthIssuer?: string | undefined
    oauthAudience?: string | undefined
    oauthJwksUri?: string | undefined
    oauthClockTolerance?: number | undefined
    allowPlaintextLoopbackOAuth?: boolean | undefined
    trustProxy?: boolean | undefined
    publicOrigin?: string | undefined
    // Briefing configuration
    briefingConfig?: BriefingConfig | undefined
    // Briefing keys explicitly supplied via CLI flags or env vars (for hot-reload baseline preservation)
    briefingOverrides?: Partial<Record<BriefingConfigurableKey, number | boolean>> | undefined
    // Full CLI/env baseline overrides (distinct from config-file defaults) for ConfigManager hot-reload
    cliEnvBaseline?: ConfigCliEnvBaseline | undefined
    // Project Registry
    projectRegistry?: Record<string, ProjectRegistryEntry> | undefined
    // Additional team database mappings (label -> path)
    additionalTeamDbs?: Record<string, string> | undefined

    // Audit configuration
    auditConfig?: AuditConfig | undefined

    // Allowlisted roots for file IO
    allowedIoRoots?: string[] | undefined
    // Admin override for Code Mode
    codemodeInternalFullAccess?: boolean | undefined
    // Auto-prune
    archiveOlderThanDays?: number | undefined
    pruneOlderThanDays?: number | undefined
    hardDeleteOlderThanDays?: number | undefined
    pruneImportanceThreshold?: number | undefined
    pruneDryRun?: boolean | undefined
    pruneExcludeTags?: string[] | undefined
    // Embedding model
    embeddingModel?: string | undefined
    // Metrics export
    metricsExport?: 'prometheus' | undefined
    metricsPort?: number | undefined
    // Metrics persistence
    persistMetrics?: boolean | undefined
    metricsPath?: string | undefined
    configFilePath?: string | undefined
    // MCP tool input element cap (0 or Infinity disables; defaults to DEFAULT_MAX_TOOL_INPUT_ELEMENTS)
    maxToolInputElements?: number | undefined
    // Autonomous MCP tool and parameter healing/interception (default: true; disabled via --no-agent-healing / MCP_AGENT_HEALING=false)
    agentHealing?: boolean | undefined
    instructionLevel?: 'essential' | 'detailed' | 'full' | undefined
}

import type { McpServer } from '@modelcontextprotocol/server'
import type { SkillCatalog } from '@modelcontextprotocol/server/ext/skills'
export type McpServerFactory = () => McpServer

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { ServerRuntime } from '../../utils/maintenance-lock.js'
import type { VectorSearchManager } from '../../vector/vector-search-manager/index.js'
import type { GitHubIntegration } from '../../github/github-integration/index.js'
import type { ConfigManager } from '../../utils/config-manager.js'

export interface ServerContext {
    db: IDatabaseAdapter;
    testDb?: IDatabaseAdapter | undefined;
    teamDb?: IDatabaseAdapter | undefined;
    testTeamDb?: IDatabaseAdapter | undefined;
    runtime: ServerRuntime;
    vectorManager: VectorSearchManager;
    teamVectorManager?: VectorSearchManager | undefined;
    github: GitHubIntegration;
    configManager: ConfigManager;
    allowedIoRoots: string[];
    activeMetricsPath?: string | undefined;
    skillCatalog?: SkillCatalog | undefined;
}

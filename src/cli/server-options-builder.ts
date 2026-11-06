import type { Command } from 'commander'
import * as path from 'node:path'
import { z } from 'zod'
import type { AuditConfig } from '../audit/index.js'
import type { ConfigResolver } from '../utils/config-resolver.js'
import { defaultDbPath, defaultTeamDbPath } from './option-groups.js'
import type { ServerOptions } from '../server/mcp-server/types.js'
import {
    assertAdditionalTeamDbIsNotSymlink,
    parseAdditionalTeamDbsOption,
    parseAllowedIoRootsOption,
    parseProjectRegistryOption,
} from './server-options-parsers.js'

export { assertAdditionalTeamDbIsNotSymlink }

const transportSchema = z.enum(['stdio', 'http'])
const teamDefaultRoleSchema = z.enum(['admin', 'member', 'viewer', 'denied'])
const reportContentTypeSchema = z.enum(['slack', 'discord', 'json'])
type TeamDefaultRole = z.infer<typeof teamDefaultRoleSchema>
type ReportContentType = z.infer<typeof reportContentTypeSchema>

export function buildServerOptions(
    resolver: ConfigResolver,
    _options: Record<string, unknown> & { team?: boolean },
    _command: Command,
    configErrors: string[]
): { serverOptions: ServerOptions; transport: string; db: string | undefined; teamDb?: string; host?: string } {
    // Wrapper to catch errors and aggregate them
    const catchConfig = <T>(fn: () => T, fallback: T): T => {
        try {
            return fn();
        } catch (e) {
            configErrors.push(e instanceof Error ? e.message : String(e));
            return fallback;
        }
    };

    const host = catchConfig(() => resolver.resolve<string>('serverHost', 'MCP_HOST') ?? process.env['HOST'] ?? undefined, undefined);
    const transport = catchConfig((): 'stdio' | 'http' => {
        if (resolver.resolveBool('http')) return 'http'
        if (resolver.resolveBool('stdio')) return 'stdio'
        const raw = resolver.resolve<string>('transport', 'TRANSPORT') ?? 'stdio'
        const parsed = transportSchema.safeParse(raw)
        if (!parsed.success) {
            throw new Error(`Invalid transport '${raw}'. Use 'stdio' or 'http'.`)
        }
        return parsed.data
    }, 'stdio')
    const stateless = catchConfig(() => resolver.resolveBool('stateless', 'STATELESS') ?? false, false);
    // Allow 'dbPath' or 'database' as fallback for 'db'
    const configDbPath = catchConfig(() => resolver.resolve<string>('dbPath'), undefined);
    const cliDatabase = catchConfig(() => resolver.resolve<string>('database'), undefined);
    const rawDb = catchConfig(() => resolver.resolve<string>('db', 'DB_PATH'), defaultDbPath);
    let db = rawDb;
    if ((db === defaultDbPath || db === undefined) && cliDatabase) {
        db = cliDatabase;
    } else if ((db === defaultDbPath || db === undefined) && configDbPath) {
        db = configDbPath;
    }

    const configTestDbPath = catchConfig(() => resolver.resolve<string>('testDbPath'), undefined);
    const rawTestDb = catchConfig(() => resolver.resolve<string>('testDb', 'TEST_DB_PATH'), undefined);
    const testDb = rawTestDb ?? configTestDbPath;

    const configTeamDbPath = catchConfig(() => resolver.resolve<string>('teamDbPath'), undefined);
    const cliTeamDatabase = catchConfig(() => resolver.resolve<string>('teamDatabase'), undefined);
    const rawTeamDb = catchConfig(() => resolver.resolve<string>('teamDb', 'TEAM_DB_PATH'), defaultTeamDbPath);
    let teamDb = rawTeamDb;
    if ((teamDb === defaultTeamDbPath || teamDb === undefined) && cliTeamDatabase) {
        teamDb = cliTeamDatabase;
    } else if ((teamDb === defaultTeamDbPath || teamDb === undefined) && configTeamDbPath) {
        teamDb = configTeamDbPath;
    }

    const configTestTeamDbPath = catchConfig(() => resolver.resolve<string>('testTeamDbPath'), undefined);
    const rawTestTeamDb = catchConfig(() => resolver.resolve<string>('testTeamDb', 'TEST_TEAM_DB_PATH'), undefined);
    const testTeamDb = rawTestTeamDb ?? configTestTeamDbPath;

    const codemodeMaxResultSize = catchConfig(() => resolver.resolve<string>('codemodeMaxResultSize', 'CODE_MODE_MAX_RESULT_SIZE'), undefined);
    if (codemodeMaxResultSize) {
        process.env['CODE_MODE_MAX_RESULT_SIZE'] = codemodeMaxResultSize;
    }

    const metricsPort = catchConfig(() => resolver.resolve<string>('metricsPort', 'MJ_METRICS_PORT'), undefined);
    if (metricsPort) {
        process.env['MJ_METRICS_PORT'] = metricsPort;
    }

    const authScopes = catchConfig(() => resolver.resolve<string>('authScopes', 'MCP_AUTH_SCOPES'), undefined);
    if (authScopes !== undefined && authScopes.trim() !== '') {
        process.env['MCP_AUTH_SCOPES'] = authScopes.trim();
    }

    const auditLogPath = catchConfig(() => resolver.resolve<string>('auditLog', 'AUDIT_LOG_PATH'), undefined);
    const auditConfig: AuditConfig | undefined = auditLogPath
        ? {
              enabled: true,
              logPath: auditLogPath,
              redact: catchConfig(() => resolver.resolveBool('auditRedact', 'AUDIT_REDACT') ?? true, true),
              auditReads: catchConfig(() => resolver.resolveBool('auditReads', 'AUDIT_READS') ?? false, false),
              maxSizeBytes: catchConfig(() => resolver.resolveInt('auditLogMaxSize', 'AUDIT_LOG_MAX_SIZE', 1024) ?? 10485760, 10485760),
          }
        : undefined;

    const instructionLevel = catchConfig((): 'essential' | 'detailed' | 'full' | undefined => {
        const raw = resolver.resolve<string>('instructionLevel', 'INSTRUCTION_LEVEL')
        if (raw === undefined || raw.trim() === '') return undefined
        if (raw === 'essential' || raw === 'detailed' || raw === 'full') return raw
        throw new Error(`Invalid --instruction-level '${raw}'. Use essential, detailed, or full.`)
    }, undefined)

    const serverOptions = {
        transport,
        port: catchConfig(() => resolver.resolveInt('port', 'PORT', 1, 65535) ?? 3000, 3000),
        host,
        statelessHttp: stateless,
        dbPath: db ?? defaultDbPath,
        testDbPath: testDb,
        teamDbPath: teamDb,
        testTeamDbPath: testTeamDb,
        teamDefaultRole: catchConfig((): TeamDefaultRole => {
            const raw = resolver.resolve<string>('teamDefaultRole', 'TEAM_DEFAULT_ROLE') ?? 'denied'
            const parsed = teamDefaultRoleSchema.safeParse(raw)
            if (!parsed.success) {
                throw new Error(`Invalid team default role '${raw}'. Use admin, member, viewer, or denied.`)
            }
            return parsed.data
        }, 'denied'),
        teamAdmin: catchConfig(() => resolver.resolve<string>('teamAdmin', 'TEAM_ADMIN'), undefined),
        toolFilter: catchConfig(() => resolver.resolve<string>('toolFilter', 'MEMORY_JOURNAL_MCP_TOOL_FILTER'), undefined),
        defaultProjectNumber: catchConfig(() => {
            const configVal = resolver.resolve<string | number>('defaultProjectNumber');
            const val = resolver.resolve<string>('defaultProject', 'DEFAULT_PROJECT_NUMBER') ?? configVal;
            return val !== undefined && val !== null ? parseInt(String(val), 10) : undefined;
        }, undefined),
        defaultWorkspaceId: catchConfig(() => resolver.resolve<string>('defaultWorkspaceId', 'DEFAULT_WORKSPACE_ID'), undefined),
        autoRebuildIndex: catchConfig(() => resolver.resolveBool('autoRebuildIndex', 'AUTO_REBUILD_INDEX') ?? false, false),
        corsOrigins: catchConfig(() => resolver.resolveStringArray('corsOrigin', 'CORS_ORIGIN'), undefined),
        enableHSTS: catchConfig(() => resolver.resolveBool('enableHsts', 'MCP_ENABLE_HSTS') ?? false, false),
        authToken: catchConfig(() => resolver.resolve<string>('authToken', 'MCP_AUTH_TOKEN'), undefined),
        scheduler: {
            backupIntervalMinutes: catchConfig(() => resolver.resolveInt('backupInterval', 'BACKUP_INTERVAL', 0) ?? 0, 0),
            keepBackups: catchConfig(() => resolver.resolveInt('keepBackups', 'KEEP_BACKUPS', 1, 100) ?? 5, 5),
            vacuumIntervalMinutes: catchConfig(() => resolver.resolveInt('vacuumInterval', 'VACUUM_INTERVAL', 0) ?? 0, 0),
            rebuildIndexIntervalMinutes: catchConfig(() => resolver.resolveInt('rebuildIndexInterval', 'REBUILD_INDEX_INTERVAL', 0) ?? 0, 0),
            digestIntervalMinutes: catchConfig(() => resolver.resolveInt('digestInterval', 'DIGEST_INTERVAL', 0) ?? 0, 0),
            pruneIntervalMinutes: catchConfig(() => resolver.resolveInt('autoPruneInterval', 'AUTO_PRUNE_INTERVAL_MINUTES', 0) ?? 0, 0),
            reportIntervalMinutes: catchConfig(() => resolver.resolveInt('reportInterval', 'REPORT_INTERVAL', 0) ?? 0, 0),
            reportDeliveryOptions: {
                webhookUrl: catchConfig(() => resolver.resolve<string>('reportWebhookUrl', 'REPORT_WEBHOOK_URL') ?? '', ''),
                webhookAuth: catchConfig(() => resolver.resolve<string>('reportWebhookAuth', 'REPORT_WEBHOOK_AUTH'), undefined),
                contentType: catchConfig((): ReportContentType => {
                    const raw = resolver.resolve<string>('reportContentType', 'REPORT_CONTENT_TYPE') ?? 'slack'
                    const parsed = reportContentTypeSchema.safeParse(raw)
                    if (!parsed.success) {
                        throw new Error(`Invalid report content type '${raw}'. Use slack, discord, or json.`)
                    }
                    return parsed.data
                }, 'slack'),
            }
        },
        oauthEnabled: catchConfig(() => resolver.resolveBool('oauthEnabled', 'OAUTH_ENABLED') ?? false, false),
        oauthIssuer: catchConfig(() => resolver.resolve<string>('oauthIssuer', 'OAUTH_ISSUER'), undefined),
        oauthAudience: catchConfig(() => resolver.resolve<string>('oauthAudience', 'OAUTH_AUDIENCE'), undefined),
        oauthJwksUri: catchConfig(() => resolver.resolve<string>('oauthJwksUri', 'OAUTH_JWKS_URI'), undefined),
        oauthClockTolerance: catchConfig(() => resolver.resolveInt('oauthClockTolerance', 'OAUTH_CLOCK_TOLERANCE', 0) ?? 60, 60),
        allowPlaintextLoopbackOAuth: catchConfig(() => resolver.resolveBool('oauthAllowPlaintextLoopback', 'OAUTH_ALLOW_PLAINTEXT_LOOPBACK') ?? false, false),
        trustProxy: catchConfig(() => resolver.resolveBool('trustProxy', 'TRUST_PROXY') ?? false, false),
        publicOrigin: catchConfig(() => resolver.resolve<string>('publicOrigin', 'PUBLIC_ORIGIN'), undefined),
        codemodeInternalFullAccess: catchConfig(() => resolver.resolveBool('codemodeInternalFullAccess', 'CODEMODE_INTERNAL_FULL_ACCESS') ?? false, false),

        projectRegistry: catchConfig(
            () => parseProjectRegistryOption(resolver.resolve<unknown>('projectRegistry', 'PROJECT_REGISTRY')),
            undefined
        ),

        additionalTeamDbs: catchConfig(
            () => parseAdditionalTeamDbsOption(resolver.resolve<unknown>('additionalTeamDbs', 'ADDITIONAL_TEAM_DBS')),
            undefined
        ),

        allowedIoRoots: catchConfig(
            () => parseAllowedIoRootsOption(resolver.resolve<unknown>('allowedIoRoots', 'ALLOWED_IO_ROOTS')),
            undefined
        ),

        briefingConfig: {
            commitCount: catchConfig(() => resolver.resolveInt('briefingCommits', 'BRIEFING_COMMIT_COUNT') ?? 3, 3),
            entryCount: catchConfig(() => resolver.resolveInt('briefingEntries', 'BRIEFING_ENTRY_COUNT') ?? 3, 3),
            summaryCount: catchConfig(() => resolver.resolveInt('briefingSummaries', 'BRIEFING_SUMMARY_COUNT') ?? 1, 1),
            includeTeam: catchConfig(() => resolver.resolveBool('briefingIncludeTeam', 'BRIEFING_INCLUDE_TEAM') ?? false, false),
            issueCount: catchConfig(() => resolver.resolveInt('briefingIssues', 'BRIEFING_ISSUE_COUNT') ?? 0, 0),
            prCount: catchConfig(() => resolver.resolveInt('briefingPrCount') ?? resolver.resolveInt('briefingPrs', 'BRIEFING_PR_COUNT') ?? 0, 0),
            prStatusBreakdown: catchConfig(() => resolver.resolveBool('briefingPrStatus', 'BRIEFING_PR_STATUS') ?? false, false),
            milestoneCount: catchConfig(() => resolver.resolveInt('briefingMilestones', 'BRIEFING_MILESTONE_COUNT') ?? 3, 3),
            rulesFilePath: catchConfig(() => {
                const val = resolver.resolve<string>('rulesFile', 'RULES_FILE_PATH');
                return val ? path.resolve(process.cwd(), val) : undefined;
            }, undefined),
            skillsDirPath: catchConfig(() => {
                const val = resolver.resolve<string>('skillsDir', 'SKILLS_DIR_PATH');
                return val ? path.resolve(process.cwd(), val) : undefined;
            }, undefined),
            workflowCount: catchConfig(() => resolver.resolveInt('briefingWorkflows', 'BRIEFING_WORKFLOW_COUNT') ?? 0, 0),
            workflowStatusBreakdown: catchConfig(() => resolver.resolveBool('briefingWorkflowStatus', 'BRIEFING_WORKFLOW_STATUS') ?? false, false),
            copilotReviews: catchConfig(() => resolver.resolveBool('briefingCopilot', 'BRIEFING_COPILOT_REVIEWS') ?? false, false),
            workflowSummary: catchConfig(() => resolver.resolve<string>('workflowSummary', 'MEMORY_JOURNAL_WORKFLOW_SUMMARY'), undefined),
            defaultProjectNumber: catchConfig(() => {
                const val = resolver.resolve<string>('defaultProject', 'DEFAULT_PROJECT_NUMBER');
                return val ? parseInt(val, 10) : undefined;
            }, undefined),
            briefingImportanceThreshold: catchConfig(() => {
                const val = resolver.resolve<unknown>('briefingImportanceThreshold', 'BRIEFING_IMPORTANCE_THRESHOLD');
                if (typeof val === 'number') return val;
                if (typeof val === 'string') return parseFloat(val);
                return 0.3;
            }, 0.3),
        },
        auditConfig,

        archiveOlderThanDays: catchConfig(() => resolver.resolveNumber('archiveOlderThanDays', 'ARCHIVE_OLDER_THAN_DAYS', 0) ?? 0, 0),
        pruneOlderThanDays: catchConfig(() => resolver.resolveNumber('pruneOlderThanDays', 'PRUNE_OLDER_THAN_DAYS', 0) ?? 0, 0),
        hardDeleteOlderThanDays: catchConfig(() => resolver.resolveNumber('hardDeleteOlderThanDays', 'HARD_DELETE_OLDER_THAN_DAYS', 0) ?? 0, 0),
        pruneImportanceThreshold: catchConfig(() => {
            const val = resolver.resolve<unknown>('pruneImportanceThreshold', 'PRUNE_IMPORTANCE_THRESHOLD');
            if (typeof val === 'number') return val;
            if (typeof val === 'string') return parseFloat(val);
            return 0.15;
        }, 0.15),
        pruneDryRun: catchConfig(() => resolver.resolveBool('pruneDryRun', 'PRUNE_DRY_RUN') ?? false, false),
        pruneExcludeTags: catchConfig(() => resolver.resolveStringArray('pruneExcludeTags', 'PRUNE_EXCLUDE_TAGS'), undefined),
        embeddingModel: catchConfig(() => resolver.resolve<string>('embeddingModel', 'EMBEDDING_MODEL'), undefined),
        ...(instructionLevel !== undefined ? { instructionLevel } : {}),
        metricsExport: catchConfig<'prometheus' | undefined>(() => {
            const raw = resolver.resolve<string>('metricsExport', 'METRICS_EXPORT');
            if (raw) {
                if (raw !== 'prometheus') throw new Error(`Unsupported metrics export format: ${raw}`);
                return 'prometheus';
            }
            return undefined;
        }, undefined),
        persistMetrics: catchConfig(() => resolver.resolveBool('persistMetrics', 'PERSIST_METRICS') ?? false, false),
        metricsPath: catchConfig(() => resolver.resolve<string>('metricsPath', 'METRICS_PATH'), undefined),
        metricsPort: catchConfig(() => resolver.resolveInt('metricsPort', 'MJ_METRICS_PORT', 0, 65535), undefined),
        configFilePath: catchConfig(() => resolver.loadedConfigPath, undefined),
        maxToolInputElements: catchConfig(() => {
            const raw = resolver.resolve<unknown>('maxToolInputElements', 'MAX_TOOL_INPUT_ELEMENTS');
            if (raw === undefined || raw === null || raw === '') return undefined;
            if (raw === Infinity || (typeof raw === 'string' && raw.trim().toLowerCase() === 'infinity')) {
                return Infinity;
            }
            return resolver.resolveInt('maxToolInputElements', 'MAX_TOOL_INPUT_ELEMENTS', 0);
        }, undefined),
        agentHealing: catchConfig(() => resolver.resolveBool('agentHealing', 'MCP_AGENT_HEALING') ?? true, true),
    };

    return { serverOptions, transport, db, teamDb, host };
}

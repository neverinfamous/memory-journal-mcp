import type { Command } from 'commander'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { z } from 'zod'
import type { ProjectRegistryEntry } from '../types/index.js'
import type { AuditConfig } from '../audit/index.js'
import type { ConfigResolver } from '../utils/config-resolver.js'
import { defaultDbPath, defaultTeamDbPath } from './option-groups.js'
import type { ServerOptions } from '../server/mcp-server/types.js'


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
    const transport = catchConfig(() => {
        if (resolver.resolveBool('http')) return 'http';
        if (resolver.resolveBool('stdio')) return 'stdio';
        return resolver.resolve<string>('transport', 'TRANSPORT') ?? 'stdio';
    }, 'stdio');
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

    const serverOptions = {
        transport: transport as 'stdio' | 'http',
        port: catchConfig(() => resolver.resolveInt('port', 'PORT', 1, 65535) ?? 3000, 3000),
        host,
        statelessHttp: stateless,
        dbPath: db ?? defaultDbPath,
        testDbPath: testDb,
        teamDbPath: teamDb,
        testTeamDbPath: testTeamDb,
        teamDefaultRole: catchConfig(() => (resolver.resolve<string>('teamDefaultRole', 'TEAM_DEFAULT_ROLE') ?? 'denied') as 'admin' | 'member' | 'viewer' | 'denied', 'denied'),
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
                contentType: catchConfig(() => (resolver.resolve<string>('reportContentType', 'REPORT_CONTENT_TYPE') ?? 'slack') as 'slack' | 'discord' | 'json', 'slack'),
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
        codemodeInternalFullAccess: catchConfig(() => resolver.resolveBool('codemodeInternalFullAccess', 'CODEMODE_INTERNAL_FULL_ACCESS') ?? true, true),
        
        projectRegistry: catchConfig(() => {
            const raw = resolver.resolve<unknown>('projectRegistry', 'PROJECT_REGISTRY');
            if (raw === undefined || raw === null || raw === '') return undefined;
            if (typeof raw === 'string' && raw.length > 51200) throw new Error('PROJECT_REGISTRY environment variable exceeds size limit (50KB)');
            try {
                const registrySchema = z.record(z.string(), z.object({ path: z.string().min(1), project_number: z.number().nullable().optional() }).strict());
                const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
                const safeParsed = JSON.parse(JSON.stringify(parsed)) as unknown; // Deep clean
                const validated = registrySchema.parse(safeParsed) as Record<string, ProjectRegistryEntry>;
                for (const key of Object.keys(validated)) {
                    const entry = validated[key];
                    if (!entry?.path) continue;
                    if (!path.isAbsolute(entry.path)) throw new Error(`Project registry path must be an absolute path: ${entry.path}`);
                    const resolvedPath = path.resolve(entry.path);
                    try {
                        const stat = fs.lstatSync(resolvedPath);
                        if (stat.isSymbolicLink()) throw new Error(`Project registry path cannot be a symlink: ${resolvedPath}`);
                        if (!stat.isDirectory()) throw new Error(`Project registry path is not a directory: ${resolvedPath}`);
                    } catch (e) {
                        throw new Error(`Project registry path error: ${resolvedPath}`, { cause: e });
                    }
                    entry.path = resolvedPath;
                }
                process.env['PROJECT_REGISTRY'] = JSON.stringify(validated);
                return validated;
            } catch (e: unknown) {
                throw new Error(`Failed to parse PROJECT_REGISTRY: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
            }
        }, undefined),
        
        additionalTeamDbs: catchConfig(() => {
            const raw = resolver.resolve<unknown>('additionalTeamDbs', 'ADDITIONAL_TEAM_DBS');
            if (raw === undefined || raw === null || raw === '') return undefined;
            if (typeof raw === 'string' && raw.length > 51200) throw new Error('ADDITIONAL_TEAM_DBS exceeds size limit');
            try {
                const dbSchema = z.record(z.string().min(1), z.string().min(1));
                const parsed = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
                const validated = dbSchema.parse(JSON.parse(JSON.stringify(parsed)) as unknown);
                for (const [label, dbPath] of Object.entries(validated)) {
                    if (!path.isAbsolute(dbPath)) throw new Error(`Additional team DB path must be absolute: ${dbPath}`);
                    const resolvedPath = path.resolve(dbPath);
                    try {
                        if (fs.existsSync(resolvedPath)) {
                            const stat = fs.lstatSync(resolvedPath);
                            if (stat.isSymbolicLink()) throw new Error(`Additional team DB path cannot be a symlink: ${resolvedPath}`);
                        }
                    } catch {
                        // ignore
                    }
                    validated[label] = resolvedPath;
                }
                return validated;
            } catch (e) {
                throw new Error(`Failed to parse ADDITIONAL_TEAM_DBS: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
            }
        }, undefined),

        allowedIoRoots: catchConfig(() => {
            const raw = resolver.resolve<unknown>('allowedIoRoots', 'ALLOWED_IO_ROOTS');
            if (raw === undefined || raw === null || raw === '') return undefined;
            if (typeof raw === 'string' && raw.length > 51200) throw new Error('ALLOWED_IO_ROOTS configuration exceeds size limit (50KB)');
            try {
                let parsed: unknown = raw;
                if (typeof raw === 'string') {
                    if (raw.trim().startsWith('[')) {
                        parsed = JSON.parse(raw) as unknown;
                    } else {
                        parsed = raw.split(',').map((s) => s.trim()).filter(Boolean);
                    }
                }
                if (Array.isArray(parsed) && parsed.every((p) => typeof p === 'string' && path.isAbsolute(p))) {
                    return parsed as string[];
                }
                if (Array.isArray(parsed)) {
                    throw new Error('All paths must be absolute');
                }
                throw new Error('Must be an array of absolute paths');
            } catch (e: unknown) {
                throw new Error(`Invalid ALLOWED_IO_ROOTS configuration: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
            }
        }, undefined),

        briefingConfig: {
            commitCount: catchConfig(() => resolver.resolveInt('briefingCommits', 'BRIEFING_COMMIT_COUNT') ?? 3, 3),
            entryCount: catchConfig(() => resolver.resolveInt('briefingEntries', 'BRIEFING_ENTRY_COUNT') ?? 3, 3),
            summaryCount: catchConfig(() => resolver.resolveInt('briefingSummaries', 'BRIEFING_SUMMARY_COUNT') ?? 1, 1),
            includeTeam: catchConfig(() => resolver.resolveBool('briefingIncludeTeam', 'BRIEFING_INCLUDE_TEAM') ?? false, false),
            issueCount: catchConfig(() => resolver.resolveInt('briefingIssues', 'BRIEFING_ISSUE_COUNT') ?? 0, 0),
            prCount: catchConfig(() => resolver.resolveInt('briefingPrs', 'BRIEFING_PR_COUNT') ?? 0, 0),
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

        autoPruneIntervalMinutes: catchConfig(() => resolver.resolveInt('autoPruneInterval', 'AUTO_PRUNE_INTERVAL_MINUTES', 0) ?? 0, 0),
        archiveOlderThanDays: catchConfig(() => resolver.resolveNumber('archiveOlderThanDays', 'ARCHIVE_OLDER_THAN_DAYS', 0), 14),
        pruneOlderThanDays: catchConfig(() => resolver.resolveNumber('pruneOlderThanDays', 'PRUNE_OLDER_THAN_DAYS', 0), 30),
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
    };

    return { serverOptions, transport, db, teamDb, host }
}

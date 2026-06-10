import { Command } from 'commander'

import * as path from 'node:path'
import * as fs from 'node:fs'
import { z } from 'zod'
import { createServer } from './server/mcp-server/index.js'
import { logger } from './utils/logger.js'
import { VERSION } from './version.js'
import type { ProjectRegistryEntry } from './types/index.js'
import { DEFAULT_AUDIT_LOG_MAX_SIZE_BYTES } from './audit/index.js'
import type { AuditConfig } from './audit/index.js'
import { ConfigResolver } from './utils/config-resolver.js'



// Database Resolution: Enforce explicit boundaries
function resolveDbPath(envPath: string | undefined, defaultName: string): string {
    if (envPath) return envPath
    return `./${defaultName}`
}

const defaultDbPath = resolveDbPath(process.env['DB_PATH'], 'memory_journal.db')
const defaultTeamDbPath = process.env['TEAM_DB_PATH'] ? process.env['TEAM_DB_PATH'] : undefined

const program = new Command()

program
    .name('memory-journal-mcp')
    .description('Project context management for AI-assisted development')
    .version(VERSION)
    .option('--transport <type>', 'Transport type: stdio or http', 'stdio')
    .option('--port <number>', 'HTTP port (for http transport)', '3000')
    .option('--server-host <host>', 'Server bind host for HTTP transport (default: localhost)')
    .option('--stateless', 'Use stateless HTTP mode (no session management)')
    .option('--db <path>', 'Database path (env: DB_PATH)', defaultDbPath)
    .option('--team-db <path>', 'Team database path (env: TEAM_DB_PATH)', defaultTeamDbPath)
    .option(
        '--additional-team-dbs <json>',
        'Additional team database mappings (label -> path) as JSON for cross-team discovery (env: ADDITIONAL_TEAM_DBS)'
    )
    .option(
        '--team-default-role <role>',
        'Default role for unrecognized team authors: admin, member, viewer, denied (env: TEAM_DEFAULT_ROLE)',
        'denied'
    )
    .option(
        '--team-admin <author>',
        'Bootstrap this author as admin if team_members table is empty (env: TEAM_ADMIN)'
    )
    .option('--tool-filter <filter>', 'Tool filter string (e.g., "starter", "core,search")')
    .option('--default-project <number>', 'Default GitHub Project number')
    .option('--auto-rebuild-index', 'Rebuild vector index on server startup')
    .option('--cors-origin <origin>', 'CORS allowed origin for HTTP transport (default: none)')
    .option('--enable-hsts', 'Enable HSTS header for HTTP transport (use when behind HTTPS)')
    .option(
        '--auth-token <token>',
        'Bearer token for HTTP transport authentication (env: MCP_AUTH_TOKEN)'
    )
    .option('--log-level <level>', 'Log level: debug, info, warning, error', 'info')
    .option(
        '--backup-interval <minutes>',
        'Automated backup interval in minutes, HTTP only (0 = disabled)',
        '0'
    )
    .option('--keep-backups <count>', 'Max backups to retain during automated cleanup', '5')
    .option(
        '--vacuum-interval <minutes>',
        'Database optimize interval in minutes, HTTP only (0 = disabled)',
        '0'
    )
    .option(
        '--rebuild-index-interval <minutes>',
        'Vector index rebuild interval in minutes, HTTP only (0 = disabled)',
        '0'
    )
    .option(
        '--digest-interval <minutes>',
        'Analytics digest interval in minutes, HTTP only (0 = disabled; recommended: 1440 for daily)',
        '0'
    )
    .option(
        '--report-interval <minutes>',
        'Scheduled report generation interval in minutes, HTTP only (0 = disabled)',
        '0'
    )
    .option(
        '--report-webhook-url <url>',
        'Webhook URL for report delivery (POST) (env: REPORT_WEBHOOK_URL)'
    )
    .option(
        '--report-webhook-auth <token>',
        'Optional Authorization header value for the report webhook (env: REPORT_WEBHOOK_AUTH)'
    )
    .option(
        '--report-content-type <type>',
        'Webhook payload format: slack, discord, or json (env: REPORT_CONTENT_TYPE)',
        'slack'
    )

    .option(
        '--codemode-max-result-size <bytes>',
        'Maximum Code Mode result size in bytes (default: 102400 / 100KB, env: CODE_MODE_MAX_RESULT_SIZE)'
    )
    .option('--oauth-enabled', 'Enable OAuth 2.1 authentication (env: OAUTH_ENABLED)')
    .option('--oauth-issuer <url>', 'OAuth issuer URL (env: OAUTH_ISSUER)')
    .option('--oauth-audience <audience>', 'OAuth audience (env: OAUTH_AUDIENCE)')
    .option('--oauth-jwks-uri <uri>', 'OAuth JWKS URI (env: OAUTH_JWKS_URI)')
    .option(
        '--oauth-clock-tolerance <seconds>',
        'OAuth clock tolerance in seconds (default: 60)',
        '60'
    )
    .option(
        '--oauth-allow-plaintext-loopback',
        'Allow plaintext loopback OAuth issuer (env: OAUTH_ALLOW_PLAINTEXT_LOOPBACK)'
    )
    .option('--trust-proxy', 'Trust reverse proxy headers (e.g. X-Forwarded-For env: TRUST_PROXY)')
    .option(
        '--public-origin <url>',
        'Public origin URL for webhook verification and OAuth redirects (env: PUBLIC_ORIGIN)'
    )
    // Audit options
    .option(
        '--audit-log <path>',
        'Enable audit logging to the specified JSONL file path, or "stderr" for container mode (env: AUDIT_LOG_PATH)'
    )
    .option(
        '--no-audit-redact',
        'Disable redaction of tool arguments from audit entries (env: AUDIT_REDACT=false)'
    )
    .option(
        '--audit-reads',
        'Enable audit logging for read-scoped tool calls (default: off, env: AUDIT_READS)'
    )
    .option(
        '--audit-log-max-size <bytes>',
        'Maximum audit log file size in bytes before rotation (default: 10485760 / 10MB, env: AUDIT_LOG_MAX_SIZE)',
        String(DEFAULT_AUDIT_LOG_MAX_SIZE_BYTES)
    )
    .option(
        '--instruction-level <level>',
        'Briefing depth: essential, standard, full (env: INSTRUCTION_LEVEL)',
        'standard'
    )
    .option(
        '--allowed-io-roots <paths>',
        'Comma-separated absolute paths or JSON array of paths for strict filesystem jailing (env: ALLOWED_IO_ROOTS)'
    )
    .option(
        '--codemode-internal-full-access',
        'Bypass tool filter constraints within the Code Mode sandbox (env: CODEMODE_INTERNAL_FULL_ACCESS)'
    )
    // Auto-prune
    .option(
        '--archive-older-than-days <days>',
        'Archive active entries older than N days with importance below threshold (env: ARCHIVE_OLDER_THAN_DAYS, 0 = disabled)',
        '0'
    )
    .option(
        '--prune-older-than-days <days>',
        'Soft-delete entries older than N days with importance below threshold (env: PRUNE_OLDER_THAN_DAYS, 0 = disabled)',
        '0'
    )
    .option(
        '--hard-delete-older-than-days <days>',
        'Permanently delete soft-deleted entries that have been dead for N days (env: HARD_DELETE_OLDER_THAN_DAYS, 0 = disabled)',
        '0'
    )
    .option(
        '--prune-importance-threshold <n>',
        'Importance score threshold for pruning (env: PRUNE_IMPORTANCE_THRESHOLD, default: 0.15)',
        '0.15'
    )
    .option(
        '--prune-dry-run',
        'Log auto-prune candidates without actually deleting them (env: PRUNE_DRY_RUN)'
    )
    .option(
        '--prune-exclude-tags <tags>',
        'Comma-separated list of tags to exclude from auto-prune (env: PRUNE_EXCLUDE_TAGS)'
    )
    .option(
        '--embedding-model <model>',
        'HuggingFace model name for semantic search embeddings (env: EMBEDDING_MODEL)'
    )
    .option(
        '--metrics-export <format>',
        'Metrics export format: prometheus (env: METRICS_EXPORT)'
    )
    .option('--persist-metrics', 'Persist metrics to disk across server restarts (env: PERSIST_METRICS)')
    .option('--metrics-path <path>', 'Custom path to the metrics JSON file (env: METRICS_PATH)')
    // Briefing configuration
    .option(
        '--briefing-entries <count>',
        'Number of journal entries in briefing (env: BRIEFING_ENTRY_COUNT)',
        '3'
    )
    .option(
        '--briefing-summaries <count>',
        'Number of session summaries to show in briefing (env: BRIEFING_SUMMARY_COUNT)',
        '1'
    )
    .option(
        '--briefing-include-team',
        'Include team DB entries in briefing (env: BRIEFING_INCLUDE_TEAM)'
    )
    .option(
        '--briefing-issues <count>',
        'Number of issues to list in briefing; 0 = count only (env: BRIEFING_ISSUE_COUNT)',
        '0'
    )
    .option(
        '--briefing-prs <count>',
        'Number of PRs to list in briefing; 0 = count only (env: BRIEFING_PR_COUNT)',
        '0'
    )
    .option(
        '--briefing-pr-status',
        'Show PR status breakdown in briefing (env: BRIEFING_PR_STATUS)'
    )
    .option(
        '--briefing-milestones <count>',
        'Number of milestones to list in briefing; 0 = hide (env: BRIEFING_MILESTONE_COUNT)',
        '3'
    )
    .option(
        '--rules-file <path>',
        'Path to user rules file for awareness in briefing (env: RULES_FILE_PATH)'
    )
    .option(
        '--skills-dir <path>',
        'Path to skills directory for awareness in briefing (env: SKILLS_DIR_PATH)'
    )
    .option(
        '--briefing-workflows <count>',
        'Number of workflow runs to list in briefing; 0 = status only (env: BRIEFING_WORKFLOW_COUNT)',
        '0'
    )
    .option(
        '--briefing-workflow-status',
        'Show workflow run status breakdown in briefing (env: BRIEFING_WORKFLOW_STATUS)'
    )
    .option(
        '--briefing-copilot',
        'Aggregate Copilot review state across recent PRs in briefing (env: BRIEFING_COPILOT_REVIEWS)'
    )
    .option(
        '--workflow-summary <text>',
        'Workflow summary for memory://workflows resource (env: MEMORY_JOURNAL_WORKFLOW_SUMMARY)'
    )
    .option(
        '--flag-vocabulary <terms>',
        'Comma-separated flag vocabulary for Hush Protocol (env: FLAG_VOCABULARY, default: blocker,needs_review,help_requested,fyi)'
    )
    .option('--config <path>', 'Path to configuration file (.yaml, .yml, .json) (env: MEMORY_JOURNAL_CONFIG)')
    .option('--dump-config', 'Print effective configuration and exit')
    .action(
        async (options: Record<string, unknown>, command: Command) => {
            let resolver: ConfigResolver;
            const configPath = (options['config'] as string | undefined) ?? process.env['MEMORY_JOURNAL_CONFIG'];
            const configErrors: string[] = [];

            try {
                resolver = new ConfigResolver(command, options, configPath);
            } catch (err) {
                configErrors.push(err instanceof Error ? err.message : String(err));
                // We cannot continue without a resolver, so create a dummy one that just returns defaults
                resolver = new ConfigResolver(command, {}, undefined);
            }

            // Wrapper to catch errors and aggregate them
            const catchConfig = <T>(fn: () => T, fallback: T): T => {
                try {
                    return fn();
                } catch (e) {
                    configErrors.push(e instanceof Error ? e.message : String(e));
                    return fallback;
                }
            };

            // Set log level
            const logLevel = catchConfig(() => resolver.resolve<string>('logLevel', 'LOG_LEVEL') ?? 'info', 'info');
            if (options['dumpConfig'] !== true) {
                logger.setLevel(logLevel as 'debug' | 'info' | 'warning' | 'error');
            }

            // Validate against default placeholder secrets
            const sensitiveEnvVars = [
                'GITHUB_TOKEN',
                'MCP_AUTH_TOKEN',
                'OAUTH_ISSUER',
                'OAUTH_JWKS_URI',
            ];
            for (const envVar of sensitiveEnvVars) {
                const envValue = process.env[envVar];
                if (typeof envValue === 'string' && envValue.startsWith('CHANGEME_')) {
                    configErrors.push(`FATAL: Insecure configuration detected. ${envVar} contains default placeholder value. Please update your environment variables.`);
                }
            }

            const host = catchConfig(() => resolver.resolve<string>('serverHost', 'MCP_HOST') ?? process.env['HOST'] ?? undefined, undefined);
            const transport = catchConfig(() => resolver.resolve<string>('transport', 'TRANSPORT') ?? 'stdio', 'stdio');
            const stateless = catchConfig(() => resolver.resolveBool('stateless', 'STATELESS') ?? false, false);
            // Allow 'dbPath' as fallback for 'db' since memory-journal.config.json uses dbPath
            const configDbPath = catchConfig(() => resolver.resolve<string>('dbPath'), undefined);
            const rawDb = catchConfig(() => resolver.resolve<string>('db', 'DB_PATH'), defaultDbPath);
            const db = (rawDb === defaultDbPath && configDbPath) ? configDbPath : rawDb;
            
            const configTeamDbPath = catchConfig(() => resolver.resolve<string>('teamDbPath'), undefined);
            const rawTeamDb = catchConfig(() => resolver.resolve<string>('teamDb', 'TEAM_DB_PATH'), defaultTeamDbPath);
            const teamDb = (rawTeamDb === defaultTeamDbPath && configTeamDbPath) ? configTeamDbPath : rawTeamDb;

            const codemodeMaxResultSize = catchConfig(() => resolver.resolve<string>('codemodeMaxResultSize', 'CODE_MODE_MAX_RESULT_SIZE'), undefined);
            if (codemodeMaxResultSize) {
                process.env['CODE_MODE_MAX_RESULT_SIZE'] = codemodeMaxResultSize;
            }

            const auditLogPath = catchConfig(() => resolver.resolve<string>('auditLog', 'AUDIT_LOG_PATH'), undefined);
            const auditConfig: AuditConfig | undefined = auditLogPath
                ? {
                      enabled: true,
                      logPath: auditLogPath,
                      redact: catchConfig(() => resolver.resolveBool('auditRedact', 'AUDIT_REDACT') ?? true, true),
                      auditReads: catchConfig(() => resolver.resolveBool('auditReads', 'AUDIT_READS') ?? false, false),
                      maxSizeBytes: catchConfig(() => resolver.resolveIntRequired('auditLogMaxSize', 'AUDIT_LOG_MAX_SIZE', 1024), 10485760),
                  }
                : undefined;

            const serverOptions = {
                transport: transport as 'stdio' | 'http',
                port: catchConfig(() => resolver.resolveIntRequired('port', 'PORT', 1, 65535), 3000),
                host,
                statelessHttp: stateless,
                dbPath: db,
                teamDbPath: teamDb,
                teamDefaultRole: catchConfig(() => (resolver.resolve<string>('teamDefaultRole', 'TEAM_DEFAULT_ROLE') ?? 'denied') as 'admin' | 'member' | 'viewer' | 'denied', 'denied'),
                teamAdmin: catchConfig(() => resolver.resolve<string>('teamAdmin', 'TEAM_ADMIN'), undefined),
                toolFilter: catchConfig(() => resolver.resolve<string>('toolFilter', 'TOOL_FILTER'), undefined),
                defaultProjectNumber: catchConfig(() => {
                    const val = resolver.resolve<string>('defaultProject', 'DEFAULT_PROJECT_NUMBER');
                    return val ? parseInt(val, 10) : undefined;
                }, undefined),
                autoRebuildIndex: catchConfig(() => resolver.resolveBool('autoRebuildIndex', 'AUTO_REBUILD_INDEX') ?? false, false),
                corsOrigins: catchConfig(() => resolver.resolveStringArray('corsOrigin', 'CORS_ORIGIN'), undefined),
                enableHSTS: catchConfig(() => resolver.resolveBool('enableHsts', 'MCP_ENABLE_HSTS') ?? false, false),
                authToken: catchConfig(() => resolver.resolve<string>('authToken', 'MCP_AUTH_TOKEN'), undefined),
                scheduler: {
                    backupIntervalMinutes: catchConfig(() => resolver.resolveIntRequired('backupInterval', 'BACKUP_INTERVAL', 0), 0),
                    keepBackups: catchConfig(() => resolver.resolveIntRequired('keepBackups', 'KEEP_BACKUPS', 1, 100), 5),
                    vacuumIntervalMinutes: catchConfig(() => resolver.resolveIntRequired('vacuumInterval', 'VACUUM_INTERVAL', 0), 0),
                    rebuildIndexIntervalMinutes: catchConfig(() => resolver.resolveIntRequired('rebuildIndexInterval', 'REBUILD_INDEX_INTERVAL', 0), 0),
                    digestIntervalMinutes: catchConfig(() => resolver.resolveIntRequired('digestInterval', 'DIGEST_INTERVAL', 0), 0),
                    reportIntervalMinutes: catchConfig(() => resolver.resolveIntRequired('reportInterval', 'REPORT_INTERVAL', 0), 0),
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
                oauthClockTolerance: catchConfig(() => resolver.resolveIntRequired('oauthClockTolerance', 'OAUTH_CLOCK_TOLERANCE', 0, 3600), 60),
                allowPlaintextLoopbackOAuth: catchConfig(() => resolver.resolveBool('oauthAllowPlaintextLoopback', 'OAUTH_ALLOW_PLAINTEXT_LOOPBACK') ?? false, false),
                trustProxy: catchConfig(() => resolver.resolveBool('trustProxy', 'TRUST_PROXY') ?? false, false),
                publicOrigin: catchConfig(() => resolver.resolve<string>('publicOrigin', 'PUBLIC_ORIGIN'), undefined),
                codemodeInternalFullAccess: catchConfig(() => resolver.resolveBool('codemodeInternalFullAccess', 'CODEMODE_INTERNAL_FULL_ACCESS') ?? false, false),
                
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
                    entryCount: catchConfig(() => resolver.resolveIntRequired('briefingEntries', 'BRIEFING_ENTRY_COUNT'), 3),
                    summaryCount: catchConfig(() => resolver.resolveIntRequired('briefingSummaries', 'BRIEFING_SUMMARY_COUNT'), 1),
                    includeTeam: catchConfig(() => resolver.resolveBool('briefingIncludeTeam', 'BRIEFING_INCLUDE_TEAM') ?? false, false),
                    issueCount: catchConfig(() => resolver.resolveIntRequired('briefingIssues', 'BRIEFING_ISSUE_COUNT'), 0),
                    prCount: catchConfig(() => resolver.resolveIntRequired('briefingPrs', 'BRIEFING_PR_COUNT'), 0),
                    prStatusBreakdown: catchConfig(() => resolver.resolveBool('briefingPrStatus', 'BRIEFING_PR_STATUS') ?? false, false),
                    milestoneCount: catchConfig(() => resolver.resolveIntRequired('briefingMilestones', 'BRIEFING_MILESTONE_COUNT'), 3),
                    rulesFilePath: catchConfig(() => {
                        const val = resolver.resolve<string>('rulesFile', 'RULES_FILE_PATH');
                        return val ? path.resolve(process.cwd(), val) : undefined;
                    }, undefined),
                    skillsDirPath: catchConfig(() => {
                        const val = resolver.resolve<string>('skillsDir', 'SKILLS_DIR_PATH');
                        return val ? path.resolve(process.cwd(), val) : undefined;
                    }, undefined),
                    workflowCount: catchConfig(() => resolver.resolveIntRequired('briefingWorkflows', 'BRIEFING_WORKFLOW_COUNT'), 0),
                    workflowStatusBreakdown: catchConfig(() => resolver.resolveBool('briefingWorkflowStatus', 'BRIEFING_WORKFLOW_STATUS') ?? false, false),
                    copilotReviews: catchConfig(() => resolver.resolveBool('briefingCopilot', 'BRIEFING_COPILOT_REVIEWS') ?? false, false),
                    workflowSummary: catchConfig(() => resolver.resolve<string>('workflowSummary', 'MEMORY_JOURNAL_WORKFLOW_SUMMARY'), undefined),
                    defaultProjectNumber: catchConfig(() => {
                        const val = resolver.resolve<string>('defaultProject', 'DEFAULT_PROJECT_NUMBER');
                        return val ? parseInt(val, 10) : undefined;
                    }, undefined),
                },
                instructionLevel: catchConfig(() => (resolver.resolve<string>('instructionLevel', 'INSTRUCTION_LEVEL') ?? 'standard') as 'essential' | 'standard' | 'full', 'standard'),
                auditConfig,
                flagVocabulary: catchConfig(() => resolver.resolveStringArray('flagVocabulary', 'FLAG_VOCABULARY'), undefined),
                archiveOlderThanDays: catchConfig(() => resolver.resolveIntRequired('archiveOlderThanDays', 'ARCHIVE_OLDER_THAN_DAYS', 0), 0),
                pruneOlderThanDays: catchConfig(() => resolver.resolveIntRequired('pruneOlderThanDays', 'PRUNE_OLDER_THAN_DAYS', 0), 0),
                hardDeleteOlderThanDays: catchConfig(() => resolver.resolveIntRequired('hardDeleteOlderThanDays', 'HARD_DELETE_OLDER_THAN_DAYS', 0), 0),
                pruneImportanceThreshold: catchConfig(() => {
                    const val = resolver.resolve<unknown>('pruneImportanceThreshold', 'PRUNE_IMPORTANCE_THRESHOLD');
                    if (typeof val === 'number') return val;
                    if (typeof val === 'string') return parseFloat(val);
                    return 0.15;
                }, 0.15),
                pruneDryRun: catchConfig(() => resolver.resolveBool('pruneDryRun', 'PRUNE_DRY_RUN') ?? false, false),
                pruneExcludeTags: catchConfig(() => resolver.resolveStringArray('pruneExcludeTags', 'PRUNE_EXCLUDE_TAGS'), undefined),
                embeddingModel: catchConfig(() => resolver.resolve<string>('embeddingModel', 'EMBEDDING_MODEL'), undefined),
                metricsExport: catchConfig(() => {
                    const raw = resolver.resolve<string>('metricsExport', 'METRICS_EXPORT');
                    if (raw) {
                        if (raw !== 'prometheus') throw new Error(`Unsupported metrics export format: ${raw}`);
                        if (transport !== 'http') {
                            process.stderr.write(`\n[WARN] --metrics-export is only supported when --transport http is used. Ignoring.\n\n`);
                            return undefined;
                        }
                        return 'prometheus';
                    }
                    return undefined;
                }, undefined),
                persistMetrics: catchConfig(() => resolver.resolveBool('persistMetrics', 'PERSIST_METRICS') ?? false, false),
                metricsPath: catchConfig(() => resolver.resolve<string>('metricsPath', 'METRICS_PATH'), undefined),
                configFilePath: configPath,
            };

            if (configErrors.length > 0) {
                process.stderr.write('Startup Configuration Errors:\n');
                configErrors.forEach(err => process.stderr.write(` - ${err}\n`));
                process.exit(1);
            }

            if (options['dumpConfig'] === true) {
                const redactedOptions = JSON.parse(JSON.stringify(serverOptions)) as Record<string, unknown>;
                const maskSensitive = (obj: Record<string, unknown>): void => {
                    for (const key of Object.keys(obj)) {
                        const lowerKey = key.toLowerCase();
                        if (typeof obj[key] === 'string' && (lowerKey.includes('token') || lowerKey.includes('secret') || lowerKey.includes('issuer') || lowerKey.includes('uri') || lowerKey.includes('password') || lowerKey.includes('key'))) {
                            obj[key] = '[REDACTED]';
                        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                            maskSensitive(obj[key] as Record<string, unknown>);
                        }
                    }
                };
                maskSensitive(redactedOptions);
                process.stdout.write(JSON.stringify(redactedOptions, null, 2) + '\n');
                process.exit(0);
            }

            logger.info('Starting Memory Journal MCP Server', {
                module: 'CLI',
                transport,
                stateless,
                db,
                ...(teamDb ? { teamDb } : {}),
                ...(host ? { host } : {}),
            });

            try {
                // Remove type cast when compiling as actual types will be enforced, 
                // but any casting avoids intermediate strictness warnings inside the CLI generator
                await createServer(serverOptions as unknown as Parameters<typeof createServer>[0]);
            } catch (error) {
                logger.error('Failed to start server', {
                    module: 'CLI',
                    error: error instanceof Error ? error.message : String(error),
                });
                process.exit(1);
            }
        }
    );

program.parse();

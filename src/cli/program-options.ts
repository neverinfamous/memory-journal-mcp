import { Command } from 'commander'
import { VERSION } from '../version.js'
import { DEFAULT_AUDIT_LOG_MAX_SIZE_BYTES } from '../audit/index.js'

export const defaultDbPath = './memory_journal.db'
export const defaultTeamDbPath = undefined

export function createProgram(): Command {
    const program = new Command()

    program
        .name('memory-journal-mcp')
        .description('Project context management for AI-assisted development')
        .version(VERSION)
        .option('--transport <type>', 'Transport type: stdio or http', 'stdio')
        .option('--port <number>', 'HTTP port (for http transport)', '3000')
        .option('--server-host <host>', 'Server bind host for HTTP transport (default: localhost) (env: MCP_HOST)')
        .option('--stateless', 'Use stateless HTTP mode (no session management) (env: STATELESS)')
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
        .option('--tool-filter <filter>', 'Tool filter string (e.g., "starter", "core,search") (env: MEMORY_JOURNAL_MCP_TOOL_FILTER)')
        .option('--default-project <number>', 'Default GitHub Project number (env: DEFAULT_PROJECT_NUMBER)')
        .option('--default-workspace-id <string>', 'Default workspace ID for isolating journal entries (env: DEFAULT_WORKSPACE_ID)')
        .option('--auto-rebuild-index', 'Rebuild vector index on server startup (env: AUTO_REBUILD_INDEX)')
        .option('--cors-origin <origin>', 'CORS allowed origin for HTTP transport (default: none) (env: CORS_ORIGIN)')
        .option('--enable-hsts', 'Enable HSTS header for HTTP transport (use when behind HTTPS) (env: MCP_ENABLE_HSTS)')
        .option(
            '--auth-token <token>',
            'Bearer token for HTTP transport authentication (env: MCP_AUTH_TOKEN)'
        )
        .option('--auth-scopes <scopes>', 'Comma-separated required OAuth scopes (env: MCP_AUTH_SCOPES)')
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
            'OAuth clock tolerance in seconds (default: 60) (env: OAUTH_CLOCK_TOLERANCE)',
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
            '--allowed-io-roots <paths>',
            'Comma-separated absolute paths or JSON array of paths for strict filesystem jailing (env: ALLOWED_IO_ROOTS)'
        )
        .option(
            '--codemode-internal-full-access',
            'Bypass tool filter constraints within the Code Mode sandbox (all groups accessible via mj.*) (env: CODEMODE_INTERNAL_FULL_ACCESS)',
            false
        )
        // Auto-prune
        .option(
            '--auto-prune-interval <minutes>',
            'Interval to run autonomous pruning in background (env: AUTO_PRUNE_INTERVAL_MINUTES, 0 = disabled)',
            '0'
        )
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
            '--briefing-importance-threshold <threshold>',
            'Minimum importance score (0.0 to 1.0) for an entry to be included in the briefing (env: BRIEFING_IMPORTANCE_THRESHOLD)'
        )
        .option(
            '--briefing-pr-count <count>',
            'Number of PRs to include in briefing (env: BRIEFING_PR_COUNT)'
        )
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

        .option('--config <path>', 'Path to configuration file (.yaml, .yml, .json) (env: MEMORY_JOURNAL_CONFIG)')
        .option('--dump-config', 'Print effective configuration and exit')

    return program
}

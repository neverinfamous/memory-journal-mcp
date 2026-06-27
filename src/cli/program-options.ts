import { Command, type Option } from 'commander'
import { match, P } from 'ts-pattern'
import { ZodError, type ZodType } from 'zod'
import { VERSION } from '../version.js'
import { DEFAULT_AUDIT_LOG_MAX_SIZE_BYTES } from '../audit/index.js'

export const defaultDbPath = './memory_journal.db'
export const defaultTeamDbPath = undefined

const optionGroups = new WeakMap<Option, string>()
const commandAiInstructions = new WeakMap<Command, string>()

export function withGroup(command: Command, groupName: string, configurer: (cmd: Command) => void): Command {
    const beforeCount = command.options.length;
    configurer(command);
    for (let i = beforeCount; i < command.options.length; i++) {
        const opt = command.options[i]
        if (opt) optionGroups.set(opt, groupName);
    }
    return command;
}

export function addAgentInstructions(command: Command, text: string): void {
    commandAiInstructions.set(command, text);
}

export function withValidation<T, A extends unknown[]>(schema: ZodType<T>, action: (...args: A) => void | Promise<void>) {
    return async (...args: A) => {
        const command = args[args.length - 1] as Command;
        // Commander's action handler args: (arg1, arg2, ..., options, command)
        const rawOptions = args.length > 1 ? args[args.length - 2] : {};
        try {
            const validOptions = schema.parse(rawOptions);
            const newArgs = [...args];
            // Replace rawOptions with validOptions in the args array
            if (newArgs.length > 1) {
                newArgs[newArgs.length - 2] = validOptions;
            }
            await action(...(newArgs as unknown as A));
        } catch (err: unknown) {
            if (err instanceof ZodError) {
                process.stderr.write(`\x1b[31mValidation Error:\x1b[0m\n`);
                err.issues.forEach((e: { path: PropertyKey[]; message: string }) => {
                    const path = e.path.length > 0 ? e.path.map(String).join('.') + ': ' : '';
                    process.stderr.write(`  - ${path}${e.message}\n`);
                });
                process.stderr.write('\n');
                command.help({ error: true });
            } else {
                throw err;
            }
        }
    }
}

export function createProgram(): Command {
    const program = new Command()

    program
        .name('memory-journal-mcp')
        .description('Project context management for AI-assisted development')
        .version(VERSION)
        .configureOutput({
            // Ensure error messages strictly go to stderr to maintain stdout discipline
            writeErr: (str) => process.stderr.write(str),
            outputError: (str, write) => write(`\x1b[31mError:\x1b[0m ${str}`)
        })

    program.configureHelp({
        formatHelp: (cmd, helper) => {
            // Check for JSON help mode
            const isJsonHelp = process.argv.includes('--json') || process.argv.includes('--json=true');
            if (isJsonHelp) {
                const envelope = {
                    status: 'success',
                    data: {
                        name: cmd.name(),
                        description: helper.commandDescription(cmd),
                        usage: helper.commandUsage(cmd),
                        commands: helper.visibleCommands(cmd).map(c => ({
                            term: helper.subcommandTerm(c),
                            description: helper.subcommandDescription(c)
                        })),
                        options: helper.visibleOptions(cmd).map(opt => ({
                            term: helper.optionTerm(opt),
                            description: helper.optionDescription(opt),
                            group: match([optionGroups.get(opt), opt.name()])
                                .with([P.string, P._], ([name]) => name)
                                .with([P.nullish, P.union('help', 'version')], () => 'Standard Options')
                                .with([P.nullish, P._], () => 'Command Options')
                                .exhaustive()
                        })),
                        arguments: helper.visibleArguments(cmd).map(arg => ({
                            term: helper.argumentTerm(arg),
                            description: helper.argumentDescription(arg)
                        })),
                        aiInstructions: commandAiInstructions.get(cmd) || null
                    },
                    timestamp: new Date().toISOString()
                }
                return JSON.stringify(envelope) + '\n';
            }

            let output = '';
            
            output += `Usage: ${helper.commandUsage(cmd)}\n`;
            
            const desc = helper.commandDescription(cmd);
            if (desc) output += `\n${desc}\n`;
            
            const args = helper.visibleArguments(cmd);
            if (args.length > 0) {
                output += '\nArguments:\n';
                args.forEach(arg => {
                    const term = helper.argumentTerm(arg);
                    const argumentDesc = helper.argumentDescription(arg);
                    output += `  ${term.padEnd(helper.padWidth(cmd, helper))}  ${argumentDesc}\n`;
                });
            }
            
            const options = helper.visibleOptions(cmd);
            if (options.length > 0) {
                const groups = new Map<string, typeof options>();
                options.forEach(opt => {
                    const groupName = match([optionGroups.get(opt), opt.name()])
                        .with([P.string, P._], ([name]) => name)
                        .with([P.nullish, P.union('help', 'version')], () => 'Standard Options')
                        .with([P.nullish, P._], () => 'Command Options')
                        .exhaustive();

                    if (!groups.has(groupName)) groups.set(groupName, []);
                    const group = groups.get(groupName);
                    if (group) group.push(opt);
                });
                
                const padWidth = helper.padWidth(cmd, helper);
                
                // Ensure Standard Options always prints last
                const standardOptions = groups.get('Standard Options');
                groups.delete('Standard Options');

                for (const [groupName, groupOpts] of groups.entries()) {
                    output += `\n${groupName}:\n`;
                    groupOpts.forEach(opt => {
                        const term = helper.optionTerm(opt);
                        const optionDesc = helper.optionDescription(opt);
                        output += `  ${term.padEnd(padWidth)}  ${optionDesc}\n`;
                    });
                }

                if (standardOptions) {
                    output += `\nStandard Options:\n`;
                    standardOptions.forEach(opt => {
                        const term = helper.optionTerm(opt);
                        const optionDesc = helper.optionDescription(opt);
                        output += `  ${term.padEnd(padWidth)}  ${optionDesc}\n`;
                    });
                }
            }

            const commands = helper.visibleCommands(cmd);
            if (commands.length > 0) {
                output += '\nCommands:\n';
                commands.forEach(c => {
                    const term = helper.subcommandTerm(c);
                    const subcommandDesc = helper.subcommandDescription(c);
                    output += `  ${term.padEnd(helper.padWidth(cmd, helper))}  ${subcommandDesc}\n`;
                });
            }
            
            const aiInstructions = commandAiInstructions.get(cmd);
            if (aiInstructions) {
                output += `\n${aiInstructions}\n`;
            }

            return output;
        }
    });

    return program
}

export function addCoreOptions(command: Command): Command {
    return withGroup(command, 'Core Options', (cmd) => {
        cmd
            .option('--config <path>', 'Path to configuration file (.yaml, .yml, .json) (env: MEMORY_JOURNAL_CONFIG)')
            .option('--dump-config', 'Print effective configuration and exit')
            .option('--log-level <level>', 'Log level: debug, info, warning, error', 'info')
    })
}

export function addDatabaseOptions(command: Command): Command {
    return withGroup(command, 'Database Options', (cmd) => {
        cmd
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
    })
}

export function addWorkspaceOptions(command: Command): Command {
    return withGroup(command, 'Workspace Options', (cmd) => {
        cmd
            .option('--default-project <number>', 'Default GitHub Project number (env: DEFAULT_PROJECT_NUMBER)')
            .option('--default-workspace-id <string>', 'Default workspace ID for isolating journal entries (env: DEFAULT_WORKSPACE_ID)')
    })
}

export function addVectorOptions(command: Command): Command {
    return withGroup(command, 'Vector Options', (cmd) => {
        cmd
            .option(
                '--embedding-model <model>',
                'HuggingFace model name for semantic search embeddings (env: EMBEDDING_MODEL)'
            )
            .option('--auto-rebuild-index', 'Rebuild vector index on server startup (env: AUTO_REBUILD_INDEX)')
    })
}

export function addNetworkOptions(command: Command): Command {
    return withGroup(command, 'Network Options', (cmd) => {
        cmd
            .option('--transport <type>', 'Transport type: stdio or http', 'stdio')
            .option('--port <number>', 'HTTP port (for http transport)', '3000')
            .option('--server-host <host>', 'Server bind host for HTTP transport (default: localhost) (env: MCP_HOST)')
            .option('--stateless', 'Use stateless HTTP mode (no session management) (env: STATELESS)')
            .option('--cors-origin <origin>', 'CORS allowed origin for HTTP transport (default: none) (env: CORS_ORIGIN)')
            .option('--enable-hsts', 'Enable HSTS header for HTTP transport (use when behind HTTPS) (env: MCP_ENABLE_HSTS)')
            .option(
                '--auth-token <token>',
                'Bearer token for HTTP transport authentication (env: MCP_AUTH_TOKEN)'
            )
            .option('--auth-scopes <scopes>', 'Comma-separated required OAuth scopes (env: MCP_AUTH_SCOPES)')
            .option('--trust-proxy', 'Trust reverse proxy headers (e.g. X-Forwarded-For env: TRUST_PROXY)')
            .option(
                '--public-origin <url>',
                'Public origin URL for webhook verification and OAuth redirects (env: PUBLIC_ORIGIN)'
            )
    })
}

export function addOAuthOptions(command: Command): Command {
    return withGroup(command, 'OAuth Options', (cmd) => {
        cmd
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
    })
}

export function addAuditOptions(command: Command): Command {
    return withGroup(command, 'Audit Options', (cmd) => {
        cmd
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
    })
}

export function addCodeModeOptions(command: Command): Command {
    return withGroup(command, 'Code Mode Options', (cmd) => {
        cmd
            .option(
                '--allowed-io-roots <paths>',
                'Comma-separated absolute paths or JSON array of paths for strict filesystem jailing (env: ALLOWED_IO_ROOTS)'
            )
            .option(
                '--codemode-internal-full-access',
                'Bypass tool filter constraints within the Code Mode sandbox (all groups accessible via mj.*) (env: CODEMODE_INTERNAL_FULL_ACCESS)',
                false
            )
            .option(
                '--codemode-max-result-size <bytes>',
                'Maximum Code Mode result size in bytes (default: 102400 / 100KB, env: CODE_MODE_MAX_RESULT_SIZE)'
            )
            .option('--tool-filter <filter>', 'Tool filter string (e.g., "starter", "core,search") (env: MEMORY_JOURNAL_MCP_TOOL_FILTER)')
    })
}

export function addSchedulerOptions(command: Command): Command {
    return withGroup(command, 'Scheduler Options', (cmd) => {
        cmd
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
    })
}

export function addPruningOptions(command: Command): Command {
    return withGroup(command, 'Pruning Options', (cmd) => {
        cmd
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
    })
}

export function addBriefingOptions(command: Command): Command {
    return withGroup(command, 'Briefing Options', (cmd) => {
        cmd
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
                '--briefing-commits <count>',
                'Number of commits to include in briefing (env: BRIEFING_COMMIT_COUNT)',
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
    })
}

export function addMetricsOptions(command: Command): Command {
    return withGroup(command, 'Metrics Options', (cmd) => {
        cmd
            .option(
                '--metrics-export <format>',
                'Metrics export format: prometheus (env: METRICS_EXPORT)'
            )
            .option('--persist-metrics', 'Persist metrics to disk across server restarts (env: PERSIST_METRICS)')
            .option('--metrics-path <path>', 'Custom path to the metrics JSON file (env: METRICS_PATH)')
    })
}

export function addOutputOptions(command: Command): Command {
    return withGroup(command, 'Command Options', (cmd) => {
        cmd.option('--json', 'Output results as a structured JSON envelope')
    })
}

export function addServerOptions(command: Command): Command {
    addCoreOptions(command)
    addDatabaseOptions(command)
    addWorkspaceOptions(command)
    addVectorOptions(command)
    addNetworkOptions(command)
    addOAuthOptions(command)
    addAuditOptions(command)
    addCodeModeOptions(command)
    addSchedulerOptions(command)
    addPruningOptions(command)
    addBriefingOptions(command)
    addMetricsOptions(command)
    return command
}

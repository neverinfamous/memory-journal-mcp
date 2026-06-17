/**
 * Server instructions for Memory Journal MCP.
 *
 * Slim instructions are sent to MCP clients during initialization.
 * Detailed help is available on-demand via memory://help resources.
 * Instructions are dynamically generated based on enabled tool groups
 * and instruction level for token efficiency.
 */

import type { ToolGroup } from '../types/index.js'
import { getEnabledGroups } from '../filtering/tool-filter.js'
import { TOOL_GROUPS } from '../filtering/tool-constants.js'

/**
 * Resource definition for instruction generation
 */
export interface ResourceDefinition {
    uri: string
    name: string
    description?: string
}

/**
 * Prompt definition for instruction generation
 */
export interface PromptDefinition {
    name: string
    description?: string
}

/**
 * Latest entry snapshot for initial briefing
 */
export interface LatestEntrySnapshot {
    id: number
    timestamp: string
    entryType: string
    content: string
}

/**
 * Instruction detail level for token efficiency
 * - essential: ~300 tokens - Core behaviors + quick access (for token-constrained clients)
 * - standard: ~350 tokens - + help pointers for enabled groups
 * - full: ~500 tokens - + active tools/prompts summary
 */
export type InstructionLevel = 'essential' | 'standard' | 'full'

// =============================================================================
// Composable Instruction Segments
// =============================================================================

/**
 * Core instructions — always included regardless of enabled groups.
 * Contains quick access, help pointers, and essential behavioral guidance.
 */
const CORE_INSTRUCTIONS = `# memory-journal-mcp

## Quick Access

| Purpose         | Action                      |
| --------------- | --------------------------- |
| Session context | \`memory://briefing\`         |
| Recent entries  | \`memory://recent\`           |
| Health/time     | \`memory://health\`           |
| Metrics/Summary | \`memory://metrics/summary\`  |
| Metrics/Latency | \`memory://metrics/latency\`  |
| Resource reads  | \`memory://metrics/resources\`|
| Project staleness| \`memory://staleness\`        |
| Report history  | \`memory://insights/reports\` |
| Full context    | \`get-context-bundle\` prompt |

## Help Resources

Read \`memory://help\` for tool group index and available help resources.
Read \`memory://help/{group}\` for per-group tool reference (parameters, annotations, examples).
Only help resources for your enabled tool groups are registered.

## Behaviors

### Essential Session Start

1. You **MUST** read the \`memory://briefing/{repo_name}\` at the start of each chat!
2. Use the standard MCP \`read_resource\` tool for this (do NOT use Code Mode/execute_code).
3. Infer the \`repo_name\` from the user's prompt or your active workspace context.
4. **RENDER BRIEFING**: The briefing resource returns a pre-formatted Markdown string containing any active flags and a dense 2-column context table. You MUST output this exact string as your response without any modifications.
5. **REVIEW ALERTS**: Pay special attention to any active flags listed at the top of the briefing. Do NOT truncate any summaries or issues.
6. **STOP & WAIT**: Do NOT autonomously resume past tasks or start work on new issues. The briefing is strictly for context.

- **AntiGravity**: Tools are \`mcp_{name}_{tool}\` → server name = \`memory-journal-mcp\`
- **Cursor**: Tools are \`user-{name}-{tool}\` → server name = \`user-memory-journal-mcp\`
- **Other clients**: Use configured name exactly. Use tool-prefix discovery if unsure.

### Journal Behaviors

- **Strict Validation**: The \`project_number\` parameter is STRICTLY REQUIRED for all mutation operations (Create, Update, Delete). It must be a **numeric** ID (e.g., \`1\`, \`14\`), not a repo name string. Find it in the briefing's Config row (\`registry: repoName (#N)\`) or via \`get_statistics\`. In Code Mode, string repo names (e.g., \`"mysql-mcp"\`) are auto-resolved to numeric IDs via the project registry, but direct MCP tool calls require the numeric value.
- **Personal vs Team**: **ALWAYS use the personal journal** (e.g., \`create_entry\`) by default. ONLY save to the team journal (e.g., \`team_create_entry\`) if the user explicitly requests it.
- **Entry History**: Every modification to an entry creates a revision. Use \`get_entry_history\` to view past versions and changes of an entry. When updating entries, consider passing \`expected_version\` to use optimistic locking and avoid overwriting concurrent edits.
- **Soft-Delete & Recovery**: Entries can be soft-deleted and restored via \`restore_entry\` or \`team_restore_entry\`. Use \`list_deleted_entries\` or \`team_list_deleted_entries\` to discover soft-deleted entries. Entries can also be archived (\`is_archived = 1\`) to preserve them in history while excluding them from normal search queries.
- **Batch Operations**: Use \`batch_create_entries\`, \`batch_update_entries\`, and \`batch_delete_entries\` (or team equivalents) to process bulk data up to 50 entries per transaction. Use \`rebuild_vector_index\` to rebuild the vector index for these entries.
- **External Imports**: Use \`import_external\` and \`team_import_external\` to ingest knowledge management exports from Notion, Obsidian, or Logseq. These tools normalize wikilinks, YAML frontmatter, and block hierarchies seamlessly. Use \`dry_run\` to preview the parsed structure.
- **Admin & Telemetry**: Use \`update_configuration\` to dynamically change the server's instruction level, tool filters, or briefing preferences without restarting. Use \`search_audit_log\` to query operational telemetry and investigate incidents across all active and rotated JSONL audit files. You can filter by \`tool_name\`, \`user\`, \`date_range\`, \`status\`, or \`category\`. Both the audit logs and the \`memory://metrics/summary\` resource reflect precise, content-type-aware token consumption estimates.
- **Create entries for**: implementations, decisions, bug fixes, milestones, user requests to "remember"
- **Search before**: major decisions, referencing prior work, understanding project context. Use \`sort_by: "importance"\` on \`search_entries\`, \`get_recent_entries\`, or \`search_by_date_range\` to surface structurally significant entries. Use the \`mode\` parameter (\`auto\`, \`fts\`, \`semantic\`, \`hybrid\`) to control search strategy. The \`fts\` and \`hybrid\` modes include Levenshtein distance typo-tolerance fallback (via \`fuzzy_match\` and \`auto_correct\`), making searches more resilient to misspellings.
- **Analyze insights**: Use cross-project insights (\`get_cross_project_insights\`) and cross-team search (\`cross_team_search\`) before defining architectures spanning multiple teams or DBs. Use \`team_get_collaboration_matrix\` to evaluate team health, cross-author activity patterns, and collaboration impact. Use repo insights (\`memory://github/insights\`) to gauge traction. View \`memory://insights/digest\` and \`memory://insights/team-collaboration\` for automated analytics snapshots. Access aggregate server metrics via \`memory://metrics/summary\`, per-tool telemetry and latency percentiles via \`memory://metrics/latency\`, and resource read frequency via \`memory://metrics/resources\`.

### Auto-Prune

On server startup, the auto-prune system implements a graduated data lifecycle (Active → Archived → Soft-Deleted → Hard-Deleted) for old entries with low significance scores.
- **Configurable Thresholds**: Controlled via \`--archive-older-than-days\`, \`--prune-older-than-days\` (soft-delete), \`--hard-delete-older-than-days\`, and \`--prune-importance-threshold\`.
- **Exclusion Rules**: Specific tags can be exempted from auto-pruning using \`--prune-exclude-tags <tags>\` (e.g. \`architecture\`, \`never-prune\`).
- **Dry Run**: Server administrators can preview what would be processed without mutating the database by using the \`--prune-dry-run\` flag.

### Scheduled Reports

When deployed in HTTP mode with \`--report-interval <minutes>\` and \`--report-webhook-url <url>\`, the server periodically generates digest reports and delivers them to the configured webhook. Reports include activity trends, significance highlights, stale project warnings, and top-importance entries.

- **Formats**: \`slack\` (default, \`{"text":"<markdown>"}\`), \`discord\` (\`{"content":"<markdown>"}\`), or \`json\` (raw DigestSnapshot payload).
- **Report history**: Read \`memory://insights/reports\` to view the last 5 generated reports and their delivery status.
- **Independent from digest**: The \`report\` job is separate from the \`digest\` analytics job. You can run one without the other.

### Real-Time Subscriptions

The server supports the standard MCP \`resources/subscribe\` capability. You can subscribe to team resources (e.g., \`memory://team/recent\`, \`memory://flags\`, and \`memory://briefing\`) to receive real-time \`notifications/resources/updated\` notifications when other agents or team members mutate shared data. Note that subscriptions are scope-authorized; your session must possess the required scope (e.g., \`team\` or \`admin\`) for the target resource, or the subscription will be rejected with a \`PermissionError\`.

### Team RBAC & Access Control

The team database features a Role-Based Access Control (RBAC) system for team members:
- **Roles**: 
  - \`viewer\`: Read-only access to all team data.
  - \`member\`: Read all, Create/Edit/Delete *own* entries, resolve own flags.
  - \`admin\`: Read/Write/Delete *all* entries and flags, manage team members, rebuild vector indexes, backup data.
- **Bootstrap Workflow**: The RBAC system is inactive until the first member is added. The first time \`team_add_member\` is called, the caller is automatically registered as an \`admin\`. Alternatively, the server can be bootstrapped via the \`TEAM_ADMIN\` environment variable or \`--team-admin\` CLI flag. Unregistered authors fall back to the configured \`TEAM_DEFAULT_ROLE\`.
- **Managing Members**: Admins can manage members using \`team_add_member\`, \`team_remove_member\`, \`team_update_member_role\`, \`team_list_members\`, and \`team_get_member\`. 
- **Author Aliases**: Admins can manage author aliases to consolidate attribution for team analytics when one person uses multiple usernames using \`team_add_author_alias\`, \`team_list_author_aliases\`, \`team_resolve_author\`, \`team_remove_author_alias\`, and \`team_consolidate_authors\`.
- **OAuth Scopes**: OAuth scopes (read/write/admin) govern broad HTTP endpoint access. RBAC roles govern fine-grained internal tool capabilities. Both must be satisfied when OAuth is active.

### Session Summaries

Use \`create_entry\` to record session summaries. Required fields:

- \`entry_type: "retrospective"\`
- \`tags: ["session-summary"]\` (plus relevant domain/activity tags)
- \`project_number\` from the briefing

Content MUST follow this EXACT structure (no extra top-level sections):

\`\`\`
## Accomplished
- [concrete items done this session]

## Unfinished / Blocked
- [remaining items or "None"]

## Context for Next Session
- [entry IDs, branch names, PR numbers, pending decisions]
\`\`\`

Do NOT add sections like "## Summary", "## Overview", "## Notes", or any other
top-level headers. Do NOT omit any of the three required sections.

Do NOT create session summaries for testing passes where everything passed and no code changes were made. Only summarize sessions with substantive work.

### Entry Type Selection

Choose the correct \`entry_type\` — do NOT default everything to \`personal_reflection\`:

- \`retrospective\` — Session summaries, certification reports, any "what was accomplished" recap
- \`bug_fix\` — Specific bug identification and/or resolution
- \`project_decision\` — Architecture decisions, pattern adoptions, technology choices
- \`planning\` — Roadmaps, sprint plans, project initialization
- \`code_review\` — Security audits, code quality reviews, copilot findings
- \`technical_note\` — Implementation notes, gotchas, reference documentation
- \`feature_implementation\` — New feature completions
- \`research\` — Investigation, benchmarking, evaluation of alternatives
- \`meeting_notes\` — Meeting minutes, sync notes, discussion summaries
- \`learning\` — Lessons learned, tutorials completed, skill acquisition
- \`standup\` — Daily standup notes, status updates
- \`milestone\` — Major project milestones, release checkpoints
- \`technical_achievement\` — Significant technical accomplishments
- \`enhancement\` — Incremental improvements, optimizations
- \`development_note\` — Day-to-day development context and progress
- \`adversarial_review\` — Adversarial audit findings, red-team results
- \`plan_draft\` — Draft plans awaiting review or refinement
- \`plan_refinement\` — Iterated plan revisions based on feedback
- \`copilot_validation\` — Copilot review validation results
- \`system_integration_test\` — Integration test runs and results
- \`test_entry\` — Test data or test-related entries
- \`flag\` — Auto-assigned by Hush Protocol tools (\`team_pass_flag\`). Do NOT set manually.
- \`other\` — Anything that doesn't fit the above categories
- \`personal_reflection\` — Only for genuinely personal notes that don't fit above

### Tag Taxonomy

Every entry MUST have at least one tag. Use kebab-case exclusively.

- _Activity_: \`session-summary\`, \`certification\`, \`stress-test\`, \`bug-fix\`, \`release\`, \`audit\`, \`remediation\`, \`refactor\`
- _Domain_: \`security\`, \`performance\`, \`architecture\`, \`code-mode\`, \`documentation\`, \`ci-cd\`, \`github-integration\`
- _Tool group_: Name of the tool group being worked on (e.g., \`core\`, \`search\`, \`github\`, \`admin\`)
- _Pattern_: \`split-schema\`, \`zod\`, \`error-handling\`, \`dual-schema\`

### Significance Marking

Mark important entries with \`significance_type\`:

- \`release\` — Version deployments
- \`milestone\` — Major completions (full certification, security audit, feature launch)
- \`decision\` — Technology or process decisions
- \`architecture\` — Architecture decisions, pattern adoptions, structural changes
- \`blocker_resolved\` — Critical blockers that were resolved
- \`lesson_learned\` — Documented lessons from failures or unexpected outcomes
- \`breakthrough\` — Significant technical or conceptual breakthroughs
- \`security\` — Security audit completions, vulnerability remediations, hardening milestones

Do NOT mark routine session summaries or pass-only testing results as significant.

### Link Entries

Create relationships to build traversable context chains:

- \`implements\` — implementation→spec, remediation→audit findings
- \`resolved\` — bugfix→issue that reported the bug
- \`evolves_from\` — v2→v1, new iteration→prior version
- \`references\` — cross-project parity work, related entries
- \`clarifies\` — documentation→implementation it explains
- \`response_to\` — reply to a question or issue raised in another entry
- \`blocked_by\` — entry was blocked by another (blocker→resolution)
- \`caused\` — entry caused or led to another outcome

Only link truly related entries. Do NOT create bulk relationships between unrelated entries that happen to share tags.`

/**
 * Code Mode summary — only included when codemode group is enabled.
 * Points to memory://help/codemode for full API reference.
 */
const CODE_MODE_INSTRUCTIONS = `

## Code Mode

API: \`tool_name\` → \`mj.group.action()\` (e.g., \`search_entries\` → \`mj.search.searchEntries()\`)
Globals: \`createEntry()\`, \`find()\`, \`recent()\`, \`searchEntries()\`, \`deleteEntry()\`, \`help()\` work without the \`mj.\` prefix.
Positional: \`create("note")\`, \`searchEntries("performance")\`
Aliases: Common parameter names are auto-corrected (\`text\`/\`message\`/\`description\`→\`content\`, \`entry\`/\`id\`→\`entry_id\`, \`q\`→\`query\`, \`path\`/\`filepath\`→\`output_dir\`, \`mode\`→\`instruction_level\`, \`keep\`→\`keep_count\`).
Discovery: \`mj.help()\` → \`{groups, totalMethods}\`. \`mj.core.help()\` for group-specific.
Sandbox: No network access (\`fetch\` is undefined). \`setTimeout\` and \`sleep(ms)\` are available for minor delays.
Readonly: Pass \`readonly: true\` to \`mj_execute_code\` to restrict execution to read-only operations.
Read \`memory://help/codemode\` for full namespace table, examples, and patterns.
**Codemode-only**: When \`mj_execute_code\` is the only registered tool, all tool names referenced in these instructions (e.g., \`create_entry\`, \`search_entries\`) must be called via \`mj_execute_code\` using \`mj.*\` namespaces or bare globals. Do NOT call them as direct MCP tools.`

/**
 * All help keys that have content (for dynamic help pointer generation).
 */
const HELP_GROUP_KEYS: readonly string[] = ["codemode","github","hush-protocol","skills","templates"]

/**
 * Build dynamic help pointers listing only the enabled groups.
 */
function buildHelpPointers(groups: Set<ToolGroup>): string {
    const enabledHelpGroups = HELP_GROUP_KEYS.filter((k) => {
        if (k === 'hush-protocol') return groups.has('team')
        if (k === 'skills') return true
        return groups.has(k as ToolGroup)
    })
    if (enabledHelpGroups.length === 0) {
        return '\n\nRead `memory://help` for gotchas and critical usage patterns.'
    }
    return '\n\n## Available Help\n\n' +
        'Read `memory://help` for gotchas and critical usage patterns.\n' +
        'Read `memory://help/{group}` for: ' + enabledHelpGroups.join(', ') + '.'
}

/**
 * Build active groups summary listing enabled group names with tool counts.
 */
function buildActiveGroupsSummary(enabledTools: Set<string>): string {
    const activeGroups: { group: ToolGroup; tools: string[] }[] = []

    for (const [group, allTools] of Object.entries(TOOL_GROUPS) as [ToolGroup, string[]][]) {
        const enabledInGroup = allTools.filter((tool) => enabledTools.has(tool))
        if (enabledInGroup.length > 0) {
            activeGroups.push({ group, tools: enabledInGroup })
        }
    }

    if (activeGroups.length === 0) return ''

    let summary = `\n\n## Active Tools (${String(enabledTools.size)})\n`
    for (const { group, tools } of activeGroups) {
        summary += `**${group}**: ${tools.map((t) => `\`${t}\``).join(', ')}\n`
    }
    return summary
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Generate dynamic instructions based on enabled tool groups and instruction level.
 *
 * Sections are conditionally included based on which tool groups are enabled:
 * - Code Mode snippet → only with `codemode` group
 * - Help group listing → `standard`+ level, only lists enabled groups
 * - Active tools summary → `full` level only
 * - Prompts listing → `full` level only
 *
 * @param enabledTools - Set of enabled tool names
 * @param prompts - Available prompt definitions
 * @param latestEntry - Optional latest entry for context snapshot
 * @param level - Instruction detail level (default: 'standard')
 * @param enabledGroups - Optional pre-computed enabled groups; derived from enabledTools if omitted
 */
export function generateStandardInstructions(
    enabledTools: Set<string>,
    prompts: PromptDefinition[],
    latestEntry?: LatestEntrySnapshot,
    level: InstructionLevel = 'standard',
    enabledGroups?: Set<ToolGroup>
): string {
    // Derive enabled groups from enabled tools if not provided (backward compat)
    const groups = enabledGroups ?? getEnabledGroups(enabledTools)

    // Always start with core instructions (overview + behaviors)
    let instructions = CORE_INSTRUCTIONS

    // Code Mode snippet — only when codemode group is enabled
    if (groups.has('codemode')) {
        instructions += CODE_MODE_INSTRUCTIONS
    }

    // Add latest entry snapshot for immediate context (compact format)
    if (latestEntry) {
        const preview = latestEntry.content.slice(0, 120)
        instructions += `\n**Latest**: #${String(latestEntry.id)} (${latestEntry.timestamp}) ${latestEntry.entryType}\n> ${preview}${latestEntry.content.length > 120 ? '...' : ''}\n`
    }

    // Essential: minimal help pointer (no group listing)
    // Standard+: dynamic help pointers listing enabled groups
    if (level === 'essential') {
        instructions += '\n\nRead `memory://help` for gotchas and critical usage patterns.'
    } else {
        instructions += buildHelpPointers(groups)
    }

    // Full level includes active groups summary + prompts
    if (level === 'full') {
        instructions += buildActiveGroupsSummary(enabledTools)

        // Add prompts section
        if (prompts.length > 0) {
            instructions += `\n## Prompts (${String(prompts.length)})\n`
            instructions += 'Pre-built templates and guided workflows:\n'
            for (const prompt of prompts) {
                instructions += `- \`${prompt.name}\` - ${prompt.description ?? ''}\n`
            }
        }
    }

    return instructions
}

/**
 * Generate instructions optimized for Code Mode (consolidated API reference).
 */
export function generateCodeModeInstructions(
    enabledTools: Set<string>,
    prompts: PromptDefinition[],
    latestEntry?: LatestEntrySnapshot,
    level: InstructionLevel = 'standard',
    enabledGroups?: Set<ToolGroup>
): string {
    const standard = generateStandardInstructions(enabledTools, prompts, latestEntry, level, enabledGroups)
    return standard + '\n\n' + HELP_CONTENT.get('codemode')
}

/**
 * Static instructions for backward compatibility.
 * @deprecated Use generateStandardInstructions() instead for dynamic content
 */
export const SERVER_INSTRUCTIONS = CORE_INSTRUCTIONS

/**
 * Help content keyed by group name.
 * 'gotchas' is the always-available help (memory://help).
 * Other keys are feature-specific help (memory://help/{key}).
 */
export const HELP_CONTENT: ReadonlyMap<string, string> = new Map([
  ["codemode", `# Code Mode API Reference

In Code Mode (\`mj_execute_code\`), you do NOT have native MCP tool schemas. You must orchestrate the server using the \`mj.*\` API inside the sandbox.

## Sandbox Environment
- **Network:** Disabled. \`fetch()\` throws \`SandboxNetworkError\`. Node network modules are stripped.
- **Globals:** \`createEntry()\`, \`find()\`, \`recent()\`, \`searchEntries()\`, \`deleteEntry()\`, \`help()\` work without the \`mj.\` prefix.
- **Positional Arguments:** \`create("note")\`, \`searchEntries("performance")\`, \`mj.backup.backupJournal("snapshot")\`.
- **Healing Aliases:** The proxy auto-heals common hallucinations (e.g., \`text\`/\`message\`/\`description\`→\`content\`, \`entry\`/\`id\`→\`entry_id\`, \`issue_id\`→\`issue_number\`, \`q\`→\`query\`, \`path\`/\`filepath\`→\`source_dir\`/\`output_dir\`, \`file\`→\`filename\`, \`mode\`→\`instruction_level\` or \`summary_only\`, \`keep\`→\`keep_count\`).
- **Arrays & Methods:** Proxies seamlessly support native array properties/methods (e.g., \`.length\`, \`[0]\`, \`.map()\`, \`.filter()\`, \`.includes()\`, \`.shift()\`, \`.concat()\`). Calling an unsupported method returns an actionable \`VALIDATION_ERROR\` rather than crashing.
- **Async/Await:** Do NOT access \`Promise\` objects synchronously. Always \`await\` async operations. Missing \`await\` statements will be intercepted and return an actionable \`VALIDATION_ERROR\`.

## API Namespace Map

### \`mj.core\`
- \`createEntry(params)\`
- \`getEntryById(params)\`
- \`getRecentEntries(params)\`
- \`getEntryHistory(params)\`
- \`listTags(params)\`

### \`mj.search\`
- \`searchEntries(params)\`
- \`searchByDateRange(params)\`
- \`semanticSearch(params)\`
- \`getVectorIndexStats(params)\`
- \`listDeletedEntries(params)\`
- \`crossTeamSearch(params)\`

### \`mj.analytics\`
- \`getStatistics(params)\` (or \`getStats()\`)
- \`getCrossProjectInsights(params)\` (or \`getInsights()\`)

### \`mj.relationships\`
- \`linkEntries(params)\`
- \`visualizeRelationships(params)\`

### \`mj.io\`
- \`exportEntries(params)\`
- \`exportMarkdown(params)\`
- \`importMarkdown(params)\`
- \`importExternal(params)\`

### \`mj.admin\`
- \`updateConfiguration(params)\`
- \`updateEntry(params)\`
- \`deleteEntry(params)\`
- \`restoreEntry(params)\`
- \`rebuildVectorIndex(params)\`
- \`addToVectorIndex(params)\`
- \`mergeTags(params)\`
- \`batchCreateEntries(params)\`
- \`batchUpdateEntries(params)\`
- \`batchDeleteEntries(params)\`
- \`searchAuditLog(params)\`

### \`mj.github\`
- \`getGithubIssues(params)\`
- \`getGithubPrs(params)\`
- \`getGithubIssue(params)\`
- \`getGithubPr(params)\`
- \`getGithubContext(params)\`
- \`getKanbanBoard(params)\`
- \`moveKanbanItem(params)\`
- \`addKanbanItem(params)\`
- \`deleteKanbanItem(params)\`
- \`createGithubIssueWithEntry(params)\`
- \`closeGithubIssueWithEntry(params)\`
- \`getGithubMilestones(params)\`
- \`getGithubMilestone(params)\`
- \`createGithubMilestone(params)\`
- \`updateGithubMilestone(params)\`
- \`deleteGithubMilestone(params)\`
- \`getRepoInsights(params)\`
- \`getCopilotReviews(params)\`

### \`mj.backup\`
- \`backupJournal(params)\`
- \`listBackups(params)\`
- \`restoreBackup(params)\`
- \`cleanupBackups(params)\`

### \`mj.team\`
- \`teamCreateEntry(params)\`, \`teamGetEntryById(params)\` (or \`teamRead()\`), \`teamGetRecent(params)\`, \`teamListTags(params)\`
- \`teamSearch(params)\`, \`teamSearchByDateRange(params)\`, \`teamSemanticSearch(params)\`
- \`teamUpdateEntry(params)\`, \`teamDeleteEntry(params)\` (or \`teamTrash()\`), \`teamRestoreEntry(params)\`, \`teamListDeletedEntries(params)\`
- \`teamMergeTags(params)\`, \`teamLinkEntries(params)\`, \`teamVisualizeRelationships(params)\`
- \`teamBatchCreateEntries(params)\`, \`teamBatchUpdateEntries(params)\`, \`teamBatchDeleteEntries(params)\`
- \`teamGetStatistics(params)\` (or \`teamGetStats()\`), \`teamGetCrossProjectInsights(params)\`, \`teamGetCollaborationMatrix(params)\`
- \`teamExportEntries(params)\` (or \`teamExport()\`), \`teamExportMarkdown(params)\`, \`teamImportMarkdown(params)\` (or \`teamImportMd()\`), \`teamImportExternal(params)\`
- \`teamBackup(params)\`, \`teamListBackups(params)\`
- \`teamGetVectorIndexStats(params)\`, \`teamRebuildVectorIndex(params)\`, \`teamAddToVectorIndex(params)\`
- \`teamPassFlag(params)\`, \`teamResolveFlag(params)\`, \`teamListFlags(params)\`, \`teamUpdateFlag(params)\`, \`teamGetFlagAnalytics(params)\`
- \`teamAddMember(params)\`, \`teamRemoveMember(params)\`, \`teamUpdateMemberRole(params)\`, \`teamListMembers(params)\`, \`teamGetMember(params)\`
- \`teamAddAuthorAlias(params)\`, \`teamRemoveAuthorAlias(params)\`, \`teamListAuthorAliases(params)\`, \`teamResolveAuthor(params)\`, \`teamConsolidateAuthors(params)\`

**Rule:** When \`mj_execute_code\` is the only registered tool (e.g., Code Mode), all tool actions must be performed using the \`mj.*\` namespaces listed above inside the code sandbox. Do NOT attempt to call the original tool names as direct MCP operations.`],
  ["github", `# GitHub Integration

- Include \`issue_number\`/\`pr_number\` and \`project_number\` in \`create_entry\` to auto-link
- After closing issue/merging PR → create summary entry with learnings
- CI failures → \`actions-failure-digest\` prompt or \`memory://actions/recent\`
- Kanban: \`get_kanban_board\` → \`add_kanban_item\` / \`move_kanban_item\` / \`delete_kanban_item\` → document completion (project_number auto-resolves if repo is registered). **⚠️ Eventual Consistency:** GitHub Projects V2 read index is heavily eventually consistent. Do NOT rely on \`get_kanban_board\` to immediately reflect items that were just added or moved.
- Milestones: \`get_github_milestones\` → track project progress, \`memory://github/milestones\`
- Commits: \`memory://commits/{project_number}/by-issue\` and \`memory://commits/{project_number}/by-pr\` group commits by referenced issues/PRs.
- Rate Limits: Before expensive API operations, check \`memory://github/rate-limit\` (or \`memory://github/rate-limit/{repo}\`) to proactively throttle.
- **Project Initialization**: To register a new project workspace, create an entry with \`project_number: N\`. Instruct the user to manually update their \`PROJECT_REGISTRY\` config, as agents cannot directly edit protected IDE config files.
- **Multi-Project Routing**: If \`memory://briefing\` shows "Registered Workspaces":
  - **Tools**: The \`repo\` parameter automatically resolves from \`project_number\`. If you omit both, they default to the primary project.
  - **Resources**: Resource URIs like \`memory://github/status\` will fallback to the default project. To explicitly target another project, use the \`{repo}\` variant (e.g., \`memory://github/status/{repo}\`).
  - **Dynamic Briefings**: You can explicitly request the briefing for a specific project by reading \`memory://briefing/{repo}\` instead of the global \`memory://briefing\` resource.

## Copilot Review Patterns

When the user has GitHub Copilot code review enabled:

**Learn from reviews** — After a PR is merged or reviewed, use \`get_copilot_reviews({ pr_number, repo })\` to read Copilot's findings (pass \`repo\` in multi-project setups). If patterns emerge (e.g., repeated null check warnings, missing error handling), suggest adding a rule or updating existing rules. Create journal entries tagged \`copilot-finding\` and link to the PR via \`pr_number\`.

**Pre-emptive checking** — Before creating or modifying code, search journal entries with tag \`copilot-finding\` for patterns relevant to the current work. Apply those patterns proactively to reduce review cycles.`],
  ["gotchas", `# Field Notes & Gotchas

## Tool Usage Pitfalls

1. **Missing \`project_number\`**: The \`project_number\` parameter is strictly required for all mutation operations (Create, Update, Delete) to prevent accidental miscategorization. You must always explicitly provide it. Omitting it will result in a validation error.
2. **Result Limits**: The \`MAX_QUERY_LIMIT\` is strictly 500 for most search tools. Use the optional \`cursor\` parameter and \`next_cursor\` output for O(1) keyset pagination on large datasets. Batch operations are strictly limited to \`MAX_BATCH_SIZE\` (50) per transaction.
3. **Code Mode Restrictions**: The \`mj_execute_code\` sandbox cannot make network requests (calling \`fetch()\` throws a \`SandboxNetworkError\` and Node network modules are stripped). Use it strictly for orchestrating \`mj.*\` API calls. If you need to hit external/HTTP endpoints, you must use native OS tools outside of Code Mode. Note: \`setTimeout\` and \`sleep(ms)\` are available for minor delays, but avoid long-running operations.
4. **Tool & Parameter Hallucinations**: Do NOT attempt to use tools that are not listed in the \`memory://help\` resource. If you guess incorrect parameter names, array methods, or access \`Promise\` objects synchronously in Code Mode, the proxy layer will intercept the mistake and return a structured \`[VALIDATION_ERROR]\` payload with \`{ success: false }\`. Read the feedback and adjust your payload rather than expecting a raw V8 crash.
5. **Phrase Matching**: The \`query\` parameter in search tools supports true phrase matching. Wrap exact strings in double quotes (e.g., \`"error handling"\`) when word order and adjacency are critical.
6. **Typo Tolerance**: FTS5 search operations automatically fall back to Levenshtein distance matching on tags and entry types if no results are found. To disable this when strict exact matching is needed, explicitly set \`exact_match: true\` (or \`fuzzy_match: false\`).
7. **Team RBAC**: If the team database has at least one member registered, RBAC is active. Unregistered authors fall back to the \`TEAM_DEFAULT_ROLE\` (which denies access by default). Non-admin members can only modify or resolve entries/flags they originally authored.
8. **Concurrent Edits**: When updating an entry (\`update_entry\`, \`team_update_entry\`), always pass \`expected_version\` if you know the current version to prevent silently overwriting concurrent changes. If you get a \`VERSION_CONFLICT\` error, re-read the latest entry state returned in the error payload, merge your changes, and retry.
9. **Cross-Team Search**: The \`cross_team_search\` tool searches across multiple team databases configured via \`ADDITIONAL_TEAM_DBS\`. Results include a \`team_db\` label identifying the source database. This tool is read-only and uses FTS5 only (no semantic/vector search across DBs). Individual DB failures are non-fatal — the response includes \`degraded: true\` and per-DB error details.
10. **Observability & Persistence**: If the server runs via HTTP with \`--metrics-export prometheus\` (or \`METRICS_EXPORT\`), a standard \`/metrics\` endpoint is exposed for external scrapers. Code Mode cannot natively fetch this endpoint; instead, use the \`memory://metrics/summary\`, \`memory://metrics/latency\`, and \`memory://metrics/resources\` resources to retrieve telemetry. **Metrics reset on restart** unless the \`--persist-metrics\` flag (or \`PERSIST_METRICS\` env var) is provided, which enables periodic JSON state snapshots for long-term trend analysis.
11. **Multi-step Operations & Error Aggregation**: Tools performing batch actions (e.g., \`import_markdown\`, \`batch_create_entries\`, \`batch_update_entries\`, \`batch_delete_entries\`, \`rebuild_vector_index\`) will return a single \`ErrorResponse\` on partial failure (with \`success: false\`). This response contains an \`aggregated_errors\` array of objects (e.g. \`[{ "message": "Item at index 0 failed: UNIQUE constraint failed" }]\`) detailing individual item failures, while the top-level error message summarizes total success/failure counts.
12. **Configuration Precedence & Debugging**: Server settings are resolved using strict precedence: CLI flags override Environment Variables, which override the Config File (\`memory-journal.config.yaml\` / \`.yml\` / \`.json\`), which overrides Defaults. If you encounter unexpected settings, you can run the server with the \`--dump-config\` flag. This command aggregates any startup configuration validation errors (printing them all at once rather than failing on the first one) or, if valid, prints the fully resolved configuration tree (with secrets automatically redacted as \`[REDACTED]\`) and exits cleanly. This is the primary method for diagnosing overriding issues.
13. **Runtime Configuration Hot-Reloading**: You can use the \`update_configuration\` tool to dynamically change the \`instruction_level\`, \`tool_filter\`, or briefing variables on the fly without a server restart. This instantly modifies the configuration file and triggers a hot-reload, emitting a \`notifications/tools/list_changed\` event to the MCP client to refresh available tools and instructions immediately.
14. **Database Encryption**: If the database requires SQLCipher encryption at rest, you must set the \`DB_ENCRYPTION_KEY\` environment variable when starting the server. If this key is missing or incorrect for an encrypted database, any operations will fail with a "not a database" error.
15. **Scheduled Reports**: The \`--report-interval\` scheduler job is HTTP-only and requires \`--report-webhook-url\` to actually deliver reports. Without a webhook URL, the job still generates and persists report snapshots (viewable via \`memory://insights/reports\`) but skips delivery. Report delivery failures are logged but never crash the server.
16. **Token Estimation & Content-Type Heuristics**: To assist you in optimizing your context window consumption, every tool execution result includes a \`_meta.tokenEstimate\` field. This value uses dynamic, content-type-aware heuristics to closely estimate real token costs (Prose defaults to 4.0 bytes/token; JSON payloads to 2.8 bytes/token; Code blocks to 3.2 bytes/token). Leverage this telemetry to govern your batch sizes or fallback to paginated/throttled endpoints if usage spikes.

## GitHub & Kanban Sync

- **Eventual Consistency**: GitHub Projects V2 read indexes are eventually consistent. If you \`add_kanban_item\` or \`move_kanban_item\`, a subsequent \`get_kanban_board\` might take up to 10 seconds to reflect the change.
- **Multi-Project Routing**: Always pass the \`repo\` parameter to GitHub tools if your \`memory://briefing\` indicates you are in a multi-project environment.

## Structural Integrity

- **Session Summaries**: Always use \`entry_type: "retrospective"\` and tag with \`session-summary\`.
- **References**: Never guess \`entry_id\`, \`issue_number\`, or \`pr_number\`. Always query them first to avoid broken links.
- **Significance**: Only mark entries with \`significance_type\` if they are genuinely major milestones, decisions, or breakthroughs. Overusing this degrades the signal-to-noise ratio of the journal.`],
  ["hush-protocol", `# Hush Protocol (Team Flags)

Flags are machine-actionable signals stored in the team database. They replace Slack/Teams noise with structured, searchable entries that surface automatically in the briefing.

**When to create a flag** (\`team_pass_flag\` — accepts required \`flag_type\`, \`message\`, \`project_number\`, and optional \`target_user\`, \`link\`, \`issue_number\`):

- \`blocker\` — work is blocked and requires another person's action
- \`needs_review\` — code, document, or decision needs peer review
- \`help_requested\` — stuck and need guidance or pairing
- \`fyi\` — non-blocking awareness signal (completed migration, config change, etc.)

**When to resolve** (\`team_resolve_flag\`): After the blocking condition is cleared. Include a brief resolution comment describing what was done. Resolving is idempotent — safe to call on already-resolved flags.

**Querying flags** (\`team_list_flags\`): List and filter flags by \`status\` (active/resolved/all), \`flag_type\`, \`target_user\`, or \`author\`. Returns enriched flag objects with parsed metadata — no manual \`auto_context\` parsing needed. Sort by \`priority\` (blockers first) or \`timestamp\`.

**Updating flags** (\`team_update_flag\`): Modify a flag's metadata without resolving it. Use cases: escalate severity (\`fyi\` → \`blocker\`), reassign (\`target_user\`), edit message, add a link. Set \`reopen: true\` to reactivate a previously resolved flag.

**Flag analytics** (\`team_get_flag_analytics\`): Aggregate flag metrics — resolution velocity, type distribution, per-user workload, and trend comparison with the previous period.

**Briefing integration**: The \`memory://briefing\` payload includes \`activeFlags\` when unresolved flags exist. The user's agent rules may instruct you to render these prominently. Always check for and acknowledge active flags at session start.

**Dashboard**: Read \`memory://flags\` to see all active (unresolved) flags. Read \`memory://flags/history\` for recently resolved flags with resolution details. Read \`memory://flags/vocabulary\` to see the configured flag types. Clients can also subscribe to \`memory://flags\` using MCP \`resources/subscribe\` to receive real-time notifications when flags change (requires \`team\` scope).

**Triage prompt**: Use the \`flag-dashboard\` prompt to triage active flags with priority assessment, staleness detection, analytics summary, and resolution guidance.

**Code Mode**:

- \`mj.team.passTeamFlag({ project_number: 1, flag_type, message, target_user })\`
- \`mj.team.resolveTeamFlag({ flag_id })\`
- \`mj.team.teamListFlags({ status: "active" })\`
- \`mj.team.teamUpdateFlag({ flag_id: 42, flag_type: "blocker" })\`
- \`mj.team.teamGetFlagAnalytics()\``],
  ["skills", `# Rule & Skill Suggestions

When you notice the user consistently applies patterns, preferences, or workflows that could be codified:

**Suggest adding a rule** when you observe:

- Naming conventions, formatting preferences, or coding standards
- Testing patterns or verification steps the user always follows
- Project-specific commands, workflows, or deployment steps
- Error handling patterns or logging conventions

**Suggest adding a skill** when you build:

- Reusable multi-step processes (e.g., deployment, release, audit workflows)
- Project-specific templates or scaffolds
- Complex integrations or tool chains the user may repeat

**Suggest refining existing rules/skills** when you notice:

- A rule conflict or ambiguity causing inconsistent behavior
- An outdated pattern that no longer matches the codebase
- Missing edge cases or exceptions to an existing rule
- A skill that could be extended with new steps

**How to act:**

- The briefing shows **Rules** and **Skills** paths — use these to locate the files
- **Always ask the user first** — never create or modify rules/skills silently
- Frame suggestions as: "I noticed you always [pattern]. Would you like me to add/update a rule for this?"
- For skills, explain the workflow it would automate and what triggers it

## Native Agent Skills (NPM Distribution)

This server leverages the \`neverinfamous-agent-skills\` package. If the user's \`SKILLS_DIR_PATH\` environment variable targets these, you have native access to skills covering TypeScript, React, Playwright, Go, Rust, Python, Docker, Tailwind CSS, shadcn/ui, security auditing, MCP server development, and DevOps workflows (\`issue-triage\`, \`pr-review\`, \`github-actions\`, \`copilot-audit\`, etc.). The \`adversarial-planner\` skill provides multi-pass plan review with structured critique stages.

- The user can distribute or update these skills across their repositories by running \`npx neverinfamous-agent-skills@latest\`.
- If you need to create a new skill, reference the bundled \`skill-builder\` instructions!`],
  ["templates", `# Content Templates

These templates define the REQUIRED structure for journal entry content by type. Do NOT invent additional top-level sections. Do NOT omit required sections.

## Session Summary (entry\\_type: "retrospective", tag: "session-summary")

\`\`\`
## Accomplished
- [Concrete item: what was done, key files/PRs/entry IDs]
- [Another concrete item]

## Unfinished / Blocked
- [Item: why it's blocked or what remains — or "None" if complete]

## Context for Next Session
- [Key context the next agent/session needs: branch names, PR numbers, entry IDs, pending decisions]
\`\`\`

Do NOT add extra top-level sections (no "## Summary", "## Overview", "## Notes").
Do NOT omit any of the three required sections.

## Feature Implementation (entry\\_type: "feature\\_implementation")

\`\`\`
## Summary
[1-2 sentence description of the feature]

## Changes
- [File/module]: [what changed]

## Testing
- [How it was tested, results]

## Notes
- [Any gotchas, follow-ups, or related entries]
\`\`\`

## Bug Fix (entry\\_type: "bug\\_fix")

\`\`\`
## Problem
[What was broken and how it manifested]

## Root Cause
[Why it happened]

## Fix
- [What was changed to fix it]

## Verification
- [How the fix was verified]
\`\`\`

## Planning (entry\\_type: "planning")

\`\`\`
## Goal
[What this plan aims to achieve]

## Approach
- [Step or phase]: [description]

## Open Questions
- [Unresolved decisions or dependencies]
\`\`\`

## Technical Note (entry\\_type: "technical\\_note")

\`\`\`
## Topic
[What this note documents]

## Details
[Technical explanation, code patterns, configuration]

## References
- [Related entries, docs, or external links]
\`\`\`

## General Rule

For any entry type not listed above, structure content with:
1. A clear \`##\` heading describing the main topic
2. Bullet points for discrete items
3. No invented sections beyond what the content actually covers`],
])

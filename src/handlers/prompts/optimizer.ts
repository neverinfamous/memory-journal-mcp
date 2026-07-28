/**
 * Memory Journal MCP Server - Optimizer Prompt Definitions
 *
 * Prompts: optimize-journal
 */

import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'
import { markUntrustedContent } from '../../utils/security-utils.js'
import { z } from 'zod'
import { coerceNumber } from '../../utils/query-helpers.js'

export function getOptimizerPromptDefinitions(): InternalPromptDef[] {
    return [
        {
            name: 'optimize-journal',
            description: 'Guided database pruning, graph verification, and multi-agent audit workflow. Optional arguments: `lookback` (Number of recent entries, default: 10), `limit` (Entry processing cap for multi-agent audit, default: 500), `project` (Target project name or number, optional), `autoRun` (boolean, default: false), `mode` (\'quick\' | \'targeted\' | \'full\', default: \'quick\'), `targetDimension` (\'unassigned\' | \'relationships\' | \'scores\' | \'tags\' | \'all\', default: \'all\').',
            icons: [ICON_PROMPT],
            arguments: [],
            handler: (args: Record<string, string> | undefined, db: IDatabaseAdapter) => {
                const schema = z.object({
                    lookback: z.preprocess(
                        coerceNumber,
                        z.number().int().min(1).max(2000).optional().default(10)
                    ),
                    limit: z.preprocess(
                        coerceNumber,
                        z.number().int().min(1).max(5000).optional().default(500)
                    ),
                    project: z.preprocess(
                        (val) => (typeof val === 'string' ? val.trim() : val),
                        z.string().optional()
                    ),
                    autoRun: z.preprocess(
                        (val) => val === 'true' || val === true,
                        z.boolean().optional().default(false)
                    ),
                    mode: z.preprocess(
                        (val) => (typeof val === 'string' ? val.toLowerCase() : val),
                        z.enum(['quick', 'targeted', 'full']).optional().default('quick')
                    ),
                    targetDimension: z.preprocess(
                        (val) => (typeof val === 'string' ? val.toLowerCase() : val),
                        z.enum(['unassigned', 'relationships', 'scores', 'tags', 'all']).optional().default('all')
                    ),
                })

                const parsed = schema.safeParse(args ?? {})
                const lookback = parsed.success ? parsed.data.lookback : 10
                const entryLimit = parsed.success ? parsed.data.limit : 500
                const targetProject = parsed.success ? parsed.data.project : undefined
                const autoRun = parsed.success ? parsed.data.autoRun : false
                const mode = parsed.success ? parsed.data.mode : 'quick'
                const targetDimension = parsed.success ? parsed.data.targetDimension : 'all'

                let statsSnippet = '_Could not fetch database statistics_'
                try {
                    interface Stats {
                        totalEntries?: unknown;
                        relationshipComplexity?: {
                            totalRelationships?: unknown;
                            avgPerEntry?: unknown;
                            density?: unknown;
                        };
                        projectBreakdown?: { name?: string; project_number: number; entry_count: number }[];
                        entriesByType?: Record<string, number>;
                        causalMetrics?: Record<string, number>;
                        significanceBreakdown?: Record<string, number>;
                        validationDistribution?: Record<string, number>;
                    }
                    const stats = db.getStatistics('week', undefined, undefined, true, '*') as Stats
                    const totalEntries = typeof stats.totalEntries === 'number' ? stats.totalEntries : 'Unknown'
                    
                    let totalRelationships: number | string = 'Unknown'
                    let avgPerEntry: number | string = 'Unknown'
                    let graphDensity = 'Unknown'
                    const rc = stats.relationshipComplexity
                    if (rc !== null && typeof rc === 'object') {
                        totalRelationships = typeof rc.totalRelationships === 'number' ? rc.totalRelationships : 'Unknown'
                        avgPerEntry = typeof rc.avgPerEntry === 'number' ? rc.avgPerEntry : 'Unknown'
                        if (typeof rc.density === 'number') {
                            graphDensity = (rc.density * 100).toFixed(2) + '%'
                        }
                    }

                    let orphanCount: number | string = 'Unknown'
                    let orphanDensity = 'Unknown'
                    try {
                        orphanCount = db.getOrphanCount('*')
                        if (typeof totalEntries === 'number' && totalEntries > 0) {
                            orphanDensity = Math.round((orphanCount / totalEntries) * 100) + '%'
                        }
                    } catch {
                        // fallback
                    }

                    let projectBreakdownText = ''
                    if (stats.projectBreakdown && Array.isArray(stats.projectBreakdown)) {
                        projectBreakdownText = '\n\n**Project Breakdown:**\n| Project Name | Project # | Entries |\n|---|---|---|\n'
                        for (const p of stats.projectBreakdown) {
                            const name = p.name || `Project ${p.project_number}`
                            projectBreakdownText += `| ${name} | ${p.project_number} | ${p.entry_count} |\n`
                        }
                    }

                    let causalMetricsText = ''
                    if (stats.causalMetrics) {
                        const ref = stats.causalMetrics['references'] ?? 0
                        const imp = stats.causalMetrics['implements'] ?? 0
                        const evo = stats.causalMetrics['evolves_from'] ?? 0
                        const res = stats.causalMetrics['resolves'] ?? 0
                        const blk = stats.causalMetrics['blocked_by'] ?? 0
                        const cau = stats.causalMetrics['caused'] ?? 0
                        causalMetricsText = `\n  - Relationship Types: ${ref} references | ${imp} implements | ${evo} evolves_from | ${res} resolves | ${blk} blocked_by | ${cau} caused`
                    }

                    let entryTypesText = ''
                    if (stats.entriesByType) {
                        const types = Object.entries(stats.entriesByType)
                            .sort((a, b) => b[1] - a[1])
                            .slice(0, 5)
                            .map(([k, v]) => `${k} (${v})`)
                            .join(', ')
                        entryTypesText = `\n- Top Entry Types: ${types}`
                    }

                    const allTags = typeof db.listTags === 'function' ? db.listTags() : []
                    const totalTags = allTags.length

                    statsSnippet = `**Global Database Health & Relationship Graph Metrics:**
- Total Entries: ${totalEntries}
- Total Unique Tags: ${totalTags}
- Active Relationship Links: ${totalRelationships} (Avg: ${avgPerEntry}/entry | Density: ${graphDensity})${causalMetricsText}${entryTypesText}
- Orphans: ${orphanCount} (${orphanDensity} density)${projectBreakdownText}`
                } catch {
                    // ignore
                }

                let unverifiedSnippet = '_No unverified entries found._'
                try {
                    const { entries } = db.getRecentEntries(50)
                    const unverified = entries.filter(e => e.validationStatus === 'none' || (e.trustScore !== undefined && e.trustScore < 0.9)).slice(0, lookback)
                    if (unverified.length > 0) {
                        unverifiedSnippet = unverified.map(e => {
                            return `ID: ${e.id} | Type: ${e.entryType} | Tags: ${e.tags.join(', ')}\nTrust: ${e.trustScore} | Impact: ${e.impactScore} | Validation: ${e.validationStatus}\nContent:\n${e.content}\n---`
                        }).join('\n')
                    }
                } catch {
                    unverifiedSnippet = '_Could not fetch unverified entries_'
                }

                const targetProjectText = targetProject ? ` | **Target Project**: \`${targetProject}\`` : ''
                const limitText = ` | **Entry Limit**: \`${entryLimit}\``
                const autoRunText = autoRun ? ` | **Auto-Run**: \`true\`` : ''

                return {
                    messages: [
                        {
                            role: 'user',
                            content: {
                                type: 'text',
                                text: `# Journal Optimizer & Verification Workflow

You are executing the guided workflow for intelligently pruning, verifying, and auditing the global memory journal database. Every operation uses soft-deletion as a safe first pass.

**Requested Mode**: \`${mode}\` | **Quality Dimension**: \`${targetDimension}\`${targetProjectText}${limitText}${autoRunText}

${statsSnippet}

## Unverified Recent Entries
${markUntrustedContent(unverifiedSnippet)}

> [!IMPORTANT]
> **AUTOMATED INITIAL EXECUTION PROTOCOL (MANDATORY)**:
> When this prompt starts, you MUST **automatically execute Option A and Option B** first without waiting for additional user instructions:
> 1. **Option A (Safety Backup & Priority Unassigned Scan)**: Immediately create a database safety backup via \`backup_journal\` and run the unassigned workspace scan across all projects (\`workspace_id: '*'\`). If any default/unassigned entries are found, auto-repair/migrate them immediately and formulate a root-cause analysis.
> 2. **Option B (Targeted Quality Dimension Scan)**: Perform a fast baseline scan of recent entries lacking relationships, trust/impact scores, or technical subsystem tags.
> 3. **Report Initial Findings**: Present the mandatory health summary, safety backup details, and unassigned status to the user.

> [!TIP]
> **INTERACTIVE HANDOVER FOR COMPREHENSIVE MULTI-AGENT DOMAIN AUDIT**:
> Upon completing the initial automated execution (Option A & B), present **Comprehensive Multi-Agent Domain Audit & Noise Pruning** to the user as an available next step.
> Explicitly inform the user that they can choose to execute it directly or customize it with natural commands, such as:
> - *"Proceed with Comprehensive Multi-Agent Domain Audit"*
> - *"Do it but only on 500 entries"*
> - *"Run Multi-Agent Audit on project mysql-mcp"*
> - *"Run Multi-Agent Audit focusing on missing relationships and noise pruning"*

---

## Standard of a Complete Entry (7 Core Quality Dimensions)
An entry is considered incomplete and worthy of auditing/enrichment if it lacks any of the following:
1. **Workspace & Project Binding (TOP PRIORITY #1)**: Explicit \`workspace_id\` and \`project_number\` matching a registered workspace (MUST NOT be \`default\` or \`0\`).
2. **Significance Classification**: \`significance_type\` (e.g., \`architectural\`, \`decision\`, \`milestone\`, \`bugfix\`, \`convention\`) and non-zero \`importance\` score (0.0 to 1.0).
3. **Trust & Validation**: \`trust_score\` (0.0 to 1.0) and non-\`none\` \`validation_status\` (\`passed\` or \`failed\`).
4. **Impact Assessment**: \`impact_score\` (0.0 to 1.0) reflecting downstream code or architecture impact.
5. **Relationships & Graph Anchors**: Inter-entry graph links (\`evolves_from\`, \`references\`, \`implements\`, \`resolves\`, \`blocked_by\`, \`caused\`).
6. **Domain & Activity Tags**: Specific, searchable tags categorizing tech stack, subsystem, and activity type.
7. **Context & Git Lineage**: \`autoContext\` commit hashes, branch info, author context, or issue/PR links.

---

## Safety Rules (MANDATORY)
1. **ZERO TOLERANCE FOR UNASSIGNED / DEFAULT ENTRIES (TOP PRIORITY #1)**: There MUST be no unassigned entries or entries assigned to 'default'. If any exist, migrate them to their proper project immediately. The agent MUST investigate why they ended up unassigned/in 'default' and include a root cause analysis and fix plan in the report.
2. **NEVER** use \`permanent: true\` unless explicitly asked to "hard delete".
3. **ALWAYS** call \`backup_journal\` before any batch delete. Abort if it fails.
4. **NEVER** delete entries with \`significance_type\` set.
5. Max batch size: 50 entries per mutation pass.
6. **Log operations**: Create a journal entry with \`entry_type: 'maintenance'\` and tag \`database-optimizer\`.
7. **Execution Scope**: Systematically process entries across registered projects in \`PROJECT_REGISTRY\` (or restricted to \`${targetProject || 'all'}\` if specified).

---

## Code Mode Inspection & Graph Dump Scripts
Do NOT use \`search_entries\` to dump the database. Use these pre-optimized Code Mode scripts in \`mj_execute_code\` for fast, sandboxed execution:

### 1. Scan for Unassigned / Default Workspace Entries (Automated Option A)
\`\`\`javascript
const unassigned = [];
let cursor = undefined;
let processed = 0;

while (processed < 500) {
  const res = await mj.core.getRecentEntries({ limit: 50, cursor, workspace_id: '*' });
  if (!res.entries || res.entries.length === 0) break;
  
  for (const entry of res.entries) {
    if (!entry.projectNumber || entry.projectNumber === 0 || entry.workspaceId === 'default' || !entry.projectName) {
      unassigned.push({ id: entry.id, type: entry.entryType, workspace: entry.workspaceId, project: entry.projectNumber, snippet: entry.content ? entry.content.slice(0, 100) : '' });
    }
  }
  
  processed += res.entries.length;
  if (!res.hasMore) break;
  cursor = res.next_cursor;
}
return unassigned;
\`\`\`

### 2. Inspect Full Relationship Graph Structure for a Project Domain
\`\`\`javascript
const entries = await mj.core.getRecentEntries({ limit: 100, workspace_id: '*' });
const graph = [];

for (const entry of (entries.entries || [])) {
  const full = await mj.core.getEntryById({ id: entry.id });
  if (full.success && full.relationships && full.relationships.length > 0) {
    graph.push({
      id: entry.id,
      title: entry.title,
      project: entry.projectName,
      relationships: full.relationships.map(r => ({ toId: r.toId, type: r.relationshipType }))
    });
  }
}
return graph;
\`\`\`

---

## Workflow Execution Options

### Option A: Quick Health & Priority Workspace Unassigned Audit (Executed Automatically)
1. **Safety Backup**: Call \`backup_journal\` before any mutations. Abort if backup creation fails.
2. **Priority Zero-Tolerance Unassigned & Default Scan & Auto-Repair**:
   - Run the Unassigned Scan script across all workspaces (\`workspace_id: '*'\`).
   - Auto-repair entries: if an entry belongs to \`workspaceId: 'default'\` and has \`projectNumber\` deterministically matching a registered project, migrate it immediately using \`mj.admin.updateEntry({ entry_id: id, target_workspace_id: correctWorkspace, workspace_id: '*' })\`.
   - **Root-Cause Investigation**: Investigate why any unassigned/default entries bypass project assignment. Formulate a remediation plan.

### Option B: Targeted Quality Dimension Audit (Executed Automatically)
1. Filter database entries by the requested target dimension (\`${targetDimension}\`):
   - \`unassigned\`: Audit only unassigned or default workspace entries.
   - \`relationships\`: Audit only orphan entries lacking graph anchors.
   - \`scores\`: Audit only entries with \`trust_score < 0.9\` or unrated \`impact_score\`.
   - \`tags\`: Audit entries with generic or empty tag arrays.
2. Process entries in batches of 30–50, updating metadata via Code Mode.

### Comprehensive Multi-Agent Domain Audit & Noise Pruning (Presented to User for Choice)
1. **Domain-Based Subagent Partitioning**: Partition entries by **Project Workspace Domain** (or focus exclusively on \`${targetProject || 'all projects'}\` capped at \`${entryLimit}\` entries). Domain partitioning preserves contextual coherence across commit narratives, retrospectives, and technical subsystem tags.
2. **Full Content & 5-Dimension Single-Pass Optimization & Noise Pruning**:
   - Instruct subagents to read entries in full and optimize all core entry dimensions while pruning noise simultaneously:
     - 🔗 **Graph Anchors**: Link related entries via Code Mode (\`mj.linkEntries({ from_id, to_id, relationship_type, workspace_id })\`) using valid relationship types (\`references\`, \`implements\`, \`evolves_from\`, \`resolves\`, \`blocked_by\`, \`caused\`).
     - 🛡️ **Trust Calibration**: Normalize trust scores (\`trust_score\` between \`0.90\`–\`1.00\` for verified code/tests).
     - 💥 **Impact Calibration**: Calibrate impact scores (\`impact_score\` between \`0.30\`–\`0.80\` based on blast radius).
     - 🏷️ **Tag Enrichment & Significance**: Assign explicit \`significance_type\` and enrich empty/generic tag lists with technical subsystem keywords.
     - 🧹 **Noise Pruning & Soft-Deletion**: Identify zero-value entries, obsolete transient debug notes, or duplicate test artifacts lacking significance (\`baseScore <= 0\`, no \`significance_type\`) and perform safe soft-deletions using Code Mode (\`mj.admin.deleteEntry({ entry_id, workspace_id })\`).
3. **Subagent Batch Parallelization**:
   - Delegate domain project workloads to parallel subagents using high-reasoning models (e.g., Gemini 3.1 Pro / \`pro\` model).
   - **Strict Isolation**: Subagents MUST NEVER write files to project directories; all scratch files must be saved in \`<appDataDir>\\\\brain\\\\<conversation-id>\\\\scratch\\\\\`.
4. **Parent Agent Resource Reclamation Guarantee**:
   - The parent agent MUST actively monitor subagent completion notifications.
   - As soon as each subagent reports completion, the parent agent MUST immediately terminate it using \`manage_subagents\` with \`Action: 'kill'\` and its \`ConversationId\` to free system resources.

---

## Mandatory Report Structure
Every execution report MUST follow this exact 4-part Markdown layout:
1. **Global Database Health & Resource Metrics**: Summary of total entries, unique tags, active relationships & avg density, relationship types breakdown, orphan count & %, and DB/Vector Index health.
2. **Project & Workspace Matrix Table**: A complete table listing entry counts and unassigned status across ALL registered projects (Note: Retrieve project breakdown via \`mj.analytics.getStatistics({ workspace_id: '*' })\` or query \`getRecentEntries({ workspace_id: project.workspaceId })\` per explicit workspace to avoid wildcard limit caps):
   | Project Name | Project # | Total Entries | Unassigned / Default | Status |
3. **Unassigned / Default Workspace Investigation & Fix Plan**:
   - Details of any migrated entries.
   - Root cause analysis explaining how the misallocation occurred.
   - Actionable fix plan / task recommendations to prevent future occurrences (or "Zero unassigned entries found" if clear).
4. **Optimization Actions & Next Steps**: Safety backup filename, enriched entries count, soft-deleted debug/test noise count, maintenance journal entry ID, and clear instructions for initiating the Comprehensive Multi-Agent Domain Audit & Noise Pruning.
`,
                            },
                        },
                    ],
                }
            },
        },
    ]
}

/**
 * Briefing — User Message Formatter
 *
 * Formats the briefing as a hybrid markdown layout:
 * - Table rows for dense groups (GitHub, Journal, System) — compresses
 *   data points using `<br>` and `·` separators for human readability.
 * - Flat lines for metrics/analytics — emoji-heavy content reads better
 *   as standalone lines.
 */

import {
    assembleBriefingTable,
    buildConfigLines,
    buildFlagsAlert,
    buildGitHistoryLines,
    buildGithubParts,
    buildGraphLines,
    buildInsightsLines,
    buildJournalParts,
    buildTrackingParts,
    formatCiDisplay,
    type BriefingUserMessageOptions,
} from './user-message-sections.js'

export type { BriefingUserMessageOptions }

/**
 * Build the user-facing markdown output for the briefing.
 */
export function formatUserMessage(opts: BriefingUserMessageOptions): string {
    const ciDisplay = formatCiDisplay(opts)
    const table = assembleBriefingTable({
        githubParts: buildGithubParts(opts, ciDisplay),
        trackingParts: buildTrackingParts(opts.github),
        journalParts: buildJournalParts(opts),
        configLines: buildConfigLines(opts),
        insightsLines: buildInsightsLines(opts),
        graphLines: buildGraphLines(opts.graphSummary, {
            ...(opts.graphPivots !== undefined ? { graphPivots: opts.graphPivots } : {}),
            ...(opts.toolNaming !== undefined ? { toolNaming: opts.toolNaming } : {}),
            ...(opts.toolHints?.expand !== undefined
                ? { expandToolHint: opts.toolHints.expand }
                : {}),
            ...(opts.workspaceId !== undefined ? { workspaceId: opts.workspaceId } : {}),
            ...(opts.analyticsInsights?.relationshipDensity !== undefined
                ? { relationshipDensity: opts.analyticsInsights.relationshipDensity }
                : {}),
        }),
        gitHistoryLines: buildGitHistoryLines(opts),
    })
    const footer = `\n\n> **Directive:** Context ingested. Await explicit user instruction before execution.`
    return `${buildFlagsAlert(opts)}${table}${footer}`
}

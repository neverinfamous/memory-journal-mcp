import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import { parseDigestSnapshot } from '../../database/sqlite-adapter/entries/digest.js'
import { ICON_PROMPT } from '../../constants/icons.js'
import type { InternalPromptDef } from './index.js'
import { resourceWorkspace, sliceUntrustedInline, type BriefingConfig } from '../resources/shared.js'

/**
 * Build a concise analytics signal string for injection into standup/retro prompts.
 * Returns empty string when no digest is available (graceful degradation).
 */
export function buildDigestSignalForPrompt(db: IDatabaseAdapter, workspaceId?: string): string {
    const snapshot = db.getLatestAnalyticsSnapshot?.('digest', workspaceId)
    if (!snapshot) return ''

    const parsed = parseDigestSnapshot(snapshot.data)
    if (parsed === null) return ''
    const lines: string[] = ['[Analytics Context]']

    // Activity trend
    const growth = parsed.activityGrowthPercent
    if (growth !== null) {
        const sign = growth >= 0 ? '+' : ''
        lines.push(
            `Activity: ${sign}${String(growth)}% vs. last period (${String(parsed.currentPeriodEntries)} entries)`
        )
    }

    // Significance spike
    const sigMultiplier = parsed.significanceMultiplier
    if (sigMultiplier !== null && sigMultiplier > 1.5) {
        lines.push(
            `Significance: ${String(parsed.currentPeriodSignificant)} significant entries (${String(sigMultiplier)}× historical avg)`
        )
    }

    // Stale projects
    if (parsed.staleProjects.length > 0) {
        const staleStr = parsed.staleProjects
            .map((p) => `P${String(p.projectNumber)} (${String(p.daysSilent)}d silent)`)
            .join(', ')
        lines.push(`⚠ Stale: ${staleStr}`)
    }

    // Only return if we have actual signals beyond the header
    if (lines.length <= 1) return ''
    return lines.join('\n') + '\n\n'
}

function buildDigestAnalyticsPrompt(spec: {
    name: string
    description: string
    headline: string
    summaryTask: string
}): InternalPromptDef {
    return {
        name: spec.name,
        description: spec.description,
        icons: [ICON_PROMPT],
        handler: (
            _args: Record<string, string> | undefined,
            db: IDatabaseAdapter,
            _teamDb?: IDatabaseAdapter,
            _github?: unknown,
            briefingConfig?: Partial<BriefingConfig>,
            runtime?: object | null
        ) => {
            const digestSignal = buildDigestSignalForPrompt(
                db,
                resourceWorkspace({
                    briefingConfig,
                    ...(runtime !== undefined ? { runtime } : {}),
                })
            )

            return {
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `${digestSignal}${spec.headline}\n${spec.summaryTask}\n\nTo complete this task, you MUST first fetch the relevant entries using \`search_by_date_range\` or read \`memory://recent\`. Do not hallucinate entries.`,
                        },
                    },
                ],
            }
        },
    }
}

function buildGoalTrackerPrompt(): InternalPromptDef {
    return {
        name: 'goal-tracker',
        description: 'Milestone and achievement tracking',
        icons: [ICON_PROMPT],
        handler: (
            _args: Record<string, string> | undefined,
            db: IDatabaseAdapter,
            _teamDb?: IDatabaseAdapter,
            _github?: unknown,
            briefingConfig?: Partial<BriefingConfig>,
            runtime?: object | null
        ) => {
            const entries = db.getSignificantEntries(
                20,
                undefined,
                resourceWorkspace({
                    briefingConfig,
                    ...(runtime !== undefined ? { runtime } : {}),
                })
            )

            const mappedEntries = entries.map((e) => ({
                id: e.id,
                type: e.entryType,
                timestamp: e.timestamp,
                content: sliceUntrustedInline(e.content, 250, '...'),
            }))

            return {
                messages: [
                    {
                        role: 'user',
                        content: {
                            type: 'text',
                            text: `Track goals and milestones based on significant entries.\nSummarize progress toward goals and highlight achievements.\n\nSources:\n${JSON.stringify(mappedEntries, null, 2)}`,
                        },
                    },
                ],
            }
        },
    }
}

/**
 * Get analytical workflow prompt definitions
 */
export function getAnalyticsPromptDefinitions(): InternalPromptDef[] {
    return [
        buildDigestAnalyticsPrompt({
            name: 'prepare-standup',
            description: 'Prepare a daily standup summary (Yesterday, Today, Blockers)',
            headline: 'Execute a standup analysis.',
            summaryTask: 'Prepare a daily standup summary (Yesterday, Today, Blockers).',
        }),
        buildDigestAnalyticsPrompt({
            name: 'prepare-retro',
            description:
                'Prepare a sprint retrospective (What went well, What could improve, Action items)',
            headline: 'Execute a retro analysis.',
            summaryTask:
                'Prepare a sprint retrospective (What went well, What could improve, Action items).',
        }),
        buildDigestAnalyticsPrompt({
            name: 'weekly-digest',
            description: 'Create a weekly digest formatted day-by-day',
            headline: 'Execute a weekly digest analysis.',
            summaryTask: 'Create a weekly digest formatted day-by-day.',
        }),
        buildGoalTrackerPrompt(),
    ]
}

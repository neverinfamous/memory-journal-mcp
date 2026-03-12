import type { ResourceContext } from '../../shared.js'
import type { TeamBriefingContext } from './types.js'

export function getTeamContext(
    context: ResourceContext,
    config: NonNullable<ResourceContext['briefingConfig']>
): TeamBriefingContext {
    if (!context.teamDb) return {}

    try {
        const teamStats = context.teamDb.getStatistics('week')
        const teamRecent = context.teamDb.getRecentEntries(1)
        const teamLatestEntry = teamRecent[0] as Record<string, unknown> | undefined
        const teamContent = teamLatestEntry ? ((teamLatestEntry['content'] as string | undefined) ?? '') : ''
        const teamLatest = teamLatestEntry
            ? `#${String(teamLatestEntry['id'])}: ${teamContent.slice(0, 60)}${teamContent.length > 60 ? '...' : ''}`
            : null

        const teamContext = {
            totalEntries: (teamStats as { totalEntries?: number }).totalEntries ?? 0,
            latestPreview: teamLatest,
        }

        if (config.includeTeam) {
            const teamEntries = context.teamDb.getRecentEntries(config.entryCount)
            const teamLatestEntries = teamEntries.map((e) => {
                const content = e.content ?? ''
                return {
                    id: e.id,
                    timestamp: e.timestamp,
                    type: e.entryType,
                    preview: content.slice(0, 80) + (content.length > 80 ? '...' : ''),
                }
            })
            return { teamContext, teamLatestEntries }
        }

        return { teamContext }
    } catch {
        // Team DB unavailable
        return {}
    }
}

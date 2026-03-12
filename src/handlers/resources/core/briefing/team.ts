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
        const teamLatest = teamRecent[0]
            ? `#${teamRecent[0].id}: ${teamRecent[0].content.slice(0, 60)}${teamRecent[0].content.length > 60 ? '...' : ''}`
            : null

        const teamContext = {
            totalEntries: teamStats.totalEntries ?? 0,
            latestPreview: teamLatest,
        }

        if (config.includeTeam) {
            const teamEntries = context.teamDb.getRecentEntries(config.entryCount)
            const teamLatestEntries = teamEntries.map((e) => ({
                id: e.id,
                timestamp: e.timestamp,
                type: e.entryType,
                preview: e.content.slice(0, 80) + (e.content.length > 80 ? '...' : ''),
            }))
            return { teamContext, teamLatestEntries }
        }

        return { teamContext }
    } catch {
        // Team DB unavailable
        return {}
    }
}

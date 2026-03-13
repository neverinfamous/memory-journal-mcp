/**
 * Briefing — Context Section Builders
 *
 * Builds the journal, team, rules-file, and skills-directory
 * context sections for the briefing resource.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type { BriefingConfig, ResourceContext } from '../../shared.js'
import { logger } from '../../../../utils/logger.js'

// ============================================================================
// Journal Context
// ============================================================================

/** Content preview length for briefing entry summaries */
const PREVIEW_LENGTH = 80

export interface JournalContext {
    totalEntries: number
    latestEntries: { id: number; timestamp: string; type: string; preview: string }[]
    lastModified: string
}

export function buildJournalContext(context: ResourceContext, config: BriefingConfig): JournalContext {
    const recentEntries = context.db.getRecentEntries(config.entryCount)
    const latestEntries = recentEntries.map((e) => {
        const content = e.content ?? ''
        return {
            id: e.id,
            timestamp: e.timestamp,
            type: e.entryType,
            preview:
                content.slice(0, PREVIEW_LENGTH) + (content.length > PREVIEW_LENGTH ? '...' : ''),
        }
    })

    const totalEntries = context.db.getActiveEntryCount()
    const lastModified = recentEntries[0]?.timestamp ?? new Date().toISOString()

    return { totalEntries, latestEntries, lastModified }
}

// ============================================================================
// Team Context
// ============================================================================

/** Team DB preview length */
const TEAM_PREVIEW_LENGTH = 60

export interface TeamContext {
    teamInfo: { totalEntries: number; latestPreview: string | null }
    teamLatestEntries?: { id: number; timestamp: string; type: string; preview: string }[]
}

export function buildTeamContext(
    context: ResourceContext,
    config: BriefingConfig
): TeamContext | undefined {
    if (!context.teamDb) return undefined

    try {
        const teamTotalEntries = context.teamDb.getActiveEntryCount()
        const teamRecent = context.teamDb.getRecentEntries(1)
        const teamLatestEntry = teamRecent[0] as Record<string, unknown> | undefined
        const teamContent = teamLatestEntry
            ? ((teamLatestEntry['content'] as string | undefined) ?? '')
            : ''
        const teamLatest = teamLatestEntry
            ? `#${String(teamLatestEntry['id'])}: ${teamContent.slice(0, TEAM_PREVIEW_LENGTH)}${teamContent.length > TEAM_PREVIEW_LENGTH ? '...' : ''}`
            : null
        const teamInfo = {
            totalEntries: teamTotalEntries,
            latestPreview: teamLatest,
        }

        let teamLatestEntries:
            | { id: number; timestamp: string; type: string; preview: string }[]
            | undefined = undefined

        if (config.includeTeam) {
            const teamEntries = context.teamDb.getRecentEntries(config.entryCount)
            teamLatestEntries = teamEntries.map((e) => {
                const content = e.content ?? ''
                return {
                    id: e.id,
                    timestamp: e.timestamp,
                    type: e.entryType,
                    preview:
                        content.slice(0, PREVIEW_LENGTH) +
                        (content.length > PREVIEW_LENGTH ? '...' : ''),
                }
            })
        }

        return { teamInfo, teamLatestEntries }
    } catch (error) {
        logger.debug('Failed to build team context', { module: 'BRIEFING', operation: 'team-context', error: error instanceof Error ? error.message : String(error) })
        return undefined
    }
}

// ============================================================================
// Rules & Skills Awareness
// ============================================================================

export interface RulesFile {
    path: string
    name: string
    sizeKB: number
    lastModified: string
}

export interface SkillsDir {
    path: string
    count: number
    names: string[]
}

/** Milliseconds per hour / per day for age formatting */
const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000

export function buildRulesFileInfo(rulesFilePath: string | undefined): RulesFile | undefined {
    if (!rulesFilePath) return undefined

    try {
        const stat = fs.statSync(rulesFilePath)
        const ageMs = Date.now() - stat.mtimeMs
        const ageHours = Math.floor(ageMs / MS_PER_HOUR)
        const ageDays = Math.floor(ageMs / MS_PER_DAY)
        const agoStr =
            ageDays > 0
                ? `${String(ageDays)}d ago`
                : ageHours > 0
                  ? `${String(ageHours)}h ago`
                  : 'just now'

        return {
            path: rulesFilePath,
            name: path.basename(rulesFilePath),
            sizeKB: Math.round(stat.size / 1024),
            lastModified: agoStr,
        }
    } catch (error) {
        logger.debug('Failed to read rules file', { module: 'BRIEFING', operation: 'rules-file', error: error instanceof Error ? error.message : String(error) })
        return undefined
    }
}

export function buildSkillsDirInfo(skillsDirPath: string | undefined): SkillsDir | undefined {
    if (!skillsDirPath) return undefined

    try {
        const entries = fs.readdirSync(skillsDirPath, { withFileTypes: true })
        const skillDirs = entries.filter((e) => e.isDirectory())
        return {
            path: skillsDirPath,
            count: skillDirs.length,
            names: skillDirs.map((d) => d.name),
        }
    } catch (error) {
        logger.debug('Failed to read skills directory', { module: 'BRIEFING', operation: 'skills-dir', error: error instanceof Error ? error.message : String(error) })
        return undefined
    }
}

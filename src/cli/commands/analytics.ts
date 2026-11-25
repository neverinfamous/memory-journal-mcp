import type { Command } from 'commander'
import { type z } from 'zod'
import { analyticsOptionsSchema } from '../schemas.js'
import { formatCliError, writeCliResult } from './cli-output.js'
import { getCliCommandDb as getDb, resolveCliReadScope } from './db-helper.js'

export const analyticsSchema = analyticsOptionsSchema

export async function analyticsStatsAction(options: z.infer<typeof analyticsSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    let failed = false
    try {
        const { workspaceId, projectNumber } = resolveCliReadScope(db, serverOptions, options)
        const result = db.getStatistics(
            undefined,
            undefined,
            undefined,
            undefined,
            workspaceId,
            projectNumber
        )
        writeCliResult(result, options.json, 'Statistics ready.')
    } catch (e) {
        failed = true
        process.stderr.write(`Analytics stats failed: ${formatCliError(e)}\n`)
    } finally {
        db.close()
    }
    if (failed) {
        process.exit(1)
    }
}

export async function analyticsInsightsAction(options: z.infer<typeof analyticsSchema>, command: Command): Promise<void> {
    const { db, serverOptions } = await getDb(options, command)
    let failed = false
    try {
        const { workspaceId, projectNumber } = resolveCliReadScope(db, serverOptions, options)
        const result = db.getCrossProjectInsights({
            minEntries: 1,
            inactiveThresholdDays: 30,
            ...(workspaceId !== undefined ? { workspaceId } : {}),
            ...(projectNumber !== undefined ? { projectNumber } : {}),
        })
        writeCliResult(result, options.json, 'Insights ready.')
    } catch (e) {
        failed = true
        process.stderr.write(`Analytics insights failed: ${formatCliError(e)}\n`)
    } finally {
        db.close()
    }
    if (failed) {
        process.exit(1)
    }
}

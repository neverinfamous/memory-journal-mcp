import type { DigestSnapshot } from '../database/sqlite-adapter/entries/digest.js'
import { logger } from '../utils/logger.js'

export interface ReportDeliveryOptions {
    webhookUrl: string
    webhookAuth?: string
    contentType?: 'slack' | 'discord' | 'json'
}

/**
 * Format a DigestSnapshot into a human-readable Markdown report.
 */
export function formatDigestReport(snapshot: DigestSnapshot, serverVersion: string): string {
    const lines: string[] = []

    lines.push(`# Memory Journal Digest`)
    lines.push(`_Computed at: ${snapshot.computedAt} (v${serverVersion})_`)
    lines.push('')

    // Activity
    lines.push(`## Activity Trend`)
    const currentActivity = snapshot.currentPeriodEntries
    const growth = snapshot.activityGrowthPercent
    const growthStr = growth !== null ? `(${growth >= 0 ? '+' : ''}${String(growth)}% vs last period)` : '(baseline period)'
    lines.push(`- **Entries this period**: ${String(currentActivity)} ${growthStr}`)
    lines.push('')

    // Significance
    if (snapshot.currentPeriodSignificant > 0) {
        lines.push(`## Significance Highlights`)
        const mult = snapshot.significanceMultiplier
        const multStr = mult !== null ? `(${String(mult)}× historical average)` : ''
        lines.push(`- **Significant entries**: ${String(snapshot.currentPeriodSignificant)} ${multStr}`)
        lines.push('')
    }

    // Stale Projects
    if (snapshot.staleProjects.length > 0) {
        lines.push(`## ⚠ Stale Projects`)
        for (const stale of snapshot.staleProjects) {
            lines.push(`- Project P${String(stale.projectNumber)}: ${String(stale.daysSilent)} days silent (Last entry: ${stale.lastEntryDate.split('T')[0]})`)
        }
        lines.push('')
    }

    // Top Importance
    if (snapshot.topImportanceEntries.length > 0) {
        lines.push(`## Top Importance Entries`)
        for (const entry of snapshot.topImportanceEntries) {
            const preview = entry.preview.replace(/\n/g, ' ').trim()
            lines.push(`- **#${String(entry.id)}** [Score: ${String(entry.score)}]: ${preview}...`)
        }
    }

    return lines.join('\n')
}

/**
 * Deliver a Markdown report to a webhook via HTTP POST.
 */
export async function deliverReport(report: string, snapshot: DigestSnapshot, options: ReportDeliveryOptions): Promise<boolean> {
    const { webhookUrl, webhookAuth, contentType = 'slack' } = options

    let bodyPayload: string
    if (contentType === 'discord') {
        bodyPayload = JSON.stringify({ content: report })
    } else if (contentType === 'json') {
        bodyPayload = JSON.stringify(snapshot)
    } else {
        // slack default
        bodyPayload = JSON.stringify({ text: report })
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json'
    }

    if (webhookAuth) {
        headers['Authorization'] = webhookAuth
    }

    const MAX_RETRIES = 1
    const RETRY_DELAY_MS = 3000
    const TIMEOUT_MS = 10000

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => { controller.abort() }, TIMEOUT_MS)

            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers,
                body: bodyPayload,
                signal: controller.signal
            })
            
            clearTimeout(timeoutId)

            if (response.ok) {
                logger.info('Digest report delivered successfully', { 
                    module: 'DigestReporter',
                    attempt,
                    contentType 
                })
                return true
            }

            // Client errors (4xx) shouldn't be retried
            if (response.status >= 400 && response.status < 500) {
                logger.error('Failed to deliver digest report (client error)', {
                    module: 'DigestReporter',
                    status: response.status,
                    statusText: response.statusText,
                    contentType
                })
                return false
            }

            throw new Error(`HTTP ${String(response.status)}: ${response.statusText}`)

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            const isAbortError = error instanceof Error && error.name === 'AbortError'
            
            if (attempt <= MAX_RETRIES) {
                logger.warning('Failed to deliver digest report, retrying...', {
                    module: 'DigestReporter',
                    attempt,
                    error: isAbortError ? 'Timeout' : errorMessage
                })
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
            } else {
                logger.error('Failed to deliver digest report after all attempts', {
                    module: 'DigestReporter',
                    error: isAbortError ? 'Timeout' : errorMessage
                })
                return false
            }
        }
    }

    return false
}

import * as dns from 'node:dns'
import * as http from 'node:http'
import * as https from 'node:https'
import { isIP } from 'node:net'
import type { DigestSnapshot } from '../database/sqlite-adapter/entries/digest.js'
import { logger } from '../utils/logger.js'
import { isPrivateOrLoopbackAddress } from '../utils/network-safety.js'
import { markUntrustedContentInline } from '../utils/security-utils.js'

const NATIVE_FETCH = globalThis.fetch

export interface ReportDeliveryOptions {
    webhookUrl: string
    webhookAuth?: string
    contentType?: 'slack' | 'discord' | 'json'
}

interface ResolvedWebhookAddress {
    address: string
    family: 4 | 6
}

interface ValidatedWebhookTarget {
    parsed: URL
    hostname: string
    resolvedAddresses: ResolvedWebhookAddress[]
}

function isBlockedWebhookIp(ip: string): boolean {
    const normalized = ip.toLowerCase()
    // IPv4-mapped IPv6 addresses are rejected outright for webhooks.
    return normalized.startsWith('::ffff:') || isPrivateOrLoopbackAddress(normalized)
}

async function resolveValidatedWebhookTarget(webhookUrl: string): Promise<ValidatedWebhookTarget> {
    let parsed: URL
    try {
        parsed = new URL(webhookUrl)
    } catch {
        throw new Error('Invalid webhook URL format')
    }

    const allowInsecureHttp = process.env['ALLOW_INSECURE_WEBHOOK_HTTP'] === 'true'
    if (parsed.protocol !== 'https:' && !(allowInsecureHttp && parsed.protocol === 'http:')) {
        throw new Error(`Disallowed webhook protocol: ${parsed.protocol} (https: required)`)
    }

    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase()
    if (
        hostname === '' ||
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal') ||
        isBlockedWebhookIp(hostname)
    ) {
        throw new Error(`Webhook hostname resolves to restricted network address: ${hostname}`)
    }

    const normalizedUrl = new URL(parsed.href)
    const literalFamily = isIP(hostname)
    if (parsed.hostname.replace(/^\[|\]$/g, '').endsWith('.')) {
        normalizedUrl.hostname = literalFamily === 6 ? `[${hostname}]` : hostname
    }

    const resolvedAddresses: ResolvedWebhookAddress[] = []
    if (literalFamily === 4 || literalFamily === 6) {
        resolvedAddresses.push({ address: hostname, family: literalFamily })
    } else if (!process.env['VITEST']) {
        const records = await dns.promises.lookup(hostname, { all: true })
        if (records.length === 0) {
            throw new Error(`Webhook DNS lookup returned no addresses for hostname: ${hostname}`)
        }
        for (const rec of records) {
            if (isBlockedWebhookIp(rec.address)) {
                throw new Error(`Webhook DNS resolved to private/loopback IP: ${rec.address}`)
            }
            const family: 4 | 6 = rec.family === 6 || rec.address.includes(':') ? 6 : 4
            resolvedAddresses.push({ address: rec.address, family })
        }
    }

    return { parsed: normalizedUrl, hostname, resolvedAddresses }
}

export async function validateWebhookUrl(webhookUrl: string): Promise<void> {
    await resolveValidatedWebhookTarget(webhookUrl)
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
            const preview = markUntrustedContentInline(
                entry.preview.replace(/\r?\n/g, ' ').trim()
            )
            lines.push(`- **#${String(entry.id)}** [Score: ${String(entry.score)}]: ${preview}...`)
        }
    }

    return lines.join('\n')
}

const WEBHOOK_MAX_RETRIES = 1
const WEBHOOK_RETRY_DELAY_MS = 3000
const WEBHOOK_TIMEOUT_MS = 10000

function buildWebhookPayloadAndHeaders(
    report: string,
    snapshot: DigestSnapshot,
    options: ReportDeliveryOptions
): { bodyPayload: string; headers: Record<string, string>; contentType: string } {
    const { webhookAuth, contentType = 'slack' } = options
    const bodyPayload =
        contentType === 'discord'
            ? JSON.stringify({ content: report })
            : contentType === 'json'
              ? JSON.stringify(snapshot)
              : JSON.stringify({ text: report })

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    }
    if (webhookAuth) {
        headers['Authorization'] = webhookAuth
    }
    return { bodyPayload, headers, contentType }
}

function isMockedGlobalFetch(): boolean {
    if (process.env['NODE_ENV'] !== 'test' && !process.env['VITEST']) {
        return false
    }
    const currentFetch: unknown = globalThis.fetch
    return (
        currentFetch !== NATIVE_FETCH ||
        (typeof currentFetch === 'function' && 'mock' in currentFetch)
    )
}

interface HttpPostResponse {
    ok: boolean
    status: number
    statusText: string
}

function sendPinnedWebhookPost(
    target: ValidatedWebhookTarget,
    headers: Record<string, string>,
    bodyPayload: string,
    signal: AbortSignal
): Promise<HttpPostResponse> {
    const primary = target.resolvedAddresses[0]
    if (primary === undefined) {
        return Promise.reject(new Error('No validated IP addresses available for webhook delivery'))
    }
    const transport = target.parsed.protocol === 'http:' ? http : https
    return new Promise((resolve, reject) => {
        let settled = false
        let onAbort = (): void => undefined
        const finishError = (err: unknown): void => {
            if (settled) return
            settled = true
            signal.removeEventListener('abort', onAbort)
            reject(err instanceof Error ? err : new Error(String(err)))
        }
        const req = transport.request(
            target.parsed,
            {
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Length': String(Buffer.byteLength(bodyPayload, 'utf8')),
                },
                lookup: (_lookupHost, opts, cb) => {
                    const wantAll =
                        typeof opts === 'object' &&
                        opts !== null &&
                        'all' in opts &&
                        opts.all === true
                    if (wantAll) {
                        cb(null, [...target.resolvedAddresses])
                        return
                    }
                    cb(null, primary.address, primary.family)
                },
            },
            (res) => {
                const status = res.statusCode ?? 0
                const statusText = res.statusMessage ?? ''
                if (status >= 300 && status < 400) {
                    res.resume()
                    finishError(new Error(`Redirect blocked for webhook (${String(status)})`))
                    return
                }
                res.resume()
                res.on('end', () => {
                    if (settled) return
                    settled = true
                    signal.removeEventListener('abort', onAbort)
                    resolve({ ok: status >= 200 && status < 300, status, statusText })
                })
                res.on('error', finishError)
            }
        )
        onAbort = (): void => {
            const abortErr = new Error('The operation was aborted')
            abortErr.name = 'AbortError'
            req.destroy()
            finishError(abortErr)
        }
        if (signal.aborted) {
            onAbort()
            return
        }
        signal.addEventListener('abort', onAbort, { once: true })
        req.on('error', finishError)
        req.write(bodyPayload)
        req.end()
    })
}

async function dispatchWebhookPost(
    target: ValidatedWebhookTarget,
    webhookUrl: string,
    headers: Record<string, string>,
    bodyPayload: string,
    signal: AbortSignal
): Promise<HttpPostResponse> {
    if (isMockedGlobalFetch() || target.resolvedAddresses.length === 0) {
        return await fetch(webhookUrl, {
            method: 'POST',
            headers,
            body: bodyPayload,
            signal,
            redirect: 'error',
        })
    }
    return await sendPinnedWebhookPost(target, headers, bodyPayload, signal)
}

async function sendWebhookAttempt(
    webhookUrl: string,
    headers: Record<string, string>,
    bodyPayload: string,
    contentType: string,
    attempt: number
): Promise<'delivered' | 'fatal' | 'retry'> {
    let target: ValidatedWebhookTarget
    try {
        target = await resolveValidatedWebhookTarget(webhookUrl)
    } catch (err: unknown) {
        logger.error('Refusing to deliver digest report to unsafe webhook URL', {
            module: 'DigestReporter',
            attempt,
            error: err instanceof Error ? err.message : String(err),
        })
        return 'fatal'
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
        controller.abort()
    }, WEBHOOK_TIMEOUT_MS)
    timeoutId.unref()
    try {
        const response = await dispatchWebhookPost(
            target, webhookUrl, headers, bodyPayload, controller.signal
        )

        if (response.ok) {
            logger.info('Digest report delivered successfully', {
                module: 'DigestReporter',
                attempt,
                contentType,
            })
            return 'delivered'
        }

        // Client errors (4xx) shouldn't be retried
        if (response.status >= 400 && response.status < 500) {
            logger.error('Failed to deliver digest report (client error)', {
                module: 'DigestReporter',
                status: response.status,
                statusText: response.statusText,
                contentType,
            })
            return 'fatal'
        }

        throw new Error(`HTTP ${String(response.status)}: ${response.statusText}`)
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const isAbortError = error instanceof Error && error.name === 'AbortError'

        if (attempt <= WEBHOOK_MAX_RETRIES) {
            logger.warning('Failed to deliver digest report, retrying...', {
                module: 'DigestReporter',
                attempt,
                error: isAbortError ? 'Timeout' : errorMessage,
            })
            await new Promise<void>((resolve) => {
                const retryTimer = setTimeout(resolve, WEBHOOK_RETRY_DELAY_MS)
                retryTimer.unref()
            })
            return 'retry'
        }
        logger.error('Failed to deliver digest report after all attempts', {
            module: 'DigestReporter',
            error: isAbortError ? 'Timeout' : errorMessage,
        })
        return 'fatal'
    } finally {
        clearTimeout(timeoutId)
    }
}

/**
 * Deliver a Markdown report to a webhook via HTTP POST.
 */
export async function deliverReport(
    report: string,
    snapshot: DigestSnapshot,
    options: ReportDeliveryOptions
): Promise<boolean> {
    const { bodyPayload, headers, contentType } = buildWebhookPayloadAndHeaders(
        report,
        snapshot,
        options
    )

    for (let attempt = 1; attempt <= WEBHOOK_MAX_RETRIES + 1; attempt++) {
        const outcome = await sendWebhookAttempt(
            options.webhookUrl,
            headers,
            bodyPayload,
            contentType,
            attempt
        )
        if (outcome === 'delivered') return true
        if (outcome === 'fatal') return false
    }

    return false
}

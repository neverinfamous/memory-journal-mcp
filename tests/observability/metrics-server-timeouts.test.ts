/**
 * Tests for src/observability/metrics-server.ts HTTP behavior & shutdown
 */

import * as http from 'node:http'
import * as net from 'node:net'
import { describe, it, expect } from 'vitest'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { startMetricsServer } from '../../src/observability/metrics-server.js'

function getFreeLoopbackPort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = net.createServer()
        probe.once('error', reject)
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address()
            const port = typeof address === 'object' && address !== null ? address.port : 0
            probe.close((err) => {
                if (err !== undefined && err !== null) {
                    reject(err)
                } else {
                    resolve(port)
                }
            })
        })
    })
}

async function httpGetOnce(
    port: number,
    reqPath: string
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    const attempt = (): Promise<{
        status: number
        headers: http.IncomingHttpHeaders
        body: string
    }> =>
        new Promise((resolve, reject) => {
            const req = http.request(
                { hostname: '127.0.0.1', port, path: reqPath, method: 'GET' },
                (res) => {
                    const chunks: Buffer[] = []
                    res.on('data', (chunk: Buffer) => chunks.push(chunk))
                    res.on('end', () => {
                        resolve({
                            status: res.statusCode ?? 0,
                            headers: res.headers,
                            body: Buffer.concat(chunks).toString('utf8'),
                        })
                    })
                }
            )
            req.once('error', reject)
            req.end()
        })

    for (let i = 0; i < 200; i++) {
        try {
            return await attempt()
        } catch (err: unknown) {
            const code =
                typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined
            if (code === 'ECONNREFUSED' && i < 199) {
                await new Promise<void>((resolve) => setImmediate(resolve))
                continue
            }
            throw err
        }
    }
    throw new Error('Metrics server did not begin listening in time')
}

describe('startMetricsServer timeouts & routing', () => {
    it('serves /metrics (200), /health (200), and /invalid (404), then shuts down cleanly', async () => {
        const runtime = new ServerRuntime()
        runtime.metrics.recordResourceRead('memory://briefing/adamic?pin_session=false')
        const port = await getFreeLoopbackPort()
        const stop = startMetricsServer(runtime, port)

        try {
            const metricsRes = await httpGetOnce(port, '/metrics')
            expect(metricsRes.status).toBe(200)
            expect(metricsRes.headers['content-type']).toBe('text/plain; version=0.0.4; charset=utf-8')
            expect(metricsRes.body).toContain(
                'mcp_resource_reads_total{resource="memory://briefing/adamic"} 1'
            )

            const invalidRes = await httpGetOnce(port, '/invalid')
            expect(invalidRes.status).toBe(404)

            const healthRes = await httpGetOnce(port, '/health')
            expect(healthRes.status).toBe(200)
            expect(JSON.parse(healthRes.body)).toEqual({ status: 'ok' })
        } finally {
            await stop()
        }
    })
})

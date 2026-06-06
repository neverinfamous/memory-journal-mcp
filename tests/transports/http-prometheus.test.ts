import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handlePrometheusMetrics } from '../../src/transports/http/handlers.js'
import { ServerRuntime } from '../../src/utils/maintenance-lock.js'
import { MetricsAccumulator } from '../../src/observability/metrics.js'
import { Request, Response } from 'express'

vi.mock('../../src/observability/prometheus-formatter.js', () => ({
    formatPrometheusMetrics: vi.fn().mockReturnValue('mock_prometheus_data'),
}))

describe('handlePrometheusMetrics', () => {
    let mockRuntime: Partial<ServerRuntime>
    let mockMetrics: MetricsAccumulator
    let req: Partial<Request>
    let res: Partial<Response>

    beforeEach(() => {
        mockMetrics = new MetricsAccumulator()
        mockRuntime = {
            metrics: mockMetrics,
        }
        
        req = {}
        res = {
            set: vi.fn(),
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
        } as unknown as Partial<Response>
    })

    it('returns formatted metrics with correct headers', () => {
        const handler = handlePrometheusMetrics(mockRuntime as ServerRuntime)
        
        handler(req as Request, res as Response)

        expect(res.set).toHaveBeenCalledWith('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
        expect(res.status).toHaveBeenCalledWith(200)
        expect(res.send).toHaveBeenCalledWith('mock_prometheus_data')
    })
})

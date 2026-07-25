import * as http from 'node:http';
import { logger } from '../utils/logger.js';
import type { ServerRuntime } from '../utils/maintenance-lock.js';
import { formatPrometheusMetrics } from './prometheus-formatter.js';

export function startMetricsServer(runtime: ServerRuntime): () => Promise<void> {
    const portStr = process.env['MJ_METRICS_PORT'];
    const port = portStr ? parseInt(portStr, 10) : 9465;

    const server = http.createServer((req, res) => {
        if (req.url === '/metrics' && req.method === 'GET') {
            try {
                const metrics = formatPrometheusMetrics(runtime.metrics);
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end(metrics);
            } catch (error) {
                logger.error('Failed to generate metrics', { error: error instanceof Error ? error.message : String(error) });
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal Server Error');
            }
        } else if (req.url === '/health' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
        }
    });

    server.on('error', (error: any) => {
        if (error?.code === 'EADDRINUSE') {
            logger.warning(`Metrics server port ${port} is already in use; standalone metrics server disabled for this instance`, { module: 'MetricsServer' });
        } else {
            logger.error('Metrics server error', { error: error instanceof Error ? error.message : String(error), module: 'MetricsServer' });
        }
    });

    server.listen(port, '0.0.0.0', () => {
        logger.info(`Standalone metrics server listening on port ${port}`, { module: 'MetricsServer' });
    });

    return () => {
        return new Promise<void>((resolve, reject) => {
            server.close((err) => {
                if (err) {
                    logger.error('Failed to close metrics server', { error: err.message, module: 'MetricsServer' });
                    reject(err);
                } else {
                    logger.info('Metrics server closed', { module: 'MetricsServer' });
                    resolve();
                }
            });
        });
    };
}

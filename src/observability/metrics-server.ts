import { timingSafeEqual } from 'node:crypto';
import * as http from 'node:http';
import { logger } from '../utils/logger.js';
import type { ServerRuntime } from '../utils/maintenance-lock.js';
import { formatPrometheusMetrics } from './prometheus-formatter.js';

export interface MetricsServerOptions {
    authToken?: string | undefined;
}

function parseMetricsPort(metricsPort: number | undefined): number {
    if (metricsPort !== undefined) {
        if (!Number.isInteger(metricsPort) || metricsPort < 0 || metricsPort > 65535) {
            throw new RangeError(
                `Invalid metrics port: ${String(metricsPort)} (expected integer 0..65535)`
            );
        }
        return metricsPort;
    }
    const portStr = process.env['MJ_METRICS_PORT'];
    if (portStr === undefined || portStr.trim() === '') return 9465;
    const trimmed = portStr.trim();
    if (!/^\d+$/.test(trimmed)) {
        throw new RangeError(`Invalid MJ_METRICS_PORT: '${portStr}' (expected integer 0..65535)`);
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        throw new RangeError(`Invalid MJ_METRICS_PORT: ${parsed} (expected integer 0..65535)`);
    }
    return parsed;
}

function isLoopbackHostHeader(hostHeader: string | string[] | undefined): boolean {
    if (hostHeader === undefined) return true;
    if (Array.isArray(hostHeader)) return false;
    const trimmed = hostHeader.trim().toLowerCase();
    if (trimmed.length === 0) return false;
    if (trimmed.startsWith('[')) {
        const closeIdx = trimmed.indexOf(']');
        if (closeIdx === -1) return false;
        const hostPart = trimmed.slice(1, closeIdx);
        const rest = trimmed.slice(closeIdx + 1);
        if (rest !== '' && !/^:\d+$/.test(rest)) return false;
        return hostPart === '::1';
    }
    if (trimmed === '::1') return true;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx !== -1) {
        const hostPart = trimmed.slice(0, colonIdx);
        const portPart = trimmed.slice(colonIdx + 1);
        if (!/^\d+$/.test(portPart)) return false;
        return hostPart === 'localhost' || hostPart === '127.0.0.1';
    }
    return trimmed === 'localhost' || trimmed === '127.0.0.1';
}

function isValidBearerToken(
    authHeader: string | string[] | undefined,
    expectedToken: string
): boolean {
    if (typeof authHeader !== 'string') return false;
    const spaceIdx = authHeader.indexOf(' ');
    if (spaceIdx === -1) return false;
    const scheme = authHeader.slice(0, spaceIdx).toLowerCase();
    if (scheme !== 'bearer') return false;
    const provided = Buffer.from(authHeader.slice(spaceIdx + 1), 'utf8');
    const expected = Buffer.from(expectedToken, 'utf8');
    return provided.length === expected.length && timingSafeEqual(expected, provided);
}

export function startMetricsServer(
    runtime: ServerRuntime,
    metricsPort?: number,
    options?: MetricsServerOptions
): () => Promise<void> {
    const port = parseMetricsPort(metricsPort);
    const authToken =
        typeof options?.authToken === 'string' && options.authToken.length > 0
            ? options.authToken
            : undefined;

    const server = http.createServer((req, res) => {
        if (!isLoopbackHostHeader(req.headers.host)) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Forbidden');
            return;
        }
        if (req.url === '/metrics' && req.method === 'GET') {
            if (authToken !== undefined && !isValidBearerToken(req.headers.authorization, authToken)) {
                res.writeHead(401, {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'WWW-Authenticate': 'Bearer',
                });
                res.end('Unauthorized');
                return;
            }
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

    server.on('error', (error: unknown) => {
        const err = error as { code?: string } | null | undefined;
        if (typeof err === 'object' && err !== null && err.code === 'EADDRINUSE') {
            logger.warning(`Metrics server port ${port} is already in use; standalone metrics server disabled for this instance`, { module: 'MetricsServer' });
        } else {
            logger.error('Metrics server error', { error: error instanceof Error ? error.message : String(error), module: 'MetricsServer' });
        }
    });

    const rawHost = process.env['MJ_METRICS_HOST']?.trim();
    const host = rawHost !== undefined && rawHost !== '' ? rawHost : '127.0.0.1';
    server.listen(port, host, () => {
        logger.info(`Standalone metrics server listening on ${host}:${port}`, { module: 'MetricsServer' });
    });

    return () => {
        return new Promise<void>((resolve, reject) => {
            if (!server.listening) {
                resolve();
                return;
            }
            server.closeAllConnections();
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

import { createHash, timingSafeEqual } from 'node:crypto';
import * as http from 'node:http';
import { hasScope, SCOPES } from '../auth/scopes.js';
import { logger } from '../utils/logger.js';
import { isPlaceholderAuthToken } from '../utils/security-utils.js';
import { getErrnoCode } from '../utils/type-guards.js';
import type { ServerRuntime } from '../utils/maintenance-lock.js';
import { formatPrometheusMetrics } from './prometheus-formatter.js';

export interface MetricsServerOptions {
    authToken?: string | undefined;
    authScopes?: readonly string[] | undefined;
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
    if (trimmed !== '0' && !/^[1-9]\d*$/.test(trimmed)) {
        throw new RangeError(`Invalid MJ_METRICS_PORT: '${portStr}' (expected integer 0..65535)`);
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        throw new RangeError(`Invalid MJ_METRICS_PORT: ${parsed} (expected integer 0..65535)`);
    }
    return parsed;
}

function isLoopbackBindHost(host: string): boolean {
    const h = host.trim().toLowerCase();
    return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
}

function isWildcardBindHost(host: string): boolean {
    const h = host.trim().toLowerCase();
    return h === '0.0.0.0' || h === '::' || h === '[::]';
}

function extractHostWithoutPort(hostHeader: string): string | null {
    const trimmed = hostHeader.trim().toLowerCase();
    if (trimmed.length === 0 || /\s/.test(trimmed) || /[@/?#\\]/.test(trimmed)) return null;
    if (trimmed === '::1') return '::1';
    try {
        const parsed = new URL(`http://${trimmed}`);
        if (
            parsed.username !== '' ||
            parsed.password !== '' ||
            parsed.pathname !== '/' ||
            parsed.search !== '' ||
            parsed.hash !== ''
        ) {
            return null;
        }
        const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
        return host.length > 0 ? host : null;
    } catch {
        return null;
    }
}

function isLoopbackHostHeader(
    hostHeader: string | string[] | undefined,
    allowMissingHost = true
): boolean {
    if (hostHeader === undefined) return allowMissingHost;
    if (Array.isArray(hostHeader)) return false;
    const hostPart = extractHostWithoutPort(hostHeader);
    if (hostPart === null) return false;
    return hostPart === 'localhost' || hostPart === '127.0.0.1' || hostPart === '::1';
}

function isMetricsHostHeaderAllowed(
    hostHeader: string | string[] | undefined,
    boundHost: string,
    isLoopbackBind: boolean,
    hasAuthToken: boolean
): boolean {
    const allowMissingHost = isLoopbackBind && !hasAuthToken;
    if (isLoopbackHostHeader(hostHeader, allowMissingHost)) return true;
    if (isLoopbackBind || !hasAuthToken) return false;
    if (hostHeader === undefined || Array.isArray(hostHeader)) return false;
    const parsed = extractHostWithoutPort(hostHeader);
    if (parsed === null) return false;
    if (isWildcardBindHost(boundHost)) return true;
    const normalizedBound = boundHost.replace(/^\[|\]$/g, '').trim().toLowerCase();
    return parsed === normalizedBound;
}

function isValidBearerToken(
    authHeader: string | string[] | undefined,
    expectedDigest: Buffer | undefined
): boolean {
    if (typeof authHeader !== 'string' || expectedDigest === undefined) return false;
    const spaceIdx = authHeader.indexOf(' ');
    if (spaceIdx === -1) return false;
    const scheme = authHeader.slice(0, spaceIdx).toLowerCase();
    if (scheme !== 'bearer') return false;
    const providedDigest = createHash('sha256').update(authHeader.slice(spaceIdx + 1), 'utf8').digest();
    return timingSafeEqual(expectedDigest, providedDigest);
}

interface ResolvedMetricsServerConfig {
    port: number;
    host: string;
    isLoopbackBind: boolean;
    authToken: string | undefined;
    expectedTokenDigest: Buffer | undefined;
    includeUserBreakdown: boolean;
}

function resolveMetricsServerConfig(
    metricsPort: number | undefined,
    options: MetricsServerOptions | undefined
): ResolvedMetricsServerConfig {
    const port = parseMetricsPort(metricsPort);
    if (options?.authToken !== undefined && options.authToken !== '' && options.authToken.trim() === '') {
        throw new Error('FATAL: Authentication token cannot be whitespace-only.');
    }
    const authToken =
        typeof options?.authToken === 'string' && options.authToken.trim().length > 0
            ? options.authToken
            : undefined;
    const rawHost = process.env['MJ_METRICS_HOST']?.trim();
    const host = rawHost !== undefined && rawHost !== '' ? rawHost : '127.0.0.1';
    const isLoopbackBind = isLoopbackBindHost(host);
    if (!isLoopbackBind && authToken === undefined) {
        throw new Error(
            `FATAL: Refusing to bind standalone metrics server to non-loopback interface '${host}' without an authentication token (--auth-token or MCP_AUTH_TOKEN).`
        );
    }
    if (isPlaceholderAuthToken(authToken)) {
        throw new Error(
            `FATAL: Default auth token detected for standalone metrics server '${host}'. You MUST change MCP_AUTH_TOKEN to a secure, cryptographically random value for production.`
        );
    }
    const expectedTokenDigest =
        authToken !== undefined ? createHash('sha256').update(authToken, 'utf8').digest() : undefined;
    const authScopes = options?.authScopes ?? [];
    const includeUserBreakdown =
        expectedTokenDigest !== undefined && hasScope([...authScopes], SCOPES.AUDIT);
    return { port, host, isLoopbackBind, authToken, expectedTokenDigest, includeUserBreakdown };
}

function servePrometheusMetrics(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    runtime: ServerRuntime,
    config: ResolvedMetricsServerConfig
): void {
    const { expectedTokenDigest, includeUserBreakdown } = config;
    if (
        expectedTokenDigest !== undefined &&
        !isValidBearerToken(req.headers.authorization, expectedTokenDigest)
    ) {
        res.writeHead(401, {
            'Content-Type': 'text/plain; charset=utf-8',
            'WWW-Authenticate': 'Bearer',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        });
        res.end();
        return;
    }
    try {
        const metrics = formatPrometheusMetrics(runtime.metrics, { includeUserBreakdown });
        res.writeHead(200, {
            'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        });
        res.end(req.method === 'HEAD' ? undefined : metrics);
    } catch (error) {
        logger.error('Failed to generate metrics', {
            error: error instanceof Error ? error.message : String(error),
        });
        res.writeHead(500, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        });
        res.end(req.method === 'HEAD' ? undefined : 'Internal Server Error');
    }
}

function parseMetricsPathname(rawUrl: string | undefined): string {
    try {
        return new URL(rawUrl ?? '/', 'http://localhost').pathname;
    } catch {
        return '';
    }
}

function handleMetricsRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    runtime: ServerRuntime,
    config: ResolvedMetricsServerConfig
): void {
    const { host, isLoopbackBind, authToken } = config;
    if (!isMetricsHostHeaderAllowed(req.headers.host, host, isLoopbackBind, authToken !== undefined)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(req.method === 'HEAD' ? undefined : 'Forbidden');
        return;
    }
    const pathname = parseMetricsPathname(req.url);
    const method = req.method ?? '';
    if (pathname === '/metrics' && (method === 'GET' || method === 'HEAD')) {
        servePrometheusMetrics(req, res, runtime, config);
        return;
    }
    if (pathname === '/health' && (method === 'GET' || method === 'HEAD')) {
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        });
        res.end(method === 'HEAD' ? undefined : JSON.stringify({ status: 'ok' }));
        return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(method === 'HEAD' ? undefined : 'Not Found');
}

function closeBoundMetricsServer(
    server: http.Server,
    resolve: () => void,
    reject: (err: Error) => void
): void {
    if (!server.listening) {
        resolve();
        return;
    }
    server.closeAllConnections();
    server.close((err) => {
        if (err) {
            logger.error('Failed to close metrics server', {
                error: err.message,
                module: 'MetricsServer',
            });
            reject(err);
        } else {
            logger.info('Metrics server closed', { module: 'MetricsServer' });
            resolve();
        }
    });
}

function createMetricsShutdown(
    server: http.Server,
    state: { closed: boolean; listenFailed: boolean }
): () => Promise<void> {
    let closePromise: Promise<void> | null = null;
    return () => {
        if (closePromise !== null) return closePromise;
        state.closed = true;
        closePromise = new Promise<void>((resolve, reject) => {
            if (server.listening) {
                closeBoundMetricsServer(server, resolve, reject);
                return;
            }
            if (state.listenFailed) {
                resolve();
                return;
            }
            // [INVARIANT] Async hostname listen() may still be in-flight when shutdown starts;
            // close as soon as it binds (or resolve if listen errors) to avoid leaking a TCP server (L6a).
            const onListening = (): void => {
                server.off('error', onListenError);
                closeBoundMetricsServer(server, resolve, reject);
            };
            const onListenError = (): void => {
                server.off('listening', onListening);
                resolve();
            };
            server.once('listening', onListening);
            server.once('error', onListenError);
        });
        return closePromise;
    };
}

export function startMetricsServer(
    runtime: ServerRuntime,
    metricsPort?: number,
    options?: MetricsServerOptions
): () => Promise<void> {
    const config = resolveMetricsServerConfig(metricsPort, options);
    const { port, host } = config;
    const state = { closed: false, listenFailed: false };

    const server = http.createServer((req, res) => {
        handleMetricsRequest(req, res, runtime, config);
    });
    server.requestTimeout = 30_000;
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 66_000;

    server.on('error', (error: unknown) => {
        if (!server.listening) {
            state.listenFailed = true;
        }
        if (getErrnoCode(error) === 'EADDRINUSE') {
            logger.warning(
                `Metrics server port ${port} is already in use; standalone metrics server disabled for this instance`,
                { module: 'MetricsServer' }
            );
        } else {
            logger.error('Metrics server error', {
                error: error instanceof Error ? error.message : String(error),
                module: 'MetricsServer',
            });
        }
    });

    server.listen(port, host, () => {
        if (!state.closed) {
            logger.info(`Standalone metrics server listening on ${host}:${port}`, {
                module: 'MetricsServer',
            });
        }
    });

    return createMetricsShutdown(server, state);
}

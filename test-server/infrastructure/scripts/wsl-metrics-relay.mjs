/**
 * WSL2 -> Windows Loopback Metrics Relay (`:9465`)
 *
 * Bridges WSL2 Docker containers (`host.docker.internal:9465` -> `172.17.0.1:9465`)
 * to a `memory-journal-mcp` stdio process bound strictly to `127.0.0.1:9465` on the
 * Windows host via WSL2 binary interop (`curl.exe`), preserving loopback-only bind
 * security without opening Windows Firewall or LAN interfaces.
 */

import http from 'node:http';
import { execFile } from 'node:child_process';

const LISTEN_HOST = process.env.MJ_RELAY_HOST || '172.17.0.1';
const LISTEN_PORT = Number(process.env.MJ_RELAY_PORT || '9465');
const UPSTREAM_PORT = Number(process.env.MJ_METRICS_PORT || '9465');
const WIN_CURL = process.env.WIN_CURL_BIN || '/mnt/c/Windows/System32/curl.exe';

function fetchFromWindowsLoopback(pathname) {
    return new Promise((resolve, reject) => {
        const url = `http://127.0.0.1:${UPSTREAM_PORT}${pathname}`;
        execFile(
            WIN_CURL,
            ['-fsS', '--max-time', '3', '-H', `Host: 127.0.0.1:${UPSTREAM_PORT}`, url],
            { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
            (err, stdout) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(stdout);
            }
        );
    });
}

const server = http.createServer(async (req, res) => {
    const method = req.method || 'GET';
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const pathname = urlObj.pathname;

    if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method Not Allowed');
        return;
    }

    if (pathname !== '/metrics' && pathname !== '/health') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
    }

    try {
        const body = await fetchFromWindowsLoopback(pathname);
        const contentType =
            pathname === '/health'
                ? 'application/json; charset=utf-8'
                : 'text/plain; version=0.0.4; charset=utf-8';
        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-store',
        });
        res.end(method === 'HEAD' ? undefined : body);
    } catch (err) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(
            method === 'HEAD'
                ? undefined
                : `Upstream Windows loopback 127.0.0.1:${UPSTREAM_PORT}${pathname} unreachable: ${err instanceof Error ? err.message : String(err)}`
        );
    }
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
    console.log(
        `[mj-metrics-relay] Listening on ${LISTEN_HOST}:${LISTEN_PORT} -> Windows 127.0.0.1:${UPSTREAM_PORT}`
    );
});

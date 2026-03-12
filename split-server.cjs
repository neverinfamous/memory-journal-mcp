const fs = require('fs');
const path = require('path');

const serverTsPath = path.join(__dirname, 'src/transports/http/server.ts');
const serverDir = path.join(__dirname, 'src/transports/http/server');

if (!fs.existsSync(serverDir)) {
    fs.mkdirSync(serverDir, { recursive: true });
}

const originalLines = fs.readFileSync(serverTsPath, 'utf8').split('\n');

const statelessContent = `import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Request, Response, Express } from 'express'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { logger } from '../../../utils/logger.js'

export async function setupStateless(app: Express, server: McpServer): Promise<void> {
${originalLines.slice(336, 369).join('\n')}
}
`;
fs.writeFileSync(path.join(serverDir, 'stateless.ts'), statelessContent);

const statefulContent = `import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { randomUUID } from 'node:crypto'
import type { Request, Response, Express } from 'express'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { logger } from '../../../utils/logger.js'
import { SESSION_TIMEOUT_MS, SESSION_SWEEP_INTERVAL_MS } from '../types.js'
import type { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'

export interface StatefulContext {
    transports: Map<string, StreamableHTTPServerTransport>
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- backward compat
    sseTransports: Map<string, SSEServerTransport>
    sessionLastActivity: Map<string, number>
    touchSession: (sid: string) => void
}

export function setupStateful(ctx: StatefulContext, app: Express, server: McpServer): ReturnType<typeof setInterval> {
    let sessionSweepTimer: ReturnType<typeof setInterval> | null = null;
${originalLines.slice(376, 570).join('\n').replace(/this\./g, 'ctx.').replace(/ctx\.app/g, 'app').replace(/ctx\.sessionSweepTimer = /g, 'sessionSweepTimer = ')}
    return sessionSweepTimer!;
}
`;
fs.writeFileSync(path.join(serverDir, 'stateful.ts'), statefulContent);

const legacySseContent = `import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Request, Response, Express } from 'express'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { logger } from '../../../utils/logger.js'
import type { StatefulContext } from './stateful.js'

export function setupLegacySSE(ctx: StatefulContext, app: Express, server: McpServer): void {
${originalLines.slice(578, 669).join('\n').replace(/this\./g, 'ctx.').replace(/ctx\.app/g, 'app')}
}
`;
fs.writeFileSync(path.join(serverDir, 'legacy-sse.ts'), legacySseContent);


const indexContent = `${originalLines.slice(0, 14).join('\n')}

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import express from 'express'
import type { Express, Request, Response, RequestHandler } from 'express'
import { logger } from '../../utils/logger.js'
import type { Scheduler } from '../../server/scheduler.js'
import type { HttpTransportConfig, RateLimitEntry } from '../types.js'
import {
    DEFAULT_MAX_BODY_BYTES,
    HTTP_REQUEST_TIMEOUT_MS,
    HTTP_KEEP_ALIVE_TIMEOUT_MS,
    HTTP_HEADERS_TIMEOUT_MS,
    SESSION_TIMEOUT_MS,
    SESSION_SWEEP_INTERVAL_MS,
} from '../types.js'
import { setSecurityHeaders, setCorsHeaders, checkRateLimit } from '../security.js'
import { handleHealthCheck, handleRootInfo, createAuthMiddleware } from '../handlers.js'
import {
    createTokenValidator,
    createOAuthResourceServer,
    createAuthMiddleware as createOAuthMiddleware,
    oauthErrorHandler,
    SUPPORTED_SCOPES,
} from '../../auth/index.js'

import { setupStateless } from './stateless.js'
import { setupStateful } from './stateful.js'
import { setupLegacySSE } from './legacy-sse.js'

${originalLines.slice(48, 220).join('\n')}
        // Set up MCP endpoints based on mode
        if (this.config.stateless) {
            await setupStateless(this.app, server)
        } else {
            this.sessionSweepTimer = setupStateful(this, this.app, server)
            setupLegacySSE(this, this.app, server)
        }
${originalLines.slice(226, 331).join('\n')}
}
`;
fs.writeFileSync(path.join(serverDir, 'index.ts'), indexContent);

console.log('Script done.');

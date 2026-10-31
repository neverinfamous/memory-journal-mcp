import type { Command } from 'commander'
import { logger } from '../../utils/logger.js'
import { createServer } from '../../server/mcp-server/index.js'
import { ConfigResolver } from '../../utils/config-resolver.js'
import { buildServerOptions } from '../server-options-builder.js'
import { type z } from 'zod'
import { serverOptionsSchema } from '../schemas.js'

export const serveSchema = serverOptionsSchema

export async function serveAction(options: z.infer<typeof serveSchema>, command: Command): Promise<void> {
    let resolver: ConfigResolver
    const configPath = options.config ?? process.env['MEMORY_JOURNAL_CONFIG']
    const configErrors: string[] = []

    try {
        resolver = new ConfigResolver(command, options, configPath)
    } catch (err) {
        configErrors.push(err instanceof Error ? err.message : String(err))
        // We cannot continue without a resolver, so create a dummy one that just returns defaults
        resolver = new ConfigResolver(command, {}, undefined)
    }

    // Set log level early
    let logLevel = 'info'
    try {
        logLevel = resolver.resolve<string>('logLevel', 'LOG_LEVEL') ?? 'info'
    } catch (e) {
        configErrors.push(e instanceof Error ? e.message : String(e))
    }
    
    if (options.dumpConfig !== true) {
        logger.setLevel(logLevel as 'debug' | 'info' | 'warning' | 'error')
    }

    // Validate against default placeholder secrets
    const sensitiveEnvVars = ['GITHUB_TOKEN', 'MCP_AUTH_TOKEN', 'OAUTH_ISSUER', 'OAUTH_JWKS_URI']
    for (const envVar of sensitiveEnvVars) {
        const envValue = process.env[envVar]
        if (typeof envValue === 'string' && envValue.startsWith('CHANGEME_')) {
            configErrors.push(
                `FATAL: Insecure configuration detected. ${envVar} contains default placeholder value. Please update your environment variables.`
            )
        }
    }

    const { serverOptions, transport, db, teamDb, host } = buildServerOptions(
        resolver,
        options,
        command,
        configErrors
    )

    if (configErrors.length > 0) {
        process.stderr.write('Startup Configuration Errors:\n')
        configErrors.forEach((err) => process.stderr.write(` - ${err}\n`))
        process.exit(1)
    }

    if (options.dumpConfig === true) {
        const redactedOptions = JSON.parse(JSON.stringify(serverOptions)) as Record<
            string,
            unknown
        >
        const maskSensitive = (obj: Record<string, unknown>): void => {
            for (const key of Object.keys(obj)) {
                const lowerKey = key.toLowerCase()
                if (
                    typeof obj[key] === 'string' &&
                    (lowerKey.includes('token') ||
                        lowerKey.includes('secret') ||
                        lowerKey.includes('issuer') ||
                        lowerKey.includes('uri') ||
                        lowerKey.includes('password') ||
                        lowerKey.includes('key'))
                ) {
                    obj[key] = '[REDACTED]'
                } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                    maskSensitive(obj[key] as Record<string, unknown>)
                }
            }
        }
        maskSensitive(redactedOptions)
        process.stdout.write(JSON.stringify(redactedOptions, null, 2) + '\n')
        process.exit(0)
    }

    logger.info('Starting Memory Journal MCP Server', {
        module: 'CLI',
        transport,
        stateless: serverOptions.statelessHttp,
        db,
        ...(teamDb ? { teamDb } : {}),
        ...(host ? { host } : {}),
    })

    try {
        await createServer(serverOptions)
    } catch (error) {
        logger.error('Failed to start server', {
            module: 'CLI',
            error: error instanceof Error ? error.message : String(error),
        })
        process.exit(1)
    }
}

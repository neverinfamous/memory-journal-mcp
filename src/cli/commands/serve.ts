import type { Command } from 'commander'
import { logger } from '../../utils/logger.js'
import { isPlaceholderAuthToken } from '../../utils/security-utils.js'
import { ConfigResolver } from '../../utils/config-resolver.js'
import { sanitizeErrorForLogging } from '../../utils/security-utils.js'
import { buildServerOptions } from '../server-options-builder.js'
import { type z } from 'zod'
import { serverOptionsSchema } from '../schemas.js'
import { dumpConfigAndExit } from '../dump-config.js'

import { parseLogLevelOption } from '../server-options-parsers.js'

export const serveSchema = serverOptionsSchema

export async function serveAction(options: z.infer<typeof serveSchema>, command: Command): Promise<void> {
    let resolver: ConfigResolver
    const envConfig = process.env['MEMORY_JOURNAL_CONFIG']?.trim()
    const configPath = options.config ?? (envConfig !== undefined && envConfig !== '' ? envConfig : undefined)
    const configErrors: string[] = []

    try {
        resolver = new ConfigResolver(command, options, configPath)
    } catch (err) {
        configErrors.push(err instanceof Error ? err.message : String(err))
        // We cannot continue without a resolver, so create a dummy one that just returns defaults
        resolver = new ConfigResolver(command, {}, undefined)
    }

    // Set log level early using the same parser as buildServerOptions so whitespace/blank
    // handling matches --dump-config (errors are recorded once by buildServerOptions).
    try {
        const earlyLogLevel = parseLogLevelOption(resolver.resolve('logLevel', 'LOG_LEVEL'))
        if (options.dumpConfig !== true) {
            logger.setLevel(earlyLogLevel ?? 'info')
        }
    } catch {
        // Validation error is recorded once by buildServerOptions via parseLogLevelOption.
    }

    // Validate against default placeholder secrets
    const sensitiveEnvVars = ['GITHUB_TOKEN', 'MCP_AUTH_TOKEN', 'OAUTH_ISSUER', 'OAUTH_JWKS_URI']
    for (const envVar of sensitiveEnvVars) {
        const envValue = process.env[envVar]
        if (isPlaceholderAuthToken(envValue)) {
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
        configErrors.forEach((err) => process.stderr.write(` - ${sanitizeErrorForLogging(err)}\n`))
        process.exit(1)
    }

    if (options.dumpConfig === true) {
        dumpConfigAndExit(serverOptions)
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
        const { createServer } = await import('../../server/mcp-server/index.js')
        await createServer(serverOptions)
    } catch (error) {
        logger.error('Failed to start server', {
            module: 'CLI',
            error: error instanceof Error ? error.message : String(error),
        })
        process.exit(1)
    }
}

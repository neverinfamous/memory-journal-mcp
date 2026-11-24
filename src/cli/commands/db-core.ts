import { DatabaseAdapterFactory } from '../../database/adapter-factory.js'
import type { IDatabaseAdapter } from '../../database/core/interfaces.js'
import type { ServerOptions } from '../../server/mcp-server/types.js'
import { type CliCommandLike, ConfigResolver } from '../../utils/config-resolver.js'
import { sanitizeErrorForLogging } from '../../utils/security-utils.js'
import { buildServerOptions } from '../server-options-builder.js'
import { dumpConfigAndExit } from '../dump-config.js'

/** Sentinel error carrying an exit code so DB-backed CLI actions run `finally { db.close() }` before exiting. */
export class CliExitError extends Error {
    public readonly exitCode: number

    constructor(exitCode: number) {
        super(`CLI command exited with code ${String(exitCode)}`)
        this.name = 'CliExitError'
        this.exitCode = exitCode
    }
}

export async function getCliCommandDb(
    options: Record<string, unknown> & { config?: string; team?: boolean },
    command: CliCommandLike,
    opts?: { throwOnExit?: boolean }
): Promise<{ db: IDatabaseAdapter; serverOptions: ServerOptions }> {
    const failExit = (code: number): never => {
        if (opts?.throwOnExit === true) {
            throw new CliExitError(code)
        }
        process.exit(code)
    }

    let resolver: ConfigResolver
    const envConfig = process.env['MEMORY_JOURNAL_CONFIG']?.trim()
    const configPath = options.config ?? (envConfig !== undefined && envConfig !== '' ? envConfig : undefined)
    const configErrors: string[] = []

    try {
        resolver = new ConfigResolver(command, options, configPath)
    } catch (err) {
        const rawErr = err instanceof Error ? err.message : String(err)
        configErrors.push(sanitizeErrorForLogging(rawErr))
        resolver = new ConfigResolver(command, {}, undefined)
    }

    const { serverOptions, teamDb } = buildServerOptions(resolver, options, command, configErrors)

    if (configErrors.length > 0) {
        process.stderr.write('Startup Configuration Errors:\n')
        configErrors.forEach((err) => process.stderr.write(` - ${sanitizeErrorForLogging(err)}\n`))
        failExit(1)
    }

    // [INVARIANT] `--dump-config` is answered before any database is opened (H13).
    if (options['dumpConfig'] === true) {
        dumpConfigAndExit(serverOptions, { exit: failExit })
    }

    const explicitTeamDbSource =
        (typeof options['teamDb'] === 'string' && options['teamDb'].trim() !== '') ||
        (typeof options['teamDatabase'] === 'string' && options['teamDatabase'].trim() !== '') ||
        (typeof options['testTeamDb'] === 'string' && options['testTeamDb'].trim() !== '')
    if (explicitTeamDbSource && options.team !== true) {
        process.stderr.write(
            'Error: --team-db/--team-database/--test-team-db requires --team to target the team database.\n'
        )
        failExit(1)
    }

    if (options.team && !teamDb) {
        process.stderr.write(
            'Error: --team requires a configured team database (--team-db or TEAM_DB_PATH).\n'
        )
        failExit(1)
    }
    const dbPath = options.team && teamDb ? teamDb : serverOptions.dbPath
    const db = await DatabaseAdapterFactory.create(dbPath, serverOptions)
    await db.initialize()
    if (options.team === true) {
        try {
            db.applyTeamSchema()
            if (
                serverOptions.teamAdmin &&
                db.getTeamMemberCount !== undefined &&
                db.addTeamMember !== undefined &&
                !db.isTeamRbacActive?.()
            ) {
                db.addTeamMember(serverOptions.teamAdmin, 'admin', 'system', 'Bootstrap Admin')
            }
        } catch (err) {
            db.close()
            throw err
        }
    }
    return { db, serverOptions }
}

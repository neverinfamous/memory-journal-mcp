import type { ConfigResolver } from '../utils/config-resolver.js'
import { defaultDbPath, defaultTeamDbPath } from './option-groups.js'

export type CatchConfig = <T>(fn: () => T, fallback: T) => T

export function resolveDatabasePaths(
    resolver: ConfigResolver,
    catchConfig: CatchConfig
): { db: string | undefined; testDb: string | undefined; teamDb: string | undefined; testTeamDb: string | undefined } {
    const cliDb = catchConfig(
        () => (resolver.isCliProvided('db') ? resolver.resolve<string>('db') : undefined),
        undefined
    )
    const cliDatabase = catchConfig(
        () => (resolver.isCliProvided('database') ? resolver.resolve<string>('database') : undefined),
        undefined
    )
    const envDb = process.env['DB_PATH'] !== undefined && process.env['DB_PATH'] !== '' ? process.env['DB_PATH'] : undefined
    const hasExplicitDb = cliDb !== undefined || cliDatabase !== undefined || envDb !== undefined
    const configDbPath = catchConfig(() => resolver.resolve<string>('dbPath'), undefined)
    const fallbackDatabase = catchConfig(() => resolver.resolve<string>('database'), undefined)
    const rawDb = catchConfig(() => resolver.resolve<string>('db', 'DB_PATH'), defaultDbPath)
    let db = cliDb ?? cliDatabase ?? rawDb
    if (!hasExplicitDb && (db === defaultDbPath || db === undefined) && fallbackDatabase) {
        db = fallbackDatabase
    } else if (!hasExplicitDb && (db === defaultDbPath || db === undefined) && configDbPath) {
        db = configDbPath
    }

    const configTestDbPath = catchConfig(() => resolver.resolve<string>('testDbPath'), undefined)
    const rawTestDb = catchConfig(() => resolver.resolve<string>('testDb', 'TEST_DB_PATH'), undefined)
    const testDb = rawTestDb ?? configTestDbPath

    const cliTeamDb = catchConfig(
        () => (resolver.isCliProvided('teamDb') ? resolver.resolve<string>('teamDb') : undefined),
        undefined
    )
    const cliTeamDatabase = catchConfig(
        () => (resolver.isCliProvided('teamDatabase') ? resolver.resolve<string>('teamDatabase') : undefined),
        undefined
    )
    const envTeamDb =
        process.env['TEAM_DB_PATH'] !== undefined && process.env['TEAM_DB_PATH'] !== ''
            ? process.env['TEAM_DB_PATH']
            : undefined
    const hasExplicitTeamDb =
        cliTeamDb !== undefined || cliTeamDatabase !== undefined || envTeamDb !== undefined
    const configTeamDbPath = catchConfig(() => resolver.resolve<string>('teamDbPath'), undefined)
    const fallbackTeamDatabase = catchConfig(() => resolver.resolve<string>('teamDatabase'), undefined)
    const rawTeamDb = catchConfig(() => resolver.resolve<string>('teamDb', 'TEAM_DB_PATH'), defaultTeamDbPath)
    let teamDb = cliTeamDb ?? cliTeamDatabase ?? rawTeamDb
    if (!hasExplicitTeamDb && (teamDb === defaultTeamDbPath || teamDb === undefined) && fallbackTeamDatabase) {
        teamDb = fallbackTeamDatabase
    } else if (!hasExplicitTeamDb && (teamDb === defaultTeamDbPath || teamDb === undefined) && configTeamDbPath) {
        teamDb = configTeamDbPath
    }

    const configTestTeamDbPath = catchConfig(() => resolver.resolve<string>('testTeamDbPath'), undefined)
    const rawTestTeamDb = catchConfig(() => resolver.resolve<string>('testTeamDb', 'TEST_TEAM_DB_PATH'), undefined)
    const testTeamDb = rawTestTeamDb ?? configTestTeamDbPath

    return { db, testDb, teamDb, testTeamDb }
}

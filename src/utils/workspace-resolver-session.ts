/**
 * [BOUNDARY] Active session project state (sticky workspace/project set by briefing or
 * agent-context reads). Re-exported from `workspace-resolver.ts`.
 * [INVARIANT] Session context is a read-time hint only; callers must never persist it onto
 * shared, long-lived config objects (see C1 in the pass-20 audit).
 */

import { getRequestContext, type RequestContext } from './request-context.js'

interface SessionProjectEntry {
    workspaceId?: string
    projectNumber?: number
}

function isEphemeralHttpStore(reqCtx: RequestContext): boolean {
    return reqCtx.ephemeralSessionProject !== undefined || reqCtx.ip !== undefined
}

const MAX_HTTP_SESSIONS = 1000
let activeSessionWorkspaceId: string | undefined = undefined
let activeSessionProjectNumber: number | undefined = undefined
const runtimeSessionProjects = new WeakMap<object, SessionProjectEntry>()
const httpSessionProjects = new Map<string, SessionProjectEntry>()

function cloneEntry(entry: SessionProjectEntry | undefined): SessionProjectEntry {
    if (entry === undefined) return {}
    return {
        ...(entry.workspaceId !== undefined ? { workspaceId: entry.workspaceId } : {}),
        ...(entry.projectNumber !== undefined ? { projectNumber: entry.projectNumber } : {}),
    }
}

function computeNextSessionEntry(
    prev: SessionProjectEntry | undefined,
    validWs: string | undefined,
    validProj: number | undefined,
    clearProject: boolean
): SessionProjectEntry {
    // [INTENT] Switching to a different workspace without a project number must not keep
    // the previous workspace's project number attached; setting only a new project number
    // must not retain a stale workspace from a different project.
    const switchedWorkspace =
        validWs !== undefined && prev?.workspaceId !== undefined && prev.workspaceId !== validWs
    const dropPrevWorkspace = validWs === undefined && validProj !== undefined
    const dropPrevProject = clearProject || switchedWorkspace
    const nextWs = validWs ?? (!dropPrevWorkspace ? prev?.workspaceId : undefined)
    const nextProj =
        validProj ??
        (!dropPrevProject && prev?.projectNumber !== undefined ? prev.projectNumber : undefined)
    return {
        ...(nextWs !== undefined ? { workspaceId: nextWs } : {}),
        ...(nextProj !== undefined ? { projectNumber: nextProj } : {}),
    }
}

/**
 * Record the active session workspace and project number (e.g. when a project briefing
 * or agent context resource is read). Pass `null` as `projectNumber` to clear a stale number.
 * Pass `null` as `runtime` in background jobs to explicitly suppress session state mutation.
 */
export function setActiveSessionProject(
    workspaceId: string | undefined,
    projectNumber?: number | null,
    runtime?: object | null
): void {
    if (runtime === null) return

    const validWs =
        workspaceId !== undefined && workspaceId !== '' && workspaceId !== '*'
            ? workspaceId
            : undefined
    const clearProject = projectNumber === null
    const validProj =
        typeof projectNumber === 'number' &&
        Number.isSafeInteger(projectNumber) &&
        projectNumber > 0
            ? projectNumber
            : undefined

    const reqCtx = getRequestContext()
    if (reqCtx !== undefined) {
        if (reqCtx.sessionId !== undefined && reqCtx.sessionId !== '') {
            const prev = httpSessionProjects.get(reqCtx.sessionId)
            const next = computeNextSessionEntry(prev, validWs, validProj, clearProject)
            httpSessionProjects.delete(reqCtx.sessionId)
            httpSessionProjects.set(reqCtx.sessionId, next)
            if (httpSessionProjects.size > MAX_HTTP_SESSIONS) {
                const oldestKey = httpSessionProjects.keys().next().value
                if (oldestKey !== undefined) httpSessionProjects.delete(oldestKey)
            }
            return
        }
        if (isEphemeralHttpStore(reqCtx)) {
            reqCtx.ephemeralSessionProject = computeNextSessionEntry(
                reqCtx.ephemeralSessionProject,
                validWs,
                validProj,
                clearProject
            )
            return
        }
    }

    if (runtime !== undefined) {
        const prev = runtimeSessionProjects.get(runtime)
        runtimeSessionProjects.set(
            runtime,
            computeNextSessionEntry(prev, validWs, validProj, clearProject)
        )
        return
    }

    const globalPrev: SessionProjectEntry = {
        ...(activeSessionWorkspaceId !== undefined ? { workspaceId: activeSessionWorkspaceId } : {}),
        ...(activeSessionProjectNumber !== undefined
            ? { projectNumber: activeSessionProjectNumber }
            : {}),
    }
    const nextGlobal = computeNextSessionEntry(globalPrev, validWs, validProj, clearProject)
    activeSessionWorkspaceId = nextGlobal.workspaceId
    activeSessionProjectNumber = nextGlobal.projectNumber
}

export function getActiveSessionProject(runtime?: object | null): {
    workspaceId?: string
    projectNumber?: number
} {
    if (runtime === null) return {}

    const reqCtx = getRequestContext()
    if (reqCtx !== undefined) {
        if (reqCtx.sessionId !== undefined && reqCtx.sessionId !== '') {
            return cloneEntry(httpSessionProjects.get(reqCtx.sessionId))
        }
        if (isEphemeralHttpStore(reqCtx)) {
            return cloneEntry(reqCtx.ephemeralSessionProject)
        }
    }

    if (runtime !== undefined) {
        return cloneEntry(runtimeSessionProjects.get(runtime))
    }

    const isTest =
        (process.env['NODE_ENV'] === 'test' || process.env['VITEST'] === 'true') &&
        process.env['VITEST_SESSION_PROJECT'] !== 'true'
    if (isTest) return {}
    return {
        ...(activeSessionWorkspaceId !== undefined
            ? { workspaceId: activeSessionWorkspaceId }
            : {}),
        ...(activeSessionProjectNumber !== undefined
            ? { projectNumber: activeSessionProjectNumber }
            : {}),
    }
}

export function clearActiveSessionProject(runtime?: object | null): void {
    if (runtime === null) return

    const reqCtx = getRequestContext()
    if (reqCtx !== undefined) {
        if (reqCtx.sessionId !== undefined && reqCtx.sessionId !== '') {
            httpSessionProjects.delete(reqCtx.sessionId)
            return
        }
        if (isEphemeralHttpStore(reqCtx)) {
            delete reqCtx.ephemeralSessionProject
            return
        }
    }

    if (runtime !== undefined) {
        runtimeSessionProjects.delete(runtime)
        return
    }
    activeSessionWorkspaceId = undefined
    activeSessionProjectNumber = undefined
}

export function clearHttpSessionProject(sessionId: string): void {
    if (sessionId !== '') {
        httpSessionProjects.delete(sessionId)
    }
}

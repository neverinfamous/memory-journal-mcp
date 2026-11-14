/**
 * [BOUNDARY] Active session project state (sticky workspace/project set by briefing or
 * agent-context reads). Re-exported from `workspace-resolver.ts`.
 * [INVARIANT] Session context is a read-time hint only; callers must never persist it onto
 * shared, long-lived config objects (see C1 in the pass-20 audit).
 */

let activeSessionWorkspaceId: string | undefined = undefined
let activeSessionProjectNumber: number | undefined = undefined
const runtimeSessionProjects = new WeakMap<object, { workspaceId?: string; projectNumber?: number }>()

/**
 * Record the active session workspace and project number (e.g. when a project briefing
 * or agent context resource is read). Pass `null` as `projectNumber` to clear a stale number.
 */
export function setActiveSessionProject(
    workspaceId: string | undefined,
    projectNumber?: number | null,
    runtime?: object | null
): void {
    const validWs =
        workspaceId !== undefined && workspaceId !== '' && workspaceId !== '*'
            ? workspaceId
            : undefined
    const clearProject = projectNumber === null
    const validProj =
        typeof projectNumber === 'number' && !Number.isNaN(projectNumber) && projectNumber > 0
            ? projectNumber
            : undefined
    // [INTENT] Switching to a different workspace without a project number must not keep
    // the previous workspace's project number attached; setting only a new project number
    // must not retain a stale workspace from a different project.
    const switchedWorkspace = (prevWs: string | undefined): boolean =>
        validWs !== undefined && prevWs !== undefined && prevWs !== validWs
    const dropPrevWorkspace = validWs === undefined && validProj !== undefined

    if (runtime !== undefined && runtime !== null) {
        const prev = runtimeSessionProjects.get(runtime)
        const dropPrevProject = clearProject || switchedWorkspace(prev?.workspaceId)
        const nextWs = validWs ?? (!dropPrevWorkspace ? prev?.workspaceId : undefined)
        runtimeSessionProjects.set(runtime, {
            ...(nextWs !== undefined ? { workspaceId: nextWs } : {}),
            ...(validProj !== undefined
                ? { projectNumber: validProj }
                : !dropPrevProject && prev?.projectNumber !== undefined
                  ? { projectNumber: prev.projectNumber }
                  : {}),
        })
    }
    const dropGlobalProject = clearProject || switchedWorkspace(activeSessionWorkspaceId)
    if (validWs !== undefined) activeSessionWorkspaceId = validWs
    else if (dropPrevWorkspace) activeSessionWorkspaceId = undefined
    if (validProj !== undefined) activeSessionProjectNumber = validProj
    else if (dropGlobalProject) activeSessionProjectNumber = undefined
}

export function getActiveSessionProject(runtime?: object | null): {
    workspaceId?: string
    projectNumber?: number
} {
    const isTest =
        (process.env['NODE_ENV'] === 'test' || process.env['VITEST'] === 'true') &&
        process.env['VITEST_SESSION_PROJECT'] !== 'true'
    const runtimeEntry =
        runtime !== undefined && runtime !== null ? runtimeSessionProjects.get(runtime) : undefined
    const ws = runtimeEntry?.workspaceId ?? (isTest ? undefined : activeSessionWorkspaceId)
    const proj = runtimeEntry?.projectNumber ?? (isTest ? undefined : activeSessionProjectNumber)
    return {
        ...(ws !== undefined ? { workspaceId: ws } : {}),
        ...(proj !== undefined ? { projectNumber: proj } : {}),
    }
}

export function clearActiveSessionProject(runtime?: object | null): void {
    if (runtime !== undefined && runtime !== null) {
        runtimeSessionProjects.delete(runtime)
        return
    }
    activeSessionWorkspaceId = undefined
    activeSessionProjectNumber = undefined
}

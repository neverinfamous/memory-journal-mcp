/**
 * Server Runtime Context
 *
 * Provides instance-scoped globals (maintenance lock, tools cache, audit logger, etc.)
 * to eliminate cross-instance process coupling.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { AuditLogger, AuditInterceptor } from '../audit/index.js'
import type { ToolRegistration, ToolDefinition } from '../types/index.js'
import type { GitHubIntegration } from '../github/github-integration/index.js'
import { MetricsAccumulator } from '../observability/metrics.js'
import { MemoryJournalMcpError } from '../types/errors.js'

export class MaintenanceManager {
    private activeJobs = 0
    private readonly activeJobDepth = new AsyncLocalStorage<number>()
    private maintenanceTargetJobs = 1
    private maintenanceWaitPromise: { promise: Promise<void>; resolve: () => void } | null = null
    private inMaintenanceMode = false

    private maybeResolveWaiter(): void {
        const threshold = this.inMaintenanceMode ? this.maintenanceTargetJobs : 0
        if (this.maintenanceWaitPromise !== null && this.activeJobs <= threshold) {
            this.maintenanceWaitPromise.resolve()
            this.maintenanceWaitPromise = null
        }
    }

    async withActiveJob<T>(fn: () => Promise<T>, bypass = false): Promise<T> {
        if (this.inMaintenanceMode && !bypass) {
            throw new MemoryJournalMcpError(
                'Maintenance Mode: The server is experiencing downtime for an internal maintenance operation. Please try again later.',
                'MAINTENANCE_MODE',
                'resource',
                { recoverable: true }
            )
        }

        const nextDepth = (this.activeJobDepth.getStore() ?? 0) + 1
        this.activeJobs++
        try {
            return await this.activeJobDepth.run(nextDepth, fn)
        } finally {
            this.activeJobs--
            this.maybeResolveWaiter()
        }
    }

    yieldJob(): void {
        this.activeJobs--
        this.maybeResolveWaiter()
    }

    resumeJob(): void {
        this.activeJobs++
    }

    async acquireMaintenanceLock(): Promise<void> {
        if (this.inMaintenanceMode) {
            throw new MemoryJournalMcpError('Maintenance lock is already acquired.', 'LOCK_ACQUIRED', 'internal')
        }
        this.inMaintenanceMode = true
        const selfJobs = Math.max(1, this.activeJobDepth.getStore() ?? 0)
        this.maintenanceTargetJobs = selfJobs

        if (this.activeJobs > selfJobs) {
            // Drain all sibling active jobs outside the acquiring call stack before swapping state.
            if (this.maintenanceWaitPromise === null) {
                let resolver: (() => void) | undefined
                const promise = new Promise<void>((resolve) => {
                    resolver = resolve
                })
                if (resolver) {
                    this.maintenanceWaitPromise = { promise, resolve: resolver }
                }
            }
            if (this.maintenanceWaitPromise !== null) {
                await this.maintenanceWaitPromise.promise
            }
        }
    }

    releaseMaintenanceLock(): void {
        this.inMaintenanceMode = false
        this.maintenanceTargetJobs = 1
        if (this.maintenanceWaitPromise !== null) {
            this.maintenanceWaitPromise.resolve()
            this.maintenanceWaitPromise = null
        }
    }

    assertNotInMaintenanceMode(): void {
        if (this.inMaintenanceMode) {
            throw new MemoryJournalMcpError(
                'Maintenance Mode: The server is experiencing downtime for an internal maintenance operation. Please try again later.',
                'MAINTENANCE_MODE',
                'resource',
                { recoverable: true }
            )
        }
    }

    isMaintenanceModeActive(): boolean {
        return this.inMaintenanceMode
    }
}

export class ServerRuntime {
    public readonly maintenanceManager = new MaintenanceManager()
    public readonly metrics = new MetricsAccumulator()
    public auditLogger: AuditLogger | null = null
    public auditInterceptor: AuditInterceptor | null = null
    public toolMapCache: Map<string, ToolDefinition> | null = null
    public mappedToolsCache: ToolRegistration[] | null = null
    public cachedContextRefs: unknown = null
    public githubClientPool: Map<string, GitHubIntegration> | null = null
    public configManager: unknown = null
    public stopBackgroundTasks: (() => void) | null = null
    public teamDefaultRole: 'admin' | 'member' | 'viewer' | 'denied' = 'denied'
    public pendingVectorInit: Promise<void> | null = null
    public disposeVectorManagers: ((timeoutMs?: number) => Promise<void>) | null = null
}

// Legacy Fallbacks removed. Consumers MUST provide a valid ServerRuntime to use MaintenanceManager logic.

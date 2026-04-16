/**
 * Server Runtime Context
 * 
 * Provides instance-scoped globals (maintenance lock, tools cache, audit logger, etc.)
 * to eliminate cross-instance process coupling.
 */
import type { AuditLogger, AuditInterceptor } from '../audit/index.js'
import type { ToolRegistration, ToolDefinition } from '../types/index.js'
import type { GitHubIntegration } from '../github/github-integration/index.js'

export class MaintenanceManager {
    private activeJobs = 0;
    private maintenanceWaiters: (() => void)[] = [];
    private inMaintenanceMode = false;

    async withActiveJob<T>(fn: () => Promise<T>, bypass = false): Promise<T> {
        if (this.inMaintenanceMode && !bypass) {
            throw new Error('Maintenance Mode: The server is experiencing downtime for an internal maintenance operation. Please try again later.');
        }
        
        this.activeJobs++;
        try {
            return await fn();
        } finally {
            this.activeJobs--;
            if (this.activeJobs === 0 && this.maintenanceWaiters.length > 0) {
                const waiters = [...this.maintenanceWaiters];
                this.maintenanceWaiters = [];
                waiters.forEach(w => w());
            }
        }
    }

    async acquireMaintenanceLock(): Promise<void> {
        if (this.inMaintenanceMode) {
            throw new Error('Maintenance lock is already acquired.');
        }
        this.inMaintenanceMode = true;

        if (this.activeJobs > 1) { // 1 is the restore job itself!
            await new Promise<void>(resolve => {
                this.maintenanceWaiters.push(resolve);
            });
        }
    }

    releaseMaintenanceLock(): void {
        this.inMaintenanceMode = false;
        if (this.maintenanceWaiters.length > 0) {
            const waiters = [...this.maintenanceWaiters];
            this.maintenanceWaiters = [];
            waiters.forEach(w => w());
        }
    }
    
    assertNotInMaintenanceMode(): void {
        if (this.inMaintenanceMode) {
            throw new Error('Maintenance Mode: The server is experiencing downtime for an internal maintenance operation. Please try again later.');
        }
    }

    isMaintenanceModeActive(): boolean {
        return this.inMaintenanceMode;
    }
}

export class ServerRuntime {
    public readonly maintenanceManager = new MaintenanceManager();
    public auditLogger: AuditLogger | null = null;
    public auditInterceptor: AuditInterceptor | null = null;
    public toolMapCache: Map<string, ToolDefinition> | null = null;
    public mappedToolsCache: ToolRegistration[] | null = null;
    public cachedContextRefs: unknown = null;
    public githubClientPool: Map<string, GitHubIntegration> | null = null;
}

// ============================================================================
// Legacy Fallbacks
// ============================================================================

export function assertNotInMaintenanceMode(): void {
    // Legacy stub for backward compatibility
}

export function isMaintenanceModeActive(): boolean {
    // Legacy stub for backward compatibility
    return false;
}

/**
 * Maintenance Lock Manager
 *
 * Provides a global quiesce mechanism to temporarily block inbound requests
 * during destructive operations like `restoreFromFile`.
 */

let maintenanceModeActive = false
const MAINTENANCE_ERROR_MESSAGE = 'Maintenance Mode: The server is experiencing downtime for an internal maintenance operation. Please try again later.'

/**
 * Check if maintenance mode is active.
 */
export function isMaintenanceModeActive(): boolean {
    return maintenanceModeActive
}

/**
 * Acquire the maintenance lock. Successive calls will throw an error if already active.
 */
export function acquireMaintenanceLock(): void {
    if (maintenanceModeActive) {
        throw new Error('Maintenance lock is already acquired.')
    }
    maintenanceModeActive = true
}

/**
 * Release the maintenance lock.
 */
export function releaseMaintenanceLock(): void {
    maintenanceModeActive = false
}

/**
 * Assert that maintenance mode is not active, otherwise throws an error.
 */
export function assertNotInMaintenanceMode(): void {
    if (maintenanceModeActive) {
        throw new Error(MAINTENANCE_ERROR_MESSAGE)
    }
}

import { describe, it, expect, beforeEach } from 'vitest'
import { MaintenanceManager } from '../../src/utils/maintenance-lock.js'

describe('MaintenanceManager', () => {
    let manager: MaintenanceManager

    beforeEach(() => {
        manager = new MaintenanceManager()
    })

    describe('withActiveJob', () => {
        it('should track active jobs', async () => {
            let activeInside = false
            const promise = manager.withActiveJob(async () => {
                activeInside = true
                expect((manager as any).activeJobs).toBe(1)
            })
            await promise
            expect(activeInside).toBe(true)
            expect((manager as any).activeJobs).toBe(0)
        })

        it('should reject if maintenance mode is active', async () => {
            await manager.acquireMaintenanceLock()
            await expect(manager.withActiveJob(async () => {})).rejects.toThrow('Maintenance Mode: The server is experiencing downtime')
        })

        it('should allow bypass if maintenance mode is active', async () => {
            await manager.acquireMaintenanceLock()
            await expect(manager.withActiveJob(async () => 'success', true)).resolves.toBe('success')
        })

        it('should resolve maintenance wait promise when jobs reach 1 (assuming 1 is the maintenance job)', async () => {
            let resolveJob1!: () => void
            let resolveJob2!: () => void
            const jobPromise1 = manager.withActiveJob(async () => {
                return new Promise<void>(resolve => { resolveJob1 = resolve })
            })
            const jobPromise2 = manager.withActiveJob(async () => {
                return new Promise<void>(resolve => { resolveJob2 = resolve })
            })

            let lockAcquired = false
            const lockPromise = manager.acquireMaintenanceLock().then(() => { lockAcquired = true })
            
            // Wait a tick
            await new Promise(r => setTimeout(r, 0))
            expect(lockAcquired).toBe(false)
            
            resolveJob2() // activeJobs drops to 1
            await jobPromise2
            
            // Wait a tick
            await new Promise(r => setTimeout(r, 0))
            expect(lockAcquired).toBe(true) // Resolves because activeJobs <= 1

            resolveJob1() // finish the remaining job
            await jobPromise1
            await lockPromise
        })
    })

    describe('yieldJob and resumeJob', () => {
        it('should decrement and increment active jobs', () => {
            manager.resumeJob()
            expect((manager as any).activeJobs).toBe(1)
            manager.yieldJob()
            expect((manager as any).activeJobs).toBe(0)
        })

        it('yieldJob should resolve maintenance wait promise when reaching 1', async () => {
            manager.resumeJob() // activeJobs = 1
            manager.resumeJob() // activeJobs = 2
            
            let lockAcquired = false
            const lockPromise = manager.acquireMaintenanceLock().then(() => { lockAcquired = true })
            
            await new Promise(r => setTimeout(r, 0))
            expect(lockAcquired).toBe(false)
            
            manager.yieldJob() // activeJobs drops to 1, should resolve
            
            await new Promise(r => setTimeout(r, 0))
            expect(lockAcquired).toBe(true) 
            
            manager.yieldJob() // activeJobs = 0
            await lockPromise
        })
    })

    describe('acquireMaintenanceLock', () => {
        it('should throw if already acquired', async () => {
            await manager.acquireMaintenanceLock()
            await expect(manager.acquireMaintenanceLock()).rejects.toThrow('Maintenance lock is already acquired.')
        })
    })

    describe('releaseMaintenanceLock', () => {
        it('should release the lock and any waiting promises', async () => {
            await manager.acquireMaintenanceLock()
            expect(manager.isMaintenanceModeActive()).toBe(true)
            manager.releaseMaintenanceLock()
            expect(manager.isMaintenanceModeActive()).toBe(false)
            expect(() => manager.assertNotInMaintenanceMode()).not.toThrow()
        })
    })
    
    describe('assertNotInMaintenanceMode', () => {
        it('should throw if in maintenance mode', async () => {
            await manager.acquireMaintenanceLock()
            expect(() => manager.assertNotInMaintenanceMode()).toThrow('Maintenance Mode: The server is experiencing downtime')
        })
        
        it('should not throw if not in maintenance mode', () => {
            expect(() => manager.assertNotInMaintenanceMode()).not.toThrow()
        })
    })
})

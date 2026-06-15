import { test as base, expect as baseExpect } from '@playwright/test'

export const test = base.extend({
    baseURL: async ({ baseURL: _ }, use, testInfo) => {
        const workerIndex = testInfo.parallelIndex ?? Number(process.env.TEST_PARALLEL_INDEX || 0)
        await use(`http://localhost:${3100 + workerIndex}`)
    },
})

export const expect = baseExpect

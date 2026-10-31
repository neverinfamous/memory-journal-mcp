import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Tests the --persist-metrics flag integration logic.
 * - Simulates the metrics accumulator.
 * - Verifies the file save and restore logic.
 */

async function main() {
    console.log('Testing metrics persistence...')
    
    const dbPath = path.resolve('.test-output/test-metrics-persistence.db')
    const metricsPath = path.resolve('.test-output/test-metrics-persistence_metrics.json')

    // Ensure clean state
    await fs.mkdir(path.resolve('.test-output'), { recursive: true })
    await fs.rm(dbPath, { force: true })
    await fs.rm(metricsPath, { force: true })
    
    // Dynamically import the typescript file natively using strip-types or fallback to TSX
    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    const metricsModulePath = path.resolve(__dirname, '../../src/observability/metrics.ts')
    
    const { MetricsAccumulator } = await import(`file://${metricsModulePath}`)
    
    console.log('1. Creating accumulator and recording metrics...')
    const acc1 = new MetricsAccumulator()
    acc1.record({
        toolName: 'test_tool',
        durationMs: 50,
        inputTokens: 10,
        outputTokens: 20,
        isError: false,
    })
    acc1.recordResourceRead('memory://health', false)
    
    console.log('2. Saving metrics to disk...')
    await acc1.saveToFile(metricsPath)
    
    console.log('3. Creating new accumulator and loading from disk...')
    const acc2 = new MetricsAccumulator()
    await acc2.loadFromFile(metricsPath)
    
    const summary = acc2.getSummary()
    
    if (summary.totalCalls !== 1) {
        throw new Error(`Expected 1 total call, got ${summary.totalCalls}`)
    }
    if (summary.toolBreakdown['test_tool']?.totalInputTokens !== 10) {
        throw new Error(`Expected 10 input tokens for test_tool`)
    }
    if (summary.totalResourceReads !== 1) {
        throw new Error(`Expected 1 resource read`)
    }
    
    console.log('✅ Metrics correctly persisted and restored!')
    
    // Clean up
    await fs.rm(dbPath, { force: true })
    await fs.rm(metricsPath, { force: true })
}

main().catch((err) => {
    console.error('Test failed:', err)
    process.exit(1)
})

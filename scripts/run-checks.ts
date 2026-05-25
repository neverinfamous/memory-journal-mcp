import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const testOutputDir = join(process.cwd(), '.test-output')
const healthStatusFile = join(testOutputDir, 'health-status.json')

try {
    // Ensure the output directory exists
    mkdirSync(testOutputDir, { recursive: true })

    console.log('Running lint and typecheck...')
    // Run both checks
    execSync('npm run lint && npm run typecheck', { stdio: 'inherit' })
    
    console.log('Checks passed! Writing health-status.json...')
    // Write success status
    writeFileSync(healthStatusFile, JSON.stringify({ ok: true, timestamp: Date.now() }, null, 2))
    
    process.exit(0)
} catch (error) {
    console.error('Checks failed! Writing health-status.json...')
    // Write failure status
    writeFileSync(healthStatusFile, JSON.stringify({ ok: false, timestamp: Date.now() }, null, 2))
    
    // Exit with error code to ensure CI/other scripts fail appropriately
    process.exit(1)
}

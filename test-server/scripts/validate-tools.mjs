import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectDir = join(scriptDir, '..', '..')
const referencePath = join(projectDir, 'test-server', 'tool-reference.md')
const toolMapPath = join(scriptDir, 'tool-map.json')

const reference = readFileSync(referencePath, 'utf8')
const toolMapData = JSON.parse(readFileSync(toolMapPath, 'utf8'))

const ssotTools = []
let inToolTable = false
for (const line of reference.split('\n')) {
    if (line.startsWith('| Tool')) {
        inToolTable = true
        continue
    }
    if (!inToolTable) {
        continue
    }
    if (line.startsWith('| ---')) {
        continue
    }
    const match = line.match(/^\| `([a-z0-9_-]+)`\s*\|/)
    if (match?.[1] !== undefined) {
        ssotTools.push(match[1])
        continue
    }
    inToolTable = false
}

const mapTools = Object.keys(toolMapData.toolMap)
const missingInMap = ssotTools.filter((tool) => !mapTools.includes(tool))
const missingInSSoT = mapTools.filter((tool) => !ssotTools.includes(tool))

console.log(`SSoT tools: ${ssotTools.length}`)
console.log(`Map tools: ${mapTools.length}`)
console.log('Missing in map:', missingInMap)
console.log('Missing in SSoT:', missingInSSoT)

if (missingInMap.length > 0 || missingInSSoT.length > 0) {
    process.exit(1)
}

console.log('Tool map matches the tool reference.')

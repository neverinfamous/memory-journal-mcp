import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

// Helper to find all .ts files in a directory
function getFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return []
    const dirents = fs.readdirSync(dir, { withFileTypes: true })
    const files = dirents.map(dirent => {
        const res = path.join(dir, dirent.name)
        return dirent.isDirectory() ? getFiles(res) : res
    })
    return Array.prototype.concat(...files).filter(f => f.endsWith('.ts'))
}

// Extract tools
function extractTools(): Map<string, { file: string, tools: Set<string> }> {
    const toolFiles = getFiles(path.join(ROOT, 'src/handlers/tools'))
    const groups = new Map<string, { file: string, tools: Set<string> }>()

    for (const file of toolFiles) {
        const relativeFile = path.relative(path.join(ROOT, 'src/handlers/tools'), file).replace(/\\/g, '/')
        if (relativeFile === 'index.ts' || relativeFile.endsWith('schemas.ts') || relativeFile.includes('helpers.ts')) continue

        const content = fs.readFileSync(file, 'utf-8')
        // Match { name: '...', group: '...' } blocks roughly
        const regex = /name:\s*['"]([^'"]+)['"][\s\S]*?group:\s*['"]([^'"]+)['"]/g
        let match
        while ((match = regex.exec(content)) !== null) {
            const name = match[1]
            const group = match[2]
            
            if (!groups.has(group)) {
                groups.set(group, { file: relativeFile, tools: new Set() })
            }
            groups.get(group)!.tools.add(name)
        }
    }
    return groups
}

// Extract resources
function extractResources(): { uri: string, name: string }[] {
    const resFiles = getFiles(path.join(ROOT, 'src/handlers/resources'))
    const resources: { uri: string, name: string }[] = []

    for (const file of resFiles) {
        if (!fs.existsSync(file)) continue
        const content = fs.readFileSync(file, 'utf-8')
        
        const regex1 = /uri:\s*['"]([^'"]+)['"][\s\S]{0,150}?name:\s*['"]([^'"]+)['"]/g
        let match
        while ((match = regex1.exec(content)) !== null) {
            resources.push({ uri: match[1], name: match[2] })
        }
        
        const regex2 = /name:\s*['"]([^'"]+)['"][\s\S]{0,150}?uri:\s*['"]([^'"]+)['"]/g
        while ((match = regex2.exec(content)) !== null) {
            resources.push({ uri: match[2], name: match[1] })
        }
    }
    
    // Deduplicate
    const uniqueResources = new Map()
    for (const res of resources) {
        uniqueResources.set(res.uri, res)
    }
    return Array.from(uniqueResources.values())
}

// Extract prompts
function extractPrompts(): { name: string, description: string }[] {
    const promptFiles = getFiles(path.join(ROOT, 'src/handlers/prompts'))
    const prompts: { name: string, description: string }[] = []

    const skipNames = new Set([
        'topic', 'depth', 'project_number', 'pr_number', 'limit', 'start_date', 'end_date',
        'tag', 'search_term', 'days_back', 'focus', 'include_archived', 'run_id', 'issue_number',
        'days', 'hours', 'issue_url', 'is_personal', 'include_relationships', 'flag_type', 'query'
    ])

    for (const file of promptFiles) {
        const relativeFile = path.relative(path.join(ROOT, 'src/handlers/prompts'), file).replace(/\\/g, '/')
        if (relativeFile === 'index.ts') continue

        const content = fs.readFileSync(file, 'utf-8')
        const regex = /name:\s*['"]([^'"]+)['"][\s\S]{0,150}?description:\s*['"]([^'"]+)['"]/g
        let match
        while ((match = regex.exec(content)) !== null) {
            const name = match[1]
            if (skipNames.has(name)) continue
            prompts.push({ name, description: match[2] })
        }
    }
    return prompts
}

function updateCodeMap() {
    const codeMapPath = path.join(ROOT, 'test-server/code-map.md')
    if (!fs.existsSync(codeMapPath)) {
        console.error('code-map.md not found at', codeMapPath)
        process.exit(1)
    }

    let content = fs.readFileSync(codeMapPath, 'utf-8')

    // Generate Tools Markdown
    const tools = extractTools()
    let toolsMd = '| Group | Tools |\n| ----- | ----- |\n'
    const sortedGroups = Array.from(tools.keys()).sort()
    for (const group of sortedGroups) {
        const info = tools.get(group)!
        const toolList = Array.from(info.tools).map(t => `\`${t}\``).join(', ')
        toolsMd += `| **${group}** | ${toolList} |\n`
    }

    // Generate Resources Markdown
    const resources = extractResources()
    let resourcesMd = '| URI | Name |\n| --- | ---- |\n'
    for (const res of resources) {
        resourcesMd += `| \`${res.uri}\` | ${res.name} |\n`
    }

    // Generate Prompts Markdown
    const prompts = extractPrompts()
    let promptsMd = '| Prompt | Description |\n| ------ | ----------- |\n'
    for (const p of prompts) {
        promptsMd += `| \`${p.name}\` | ${p.description.replace(/\n/g, ' ').substring(0, 80)}${p.description.length > 80 ? '...' : ''} |\n`
    }

    // Inject into markers
    content = content.replace(/<!-- BEGIN: TOOL_MAPPING -->[\s\S]*?<!-- END: TOOL_MAPPING -->/, `<!-- BEGIN: TOOL_MAPPING -->\n${toolsMd}\n<!-- END: TOOL_MAPPING -->`)
    content = content.replace(/<!-- BEGIN: RESOURCES -->[\s\S]*?<!-- END: RESOURCES -->/, `<!-- BEGIN: RESOURCES -->\n${resourcesMd}\n<!-- END: RESOURCES -->`)
    content = content.replace(/<!-- BEGIN: PROMPTS -->[\s\S]*?<!-- END: PROMPTS -->/, `<!-- BEGIN: PROMPTS -->\n${promptsMd}\n<!-- END: PROMPTS -->`)

    fs.writeFileSync(codeMapPath, content)
    console.log('code-map.md updated successfully.')
}

updateCodeMap()

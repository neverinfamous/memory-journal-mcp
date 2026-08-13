import { promises as fs } from 'node:fs'
import * as path from 'node:path'

async function* walk(dir: string): AsyncGenerator<string> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            yield* walk(fullPath)
        } else if (fullPath.endsWith('.ts')) {
            yield fullPath
        }
    }
}

async function fix() {
    for await (const file of walk('src')) {
        let content = await fs.readFile(file, 'utf8')
        let changed = false

        if (content.includes('InternalError') || content.includes('InvalidParamsError') || content.includes('InvalidRequestError')) {
            content = content.replace(/import \{.*?InternalError.*\} from '@modelcontextprotocol\/server'/g, "import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'")
            content = content.replace(/import \{.*?InvalidParamsError.*\} from '@modelcontextprotocol\/server'/g, "import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'")
            content = content.replace(/import \{.*?InvalidRequestError.*\} from '@modelcontextprotocol\/server'/g, "import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'")
            
            content = content.replace(/new InternalError\(/g, 'new ProtocolError(ProtocolErrorCode.InternalError, ')
            content = content.replace(/new InvalidParamsError\(/g, 'new ProtocolError(ProtocolErrorCode.InvalidParams, ')
            content = content.replace(/new InvalidRequestError\(/g, 'new ProtocolError(ProtocolErrorCode.InvalidRequest, ')

            // Cleanup duplicate imports
            let hasImport = false
            content = content.split('\n').filter(line => {
                if (line.includes("import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server'")) {
                    if (hasImport) return false
                    hasImport = true
                    return true
                }
                return true
            }).join('\n')
            
            await fs.writeFile(file, content)
            console.log('Fixed', file)
        }
    }
}

fix()

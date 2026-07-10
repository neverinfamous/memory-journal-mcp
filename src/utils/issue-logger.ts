import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

export interface AgentIssue {
    timestamp: string
    source: 'CLI' | 'MCP'
    action: string
    input: unknown
    error: string
}

export function logAgentIssue(issue: Omit<AgentIssue, 'timestamp'>): void {
    const fullIssue: AgentIssue = {
        timestamp: new Date().toISOString(),
        ...issue,
    }

    try {
        const __filename = fileURLToPath(import.meta.url)
        const __dirname = path.dirname(__filename)
        const rootDir = path.resolve(__dirname, '..', '..')
        const logsDir = path.join(rootDir, 'logs')
        
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true })
        }

        const logFile = path.join(logsDir, 'agent-issues.jsonl')
        fs.appendFileSync(logFile, JSON.stringify(fullIssue) + '\n')
    } catch (e) {
        // Fail silently so we don't crash the main process if logging fails
        console.error('Failed to write to agent-issues.jsonl:', e)
    }
}

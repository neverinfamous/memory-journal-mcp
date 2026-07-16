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
    if (process.env['NODE_ENV'] === 'test') {
        return
    }

    const fullIssue: AgentIssue = {
        timestamp: new Date().toISOString(),
        ...issue,
    }

    try {
        const __filename = fileURLToPath(import.meta.url)
        let rootDir = path.dirname(__filename)
        while (!fs.existsSync(path.join(rootDir, 'package.json')) && rootDir !== path.parse(rootDir).root) {
            rootDir = path.dirname(rootDir)
        }
        
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

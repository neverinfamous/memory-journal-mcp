import fs from 'fs';
import path from 'path';

const standardDir = 'c:/Users/chris/Desktop/memory-journal-mcp/test-server/standard';
const ssotPath = 'C:/Users/chris/.gemini/antigravity/brain/e6a6ef28-1559-4eae-917f-c253a148654a/scratch/ssot-mapping.md';

const ssot = fs.readFileSync(ssotPath, 'utf8');
const tools = new Set();
for (const line of ssot.split('\n')) {
  if (line.trim().startsWith('- ')) {
    tools.add(line.trim().substring(2));
  }
}

const files = fs.readdirSync(standardDir).filter(f => f.endsWith('.md') && f !== 'README.md' && f !== 'coordinator-workflow.md' && f !== 'tool-group-requirements.md');

const hallucinations = new Set();

for (const f of files) {
  const p = path.join(standardDir, f);
  const c = fs.readFileSync(p, 'utf8');
  
  // Find all strings like `tool_name` or `tool_name(...)` 
  // Let's use a regex to extract typical tool calls
  const matches = [...c.matchAll(/`([a-z_]+)\b/g)];
  for (const match of matches) {
    const toolName = match[1];
    if (toolName !== 'mj_execute_code' && !tools.has(toolName) && toolName.includes('_')) {
      hallucinations.add(toolName);
    }
  }
}

console.log('Potential hallucinations found:', Array.from(hallucinations));

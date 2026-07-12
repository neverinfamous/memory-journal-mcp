import fs from 'fs';
import path from 'path';

const standardDir = 'c:/Users/chris/Desktop/memory-journal-mcp/test-server/standard';
const ssotPath = 'C:/Users/chris/.gemini/antigravity/brain/e6a6ef28-1559-4eae-917f-c253a148654a/scratch/ssot-mapping.md';
const toolMapPath = 'c:/Users/chris/Desktop/memory-journal-mcp/test-server/scripts/tool-map.json';

const ssot = fs.readFileSync(ssotPath, 'utf8');
const tools = [];
for (const line of ssot.split('\n')) {
  if (line.trim().startsWith('- ')) {
    tools.push(line.trim().substring(2));
  }
}

const files = fs.readdirSync(standardDir).filter(f => f.endsWith('.md') && f !== 'README.md' && f !== 'coordinator-workflow.md' && f !== 'tool-group-requirements.md');
const toolToFiles = {};

for (const t of tools) toolToFiles[t] = [];

for (const f of files) {
  const p = path.join(standardDir, f);
  const c = fs.readFileSync(p, 'utf8');
  
  for (const t of tools) {
    if (c.includes(`\`${t}\``) || c.includes(`${t}(`) || c.includes(`${t} `)) {
      toolToFiles[t].push(f);
    }
  }
}

const map = JSON.parse(fs.readFileSync(toolMapPath, 'utf8'));
for (const [tool, newFiles] of Object.entries(toolToFiles)) {
  if (!map.toolMap[tool]) map.toolMap[tool] = [];
  for (const f of newFiles) {
    if (!map.toolMap[tool].includes(f)) {
      map.toolMap[tool].push(f);
    }
  }
  map.toolMap[tool].sort();
}

// Special case for mj_execute_code: exclude from toolMap sorting or add its missing files?
// Let's just write back the tool map
fs.writeFileSync(toolMapPath, JSON.stringify(map, null, 2));
console.log('Updated tool-map.json with standard files.');

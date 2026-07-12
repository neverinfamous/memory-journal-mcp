import fs from 'fs';
import path from 'path';

const standardDir = 'c:/Users/chris/Desktop/memory-journal-mcp/test-server/standard';
const ssotPath = 'C:/Users/chris/.gemini/antigravity/brain/e6a6ef28-1559-4eae-917f-c253a148654a/scratch/ssot-mapping.md';

const ssot = fs.readFileSync(ssotPath, 'utf8');
const tools = [];
for (const line of ssot.split('\n')) {
  if (line.trim().startsWith('- ')) {
    tools.push(line.trim().substring(2));
  }
}

console.log('Total tools in SSoT:', tools.length);

const files = fs.readdirSync(standardDir).filter(f => f.endsWith('.md') && f !== 'README.md' && f !== 'coordinator-workflow.md' && f !== 'tool-group-requirements.md');
const fileToTools = {};
const toolToFiles = {};

for (const t of tools) toolToFiles[t] = [];

for (const f of files) {
  const p = path.join(standardDir, f);
  const c = fs.readFileSync(p, 'utf8');
  fileToTools[f] = [];
  
  for (const t of tools) {
    // simple heuristic: if tool name appears in backticks or just plainly in the test table
    if (c.includes(`\`${t}\``) || c.includes(`${t}(`)) {
      fileToTools[f].push(t);
      toolToFiles[t].push(f);
    }
  }
}

const missing = [];
for (const t of tools) {
  if (toolToFiles[t].length === 0) {
    missing.push(t);
  }
}

console.log('Missing tools in standard tests:', missing);
console.log('File coverage:');
for (const f of files) {
  console.log(`${f}: ${fileToTools[f].length} tools`);
}

fs.writeFileSync('c:/Users/chris/Desktop/memory-journal-mcp/scratch_audit.json', JSON.stringify({missing, toolToFiles}, null, 2));

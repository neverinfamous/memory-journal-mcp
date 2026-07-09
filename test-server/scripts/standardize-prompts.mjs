import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const toolMapPath = path.join(__dirname, 'tool-map.json');
const toolMapData = JSON.parse(fs.readFileSync(toolMapPath, 'utf8'));
const reverseMap = {};

// Build reverse map: file -> tools
for (const [tool, files] of Object.entries(toolMapData.toolMap)) {
  if (tool === 'mj_execute_code') continue;
  for (const file of files) {
    if (!reverseMap[file]) {
      reverseMap[file] = [];
    }
    reverseMap[file].push(tool);
  }
}

const usabilityDir = path.join(__dirname, '..', 'usability');
const files = fs.readdirSync(usabilityDir).filter(f => f.endsWith('.md') && f.startsWith('test-'));

let updated = 0;

for (const file of files) {
  const filePath = path.join(usabilityDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  const targetPrefix = 'Use the `mj_execute_code` tool to interact with the following tools in this test pass:';
  const idx = lines.findIndex(l => l.includes(targetPrefix));
  
  if (idx !== -1 && idx + 1 < lines.length) {
    const assignedTools = reverseMap[file] || [];
    // Format the tools line as backticked, comma-separated list
    const toolsLine = assignedTools.map(t => `\`${t}\``).join(', ');
    
    // Replace the next line with the new tools list
    lines[idx + 1] = toolsLine;
    fs.writeFileSync(filePath, lines.join('\n'));
    updated++;
  }
}

console.log(`Standardized ${updated} test prompt files based on tool-map.json.`);

import fs from 'fs';
import path from 'path';

const ssot = fs.readFileSync('C:/Users/chris/.gemini/antigravity/brain/669d9f8a-c14c-4dde-8806-f4acba74b6da/scratch/ssot-mapping.md', 'utf8');
const toolMapPath = 'C:/Users/chris/Desktop/memory-journal-mcp/test-server/scripts/tool-map.json';
const toolMapData = JSON.parse(fs.readFileSync(toolMapPath, 'utf8'));

const regex = /`([^`]+)`/g;
const ssotTools = [];
let match;
while ((match = regex.exec(ssot)) !== null) {
  const t = match[1];
  if (t !== 'test-server/scripts/tool-map.json' && t !== 'src/filtering/tool-constants.ts') {
    ssotTools.push(t);
  }
}

const mapTools = Object.keys(toolMapData.toolMap);
const missingInMap = ssotTools.filter(t => !mapTools.includes(t));
const missingInSSoT = mapTools.filter(t => !ssotTools.includes(t));

console.log('Missing in map:', missingInMap);
console.log('Missing in SSoT:', missingInSSoT);

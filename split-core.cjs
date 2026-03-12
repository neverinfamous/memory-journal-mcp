const fs = require('fs');

const path = 'src/handlers/resources/core.ts';
const lines = fs.readFileSync(path, 'utf8').split('\n');

const briefingLines = lines.slice(37, 618).join('\n');
const instructionsLines = lines.slice(618, 661).join('\n');
const recentLines = lines.slice(661, 681).join('\n');
const significantLines = lines.slice(681, 722).join('\n');
const tagsLines = lines.slice(722, 743).join('\n');
const statisticsLines = lines.slice(743, 758).join('\n');
const healthLines = lines.slice(758, 821).join('\n');
const getTotalToolCountLines = lines.slice(28, 32).join('\n');

const briefingContent = `import * as fs from 'node:fs'
import * as path from 'node:path'
import { ICON_BRIEFING } from '../../../constants/icons.js'
import pkg from '../../../../package.json' with { type: 'json' }
import { DEFAULT_BRIEFING_CONFIG } from '../shared.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../shared.js'

export function getBriefingResource(): InternalResourceDef {
    return ${briefingLines.trim().replace(/,$/, '')}
}
`;

fs.writeFileSync('src/handlers/resources/core/briefing.ts', briefingContent);

const instructionsContent = `import { ICON_BRIEFING } from '../../../constants/icons.js'
import { getAllToolNames } from '../../../filtering/tool-filter.js'
import { generateInstructions, type InstructionLevel } from '../../../constants/server-instructions.js'
import { getPrompts } from '../../prompts/index.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../shared.js'

export function getInstructionsResource(): InternalResourceDef {
    return ${instructionsLines.trim().replace(/,$/, '')}
}
`;

fs.writeFileSync('src/handlers/resources/core/instructions.ts', instructionsContent);

const statsContent = `import {
    ICON_CLOCK,
    ICON_HEALTH,
    ICON_STAR,
    ICON_TAG,
    ICON_ANALYTICS,
} from '../../../constants/icons.js'
import { getAllToolNames } from '../../../filtering/tool-filter.js'
import type { Tag } from '../../../types/index.js'
import type { InternalResourceDef, ResourceContext, ResourceResult } from '../shared.js'
import { execQuery, transformEntryRow } from '../shared.js'

${getTotalToolCountLines}

export function getStatsResources(): InternalResourceDef[] {
    return [
${recentLines}
${significantLines}
${tagsLines}
${statisticsLines}
${healthLines}
    ]
}
`;

fs.writeFileSync('src/handlers/resources/core/stats.ts', statsContent);

const indexContent = `import type { InternalResourceDef } from '../shared.js'
import { getBriefingResource } from './briefing.js'
import { getInstructionsResource } from './instructions.js'
import { getStatsResources } from './stats.js'

export function getCoreResourceDefinitions(): InternalResourceDef[] {
    return [
        getBriefingResource(),
        getInstructionsResource(),
        ...getStatsResources()
    ]
}
`;

fs.writeFileSync('src/handlers/resources/core/index.ts', indexContent);

console.log('Script done.');

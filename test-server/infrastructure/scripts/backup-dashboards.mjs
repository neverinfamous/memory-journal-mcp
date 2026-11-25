/**
 * Backup Datadog dashboards for memory-journal-mcp via the `pup` CLI.
 * Strips Datadog API metadata so exported definitions remain portable.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configDir = join(__dirname, '..', 'config');

const DASHBOARDS = [
    { id: 'my6-q9k-682', file: 'datadog-dashboard.json' },
    { id: '79q-b3r-jhu', file: 'datadog-ai-dashboard.json' },
];

const METADATA_KEYS = new Set([
    'id',
    'url',
    'author_handle',
    'author_name',
    'created_at',
    'modified_at',
    'deleted_at',
]);

function stripMetadata(rawJson) {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Unexpected dashboard payload from pup dashboards get');
    }
    const clean = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (!METADATA_KEYS.has(key)) {
            clean[key] = value;
        }
    }
    return JSON.stringify(clean, null, 2) + '\n';
}

let updatedCount = 0;

for (const dashboard of DASHBOARDS) {
    console.log(`Downloading dashboard ${dashboard.file} (${dashboard.id})...`);
    try {
        const raw = execFileSync(
            'pup',
            ['dashboards', 'get', dashboard.id, '-o', 'json'],
            { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'] }
        );
        const formatted = stripMetadata(raw);
        const dest = join(configDir, dashboard.file);
        const previous = existsSync(dest) ? readFileSync(dest, 'utf-8') : null;
        if (previous === formatted) {
            console.log(`  -> Unchanged (${dashboard.file}).`);
        } else {
            writeFileSync(dest, formatted, 'utf-8');
            updatedCount++;
            console.log(`  -> Saved portable definition to ${dest}`);
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`  -> Failed to download ${dashboard.file}: ${msg}`);
        process.exit(1);
    }
}

console.log(`Dashboard backup complete (${updatedCount} updated).`);

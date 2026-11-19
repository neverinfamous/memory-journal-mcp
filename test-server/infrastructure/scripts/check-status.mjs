import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function resolveDockerCommand() {
    if (process.platform !== 'win32') {
        return { cmd: 'docker', prefixArgs: [] };
    }
    try {
        execFileSync('docker', ['info'], { stdio: 'pipe' });
        return { cmd: 'docker', prefixArgs: [] };
    } catch {
        return { cmd: 'wsl', prefixArgs: ['--exec', 'docker'] };
    }
}

const { cmd: dockerCmd, prefixArgs } = resolveDockerCommand();

const execDocker = (args, ignoreError = false) => {
    try {
        return execFileSync(dockerCmd, [...prefixArgs, ...args], {
            encoding: 'utf-8',
            stdio: 'pipe',
            cwd: REPO_ROOT,
        });
    } catch (e) {
        if (!ignoreError) {
            console.error(`Error: ${e.message}`);
        }
        return null;
    }
};

function parseExpectedContainers() {
    const jsonRaw = execDocker(['compose', 'config', '--format', 'json'], true);
    if (jsonRaw) {
        try {
            const parsed = JSON.parse(jsonRaw);
            if (parsed && typeof parsed === 'object' && parsed.services) {
                return Object.entries(parsed.services)
                    .map(([service, def]) => ({
                        service,
                        containerName: def?.container_name || `mj-${service}`,
                    }))
                    .sort((a, b) => a.service.localeCompare(b.service));
            }
        } catch {
            // Fallback to YAML parse below
        }
    }

    try {
        const yamlContent = fs.readFileSync(path.join(REPO_ROOT, 'docker-compose.yml'), 'utf-8');
        const targets = [];
        let inServices = false;
        let currentService = null;
        let currentContainer = null;

        for (const line of yamlContent.split('\n')) {
            if (line.startsWith('services:')) {
                inServices = true;
                continue;
            }
            if (!inServices) continue;
            if (/^[a-zA-Z]/.test(line)) break;

            const svcMatch = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
            if (svcMatch) {
                if (currentService) {
                    targets.push({
                        service: currentService,
                        containerName: currentContainer || `mj-${currentService}`,
                    });
                }
                currentService = svcMatch[1];
                currentContainer = null;
                continue;
            }
            const nameMatch = line.match(/^\s+container_name:\s*([^\s#]+)/);
            if (nameMatch && currentService) {
                currentContainer = nameMatch[1].replace(/^['"]|['"]$/g, '');
            }
        }
        if (currentService) {
            targets.push({
                service: currentService,
                containerName: currentContainer || `mj-${currentService}`,
            });
        }
        if (targets.length === 0) {
            console.error('Failed to parse any services from docker-compose.yml.');
            process.exit(1);
        }
        return targets.sort((a, b) => a.service.localeCompare(b.service));
    } catch {
        console.error('Failed to read docker-compose.yml services.');
        process.exit(1);
    }
}

async function checkHttpEndpoint(label, url) {
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
            console.log(`✅ ${label.padEnd(24)} : HTTP ${res.status} (${url})`);
            return true;
        }
        console.log(`❌ ${label.padEnd(24)} : HTTP ${res.status} (${url})`);
        return false;
    } catch (err) {
        console.log(`❌ ${label.padEnd(24)} : Unreachable (${err instanceof Error ? err.message : String(err)})`);
        return false;
    }
}

const targets = parseExpectedContainers();

console.log('=== Memory Journal Observability Status Check ===\n');
console.log(`Container Status (${targets.length} services):`);
console.log('----------------------------------------');

let allUp = true;

const psOutput = execDocker(['ps', '-a', '--format', '{{.Names}}|{{.State}}|{{.Status}}|{{.Image}}'], false);
if (psOutput === null) {
    console.error('Error: Failed to execute docker ps. Docker daemon might not be running.');
    process.exit(1);
}

const runningContainers = {};
for (const line of psOutput.trim().split('\n')) {
    if (!line.trim()) continue;
    const [name, state, status, image] = line.split('|');
    if (name) {
        runningContainers[name.trim()] = {
            state: (state || '').trim(),
            status: (status || '').trim(),
            image: (image || '').trim(),
        };
    }
}

for (const { service, containerName } of targets) {
    const info = runningContainers[containerName];
    const renameOrphan = Object.keys(runningContainers).find((n) => n.endsWith(`_${containerName}`));

    if (renameOrphan) {
        console.log(
            `⚠️ ${containerName.padEnd(24)} : Stuck rename-prefix container detected (${renameOrphan}) — run recreate-ecosystem.mjs`
        );
        allUp = false;
        continue;
    }

    if (info) {
        let displayStatus = `${info.status} [${info.image}]`;
        let icon = '✅';
        if (info.state !== 'running') {
            if (service === 'datadog-unified') {
                icon = '⚠️';
                displayStatus = `Down (${info.state}) - Expected without DD_API_KEY`;
            } else {
                icon = '❌';
                displayStatus = `Down (${info.state})`;
                allUp = false;
            }
        } else if (info.status.includes('unhealthy')) {
            icon = '❌';
            allUp = false;
        } else if (info.status.includes('health: starting')) {
            icon = '⏳';
            allUp = false;
        }
        console.log(`${icon} ${containerName.padEnd(24)} : ${displayStatus}`);
    } else if (service === 'datadog-unified') {
        console.log(`⚠️ ${containerName.padEnd(24)} : Not Found (Expected without DD_API_KEY)`);
    } else {
        console.log(`❌ ${containerName.padEnd(24)} : Not Found / Offline`);
        allUp = false;
    }
}

console.log('\nHTTP Endpoint & Scrape Target Health:');
console.log('----------------------------------------');
const promOk = await checkHttpEndpoint('Prometheus (:9091)', 'http://localhost:9091/-/healthy');
const grafOk = await checkHttpEndpoint('Grafana (:3002)', 'http://localhost:3002/api/health');
if (!promOk || !grafOk) {
    allUp = false;
}

if (promOk) {
    try {
        const targetsRes = await fetch('http://localhost:9091/api/v1/targets?state=active', {
            signal: AbortSignal.timeout(4000),
        });
        if (targetsRes.ok) {
            const payload = await targetsRes.json();
            const activeTargets = payload?.data?.activeTargets || [];
            const downTargets = activeTargets.filter((t) => t.health !== 'up');
            if (activeTargets.length > 0 && downTargets.length === 0) {
                console.log(`✅ ${'Prometheus Targets'.padEnd(24)} : ${activeTargets.length} target(s) all UP`);
            } else if (downTargets.length > 0) {
                console.log(
                    `⚠️ ${'Prometheus Targets'.padEnd(24)} : ${downTargets.length}/${activeTargets.length} DOWN (${downTargets.map((t) => t.lastError || t.labels?.job).join('; ')})`
                );
                allUp = false;
            }
        }
    } catch {
        // Non-fatal if targets endpoint unreachable
    }
}

const ddInfo = runningContainers['mj-datadog-unified'];
if (ddInfo && ddInfo.state === 'running') {
    const ddStatusOut = execDocker(['exec', 'mj-datadog-unified', 'agent', 'status'], true);
    if (ddStatusOut) {
        const lines = ddStatusOut.split(/\r?\n/);
        const errorChecks = lines.filter((l) => l.includes('Instance ID:') && l.includes('[ERROR]'));
        const okChecks = lines.filter((l) => l.includes('Instance ID:') && l.includes('[OK]'));
        if (errorChecks.length > 0) {
            console.log(`❌ ${'Datadog Integrations'.padEnd(24)} : ${errorChecks.length} integration ERROR(s)`);
            for (const errLine of errorChecks) {
                console.log(`   ❌ ${errLine.trim()}`);
            }
            allUp = false;
        } else if (okChecks.length > 0) {
            console.log(`✅ ${'Datadog Integrations'.padEnd(24)} : ${okChecks.length} integration checks all OK`);
        }
    }
}

console.log('\n========================================');
if (allUp) {
    console.log('🎉 Memory Journal observability stack is fully healthy!');
} else {
    console.log('⚠️ Ecosystem has issues. Run recreate-ecosystem.mjs or inspect container logs.');
    process.exit(1);
}

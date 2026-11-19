import { execFileSync, execSync } from 'child_process';
import { setTimeout } from 'timers/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');

const secretsEnvPath = process.env.SECRETS_ENV_PATH || join(REPO_ROOT, '.env');
if (fs.existsSync(secretsEnvPath)) {
    const envConfig = fs.readFileSync(secretsEnvPath, 'utf-8');
    envConfig.split('\n').forEach((line) => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
            process.env[match[1]] = (match[2] || '').trim().replace(/^['"](.*)['"]$/, '$1');
        }
    });
    process.env.WSLENV = process.env.WSLENV ? `${process.env.WSLENV}:DD_API_KEY/u` : 'DD_API_KEY/u';
}

function resolveDockerCommand() {
    if (process.platform !== 'win32') {
        return { cmd: 'docker', prefixArgs: [], shellPrefix: 'docker' };
    }
    try {
        execFileSync('docker', ['info'], { stdio: 'pipe' });
        return { cmd: 'docker', prefixArgs: [], shellPrefix: 'docker' };
    } catch {
        return { cmd: 'wsl', prefixArgs: ['--exec', 'docker'], shellPrefix: 'wsl --exec docker' };
    }
}

const { cmd: dockerCmd, prefixArgs, shellPrefix } = resolveDockerCommand();

function runDocker(args) {
    console.log(`\n> ${shellPrefix} ${args.join(' ')}`);
    execFileSync(dockerCmd, [...prefixArgs, ...args], { stdio: 'inherit', cwd: REPO_ROOT });
}

function runDockerQuiet(args) {
    try {
        return execFileSync(dockerCmd, [...prefixArgs, ...args], {
            encoding: 'utf-8',
            cwd: REPO_ROOT,
            stdio: 'pipe',
        });
    } catch {
        return '';
    }
}

function parseExpectedContainers() {
    const jsonRaw = runDockerQuiet(['compose', 'config', '--format', 'json']);
    if (jsonRaw) {
        try {
            const parsed = JSON.parse(jsonRaw);
            if (parsed && typeof parsed === 'object' && parsed.services) {
                return Object.entries(parsed.services).map(([service, def]) => ({
                    service,
                    containerName: def?.container_name || `mj-${service}`,
                }));
            }
        } catch {
            // Fall through to YAML parser
        }
    }

    const yamlContent = fs.readFileSync(join(REPO_ROOT, 'docker-compose.yml'), 'utf-8');
    const results = [];
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
                results.push({
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
        results.push({
            service: currentService,
            containerName: currentContainer || `mj-${currentService}`,
        });
    }
    return results;
}

console.log('=== Recreating Memory Journal Monitoring Ecosystem ===');

try {
    // ── Phase 1: Discover services & container_name mappings ──────────
    console.log('\n[1/4] Discovering containers from docker-compose.yml...');
    const targets = parseExpectedContainers();
    if (targets.length === 0) {
        throw new Error('No services found in docker-compose.yml. Is the file valid?');
    }
    console.log(
        `  Found ${targets.length} services: ${targets.map((t) => `${t.service} (${t.containerName})`).join(', ')}`
    );

    // ── Phase 2: Cleanup containers (including stuck rename prefixes) ─
    console.log('\n[2/4] Cleaning up old containers and volumes...');
    const existingNames = runDockerQuiet(['ps', '-a', '--format', '{{.Names}}'])
        .trim()
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

    // [INVARIANT] Only target explicit `mj-*` containerName values (and `*_mj-*` rename-prefix orphans).
    // NEVER remove bare Compose service keys (`dozzle`, `prometheus`, `grafana`, `loki`, `alloy`,
    // `datadog-unified`), which belong to the sibling `unified-database-ecosystem` stack!
    const expectedContainerSet = new Set(targets.map((t) => t.containerName));
    const toRemove = new Set();
    for (const { containerName } of targets) {
        if (existingNames.includes(containerName)) toRemove.add(containerName);
    }
    for (const existing of existingNames) {
        for (const expected of expectedContainerSet) {
            if (existing.endsWith(`_${expected}`)) {
                toRemove.add(existing);
            }
        }
    }
    for (const name of toRemove) {
        runDockerQuiet(['rm', '-f', name]);
    }

    // [INVARIANT] Omit `-v` so `mj-dozzle-data` (UI users & preferences) persists across stack recreates.
    runDocker(['compose', 'down', '--remove-orphans']);
    runDockerQuiet(['volume', 'rm', '-f', 'mj-infrastructure_prometheus_data']);
    console.log('  Giving Docker daemon time to flush networks...');
    await setTimeout(3000);

    // ── Phase 2.5: Ensure WSL2 -> Windows 127.0.0.1:9465 metrics relay ─
    if (dockerCmd === 'wsl' || fs.existsSync('/mnt/c/Windows/System32/curl.exe')) {
        console.log('\n[2.5/4] Ensuring WSL2 loopback metrics relay (mj-metrics-relay.service)...');
        const relaySource = fs.readFileSync(join(__dirname, 'wsl-metrics-relay.mjs'), 'utf-8');
        const installScript = [
            'set -e',
            'mkdir -p ~/.local/share/memory-journal-mcp ~/.config/systemd/user',
            'cat > ~/.local/share/memory-journal-mcp/wsl-metrics-relay.mjs << \'EOF_RELAY\'',
            relaySource.trimEnd(),
            'EOF_RELAY',
            'DOCKER0_IP=$(ip -4 addr show docker0 2>/dev/null | awk \'/inet / {split($2,a,"/"); print a[1]; exit}\')',
            'RELAY_HOST=${DOCKER0_IP:-172.17.0.1}',
            'cat > ~/.config/systemd/user/mj-metrics-relay.service << EOF_UNIT',
            '[Unit]',
            'Description=Memory Journal WSL2 to Windows Loopback Metrics Relay (:9465)',
            'After=network.target',
            '',
            '[Service]',
            'Type=simple',
            'Environment=MJ_RELAY_HOST=${RELAY_HOST}',
            'Environment=MJ_RELAY_PORT=9465',
            'ExecStart=/usr/bin/node %h/.local/share/memory-journal-mcp/wsl-metrics-relay.mjs',
            'Restart=always',
            'RestartSec=3',
            '',
            '[Install]',
            'WantedBy=default.target',
            'EOF_UNIT',
            'systemctl --user daemon-reload',
            'systemctl --user enable --now mj-metrics-relay.service',
        ].join('\n');

        if (dockerCmd === 'wsl') {
            execFileSync('wsl', ['--exec', 'bash', '-s'], {
                input: installScript,
                stdio: ['pipe', 'inherit', 'inherit'],
                cwd: REPO_ROOT,
            });
        } else {
            execFileSync('bash', ['-s'], {
                input: installScript,
                stdio: ['pipe', 'inherit', 'inherit'],
                cwd: REPO_ROOT,
            });
        }
    }

    // ── Phase 3: Start ecosystem ──────────────────────────────────────
    console.log('\n[3/4] Starting ecosystem containers...');
    runDocker(['compose', 'up', '-d', '--remove-orphans']);

    // ── Phase 4: Verify health via check-status.mjs ───────────────────
    console.log('\n[4/4] Waiting for container healthchecks...');
    const maxAttempts = 20;
    let healthy = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            execSync(`node "${join(__dirname, 'check-status.mjs')}"`, {
                cwd: REPO_ROOT,
                stdio: attempt === maxAttempts ? 'inherit' : 'pipe',
            });
            healthy = true;
            break;
        } catch {
            if (attempt < maxAttempts) {
                await setTimeout(3000);
            }
        }
    }

    if (!healthy) {
        throw new Error('Ecosystem containers did not reach healthy state within timeout.');
    }

    console.log('\n✅ Memory Journal Monitoring Ecosystem Successfully Recreated.');
} catch (error) {
    console.error('\n❌ Ecosystem recreation failed:', error.message);
    process.exit(1);
}

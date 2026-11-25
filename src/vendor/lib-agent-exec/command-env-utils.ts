// @ts-nocheck
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { IMMUTABLE_ENV_OVERRIDES } from './environment.js';
import { convertToWindowsPath, convertToWslPath } from './path-convert.js';

/**
 * [INTENT]: Build sanitized `KEY=VALUE` pairs for `wsl.exe env ...`, normalizing PATH and protecting immutable overrides.
 */
export function buildWslEnvArgs(payloadEnv?: Record<string, unknown>, envOverrides: Record<string, string> = {}): string[] {
  const wslEnvArgs: string[] = [];
  const wslUuid = crypto.randomUUID();
  wslEnvArgs.push(`AGENT_EXEC_WSL_UUID=${wslUuid}`);
  const env = payloadEnv ?? {};
  let hasExplicitPath = false;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || v === null || k.length === 0 || /[=\r\n\0]/.test(k)) continue;
    const strVal = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
    if (strVal.length === 0 && typeof v !== 'string') continue;
    const upperKey = k.toUpperCase();
    if (upperKey === 'AGENT_EXEC_WSL_UUID' || IMMUTABLE_ENV_OVERRIDES.has(upperKey)) continue;
    if (upperKey === 'PATH') {
      hasExplicitPath = true;
      const wslPathVal = /[a-zA-Z]:[/\\]/.test(strVal)
        ? strVal.split(';').filter(Boolean).map(seg => convertToWslPath(seg)).join(':')
        : strVal;
      wslEnvArgs.push(`PATH=${wslPathVal}`);
      continue;
    }
    wslEnvArgs.push(`${k}=${convertToWslPath(strVal)}`);
  }
  for (const [k, v] of Object.entries(envOverrides)) {
    const upperKey = k.toUpperCase();
    if (upperKey === 'PATH') {
      hasExplicitPath = true;
      const wslPathVal = /[a-zA-Z]:[/\\]/.test(v)
        ? v.split(';').filter(Boolean).map(seg => convertToWslPath(seg)).join(':')
        : v;
      wslEnvArgs.push(`PATH=${wslPathVal}`);
      continue;
    }
    wslEnvArgs.push(`${k}=${convertToWslPath(v)}`);
  }

  if (!hasExplicitPath) {
    const wslUser = (process.env['WSL_USER'] ?? path.basename(os.homedir())).trim() || 'ubuntu';
    const defaultWslPathsList = [
      `/home/${wslUser}/.bun/bin`,
      `/home/${wslUser}/.cargo/bin`,
      `/home/${wslUser}/.local/bin`,
      '/root/.bun/bin',
      '/root/.cargo/bin',
      '/root/.local/bin',
      '/usr/local/sbin',
      '/usr/local/bin',
      '/usr/sbin',
      '/usr/bin',
      '/sbin',
      '/bin',
    ];
    const appData = process.env['APPDATA'];
    if (appData !== undefined && appData.length > 0) {
      defaultWslPathsList.push(convertToWslPath(path.join(appData, 'npm')));
    } else {
      defaultWslPathsList.push(convertToWslPath(path.join(os.homedir(), 'AppData', 'Roaming', 'npm')));
    }
    const defaultWslPaths = defaultWslPathsList.join(':');
    wslEnvArgs.push(`PATH=${defaultWslPaths}`);
  }

  return wslEnvArgs;
}

const PKG_SCRIPT_VALUE_FLAGS = new Set([
  '--filter', '-F', '-C', '--dir', '--cwd', '--prefix', '--config', '-c',
]);
const PKG_DIR_FLAGS = new Set(['-C', '--dir', '--cwd', '--prefix']);

function normalizePkgCwd(rawDir: string): string {
  return process.platform === 'win32' && /^\/mnt\/[a-zA-Z](?:\/|$)/i.test(rawDir)
    ? convertToWindowsPath(rawDir)
    : rawDir;
}

function resolvePkgScriptDir(payloadCwd: string | undefined, dirFlagVal: string | undefined): string {
  const normBase = payloadCwd !== undefined && payloadCwd.length > 0 ? normalizePkgCwd(payloadCwd) : process.cwd();
  const baseCwd = path.resolve(normBase);
  if (dirFlagVal === undefined || dirFlagVal.length === 0) return baseCwd;
  const normFlag = normalizePkgCwd(dirFlagVal);
  return path.isAbsolute(normFlag) ? path.normalize(normFlag) : path.resolve(baseCwd, normFlag);
}

const PackageScriptsSchema = z.object({
  scripts: z.record(z.string(), z.unknown()).optional(),
});

const PKG_SCRIPT_MANAGERS = new Set(['pnpm', 'npm', 'bun', 'yarn']);

/**
 * [INTENT]: Look up the underlying command string for `npm|pnpm|bun|yarn` script invocations via `package.json`.
 */
export function getUnderlyingPackageScript(cmdBasename: string, args: string[] | undefined, payloadCwd: string | undefined): string {
  const base = cmdBasename.toLowerCase().replace(/\.(cmd|exe)$/i, '');
  if (!PKG_SCRIPT_MANAGERS.has(base) || !args || args.length === 0) return '';
  const nonFlagArgs: string[] = [];
  let dirFlagVal: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '--') break;
    const eqIdx = a.indexOf('=');
    const flagKey = eqIdx === -1 ? a : a.slice(0, eqIdx);
    if (eqIdx !== -1 && PKG_DIR_FLAGS.has(flagKey)) {
      dirFlagVal = a.slice(eqIdx + 1);
      continue;
    }
    if (PKG_SCRIPT_VALUE_FLAGS.has(a)) {
      if (PKG_DIR_FLAGS.has(a) && args[i + 1] !== undefined) dirFlagVal = args[i + 1];
      i += 1;
      continue;
    }
    if (a.startsWith('-')) continue;
    nonFlagArgs.push(a);
  }
  const scriptName = (nonFlagArgs[0] === 'run' || nonFlagArgs[0] === 'exec') ? nonFlagArgs[1] : nonFlagArgs[0];
  if (!scriptName) return '';
  try {
    const pkgPath = path.join(resolvePkgScriptDir(payloadCwd, dirFlagVal), 'package.json');
    if (fs.statSync(pkgPath, { throwIfNoEntry: false })?.isFile() !== true) return '';
    const parsedPkg = PackageScriptsSchema.safeParse(JSON.parse(fs.readFileSync(pkgPath, 'utf8')));
    if (!parsedPkg.success || parsedPkg.data.scripts === undefined) return '';
    const scripts = parsedPkg.data.scripts;
    const val = Object.hasOwn(scripts, scriptName) ? scripts[scriptName] : undefined;
    return typeof val === 'string' ? val : '';
  } catch (err: unknown) {
    const code = err !== null && typeof err === 'object' && 'code' in err ? err.code : undefined;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      console.error(`⚠️ package.json script lookup warning: ${err instanceof Error ? err.message : String(err)}`);
    }
    return '';
  }
}

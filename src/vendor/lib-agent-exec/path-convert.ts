// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';

export function formatForCmdExe(args: string[]): string[] {
  if (args[0]?.toLowerCase() !== '/c') return args;
  const originalCmdAndArgs = args.slice(1);
  const commandLine = originalCmdAndArgs.map(arg => {
    let crtArg = arg;
    if (/[ \t\n\v"]/.test(arg) || arg.length === 0) {
      // CRT argv quoting doubles backslashes only when they precede a quote (including the closing quote).
      crtArg = arg.replace(/(\\+)(")/g, '$1$1$2'); // codeql[js/incomplete-sanitization]
      crtArg = crtArg.replace(/"/g, '\\"');
      crtArg = crtArg.replace(/(\\+)$/, '$1$1');
      crtArg = `"${crtArg}"`;
    }
    let cmdArg = '';
    let inQuotes = false;
    for (let i = 0; i < crtArg.length; i++) {
      const char = crtArg[i];
      if (char === '"') {
        inQuotes = !inQuotes;
        cmdArg += char;
      } else if (!inQuotes && /[&|<>^]/.test(char)) {
        cmdArg += '^' + char;
      } else {
        cmdArg += char;
      }
    }
    return cmdArg;
  }).join(' ');
  return ['/d', '/s', '/c', `"${commandLine}"`];
}

export function convertToWslPath(winPath: string): string {
  if (winPath.startsWith('^') || winPath.startsWith('$')) {
    return winPath;
  }

  if (!winPath || typeof winPath !== 'string') {
    return winPath ?? '';
  }

  const transform = (p: string) => {
    return p.replace(/^([a-zA-Z]):[/\\]+(.*)/, (_match, drive: string, rest: string) => `/mnt/${drive.toLowerCase()}/${rest.replace(/\\+/g, '/')}`);
  };

  if (path.win32.isAbsolute(winPath)) {
    return transform(winPath);
  }

  const doubleQuoteMatch = winPath.match(/^"(.+)"$/);
  const singleQuoteMatch = winPath.match(/^'(.+)'$/);
  if (doubleQuoteMatch?.[1] !== undefined && path.win32.isAbsolute(doubleQuoteMatch[1])) {
    return `"${transform(doubleQuoteMatch[1])}"`;
  }
  if (singleQuoteMatch?.[1] !== undefined && path.win32.isAbsolute(singleQuoteMatch[1])) {
    return `'${transform(singleQuoteMatch[1])}'`;
  }

  const kvMatch = winPath.match(/^([a-zA-Z0-9_-]+[=:])(.+)$/);
  if (kvMatch?.[1] !== undefined && kvMatch[2] !== undefined) {
    const prefix = kvMatch[1];
    const value = kvMatch[2];

    const doubleQuoteMatchValue = value.match(/^"(.+)"$/);
    const singleQuoteMatchValue = value.match(/^'(.+)'$/);

    if (doubleQuoteMatchValue?.[1] !== undefined && path.win32.isAbsolute(doubleQuoteMatchValue[1])) {
      return `${prefix}"${transform(doubleQuoteMatchValue[1])}"`;
    }
    if (singleQuoteMatchValue?.[1] !== undefined && path.win32.isAbsolute(singleQuoteMatchValue[1])) {
      return `${prefix}'${transform(singleQuoteMatchValue[1])}'`;
    }
    if (path.win32.isAbsolute(value)) {
      return `${prefix}${transform(value)}`;
    }
    if (value.includes('\\')) {
      if (/[{}`;|"'<>:]/.test(value)) return winPath;
      if (value.includes(' ') && !fs.existsSync(value.trim())) return winPath;
      if (value.trim().endsWith('\\') && !fs.existsSync(value.trim())) return winPath;
      if (prefix.endsWith(':') && !/^[a-zA-Z]:[/\\]/.test(value.trim())) return winPath;
      return `${prefix}${value.replace(/\\/g, '/')}`;
    }
  }

  if (!winPath.startsWith('-') && winPath.includes('\\')) {
    if (/[{}`;|"'<>:]/.test(winPath)) return winPath;
    if (winPath.includes(' ') && !fs.existsSync(winPath)) return winPath;
    if (winPath.endsWith('\\') && !fs.existsSync(winPath)) return winPath;
    return winPath.replace(/\\/g, '/');
  }

  return winPath;
}

export function convertToWindowsPath(wslPath: string): string {
  if (!wslPath || typeof wslPath !== 'string') {
    return wslPath ?? '';
  }

  const trimmed = wslPath.trim();
  const quoteMatch = trimmed.match(/^(['"])(.*)\1$/);
  const target = quoteMatch !== null && quoteMatch[2] !== undefined ? quoteMatch[2] : trimmed;

  const mntMatch = target.match(/^\/?mnt\/([a-zA-Z])(?:\/(.*))?$/i);
  if (mntMatch !== null && mntMatch[1] !== undefined) {
    const drive = mntMatch[1].toUpperCase();
    const rest = mntMatch[2] !== undefined ? mntMatch[2].replace(/\//g, '\\') : '';
    const winPath = rest.length > 0 ? `${drive}:\\${rest}` : `${drive}:\\`;
    return quoteMatch !== null && quoteMatch[1] !== undefined ? `${quoteMatch[1]}${winPath}${quoteMatch[1]}` : winPath;
  }

  return wslPath;
}

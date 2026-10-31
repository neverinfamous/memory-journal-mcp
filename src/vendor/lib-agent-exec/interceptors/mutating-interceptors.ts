// @ts-nocheck
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { match, P } from 'ts-pattern';
import { execSync } from 'node:child_process';
import { ExecutionContext } from './types.js';
import { getPositionalArgs, convertToWslPath } from '../command-utils.js';

export function runMutatingInterceptors(
  ctx: ExecutionContext,
  derived: { cmd: string; cmdBasename: string; args: string[] }
) {
  const { cmd, cmdBasename, args } = derived;

  match({ cmd, args })
    .with({ cmd: P.union('ssh', 'ssh.exe', 'scp', 'scp.exe', 'sftp', 'sftp.exe') }, ({ args: matchedArgs }) => {
      if (!matchedArgs.some(a => a.includes('BatchMode=yes'))) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-o BatchMode=yes' into ${cmdBasename} command to prevent password prompt hanging.... (Frictionless Recovery)`);
        ctx.args.unshift('-o', 'BatchMode=yes');
      }
      if (!matchedArgs.some(a => a.includes('StrictHostKeyChecking='))) {
        ctx.args.unshift('-o', 'StrictHostKeyChecking=accept-new');
      }
    })
    .with({ cmd: P.union('ping', 'ping.exe') }, ({ args: matchedArgs }) => {
      if (process.platform === 'win32' || cmd === 'ping.exe') {
        if (matchedArgs.includes('-t')) {
          console.error(`\n   💡 AGENT HINT: 'ping -t' runs indefinitely. Stripping '-t'.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
          for (let i = ctx.args.length - 1; i >= 0; i--) {
            if (ctx.args[i] === '-t') ctx.args.splice(i, 1);
          }
        }
      } else {
        if (!matchedArgs.includes('-c')) {
          console.error(`\n   🛠️ AUTONOMOUS HEALING: 'ping' on Unix runs indefinitely without '-c'. Injecting '-c 4'.... (Frictionless Recovery)`);
          ctx.args.unshift('-c', '4');
        }
      }
    })
    .with({ cmd: P.union('rm', 'rm.exe') }, ({ args: matchedArgs }) => {
      const hasForce = matchedArgs.some(a => a === '-f' || a === '--force' || /^-([a-zA-Z]*f[a-zA-Z]*)$/.test(a));
      if (!hasForce) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-f' into rm command to prevent interactive prompts and missing file errors.... (Frictionless Recovery)\x1b[0m`);
        ctx.args.unshift('-f');
      }
    })
    .with({ cmd: P.union('sudo', 'sudo.exe') }, ({ args: matchedArgs }) => {
      if (process.platform !== 'win32' && !matchedArgs.includes('-n') && !matchedArgs.includes('--non-interactive')) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-n' (non-interactive) into sudo command to prevent password prompt hanging.... (Frictionless Recovery)`);
        ctx.args.unshift('-n');
      }
    })
    .with({ cmd: P.union('git', 'git.exe') }, ({ args: matchedArgs }) => {
      const gitCwd = ctx.payload.cwd !== undefined && ctx.payload.cwd.length > 0 ? path.resolve(ctx.payload.cwd) : process.cwd();
      const lockPath = path.join(gitCwd, '.git', 'index.lock');
      if (fs.existsSync(lockPath)) {
        try {
          const stats = fs.statSync(lockPath);
          if (Date.now() - stats.mtimeMs > 10000) {
            console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected stale '.git/index.lock' (age: ${Math.round((Date.now() - stats.mtimeMs) / 1000)}s). Removing lock to prevent exit 128... (Frictionless Recovery)\x1b[0m`);
            fs.unlinkSync(lockPath);
          }
        } catch {
          // ignore
        }
      }
      if (matchedArgs.includes('add') && matchedArgs.some(a => a.includes('.agents'))) {
        if (!matchedArgs.includes('-f') && !matchedArgs.includes('--force')) {
           console.error(`\n   🛠️ AUTONOMOUS HEALING: Injecting '-f' to 'git add' for '.agents' path which is ignored... (Frictionless Recovery)\x1b[0m`);
           ctx.args.splice(ctx.args.indexOf('add') + 1, 0, '-f');
        }
      }
      if (matchedArgs.includes('branch') && matchedArgs.includes('-r')) {
        console.error(`\n   💡 AGENT HINT: 'git branch -r' may return stale deleted branches.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Synchronously running 'git fetch -p' to prune the cache before executing branch listing.\x1b[0m`);
        try {
          execSync('git fetch -p', { stdio: 'ignore' });
        } catch {
          // ignore
        }
      }
    })
    .with({ cmd: P.union('jq', 'jq.exe') }, ({ args: matchedArgs }) => {
      const hasStdin = ctx.payload.stdin !== undefined && ctx.payload.stdin.length > 0;
      if (hasStdin && getPositionalArgs('jq', matchedArgs).length === 0) {
        console.error(`\n   💡 AGENT HINT: 'jq' requires a filter argument when reading from stdin.`);
        console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-injecting '.' filter... (Frictionless Recovery)\x1b[0m`);
        ctx.args.push('.');
      }
      if (hasStdin && typeof ctx.payload.stdin === 'string') {
        let stdin = ctx.payload.stdin;
        // Check for XML/untrusted wrapper tags like <database_output>...</database_output> or <output>...</output>
        const tagMatch = stdin.match(/<([a-zA-Z0-9_-]+_output|output)>([\s\S]*?)<\/\1>/i);
        if (tagMatch !== null && tagMatch[2] !== undefined) {
          console.error(`\n   🛠️ AUTONOMOUS HEALING: Stripped untrusted wrapper tags (<${tagMatch[1]}>) from jq stdin... (Frictionless Recovery)\x1b[0m`);
          stdin = tagMatch[2].trim();
        } else {
          // Check for markdown code fences
          const fenceMatch = stdin.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
          if (fenceMatch !== null && fenceMatch[1] !== undefined) {
            console.error(`\n   🛠️ AUTONOMOUS HEALING: Stripped markdown code fences from jq stdin... (Frictionless Recovery)\x1b[0m`);
            stdin = fenceMatch[1].trim();
          } else if (stdin.includes('[WARNING:') || stdin.includes('<database_output>')) {
            const cleaned = stdin
              .replace(/\[WARNING:[^\]]*\]/gi, '')
              .replace(/<database_output>/gi, '')
              .replace(/<\/database_output>/gi, '')
              .trim();
            if (cleaned !== stdin) {
              console.error(`\n   🛠️ AUTONOMOUS HEALING: Stripped warning preambles from jq stdin... (Frictionless Recovery)\x1b[0m`);
              stdin = cleaned;
            }
          }
        }
        ctx.payload.stdin = stdin;
      }

      const cwd = ctx.payload.cwd !== undefined && ctx.payload.cwd.length > 0
        ? path.resolve(ctx.payload.cwd)
        : process.cwd();
      const posArgs = getPositionalArgs('jq', ctx.args);
      const hasFilterFile = ctx.args.some(a => a === '-f' || a === '--from-file');
      const fileArgCandidates = hasFilterFile ? posArgs : posArgs.slice(1);

      for (const fileArg of fileArgCandidates) {
        if (!fileArg || fileArg.startsWith('-')) continue;
        const rawFile = fileArg.replace(/^['"]|['"]$/g, '');
        const isWslPath = rawFile.startsWith('/mnt/');
        const wslNormalized = isWslPath
          ? rawFile.replace(/^\/mnt\/([a-zA-Z])\/(.*)$/, (_, drive, rest) => `${drive.toUpperCase()}:/${rest}`)
          : rawFile;
        const resolvedFile = path.isAbsolute(wslNormalized) ? path.normalize(wslNormalized) : path.resolve(cwd, wslNormalized);

        if (fs.existsSync(resolvedFile) && fs.statSync(resolvedFile).isFile()) {
          try {
            const rawContent = fs.readFileSync(resolvedFile, 'utf8');
            let cleaned = rawContent;
            const tagMatch = rawContent.match(/<([a-zA-Z0-9_-]+_output|output)>([\s\S]*?)<\/\1>/i);
            if (tagMatch !== null && tagMatch[2] !== undefined) {
              cleaned = tagMatch[2].trim();
            } else {
              const fenceMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
              if (fenceMatch !== null && fenceMatch[1] !== undefined) {
                cleaned = fenceMatch[1].trim();
              } else if (rawContent.includes('[WARNING:') || rawContent.includes('<database_output>')) {
                cleaned = rawContent
                  .replace(/\[WARNING:[^\]]*\]/gi, '')
                  .replace(/<database_output>/gi, '')
                  .replace(/<\/database_output>/gi, '')
                  .trim();
              }
            }

            if (cleaned !== rawContent) {
              console.error(`\n   🛠️ AUTONOMOUS HEALING: Stripped untrusted wrapper tags / warning preambles from jq input file '${fileArg}'... (Frictionless Recovery)\x1b[0m`);
              const outDir = os.tmpdir();
              const tmpSanitized = path.join(outDir, `.agent_sanitized_jq_${Date.now()}_${path.basename(resolvedFile)}`);
              fs.writeFileSync(tmpSanitized, cleaned, 'utf8');
              process.on('exit', () => {
                try { if (fs.existsSync(tmpSanitized)) fs.unlinkSync(tmpSanitized); } catch { /* ignore */ }
              });
              const newFileArg = isWslPath ? convertToWslPath(tmpSanitized) : tmpSanitized;
              const idx = ctx.args.indexOf(fileArg);
              if (idx !== -1) {
                ctx.args[idx] = newFileArg;
              }
              if ('args' in ctx.payload && Array.isArray(ctx.payload.args)) {
                const pIdx = ctx.payload.args.indexOf(fileArg);
                if (pIdx !== -1) {
                  ctx.payload.args[pIdx] = newFileArg;
                }
              }
            }
          } catch {
            // ignore read error
          }
        }
      }
    })
    .otherwise(() => {});
}

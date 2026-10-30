// @ts-nocheck
import { ExecutionContext, AGENT_NATIVE_TOOLS, ECOSYSTEM_MCP_TOOLS } from './types.js';
import { match, P } from 'ts-pattern';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { convertToWslPath, getPositionalArgs, healFragmentedQuotes, escapeUnixArg, getUnderlyingPackageScript } from '../command-utils.js';
import { getUnquoted } from './utils.js';
import { findEcosystemScript } from '../utils.js';
import { runMutatingInterceptors } from './mutating-interceptors.js';
import { runStructuralInterceptors } from './structural-interceptors.js';
import { healPathHallucinations, healEvalCodePathHallucinations } from '../path-healer.js';
import { handleFindInterception, handleRipgrepInterception, handleGrepInterception, parseGrepSearchArgs, GREP_EXCLUDE_DIRS } from './search-interceptor.js';
import { isPowerShellCode } from '../eval-healer.js';
const INTERPRETER_INLINE_FLAGS: Record<string, readonly string[]> = {
  node: ['-e', '--eval', '-p', '--print'],
  bun: ['-e', '--eval', '-p', '--print'],
  tsx: ['-e', '--eval', '-p', '--print'],
  'ts-node': ['-e', '--eval', '-p', '--print'],
  python: ['-c', '--command'],
  python3: ['-c', '--command'],
};

function getInlineScriptDetails(interpreter: string, args: string[]): { flagIdx: number; isPrint: boolean; scriptContent: string } | null {
  const allowed = INTERPRETER_INLINE_FLAGS[interpreter.toLowerCase()];
  if (!allowed || args.length === 0) return null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (allowed.includes(arg)) {
      if (i + 1 < args.length) {
        return {
          flagIdx: i,
          isPrint: ['-p', '--print'].includes(arg),
          scriptContent: args[i + 1],
        };
      }
      return null;
    }
    // If we encounter an argument before any inline flag that is NOT an interpreter option,
    // then it's a subcommand or a script path, so any subsequent flags belong to that script/subcommand!
    if (!arg.startsWith('-')) {
      return null;
    }
    // If it looks like a script file or relative/absolute path, it's not an interpreter option
    if (arg.startsWith('./') || arg.startsWith('.\\') || /\\.(?:ts|js|mjs|cjs|py)$/i.test(arg)) {
      return null;
    }
  }
  return null;
}

export function systemInterceptor(ctx: ExecutionContext): void {
  const originalArgs = ctx.args;
  ctx.args = healFragmentedQuotes(ctx.args);
  if (ctx.args.length !== originalArgs.length || ctx.args.some((a, idx) => a !== originalArgs[idx])) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected fragmented quotes from PowerShell tokenization. Reassembling arguments... (Frictionless Recovery)\x1b[0m`);
  }

  // Unwrap shells invoked through package runners (e.g. bun run pwsh -c ... -> pwsh -c ...)
  const pkgBase = ctx.cmdBasename.toLowerCase().replace(/\.(exe|cmd)$/i, '');
  if (['bun', 'pnpm', 'npm', 'npx', 'yarn', 'bunx', 'pnpx', 'node', 'tsx', 'ts-node'].includes(pkgBase)) {
    const runIdx = ctx.args[0]?.toLowerCase() === 'run' ? 1 : 0;
    const possibleShell = ctx.args[runIdx]?.toLowerCase().replace(/\.(exe|cmd)$/i, '');
    if (possibleShell && ['pwsh', 'powershell', 'cmd', 'bash', 'sh', 'wsl'].includes(possibleShell)) {
      console.error(`\n   💡 AGENT HINT: Shell '${possibleShell}' invoked through package runner '${ctx.cmdBasename}'.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Unwrapping package runner to execute shell directly with safety interceptors... (Frictionless Recovery)\x1b[0m`);
      ctx.cmdBasename = possibleShell;
      if (ctx.payload.type === 'command') {
        ctx.payload.command = possibleShell;
      }
      ctx.args = ctx.args.slice(runIdx + 1);
    } else if (ctx.args.some(a => path.basename(a).toLowerCase() === 'agent-exec.ts')) {
      // Nested agent-exec.ts invocation: disable stall interceptors on the wrapper to prevent false-positive aborts
      ctx.payload.bypassInterceptors = true;
      let nestedTimeout = 180000;
      for (const a of ctx.args) {
        if (typeof a === 'string') {
          const timeoutMatch = a.match(/["']?timeoutMs["']?\s*:\s*(\d+)/i) || a.match(/["']?timeout["']?\s*:\s*(\d+)/i);
          if (timeoutMatch && timeoutMatch[1]) {
            const parsed = parseInt(timeoutMatch[1], 10);
            if (!Number.isNaN(parsed) && parsed > nestedTimeout) {
              nestedTimeout = parsed;
            }
          }
          const flagMatch = a.match(/^--(?:timeout|timeoutMs)=(\d+)$/i);
          if (flagMatch && flagMatch[1]) {
            const parsed = parseInt(flagMatch[1], 10);
            if (!Number.isNaN(parsed) && parsed > nestedTimeout) {
              nestedTimeout = parsed;
            }
          }
          if (/(?:docker|docker-compose|podman)/i.test(a) && /(?:build|scout)/i.test(a)) {
            nestedTimeout = Math.max(nestedTimeout, 600000);
          }
          if (/(?:playwright|cypress|\be2e\b)/i.test(a)) {
            nestedTimeout = Math.max(nestedTimeout, 600000);
          }
          if (/(?:coverage|--coverage)/i.test(a)) {
            nestedTimeout = Math.max(nestedTimeout, 480000);
          }
          if (/(?:typecheck|tsc|lint|check|build|test|vitest|jest)/i.test(a)) {
            nestedTimeout = Math.max(nestedTimeout, 600000);
          }
          if (a.endsWith('.json') && fs.existsSync(a)) {
            try {
              const fileContent = fs.readFileSync(a, 'utf8');
              const fileTimeoutMatch = fileContent.match(/["']?timeoutMs["']?\s*:\s*(\d+)/i);
              if (fileTimeoutMatch && fileTimeoutMatch[1]) {
                const parsed = parseInt(fileTimeoutMatch[1], 10);
                if (!Number.isNaN(parsed) && parsed > nestedTimeout) {
                  nestedTimeout = parsed;
                }
              }
              if (/(?:docker|docker-compose|podman)/i.test(fileContent) && /(?:build|scout)/i.test(fileContent)) {
                nestedTimeout = Math.max(nestedTimeout, 600000);
              }
              if (/(?:playwright|cypress|\be2e\b)/i.test(fileContent)) {
                nestedTimeout = Math.max(nestedTimeout, 600000);
              }
              if (/(?:coverage|--coverage)/i.test(fileContent)) {
                nestedTimeout = Math.max(nestedTimeout, 480000);
              }
              if (/(?:typecheck|tsc|lint|check|build|test|vitest|jest)/i.test(fileContent)) {
                nestedTimeout = Math.max(nestedTimeout, 600000);
              }
            } catch { /* ignore */ }
          }
        }
      }
      ctx.payload.timeoutMs = Math.max(ctx.payload.timeoutMs || nestedTimeout, nestedTimeout);
    }
  }

  const { cmdBasename, payload } = ctx;
  const { args } = ctx;
  const exactShellChars = ['|', '>', '<', '&&', '||', ';'];
  const patternTools = ['grep', 'grep.exe', 'egrep', 'fgrep', 'rg', 'rg.exe', 'jq', 'jq.exe', 'yq', 'yq.exe', 'sed', 'sed.exe', 'awk', 'gawk', 'find', 'find.exe', 'fd', 'fd.exe', 'fdfind', 'fdfind.exe', 'node', 'node.exe', 'python', 'python.exe', 'bun', 'bun.exe', 'tail', 'tail.exe', 'head', 'head.exe', 'wc', 'wc.exe', 'sort', 'sort.exe', 'uniq', 'uniq.exe', 'tee', 'tee.exe'];
  const shells = ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe', 'wsl', 'wsl.exe'] as const;
  const inlineFlags = ['-c', '-command', '/c', '-ec', '-encodedcommand', '-en', '-e', '--eval', '-execute', '--execute'];
  if (payload.type === 'eval' && typeof payload.code === 'string') {
    const trimmedCode = payload.code.trim();

    // Frictionless Recovery: detect grep_search invocation in eval code
    if (/^grep_search\s*\(/i.test(trimmedCode)) {
      const patternMatch = trimmedCode.match(/["'`]?(?:SearchPattern|Query|query|pattern)["'`]?\s*:\s*["'`]([^"'`]+)["'`]/i);
      const pathMatch = trimmedCode.match(/["'`]?(?:SearchPath|path|dir)["'`]?\s*:\s*["'`]([^"'`]+)["'`]/i);
      const caseMatch = trimmedCode.match(/["'`]?(?:CaseInsensitive|caseInsensitive)["'`]?\s*:\s*(true|false)/i);
      const regexMatch = trimmedCode.match(/["'`]?(?:IsRegex|isRegex)["'`]?\s*:\s*(true|false)/i);

      if (patternMatch !== null && patternMatch[1] !== undefined) {
        const pattern = patternMatch[1];
        const searchPath = (pathMatch !== null && pathMatch[1] !== undefined) ? pathMatch[1] : '.';
        const isCaseInsensitive = caseMatch !== null && caseMatch[1] !== undefined ? caseMatch[1].toLowerCase() === 'true' : false;
        const isRegex = regexMatch !== null && regexMatch[1] !== undefined ? regexMatch[1].toLowerCase() === 'true' : false;

        console.error(`\n   💡 AGENT HINT: 'grep_search' called as a function inside eval code.`);
        console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating grep_search function call to ripgrep (rg) command... (Frictionless Recovery)\x1b[0m`);

        const flags = ['-n'];
        if (isCaseInsensitive) flags.push('-i');
        if (!isRegex) flags.push('-F');
        payload.target = 'wsl2';
        payload.interpreter = 'bash';
        payload.code = `rg ${flags.join(' ')} ${escapeUnixArg(pattern, false)} ${escapeUnixArg(convertToWslPath(searchPath), false)}`;
      }
    } else {
      const grepSearchCliMatch = trimmedCode.match(/^(?:(?:bun|npm|pnpm|yarn|npx|node|tsx|ts-node)\s+(?:run\s+)?)?(?:(?:\.[/\\])?(?:\.agents[/\\]scripts[/\\]))?grep_search(?:\.ts|\.js)?\b\s*(.*)$/i);
      if (grepSearchCliMatch !== null) {
        const rest = grepSearchCliMatch[1] ?? '';
        const rawTokens = rest.match(/(?:[^\s"'`]+|"[^"]*"|'[^']*'|`[^`]*`)+/g) ?? [];
        const cleanTokens = rawTokens.map(t => {
          if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) || (t.startsWith('`') && t.endsWith('`'))) {
            return t.slice(1, -1);
          }
          return t;
        });
        const { pattern, searchPath, isCaseInsensitive, isWord, isRegex } = parseGrepSearchArgs(cleanTokens);
        if (pattern.length > 0) {
          console.error(`\n   💡 AGENT HINT: 'grep_search' executed directly in eval code.`);
          console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'grep_search' to ripgrep (rg)... (Frictionless Recovery)\x1b[0m`);
          payload.target = 'wsl2';
          payload.interpreter = 'bash';
          const rgFlags = ['-n'];
          if (isCaseInsensitive) rgFlags.push('-i');
          if (isWord) rgFlags.push('-w');
          if (!isRegex) rgFlags.push('-F');
          payload.code = `rg ${rgFlags.join(' ')} ${escapeUnixArg(pattern, false)} ${escapeUnixArg(convertToWslPath(searchPath), false)}`;
        } else if (searchPath.length > 0) {
          console.error(`\n   💡 AGENT HINT: 'grep_search' executed directly in eval code without pattern.`);
          console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'grep_search' to ripgrep (rg) --files... (Frictionless Recovery)\x1b[0m`);
          payload.target = 'wsl2';
          payload.interpreter = 'bash';
          payload.code = `rg --files ${escapeUnixArg(convertToWslPath(searchPath), false)}`;
        }
      } else {
        const listDirMatch = trimmedCode.match(/^(?:(?:bun|npm|pnpm|yarn|npx|node|tsx|ts-node)\s+(?:run\s+)?)?(?:(?:\.[/\\])?(?:\.agents[/\\]scripts[/\\]))?list_dir(?:\.ts|\.js)?\b\s*(.*)$/i);
        if (listDirMatch !== null) {
          const rest = (listDirMatch[1] ?? '').trim().replace(/^['"`]|['"`]$/g, '');
          const targetPath = rest.length > 0 ? rest : '.';
          console.error(`\n   💡 AGENT HINT: 'list_dir' executed directly in eval code.`);
          console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'list_dir' to ls... (Frictionless Recovery)\x1b[0m`);
          payload.target = 'wsl2';
          payload.interpreter = 'bash';
          payload.code = `ls ${escapeUnixArg(convertToWslPath(targetPath), false)}`;
        } else {
          const viewFileMatch = trimmedCode.match(/^(?:(?:bun|npm|pnpm|yarn|npx|node|tsx|ts-node)\s+(?:run\s+)?)?(?:(?:\.[/\\])?(?:\.agents[/\\]scripts[/\\]))?view_file(?:\.ts|\.js)?\b\s*(.*)$/i);
          if (viewFileMatch !== null && (viewFileMatch[1] ?? '').trim().length > 0) {
            const targetPath = (viewFileMatch[1] ?? '').trim().replace(/^['"`]|['"`]$/g, '');
            console.error(`\n   💡 AGENT HINT: 'view_file' executed directly in eval code.`);
            console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'view_file' to cat... (Frictionless Recovery)\x1b[0m`);
            payload.target = 'wsl2';
            payload.interpreter = 'bash';
            payload.code = `cat ${escapeUnixArg(convertToWslPath(targetPath), false)}`;
          } else {
            const pkgRunnerMatch = trimmedCode.match(/^(?:bunx|npx|pnpx|bun\s+x|pnpm\s+dlx|yarn\s+dlx)\s+(?:@\S+\/)?(?:rg|ripgrep|fd|fdfind)\b\s*(.*)$/i);
            if (pkgRunnerMatch !== null) {
              const isFd = /^(?:bunx|npx|pnpx|bun\s+x|pnpm\s+dlx|yarn\s+dlx)\s+(?:@\S+\/)?(?:fd|fdfind)\b/i.test(trimmedCode);
              const toolName = isFd ? 'fd' : 'rg';
              const rest = pkgRunnerMatch[1] ?? '';
              console.error(`\n   💡 AGENT HINT: '${toolName}' executed via package runner in eval code.`);
              console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating package runner ${toolName} to native ${toolName}... (Frictionless Recovery)\x1b[0m`);
              payload.target = 'wsl2';
              payload.interpreter = 'bash';
              payload.code = `${toolName} ${rest}`.trim();
            }
          }
        }
      }
    }

    const gitInspectMatch = trimmedCode.match(/^git\s+(status|log|shortlog|diff)\b(.*)$/i);
    if (gitInspectMatch !== null && gitInspectMatch[1] !== undefined) {
      const gitSubCmd = gitInspectMatch[1].toLowerCase();
      const cwd = payload.cwd !== undefined && payload.cwd.length > 0 ? path.resolve(payload.cwd) : process.cwd();
      const scriptCandidate = findEcosystemScript(cwd, 'get-git-history-json.ts');
      const fallbackScript = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1')), '../../get-git-history-json.ts');
      const script = scriptCandidate ?? fallbackScript;

      if (fs.existsSync(script)) {
        console.error(`\n   💡 AGENT HINT: 'git ${gitSubCmd}' inside eval payload detected.`);
        console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-translating 'git ${gitSubCmd}' in eval to get-git-history-json.ts... (Frictionless Recovery)\x1b[0m`);
        payload.target = 'windows';
        payload.interpreter = 'bun';
        const scriptPathEscaped = script.replace(/\\/g, '/');
        const cwdEscaped = cwd.replace(/\\/g, '/');
        if (gitSubCmd === 'status') {
          payload.code = `import { spawnSync } from 'node:child_process'; const res = spawnSync(process.execPath, [${JSON.stringify(scriptPathEscaped)}, '--uncommitted', '--stats'], { stdio: 'inherit', cwd: ${JSON.stringify(cwdEscaped)} }); process.exit(res.status ?? 0);`;
        } else if (gitSubCmd === 'diff') {
          payload.code = `import { spawnSync } from 'node:child_process'; const res = spawnSync(process.execPath, [${JSON.stringify(scriptPathEscaped)}, '--stats', '--include-patch'], { stdio: 'inherit', cwd: ${JSON.stringify(cwdEscaped)} }); process.exit(res.status ?? 0);`;
        } else {
          payload.code = `import { spawnSync } from 'node:child_process'; const res = spawnSync(process.execPath, [${JSON.stringify(scriptPathEscaped)}], { stdio: 'inherit', cwd: ${JSON.stringify(cwdEscaped)} }); process.exit(res.status ?? 0);`;
        }
      }
    }

    const findGlobMatch = trimmedCode.match(/^find\s+([^\s]+)\s+([*?][^\s]*|[^\s]*[*?][^\s]*)(.*)$/i);
    if (findGlobMatch !== null && findGlobMatch[1] !== undefined && findGlobMatch[2] !== undefined) {
      const searchPath = findGlobMatch[1];
      const pattern = findGlobMatch[2];
      const rest = findGlobMatch[3] ?? '';
      console.error(`\n   💡 AGENT HINT: 'find' without '-name' flag detected in eval code.`);
      console.error(`\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Auto-injecting '-name' flag for pattern '${pattern}'... (Frictionless Recovery)\x1b[0m`);
      payload.code = `find ${searchPath} -name "${pattern}" ${rest}`.trim();
    }

    if (/^find\s+([./~a-zA-Z0-9_-]+)\s+/i.test(payload.code) && !payload.code.includes('-prune')) {
      const broadFindMatch = payload.code.match(/^find\s+([./~a-zA-Z0-9_-]+)\s+(.*)$/i);
      if (broadFindMatch !== null && broadFindMatch[1] !== undefined && broadFindMatch[2] !== undefined) {
        const rootPath = broadFindMatch[1].trim();
        const rest = broadFindMatch[2];
        const isBroad = rootPath === '.' || rootPath === './' || rootPath === '..' || rootPath === '../' || rootPath.startsWith('/mnt/') || /^[a-zA-Z]:/.test(rootPath);
        if (isBroad && !rest.includes('-maxdepth')) {
          console.error(`\n   🛠️ AUTONOMOUS HEALING: Broad find in eval payload detected. Auto-injecting directory pruning for node_modules, .git, and dist to prevent timeouts... (Frictionless Recovery)\x1b[0m`);
          payload.code = `find ${rootPath} \\( -name node_modules -o -name .git -o -name dist -o -name .cache -o -name coverage \\) -prune -o ${rest}`;
        }
      }
    }

    const bundledSearchFlagsRegex = /(?:^|[;&|\s])(?:rg|ripgrep|grep|egrep|fgrep)\s+(["'])(-[a-zA-Z0-9_-]+(?:\s+\d+)?(?:\s+-[a-zA-Z0-9_-]+(?:\s+\d+)?)*)\s+([^"']+)\1/i;
    if (bundledSearchFlagsRegex.test(payload.code)) {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected bundled search flags and pattern inside quotes in eval code. Unbundling flags... (Frictionless Recovery)\x1b[0m`);
      payload.code = payload.code.replace(/(["'])(-[a-zA-Z0-9_-]+(?:\s+\d+)?(?:\s+-[a-zA-Z0-9_-]+(?:\s+\d+)?)*)\s+([^"']+)\1/g, (_m, q, flags, pattern) => {
        return `${flags} ${q}${pattern}${q}`;
      });
    }

    const rgUnquotedMatch = payload.code.match(/^rg\s+((?:-[^\s]+\s+)*)((?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*\s+){2,})(\/[^\s]+|[a-zA-Z]:[^\s]+|\.[^\s]+|[^\s]+\.[a-zA-Z0-9]+)$/);
    if (rgUnquotedMatch !== null && rgUnquotedMatch[2] !== undefined && rgUnquotedMatch[3] !== undefined) {
      const flags = rgUnquotedMatch[1] ?? '';
      const pattern = rgUnquotedMatch[2].trim();
      const targetPath = rgUnquotedMatch[3].trim();
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Unquoted search pattern in eval 'rg' detected. Recombining into single quoted pattern... (Frictionless Recovery)\x1b[0m`);
      payload.code = `rg ${flags}"${pattern}" ${targetPath}`;
    }

    const grepDirMatch = payload.code.match(/^(?:grep|egrep)\s+(.*)$/i);
    if (grepDirMatch !== null) {
      const rest = grepDirMatch[1] ?? '';
      const tokens = rest.trim().split(/\s+/);
      const isDir = (t: string): boolean => {
        if (/[()*+?[\]^$|{}]/.test(t) || /\\[bBwWdDsSnrtv0()[\]{}.*+?^$|]/.test(t)) return false;
        try {
          const cwd = payload.cwd !== undefined && payload.cwd.length > 0 ? path.resolve(payload.cwd) : process.cwd();
          const p = path.resolve(cwd, t);
          if (fs.existsSync(p)) {
            return fs.statSync(p).isDirectory();
          }
        } catch {
          // ignore
        }
        if (/\.[a-zA-Z0-9]{1,6}$/.test(t)) return false;
        if (t.endsWith('/') || t.endsWith('\\') || t === '.' || t === '..' || t.startsWith('./') || t.startsWith('../') || t.includes('/') || t.includes('\\') || /^[a-zA-Z]:/.test(t)) return true;
        return false;
      };

      if (!/(?:^|\s)(?:-[a-zA-Z]*[rR]\b|--recursive\b)/.test(payload.code)) {
        const isTargetingDir = tokens.some(t => !t.startsWith('-') && isDir(t));
        if (isTargetingDir) {
          console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected directory target in eval grep without recursive flag. Auto-injecting '-r'... (Frictionless Recovery)\x1b[0m`);
          payload.code = payload.code.replace(/^(grep|egrep)\b/i, '$1 -r');
        }
      }

      // Check for reversed arguments: grep [flags] <dir> <pattern> -> grep [flags] <pattern> <dir>
      const nonFlagTokens = tokens.filter(t => !t.startsWith('-'));
      if (nonFlagTokens.length === 2 && !payload.code.includes('-e') && !payload.code.includes('--regexp')) {
        const [first, second] = nonFlagTokens;
        if (isDir(first) && !isDir(second)) {
          console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected reversed arguments in eval grep (directory before pattern). Swapping arguments to place pattern first... (Frictionless Recovery)\x1b[0m`);
          const regexSwap = new RegExp(`(${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s+(${second.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`);
          payload.code = payload.code.replace(regexSwap, '$2 $1');
        }
      }

      const isRecursiveGrep = /(?:^|\s)(?:-[a-zA-Z]*[rR]\b|--recursive\b)/.test(payload.code);
      const isBroadGrep = tokens.some(t => {
        if (t.startsWith('-')) return false;
        const clean = t.replace(/^['"]|['"]$/g, '').trim();
        return clean === '.' || clean === './' || clean === '..' || clean === '../' || clean.startsWith('./.') || clean.startsWith('.agents') || clean.startsWith('/mnt/') || /^[a-zA-Z]:/.test(clean);
      });
      if (isRecursiveGrep && isBroadGrep) {
        const missingExcludes = GREP_EXCLUDE_DIRS.filter(
          d => !payload.code.includes(`--exclude-dir=${d}`) && !payload.code.includes(`--exclude-dir ${d}`)
        );
        if (missingExcludes.length > 0 && !payload.code.includes('--exclude-dir=')) {
          console.error(
            `\n   🛠️ AUTONOMOUS HEALING: Recursive grep on mounted Windows filesystem detected. Auto-injecting --exclude-dir for node_modules, .git, and dist (and artifact/cache dirs) to prevent timeouts... (Frictionless Recovery)\x1b[0m`
          );
          const excludeFlags = missingExcludes.map(d => `--exclude-dir=${d}`).join(' ');
          payload.code = payload.code.replace(/^(grep|egrep)\b/i, `$1 ${excludeFlags}`);
        }
        if (!payload.code.includes('--binary-files=')) {
          payload.code = payload.code.replace(/^(grep|egrep)\b/i, '$1 --binary-files=without-match');
        }
        if (payload.timeoutMs === undefined || payload.timeoutMs <= 30000) {
          payload.timeoutMs = 60000;
        }
      }
    }

    const rgDirMatch = payload.code.match(/^(?:rg|ripgrep)\s+(.*)$/i);
    if (rgDirMatch !== null) {
      if (/\b(?:rg|ripgrep)\b.*-E\b/.test(payload.code)) {
        payload.code = payload.code.replace(/\b(rg|ripgrep)\b(\s+(?:-[^\s]+\s+)*)-E\b/gi, '$1$2-e');
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected grep-style '-E' flag in eval 'rg'. Rewriting to '-e'... (Frictionless Recovery)\x1b[0m`);
      }
      const rest = rgDirMatch[1] ?? '';
      const tokens = rest.trim().split(/\s+/);
      const isDir = (t: string): boolean => {
        if (t.endsWith('/') || t.endsWith('\\') || t === '.' || t === '..' || t.startsWith('./') || t.startsWith('../') || t.includes('/') || t.includes('\\') || /^[a-zA-Z]:/.test(t)) return true;
        try {
          const cwd = payload.cwd !== undefined && payload.cwd.length > 0 ? path.resolve(payload.cwd) : process.cwd();
          const p = path.resolve(cwd, t);
          return fs.existsSync(p) && fs.statSync(p).isDirectory();
        } catch {
          return false;
        }
      };

      const nonFlagTokens = tokens.filter(t => !t.startsWith('-'));
      if (nonFlagTokens.length === 2 && !payload.code.includes('-e') && !payload.code.includes('--regexp')) {
        const [first, second] = nonFlagTokens;
        if (isDir(first) && !isDir(second)) {
          console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected reversed arguments in eval 'rg' (directory before pattern). Swapping arguments to place pattern first... (Frictionless Recovery)\x1b[0m`);
          const regexSwap = new RegExp(`(${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s+(${second.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`);
          payload.code = payload.code.replace(regexSwap, '$2 $1');
        }
      }
    }

    if ((AGENT_NATIVE_TOOLS as readonly string[]).includes(trimmedCode)) {
      console.error(`\n   💡 AGENT HINT: '${trimmedCode}' is an agent-native tool, NOT executable code or a shell script. Please invoke the '${trimmedCode}' tool directly.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
      process.exit(1);
    }
    const matchedMcpTool = (ECOSYSTEM_MCP_TOOLS as readonly string[]).find(t => trimmedCode === t || trimmedCode.startsWith(`${t}(`) || trimmedCode.startsWith(`${t} `));
    if (matchedMcpTool !== undefined) {
      console.error(`\n   💡 AGENT HINT: '${matchedMcpTool}' is an MCP tool, NOT executable code or a shell script. Please call the '${matchedMcpTool}' MCP tool via call_mcp_tool.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Call MCP tool. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
      process.exit(1);
    }
  }

  const isCommand = payload.type === 'command';
  const rawCmdStr = 'command' in payload && typeof payload.command === 'string' && payload.command.trim().includes(' ')
    ? payload.command.trim()
    : cmdBasename.trim();
  const embeddedArgs = rawCmdStr.includes(' ')
    ? rawCmdStr.split(/\s+/).slice(1)
    : [];
  const combinedArgs = [...embeddedArgs, ...args];
  const positionalArgs = getPositionalArgs(cmdBasename, combinedArgs);
  const hasStdin = !!payload.stdin;
  const cmd = cmdBasename.toLowerCase();

  // Extract the first token's basename when the command string contains spaces
  // to prevent path.basename("curl https://example.com") returning "example.com"
  const originalCmd = 'command' in payload && typeof payload.command === 'string'
    ? (() => {
        const cmdStr = payload.command.trim();
        const firstToken = cmdStr.includes(' ') ? cmdStr.split(/\s+/)[0] : cmdStr;
        return path.basename(firstToken).toLowerCase();
      })()
    : cmd;

  // 0. Early intercept: detect commands embedded in command string or scripts
  const networkAliases = ['curl', 'wget', 'invoke-webrequest', 'iwr'];
  if (isCommand && 'command' in payload && typeof payload.command === 'string' && payload.command.includes(' ')) {
    const firstToken = payload.command.trim().split(/\s+/)[0].toLowerCase();
    const firstTokenBase = path.basename(firstToken).replace(/\.exe$/, '');
    if (networkAliases.includes(firstTokenBase) && !firstToken.endsWith('.exe') && payload.target !== 'wsl2') {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Network request command '${firstToken}' detected in command string. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
      payload.target = 'wsl2';
    }
  }

  // Intercept network, search, and fs list aliases in eval and script payloads (ONLY for shell scripts)
  if ((payload.type === 'eval' || payload.type === 'script') && payload.target !== 'wsl2') {
    const isShellPayload = (() => {
      if (payload.type === 'eval') {
        const interp = (payload.interpreter || 'pwsh').toLowerCase();
        return ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe'].includes(interp);
      }
      if (payload.type === 'script' && typeof payload.scriptPath === 'string') {
        if (payload.interpreter) {
          return ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe', 'bash', 'bash.exe', 'sh', 'sh.exe'].includes(payload.interpreter.toLowerCase());
        }
        const ext = path.extname(payload.scriptPath).toLowerCase();
        return ['.ps1', '.bat', '.cmd', '.sh', '.bash'].includes(ext);
      }
      return false;
    })();

    if (isShellPayload) {
      let scriptContent = '';
      if (payload.type === 'eval') {
        scriptContent = payload.code;
      } else if (payload.type === 'script' && typeof payload.scriptPath === 'string' && fs.existsSync(payload.scriptPath)) {
        scriptContent = fs.readFileSync(payload.scriptPath, 'utf8');
      }

      // If the code is PowerShell code (contains PowerShell cmdlets or variables), NEVER switch it to WSL2 bash!
      if (isPowerShellCode(scriptContent)) {
        if (payload.interpreter && ['bash', 'sh'].includes(payload.interpreter.toLowerCase())) {
          payload.interpreter = 'pwsh';
          payload.target = 'windows';
        }
        return;
      }

      const tokens = scriptContent.split(/[\s;|{>&<]+/).filter(Boolean).map((t: string) => t.toLowerCase());
      
      const cmdStr = tokens.find((t: string) => networkAliases.includes(t));
      const fsSearchAliases = ['grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe'];
      const searchCmdStr = tokens.find((t: string) => fsSearchAliases.includes(t));
      const fsListAliases = ['ls', 'ls.exe', 'dir', 'dir.exe', 'tree', 'tree.com'];
      const listCmdStr = tokens.find((t: string) => fsListAliases.includes(t));

      if (cmdStr || searchCmdStr || listCmdStr) {
        const detected = cmdStr || searchCmdStr || listCmdStr;
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Shell command/script using '${detected}' detected. Switching execution target to WSL2... (Frictionless Recovery)\x1b[0m`);
        payload.target = 'wsl2';
        if (!payload.interpreter || ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe'].includes(payload.interpreter)) {
          payload.interpreter = 'bash';
        }
      }
    }
  }

  if (payload.target === 'wsl2') {
    let defaultWslTimeout = 30000;
    
    if (payload.type === 'eval' || payload.type === 'script') {
      const codeOrScript = payload.type === 'eval' ? payload.code : (payload.scriptPath || '');
      const isInlineShellHallucination = payload.type === 'eval' && /^\s*(?:pwsh|powershell|cmd|bash|sh|wsl)(?:\.exe)?\b/i.test(codeOrScript);
      const isPlaywright = !isInlineShellHallucination && Boolean(codeOrScript && /(?:playwright|cypress|\be2e\b|test:e2e)/i.test(codeOrScript));
      const isCoverage = !isInlineShellHallucination && Boolean(codeOrScript && /(?:coverage|--coverage)/i.test(codeOrScript));
      const isDocker = !isInlineShellHallucination && Boolean(codeOrScript && /(?:docker|docker-compose|podman)/i.test(codeOrScript) && /(?:build|scout)/i.test(codeOrScript));
      const isChainedQuality = !isInlineShellHallucination && payload.type === 'eval' && Boolean(codeOrScript && /(?:typecheck|tsc|lint|check|build|test).*(?:&&|;).*(?:typecheck|tsc|lint|check|build|test)/i.test(codeOrScript));
      const hasQualityCheck = !isInlineShellHallucination && payload.type === 'eval' && Boolean(codeOrScript && /(?:(?:bun|pnpm|npm|yarn|npx|bunx|pnpx)\s+(?:run\s+)?(?:typecheck|tsc|lint|check|build|test)\b|\b(?:vitest|jest|tsc|eslint)\b)/i.test(codeOrScript));
      const isKnownDeterministic = !isInlineShellHallucination && Boolean(codeOrScript && /(?:commit\.ts|get-git-history-json\.ts|backup-conversations\.ts)/i.test(codeOrScript));
      const hasMountedSearch = !isInlineShellHallucination && Boolean(codeOrScript && /(?:find|grep|rg|ls|tree)\b/i.test(codeOrScript));
      
      if (isPlaywright) {
        defaultWslTimeout = 600000;
        payload.bypassInterceptors = true;
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected Playwright/E2E test in WSL2 eval payload. Auto-extending timeout to 600s... (Frictionless Recovery)`);
      } else if (isDocker) {
        defaultWslTimeout = 600000;
        payload.bypassInterceptors = true;
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected Docker build/scout in WSL2 eval payload. Auto-extending timeout to 600s... (Frictionless Recovery)`);
      } else if (isCoverage) {
        defaultWslTimeout = 300000;
        payload.bypassInterceptors = true;
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected test coverage in WSL2 eval payload. Auto-extending timeout to 300s... (Frictionless Recovery)`);
      } else if (isChainedQuality) {
        defaultWslTimeout = 180000;
        payload.bypassInterceptors = true;
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected chained quality checks in WSL2 eval payload. Auto-extending timeout to 180s... (Frictionless Recovery)`);
      } else if (hasQualityCheck || isKnownDeterministic) {
        defaultWslTimeout = 90000;
        payload.bypassInterceptors = true;
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected quality check or deterministic script in WSL2 eval payload. Auto-extending timeout to 90s... (Frictionless Recovery)`);
      } else if (hasMountedSearch) {
        defaultWslTimeout = 90000;
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected file search across mounted filesystem in WSL2 eval payload. Auto-extending timeout to 90s... (Frictionless Recovery)`);
      }
    } else if (payload.type === 'command') {
      const underlyingScript = getUnderlyingPackageScript(cmdBasename, args, payload.cwd);
      const isNestedAgentExec = (args && args.some(a => path.basename(a).toLowerCase() === 'agent-exec.ts'));
      const isDocker = /(?:docker|docker-compose|podman)/i.test(cmdBasename) && (args && args.some(a => /(?:build|scout)/i.test(a)));
      const isPlaywright = /(?:playwright|cypress)/i.test(cmdBasename) ||
        (args && args.some(a => /(?:playwright|cypress|\be2e\b|test:e2e|test-e2e)/i.test(a))) ||
        /(?:playwright|cypress|\be2e\b)/i.test(underlyingScript);
      const isCoverage = /(?:coverage)/i.test(cmdBasename) ||
        (args && args.some(a => /(?:coverage|--coverage|test:coverage)/i.test(a))) ||
        /(?:coverage|--coverage)/i.test(underlyingScript);
      const isQuality = !isNestedAgentExec && !isDocker && (
        /(?:typecheck|tsc|lint|check|build|test|vitest|jest)/i.test(cmdBasename) ||
        (args && args.some(a => /(?:typecheck|tsc|lint|check|build|test|vitest|jest)/i.test(a))) ||
        /(?:typecheck|tsc|lint|check|build|test|vitest|jest)/i.test(underlyingScript)
      );
      const isKnownDeterministic = /(?:commit\.ts|get-git-history-json\.ts|backup-conversations\.ts)/i.test(cmdBasename) || (args && args.some(a => /(?:commit\.ts|get-git-history-json\.ts|backup-conversations\.ts)/i.test(a)));
      const isSearch = /(?:find|grep|rg|ls|tree)\b/i.test(cmdBasename) || (args && args.some(a => /(?:find|grep|rg|ls|tree)\b/i.test(a)));
      
      if (isPlaywright || isDocker) {
        defaultWslTimeout = 600000;
        payload.bypassInterceptors = true;
      } else if (isQuality || isKnownDeterministic) {
        const testFiles = args ? args.filter(a => /\.(?:test|spec)\.[a-zA-Z0-9]+$/i.test(a)) : [];
        const isMultiTest = testFiles.length > 1;
        const isTestDir = args ? args.some(a => /(?:tests?[/\\]\w+[/\\].*[/\\].*|tests?[/\\]$)/i.test(a) && !/\.[a-zA-Z0-9_-]+$/i.test(a)) : false;
        const isTestRunner = /(?:vitest|jest|pytest|playwright|cypress)/i.test(cmdBasename) ||
          (args && args.some(a => /(?:vitest|jest|pytest|playwright|cypress|^test(?::.*|-.*)?$|^coverage(?::.*)?$)/i.test(a))) ||
          /(?:vitest|jest|pytest|playwright|cypress)/i.test(underlyingScript);
        const isFullSuite = isTestRunner && testFiles.length === 0 && !isTestDir;
        const targetFiles = args ? args.filter(a => !a.startsWith('-') && /\.(?:ts|js|tsx|jsx|json|mjs|cjs)$/i.test(a)) : [];
        const hasTargetFiles = targetFiles.length > 0;
        const hasLargeFile = targetFiles.some(a => /(?:api\.ts|codemode|bundle|generated)/i.test(a));
        const isLintOrCheck = /(?:lint|check)/i.test(cmdBasename) ||
          (args && args.some(a => /(?:lint|check)/i.test(a))) ||
          /(?:lint|check)/i.test(underlyingScript);
        const isFullLintOrCheck = isLintOrCheck && !hasTargetFiles;
        defaultWslTimeout = isCoverage ? 300000 : (isFullLintOrCheck || hasLargeFile ? 360000 : (isMultiTest || isTestDir || isFullSuite ? 180000 : 90000));
        payload.bypassInterceptors = true;
      } else if (isSearch) {
        defaultWslTimeout = 90000;
      }
    }
    
    payload.timeoutMs = Math.max(payload.timeoutMs || defaultWslTimeout, defaultWslTimeout);
  } else {
    if (payload.type === 'eval' || payload.type === 'script') {
      const codeOrScript = payload.type === 'eval' ? payload.code : (payload.scriptPath || '');
      const isInlineShellHallucination = payload.type === 'eval' && /^\s*(?:pwsh|powershell|cmd|bash|sh|wsl)(?:\.exe)?\b/i.test(codeOrScript);
      const isPlaywright = !isInlineShellHallucination && Boolean(codeOrScript && /(?:playwright|cypress|\be2e\b|test:e2e)/i.test(codeOrScript));
      const isCoverage = !isInlineShellHallucination && Boolean(codeOrScript && /(?:coverage|--coverage)/i.test(codeOrScript));
      const isDocker = !isInlineShellHallucination && Boolean(codeOrScript && /(?:docker|docker-compose|podman)/i.test(codeOrScript) && /(?:build|scout)/i.test(codeOrScript));
      const isChainedQuality = !isInlineShellHallucination && payload.type === 'eval' && Boolean(codeOrScript && /(?:typecheck|tsc|lint|check|build|test).*(?:&&|;).*(?:typecheck|tsc|lint|check|build|test)/i.test(codeOrScript));
      const hasQualityCheck = !isInlineShellHallucination && payload.type === 'eval' && Boolean(codeOrScript && /(?:(?:bun|pnpm|npm|yarn|npx|bunx|pnpx)\s+(?:run\s+)?(?:typecheck|tsc|lint|check|build|test)\b|\b(?:vitest|jest|tsc|eslint)\b)/i.test(codeOrScript));
      const isKnownDeterministic = !isInlineShellHallucination && Boolean(codeOrScript && /(?:commit\.ts|get-git-history-json\.ts|backup-conversations\.ts)/i.test(codeOrScript));
      if (isPlaywright) {
        payload.timeoutMs = Math.max(payload.timeoutMs || 600000, 600000);
        payload.bypassInterceptors = true;
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected Playwright/E2E test in Windows eval payload. Auto-extending timeout to 600s... (Frictionless Recovery)`);
      } else if (isDocker) {
        payload.timeoutMs = Math.max(payload.timeoutMs || 600000, 600000);
        payload.bypassInterceptors = true;
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected Docker build/scout in Windows eval payload. Auto-extending timeout to 600s... (Frictionless Recovery)`);
      } else if (isCoverage) {
        payload.timeoutMs = Math.max(payload.timeoutMs || 480000, 480000);
        payload.bypassInterceptors = true;
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected test coverage in Windows eval payload. Auto-extending timeout to 480s... (Frictionless Recovery)`);
      } else if (isChainedQuality) {
        payload.timeoutMs = Math.max(payload.timeoutMs || 600000, 600000);
        payload.bypassInterceptors = true;
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected chained quality checks in Windows eval payload. Auto-extending timeout to 600s... (Frictionless Recovery)`);
      } else if (hasQualityCheck || isKnownDeterministic) {
        const isFullLintOrCheck = Boolean(codeOrScript && /(?:lint|check)/i.test(codeOrScript) && !/\.(?:ts|js|tsx|jsx)\b/i.test(codeOrScript));
        const hasLargeFile = Boolean(codeOrScript && /(?:api\.ts|codemode|bundle|generated)/i.test(codeOrScript));
        const qualityTimeout = (isFullLintOrCheck || hasLargeFile) ? 600000 : 240000;
        payload.timeoutMs = Math.max(payload.timeoutMs || qualityTimeout, qualityTimeout);
        payload.bypassInterceptors = true;
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected quality check or deterministic script in Windows eval payload. Auto-extending timeout to ${qualityTimeout / 1000}s... (Frictionless Recovery)`);
      }
    } else if (payload.type === 'command') {
      const underlyingScript = getUnderlyingPackageScript(cmdBasename, args, payload.cwd);
      const isNestedAgentExec = (args && args.some(a => path.basename(a).toLowerCase() === 'agent-exec.ts'));
      const isDocker = /(?:docker|docker-compose|podman)/i.test(cmdBasename) && (args && args.some(a => /(?:build|scout)/i.test(a)));
      const isPlaywright = /(?:playwright|cypress)/i.test(cmdBasename) ||
        (args && args.some(a => /(?:playwright|cypress|\be2e\b|test:e2e|test-e2e)/i.test(a))) ||
        /(?:playwright|cypress|\be2e\b)/i.test(underlyingScript);
      const isCoverage = /(?:coverage)/i.test(cmdBasename) ||
        (args && args.some(a => /(?:coverage|--coverage|test:coverage)/i.test(a))) ||
        /(?:coverage|--coverage)/i.test(underlyingScript);
      const isQuality = !isNestedAgentExec && !isDocker && (
        /(?:typecheck|tsc|lint|check|build|test|vitest|jest)/i.test(cmdBasename) ||
        (args && args.some(a => /(?:typecheck|tsc|lint|check|build|test|vitest|jest)/i.test(a))) ||
        /(?:typecheck|tsc|lint|check|build|test|vitest|jest)/i.test(underlyingScript)
      );
      const isKnownDeterministic = /(?:commit\.ts|get-git-history-json\.ts|backup-conversations\.ts)/i.test(cmdBasename) || (args && args.some(a => /(?:commit\.ts|get-git-history-json\.ts|backup-conversations\.ts)/i.test(a)));
      if (isPlaywright || isDocker) {
        payload.timeoutMs = Math.max(payload.timeoutMs || 600000, 600000);
        payload.bypassInterceptors = true;
      } else if (isQuality || isKnownDeterministic) {
        const testFiles = args ? args.filter(a => /\.(?:test|spec)\.[a-zA-Z0-9]+$/i.test(a)) : [];
        const isMultiTest = testFiles.length > 1;
        const isTestDir = args ? args.some(a => /(?:tests?[/\\]\w+[/\\].*[/\\].*|tests?[/\\]$)/i.test(a) && !/\.[a-zA-Z0-9_-]+$/i.test(a)) : false;
        const isTestRunner = /(?:vitest|jest|pytest|playwright|cypress)/i.test(cmdBasename) ||
          (args && args.some(a => /(?:vitest|jest|pytest|playwright|cypress|^test(?::.*|-.*)?$|^coverage(?::.*)?$)/i.test(a))) ||
          /(?:vitest|jest|pytest|playwright|cypress)/i.test(underlyingScript);
        const isFullSuite = isTestRunner && testFiles.length === 0 && !isTestDir;
        const targetFiles = args ? args.filter(a => !a.startsWith('-') && /\.(?:ts|js|tsx|jsx|json|mjs|cjs)$/i.test(a)) : [];
        const hasTargetFiles = targetFiles.length > 0;
        const isMultiFileLint = targetFiles.length > 1;
        const hasLargeFile = targetFiles.some(a => /(?:api\.ts|codemode|bundle|generated)/i.test(a));
        const isLintOrCheck = /(?:lint|check)/i.test(cmdBasename) ||
          (args && args.some(a => /(?:lint|check)/i.test(a))) ||
          /(?:lint|check)/i.test(underlyingScript);
        const isFullLintOrCheck = isLintOrCheck && !hasTargetFiles;
        const winTimeout = isCoverage ? 480000 : (isFullLintOrCheck || hasLargeFile ? 600000 : (isTestDir || isFullSuite ? 360000 : (isMultiTest || isMultiFileLint ? 300000 : 240000)));
        payload.timeoutMs = Math.max(payload.timeoutMs || winTimeout, winTimeout);
        payload.bypassInterceptors = true;
      }
    }
  }

  // 1. Generic Path Hallucination Intercepts (runs before tool matching so healed paths are matched)
  healPathHallucinations(ctx);

  // 1.1. Mutating intercepts (safe to run before block checks)
  runMutatingInterceptors(ctx, { cmd, cmdBasename, args });

  const activeCombinedArgs = [...embeddedArgs, ...ctx.args];
  const activePositionalArgs = getPositionalArgs(cmdBasename, activeCombinedArgs);

  match({ ...ctx, positionalArgs: activePositionalArgs, hasStdin, cmd, isCommand, isWin32: process.platform === 'win32', originalCmd })
    .with({ originalCmd: P.union('cat', 'cat.exe', 'get-content') }, () => {
      if (['sh', 'bash', 'pwsh', 'powershell', 'cmd'].includes(cmd)) {
        return;
      }
      if (!hasStdin && activePositionalArgs.length === 0) {
        console.error(`\n   💡 AGENT HINT: 'cat' called without file arguments and no stdin. It will hang indefinitely.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Provide a file argument or use view_file.\x1b[0m`);
        process.exit(1);
      }
      console.error(`\n   💡 AGENT INTERCEPT: 'cat' file inspection command detected. Switching execution target to WSL2... (Frictionless Recovery)`);
      ctx.payload.target = 'wsl2';
      ctx.args = ctx.args.map(a => convertToWslPath(a));
    })
    .with({ originalCmd: P.union('grep', 'grep.exe', 'egrep', 'egrep.exe', 'fgrep', 'fgrep.exe', 'select-string', 'select-string.exe') }, () => {
      if (['sh', 'bash', 'pwsh', 'powershell', 'cmd'].includes(cmd)) {
        return;
      }
      if (embeddedArgs.length > 0 && ctx.args.length === 0) {
        ctx.args = [...embeddedArgs];
        ctx.cmdBasename = originalCmd;
        if (ctx.payload.type === 'command') {
          ctx.payload.command = originalCmd;
          ctx.payload.args = ctx.args;
        }
      }
      if (cmdBasename.toLowerCase().startsWith('select-string')) {
        if (ctx.payload.type === 'command') ctx.payload.command = 'grep';
        ctx.cmdBasename = 'grep';
      }
      handleGrepInterception(ctx, hasStdin);
    })
    .with({ originalCmd: P.union('ls', 'ls.exe', 'dir', 'dir.exe', 'get-childitem', 'get-childitem.exe', 'gci', 'tree', 'tree.com') }, () => {
      if (['sh', 'bash', 'pwsh', 'powershell', 'cmd'].includes(cmd)) {
        return;
      }
      console.error(`\n   💡 AGENT INTERCEPT: '${cmdBasename}' directory listing command detected. Switching execution target to WSL2... (Frictionless Recovery)`);
      ctx.payload.target = 'wsl2';
      if ('interpreter' in ctx.payload && ctx.payload.interpreter && ['pwsh', 'pwsh.exe', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe'].includes(ctx.payload.interpreter.toLowerCase())) {
        ctx.payload.interpreter = 'bash';
      }

      const filterIdx = ctx.args.findIndex(a => ['-filter', '-include'].includes(a.toLowerCase()));
      const hasRecurse = ctx.args.some(a => ['-recurse', '-r', '-R', '/s'].includes(a.toLowerCase()));
      const hasFile = ctx.args.some(a => a.toLowerCase() === '-file');
      const hasDir = ctx.args.some(a => a.toLowerCase() === '-directory');

      if (filterIdx !== -1 && filterIdx + 1 < ctx.args.length) {
        const pattern = ctx.args[filterIdx + 1];
        let targetPath = '.';
        for (let i = 0; i < ctx.args.length; i++) {
          if (i === filterIdx || i === filterIdx + 1) continue;
          const a = ctx.args[i];
          if (!a.startsWith('-')) {
            targetPath = convertToWslPath(a);
            break;
          }
        }
        if (ctx.payload.type === 'command') {
          ctx.payload.command = 'find';
        }
        const newArgs = [targetPath];
        if (!hasRecurse) {
          newArgs.push('-maxdepth', '1');
        }
        if (hasFile) newArgs.push('-type', 'f');
        if (hasDir) newArgs.push('-type', 'd');
        newArgs.push('-name', pattern);
        ctx.args = newArgs;
        return;
      }

      // Check if this is a recursive search with a file pattern (e.g. dir /s /b pattern.ext or dir /s pattern)
      const nonFlagArgs = ctx.args.filter(a => !a.startsWith('-') && !a.startsWith('/'));
      if (hasRecurse && nonFlagArgs.length > 0) {
        const patternArg = nonFlagArgs[0];
        let targetPath = '.';
        let pattern = patternArg;
        
        if (patternArg.includes('/') || patternArg.includes('\\')) {
          const lastSep = Math.max(patternArg.lastIndexOf('/'), patternArg.lastIndexOf('\\'));
          const dirPart = patternArg.substring(0, lastSep);
          pattern = patternArg.substring(lastSep + 1);
          if (dirPart) {
            targetPath = convertToWslPath(dirPart);
          }
        }

        if (pattern && pattern !== '.' && pattern !== '..') {
          if (ctx.payload.type === 'command') {
            ctx.payload.command = 'find';
          }
          const newArgs = [targetPath];
          if (hasFile) newArgs.push('-type', 'f');
          if (hasDir) newArgs.push('-type', 'd');
          newArgs.push('-name', pattern);
          ctx.args = newArgs;
          return;
        }
      }

      if (['dir', 'get-childitem', 'gci'].includes(cmdBasename.toLowerCase())) {
        if (ctx.payload.type === 'command') ctx.payload.command = 'ls';
      }

      const cleanedArgs: string[] = [];
      let skipNext = false;
      for (let i = 0; i < ctx.args.length; i++) {
        if (skipNext) {
          skipNext = false;
          continue;
        }
        const a = ctx.args[i];
        const lower = a.toLowerCase();
        if (lower === '-path' || lower === '-path:') {
          continue;
        }
        if (lower === '-depth' || lower === '-depth:') {
          if (i + 1 < ctx.args.length && /^\d+$/.test(ctx.args[i + 1])) {
            skipNext = true;
          }
          continue;
        }
        if (lower.startsWith('-depth:')) {
          continue;
        }
        if (lower === '-filter' || lower === '-include') {
          skipNext = true;
          continue;
        }
        if (lower === '-recurse' || lower === '/s') {
          cleanedArgs.push('-R');
          continue;
        }
        if (lower === '/b') {
          cleanedArgs.push('-1');
          continue;
        }
        if (lower === '-file' || lower === '-directory' || lower === '/ad' || lower === '/a:d') {
          continue;
        }
        if (/^\/[aA](?::?[a-zA-Z-]*)?$/.test(lower)) {
          if (lower.includes('h')) {
            cleanedArgs.push('-a');
          }
          continue;
        }
        if (/^\/[oO](?::?[a-zA-Z-]*)?$/.test(lower)) {
          if (lower.includes('t') || lower.includes('d')) cleanedArgs.push('-t');
          if (lower.includes('s')) cleanedArgs.push('-S');
          continue;
        }
        if (lower === '/w' || lower === '/p' || lower === '/q' || lower === '/c' || lower === '/4') {
          continue;
        }
        if (lower === '-name') {
          cleanedArgs.push('-1');
          continue;
        }
        if (lower === '-force' || lower === '-hidden') {
          cleanedArgs.push('-a');
          continue;
        }
        if (lower === '-readonly') {
          continue;
        }
        cleanedArgs.push(convertToWslPath(a));
      }
      ctx.args = cleanedArgs;
    })
    .with({ originalCmd: P.union('curl', 'curl.exe', 'wget', 'wget.exe', 'invoke-webrequest', 'iwr') }, () => {
      if (ctx.payload.target !== 'wsl2') {
        console.error(`\n   💡 AGENT INTERCEPT: '${cmdBasename}' network command detected. Switching execution target to WSL2... (Frictionless Recovery)`);
        ctx.payload.target = 'wsl2';
      }
      if (['invoke-webrequest', 'iwr'].includes(cmdBasename.toLowerCase())) {
        if (ctx.payload.type === 'command') ctx.payload.command = 'curl';
      }
      ctx.args = ctx.args.map(a => convertToWslPath(a));
    })
    .with({ cmd: P.union('awk', 'gawk', 'sed', 'sed.exe', 'jq', 'jq.exe', 'yq', 'yq.exe', 'find', 'find.exe', 'tail', 'tail.exe', 'head', 'head.exe', 'wc', 'wc.exe', 'sort', 'sort.exe', 'uniq', 'uniq.exe', 'tee', 'tee.exe') }, () => {
      if (ctx.payload.target !== 'wsl2') {
        console.error(`\n   💡 AGENT INTERCEPT: '${cmdBasename}' natively fails, lacks features, or is not installed on Windows. Switching execution target to WSL2... (Frictionless Recovery)`);
        ctx.payload.target = 'wsl2';
      }

      if (['find', 'find.exe'].includes(cmdBasename.toLowerCase())) {
        handleFindInterception(ctx);
      }

      // Automatically convert Windows paths (like C:\... or C:/... or "C:\...") to WSL paths (/mnt/c/...)
      ctx.args = ctx.args.map(a => convertToWslPath(a));
    })
    .with({ isCommand: true, originalCmd: P.union('rg', 'rg.exe') }, () => {
      if (['sh', 'bash', 'pwsh', 'powershell', 'cmd'].includes(cmd)) {
        return;
      }
      handleRipgrepInterception(ctx, hasStdin);
    })
    .with({ cmd: P.union('gh', 'gh.exe', 'pnpm', 'npm', 'docker', 'docker.exe') }, ({ args }) => {
      const isLogin = args.some(a => a === 'login' || a === 'auth');
      if (isLogin) {
        console.error(`\n   💡 AGENT HINT: Interactive login commands like '${cmdBasename} ${args.join(' ')}' hang the agent.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Blocking execution. Authentication must be handled externally.\x1b[0m`);
        process.exit(1);
      }
    })
    .with({ cmd: P.union('pwsh', 'pwsh.exe', 'powershell', 'powershell.exe') }, ({ args: matchedArgs }) => {
      const scriptStartFlags = ['-c', '-command', '/c', '-ec', '-encodedcommand', '-en', '-file', '-f'];
      const scriptFlagIdx = matchedArgs.findIndex(a => scriptStartFlags.includes(a.toLowerCase()));
      const searchArgs = scriptFlagIdx === -1 ? matchedArgs : matchedArgs.slice(0, scriptFlagIdx);
      
      if (!searchArgs.some(a => a.toLowerCase() === '-noninteractive')) {
        console.error(`\n   🛠️ AUTONOMOUS HEALING: Automatically injecting '-NonInteractive' into ${cmdBasename} command to prevent hanging.... (Frictionless Recovery)`);
        ctx.args.unshift('-NonInteractive');
      }
      if (!searchArgs.some(a => a.toLowerCase() === '-noprofile')) {
        ctx.args.unshift('-NoProfile');
      }
    })
    .otherwise(() => {});


  // 2. Unsafe Pipes Detection
  const cmdLower = cmdBasename.toLowerCase();
  const isPkgMgr = ['npm', 'npm.cmd', 'pnpm', 'pnpm.cmd', 'yarn', 'yarn.cmd', 'bun', 'bun.exe', 'npx', 'npx.cmd'].includes(cmdLower);
  const pkgSubcommand = isPkgMgr ? args.find(a => !a.startsWith('-'))?.toLowerCase() : undefined;
  const isInvokingPatternTool = pkgSubcommand !== undefined && patternTools.includes(pkgSubcommand);

  const shouldCheckPipes = match(payload)
    .with({ type: 'command', target: 'wsl2' }, () => false)
    .with({ type: 'command' }, () => !patternTools.includes(cmd) && !isInvokingPatternTool)
    .otherwise(() => false);

  if (shouldCheckPipes) {
    const hasUnsafe = args.some((arg, index) => {
      // Avoid falsely triggering on semicolons or shell characters inside inline script bodies or attached values
      if (index > 0 && inlineFlags.includes(args[index - 1].toLowerCase())) {
        return false;
      }
      if (inlineFlags.some(flag => arg.toLowerCase().startsWith(flag + '=') || (flag.length === 2 && arg.toLowerCase().startsWith(flag) && arg.length > 2))) {
        return false;
      }
      return match(arg)
        .with(P.string.includes('$('), () => true)
        .with(P.string.includes('`'), () => true)
        .with(P.when(a => a.includes('\\&') || a.includes('\\|') || a.includes('\\>') || a.includes('\\<') || a.includes('\\;')), () => true)
        .with(P.when((a: string) => {
            if (exactShellChars.includes(a.trim())) return true;
            
            const finalState = { unquoted: getUnquoted(a) };
            
            return exactShellChars.some(op => {
                let checkStr = finalState.unquoted;
                checkStr = checkStr.replace(/<[^>]+>/g, '');
                if (op === '>') {
                    checkStr = checkStr.replace(/=>/g, '').replace(/->/g, '');
                } else if (op === '<') {
                    checkStr = checkStr.replace(/<-/g, '');
                }
                
                if (!checkStr.includes(op)) return false;
                
                const hasSpacesAround = checkStr.includes(` ${op} `) || checkStr.startsWith(`${op} `) || checkStr.endsWith(` ${op}`);
                const isShell = ['pwsh', 'powershell', 'bash', 'sh', 'cmd', 'pwsh.exe', 'powershell.exe', 'cmd.exe'].includes(cmdLower);
                
                if (checkStr.trim() === op) return true;
                if (isShell) return true;
                
                if (checkStr.includes('{') || checkStr.includes('[')) return false;
                
                if (!hasSpacesAround) {
                    if (op === '|') return false; // Single | without spaces is regex alternation or union type
                    if (op === '&&' || op === '||') return true; // Chained commands without spaces
                    return false;
                }
                
                if (isPkgMgr) return true;
                return false;
            });
        }), () => true)
        .otherwise(() => false);
    });
    if (hasUnsafe) {
      console.error(`\n   💡 AGENT HINT: Standalone shell operators (|, >, <, &&, ||, ;) detected in arguments.\n\x1b[38;5;208m   🛠️ AUTONOMOUS HEALING: Execution blocked. Fix parameters, use native tool, or spawn /heal-infrastructure. Ref: [AGENT_README.md](file:///C:/Users/chris/Desktop/adamic/.agents/scripts/lib-agent-exec/AGENT_README.md)\x1b[0m`);
      console.error(`   Because 'agent-exec.ts' uses \`shell: false\`, these operators are treated as literal strings and will fail.`);
      console.error(`   To use shell features, please use a 'script' payload type or pipe natively in PowerShell.`);
      process.exit(1);
    }
  }

  // Helper for inline commands
  const inlineIdx = args.findIndex(a => inlineFlags.includes(a.toLowerCase()));
  const hasInlineCmd = inlineIdx !== -1;
  const inlineFlag = hasInlineCmd ? args[inlineIdx].toLowerCase() : '';
  const innerCmdStr = hasInlineCmd ? (args[inlineIdx + 1] || '') : '';
  


  // 3. Centralized structural blocking using ts-pattern
  runStructuralInterceptors(ctx, { cmd, cmdBasename, originalCmd, args, isCommand, hasInlineCmd, inlineFlag, innerCmdStr, positionalArgs, hasStdin, shells });

  const interpreterName = originalCmd.replace(/\.exe$/i, '').toLowerCase();
  const inlineDetails = isCommand && ['node', 'bun', 'python', 'python3', 'tsx', 'ts-node'].includes(interpreterName)
    ? getInlineScriptDetails(interpreterName, ctx.args)
    : null;

  if (inlineDetails) {
    const { flagIdx, isPrint, scriptContent } = inlineDetails;
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Transparently rewriting inline ${interpreterName} script to a temporary file execution to avoid quoting bugs... (Frictionless Recovery)\x1b[0m`);
    const ext = interpreterName.startsWith('python') ? 'py' : (['bun', 'tsx', 'ts-node'].includes(interpreterName) ? 'ts' : 'js');
    const outDir = os.tmpdir();
    const tmpFile = path.join(outDir, `.agent_inline_script_${Date.now()}.${ext}`);

    const cwd = ctx.payload.cwd !== undefined && ctx.payload.cwd.length > 0
      ? path.resolve(ctx.payload.cwd)
      : process.cwd();

    let fileContent = interpreterName.startsWith('python')
      ? `import sys; sys.path.insert(0, '')\n${scriptContent}`
      : healEvalCodePathHallucinations(scriptContent, cwd, ctx.payload.target);

    if (isPrint) {
      fileContent = `try {\n  const __res = eval(${JSON.stringify(fileContent)});\n  if (__res !== undefined) console.log(__res);\n} catch {\n  ${fileContent}\n}\n`;
    }

    fs.writeFileSync(tmpFile, fileContent);
    process.on('exit', () => {
      try {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      } catch {
        // ignore
      }
    });

    ctx.cmdBasename = interpreterName;
    ctx.args.splice(flagIdx, 2, tmpFile);
    if ('command' in ctx.payload) {
      ctx.payload.command = interpreterName;
      ctx.payload.args = ctx.args;
    }
  }
}

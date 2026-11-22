// @ts-nocheck
import { RG_VALUE_FLAGS as RG_VALUE_FLAGS_LIST, healFragmentedQuotes } from '../command-utils.js';
import { unbundleSearchCommandArgs } from './search-flag-unpack.js';
import { ExecutionContext } from './types.js';

export const RG_KNOWN_ENCODINGS = new Set([
  'utf8', 'utf16', 'utf16le', 'utf16be', 'ascii', 'usascii', 'latin1',
  'windows1252', 'cp1252', 'iso88591', 'gbk', 'eucjp', 'shiftjis', 'none', 'auto',
]);

const RG_VALUE_FLAGS = new Set<string>(RG_VALUE_FLAGS_LIST);

export function isKnownRgEncoding(value: string): boolean {
  return RG_KNOWN_ENCODINGS.has(value.trim().toLowerCase().replace(/[-_]/g, ''));
}

function countRgNonValuePositionals(args: readonly string[]): { count: number; hasPatternFlag: boolean } {
  let count = 0;
  let hasPatternFlag = false;
  let sawEndOfFlags = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (!sawEndOfFlags && arg === '--') { sawEndOfFlags = true; continue; }
    if (!sawEndOfFlags && arg.startsWith('-')) {
      if (
        arg === '-e' || (arg.startsWith('-e') && !arg.startsWith('--')) ||
        arg === '--regexp' || arg.startsWith('--regexp=') ||
        arg === '-f' || (arg.startsWith('-f') && !arg.startsWith('--')) ||
        arg === '--file' || arg.startsWith('--file=')
      ) {
        hasPatternFlag = true;
      }
      if (RG_VALUE_FLAGS.has(arg) || arg === '-r') i++;
      continue;
    }
    count++;
  }
  return { count, hasPatternFlag };
}

function reassembleRipgrepQuotes(ctx: ExecutionContext): void {
  const reassembledArgs = healFragmentedQuotes(ctx.args, ctx.payload.cwd ?? ctx.cwd);
  const changed = reassembledArgs.length !== ctx.args.length || reassembledArgs.some((arg, idx) => arg !== ctx.args[idx]);
  if (!changed) return;
  ctx.args = reassembledArgs;
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
}

function shouldKeepBareRipgrepR(args: readonly string[], idx: number): boolean {
  const nextArg = args[idx + 1];
  if (nextArg === undefined) return false;
  if (nextArg === '') return true;
  if (nextArg.startsWith('-')) return false;
  if (/\$(?:\d+|\{|[A-Za-z_]|&)/.test(nextArg)) return true;
  const { count, hasPatternFlag } = countRgNonValuePositionals(args);
  return hasPatternFlag ? count >= 1 : count >= 2;
}

function stripRipgrepRecursiveFlags(args: string[]): { args: string[]; stripped: boolean } {
  let stripped = false;
  const cleaned: string[] = [];
  for (let idx = 0; idx < args.length; idx++) {
    const arg = args[idx];
    if (arg === undefined) continue;
    if (arg === '--') {
      cleaned.push(...args.slice(idx));
      break;
    }
    if (arg === '-r') {
      if (shouldKeepBareRipgrepR(args, idx)) {
        cleaned.push('-r', args[idx + 1] ?? '');
        idx++;
      } else {
        stripped = true;
      }
      continue;
    }
    if (RG_VALUE_FLAGS.has(arg) && idx + 1 < args.length) {
      cleaned.push(arg, args[idx + 1] ?? '');
      idx++;
      continue;
    }
    if (arg === '-R' || arg === '--recursive') {
      stripped = true;
      continue;
    }
    if (!arg.startsWith('-') || arg.startsWith('--')) {
      cleaned.push(arg);
      continue;
    }
    if (!/^-(?:t|T|e|f|g|E|m|M|A|B|C|j).+/.test(arg) && /^-[a-zA-Z0-9]+$/.test(arg) && (arg.includes('R') || arg.includes('r'))) {
      stripped = true;
      const withoutR = arg.replace(/[Rr]/g, '');
      if (withoutR !== '-') cleaned.push(withoutR);
      continue;
    }
    cleaned.push(arg);
  }
  return { args: cleaned, stripped };
}

interface FlagStep {
  handled: boolean;
  convertedGlob: boolean;
  convertedExtReason: 'strip' | 'pattern' | null;
  pushed: string[];
  extra: number;
}

function negatedGlob(pattern: string): string {
  return pattern.startsWith('!') ? pattern : `!${pattern}`;
}

function translateExtendedRegex(args: string[], index: number): FlagStep {
  if (index + 1 >= args.length) {
    return { handled: true, convertedGlob: false, convertedExtReason: 'strip', pushed: [], extra: 0 };
  }
  const nextArg = args[index + 1];
  if (nextArg !== undefined && nextArg.startsWith('-')) {
    return { handled: true, convertedGlob: false, convertedExtReason: 'strip', pushed: [], extra: 0 };
  }
  if (nextArg !== undefined && !isKnownRgEncoding(nextArg)) {
    return { handled: true, convertedGlob: false, convertedExtReason: 'pattern', pushed: ['-e', nextArg], extra: 1 };
  }
  if (nextArg !== undefined) {
    return { handled: true, convertedGlob: false, convertedExtReason: null, pushed: ['-E', nextArg], extra: 1 };
  }
  return { handled: false, convertedGlob: false, convertedExtReason: null, pushed: [], extra: 0 };
}

function translateGrepStyleArg(args: string[], index: number, arg: string): FlagStep {
  const untouched: FlagStep = { handled: false, convertedGlob: false, convertedExtReason: null, pushed: [], extra: 0 };
  if (RG_VALUE_FLAGS.has(arg) && arg !== '-E' && index + 1 < args.length) {
    return { handled: true, convertedGlob: false, convertedExtReason: null, pushed: [arg, args[index + 1] ?? ''], extra: 1 };
  }
  if (arg === '-E') return translateExtendedRegex(args, index);
  if (arg === '--include' && index + 1 < args.length) {
    const nextArg = args[index + 1];
    if (nextArg === undefined) return untouched;
    return { handled: true, convertedGlob: true, convertedExtReason: null, pushed: ['-g', nextArg], extra: 1 };
  }
  if (arg.startsWith('--include=')) {
    return { handled: true, convertedGlob: true, convertedExtReason: null, pushed: [`-g=${arg.slice('--include='.length)}`], extra: 0 };
  }
  if (arg === '--exclude' && index + 1 < args.length) {
    const pattern = args[index + 1];
    if (pattern === undefined) return untouched;
    return { handled: true, convertedGlob: true, convertedExtReason: null, pushed: ['-g', negatedGlob(pattern)], extra: 1 };
  }
  if (arg.startsWith('--exclude=')) {
    const pattern = arg.slice('--exclude='.length);
    return { handled: true, convertedGlob: true, convertedExtReason: null, pushed: [`-g=${negatedGlob(pattern)}`], extra: 0 };
  }
  if (arg === '--exclude-dir' && index + 1 < args.length) {
    const dir = args[index + 1];
    if (dir === undefined) return untouched;
    return { handled: true, convertedGlob: true, convertedExtReason: null, pushed: ['-g', `!${dir}/**`], extra: 1 };
  }
  if (arg.startsWith('--exclude-dir=')) {
    const dir = arg.slice('--exclude-dir='.length);
    return { handled: true, convertedGlob: true, convertedExtReason: null, pushed: [`-g=!${dir}/**`], extra: 0 };
  }
  return untouched;
}

function normalizeRipgrepGrepStyleFlags(args: string[]): { args: string[]; convertedGlob: boolean; extReasons: Array<'strip' | 'pattern'> } {
  const healedArgs: string[] = [];
  let convertedGlob = false;
  const extReasons: Array<'strip' | 'pattern'> = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg === '--') {
      healedArgs.push(...args.slice(i));
      break;
    }
    const step = translateGrepStyleArg(args, i, arg);
    if (!step.handled) {
      healedArgs.push(arg);
      continue;
    }
    if (step.convertedGlob) convertedGlob = true;
    if (step.convertedExtReason !== null) extReasons.push(step.convertedExtReason);
    healedArgs.push(...step.pushed);
    i += step.extra;
  }
  return { args: healedArgs, convertedGlob, extReasons };
}

export function normalizeRipgrepInvocation(ctx: ExecutionContext): boolean {
  const unbundledFlags = unbundleSearchCommandArgs(ctx);
  reassembleRipgrepQuotes(ctx);
  const stripped = stripRipgrepRecursiveFlags(ctx.args);
  const healed = normalizeRipgrepGrepStyleFlags(stripped.args);
  ctx.args = healed.args;
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
  if (stripped.stripped) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: 'rg' searches recursively by default. Stripping redundant recursive flag (-r/-R) to prevent argument parsing errors... (Frictionless Recovery)`);
  }
  for (const reason of healed.extReasons) {
    if (reason === 'strip') {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected grep-style '-E' (extended regex) flag in 'rg'. Stripping '-E' as ripgrep uses extended regex by default... (Frictionless Recovery)\x1b[0m`);
    } else {
      console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected grep-style '-E' (extended regex) flag in 'rg'. Rewriting to '-e' to treat as regex pattern instead of encoding... (Frictionless Recovery)\x1b[0m`);
    }
  }
  if (healed.convertedGlob) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: 'rg' does not accept grep-style '--include/--exclude'. Normalizing to ripgrep '-g' (glob) flags... (Frictionless Recovery)`);
  }
  return unbundledFlags;
}

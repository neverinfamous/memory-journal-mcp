// @ts-nocheck
import { healFragmentedQuotes } from '../command-utils.js';
import { unbundleSearchCommandArgs } from './search-flag-unpack.js';
import { ExecutionContext } from './types.js';

const RG_KNOWN_ENCODINGS = [
  'utf-8', 'utf-16', 'utf-16le', 'utf-16be', 'ascii', 'latin1',
  'windows-1252', 'iso-8859-1', 'gbk', 'euc-jp', 'shift-jis',
];

function reassembleRipgrepQuotes(ctx: ExecutionContext): void {
  const reassembledArgs = healFragmentedQuotes(ctx.args);
  const changed = reassembledArgs.length !== ctx.args.length || reassembledArgs.some((arg, idx) => arg !== ctx.args[idx]);
  if (!changed) return;
  ctx.args = reassembledArgs;
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
}

function mapBareRipgrepR(args: string[], idx: number, markStripped: () => void): string {
  const nextArg = args[idx + 1];
  const nonFlagCount = args.filter((item) => !item.startsWith('-')).length;
  if (!nextArg || nextArg.startsWith('-') || idx > 0 || nonFlagCount <= 2) {
    markStripped();
    return '';
  }
  return '-r';
}

function mapRipgrepRecursiveArg(args: string[], arg: string, idx: number, markStripped: () => void): string {
  if (arg === '-R' || arg === '--recursive') {
    markStripped();
    return '';
  }
  if (!arg.startsWith('-') || arg.startsWith('--')) return arg;
  if (arg === '-r') return mapBareRipgrepR(args, idx, markStripped);
  if (/^-[a-zA-Z0-9]+$/.test(arg) && (arg.includes('R') || arg.includes('r'))) {
    markStripped();
    const cleaned = arg.replace(/[Rr]/g, '');
    return cleaned === '-' ? '' : cleaned;
  }
  return arg;
}

function stripRipgrepRecursiveFlags(args: string[]): { args: string[]; stripped: boolean } {
  let stripped = false;
  const markStripped = (): void => {
    stripped = true;
  };
  const cleaned = args
    .map((arg, idx) => mapRipgrepRecursiveArg(args, arg, idx, markStripped))
    .filter((arg) => Boolean(arg));
  return { args: cleaned, stripped };
}

interface FlagStep {
  handled: boolean;
  converted: boolean;
  pushed: string[];
  extra: number;
}

function negatedGlob(pattern: string): string {
  return pattern.startsWith('!') ? pattern : `!${pattern}`;
}

function translateExtendedRegex(args: string[], index: number): FlagStep {
  if (index + 1 >= args.length) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected grep-style '-E' (extended regex) flag in 'rg'. Stripping '-E' as ripgrep uses extended regex by default... (Frictionless Recovery)\x1b[0m`);
    return { handled: true, converted: true, pushed: [], extra: 0 };
  }
  const nextArg = args[index + 1];
  if (nextArg !== undefined && !RG_KNOWN_ENCODINGS.includes(nextArg.toLowerCase())) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected grep-style '-E' (extended regex) flag in 'rg'. Rewriting to '-e' to treat as regex pattern instead of encoding... (Frictionless Recovery)\x1b[0m`);
    return { handled: true, converted: true, pushed: ['-e', nextArg], extra: 1 };
  }
  return { handled: true, converted: false, pushed: [], extra: 0 };
}

function translateGrepStyleArg(args: string[], index: number, arg: string): FlagStep {
  const untouched: FlagStep = { handled: false, converted: false, pushed: [], extra: 0 };
  if (arg === '-E') return translateExtendedRegex(args, index);
  if (arg === '--include' && index + 1 < args.length) {
    const nextArg = args[index + 1];
    if (nextArg === undefined) return untouched;
    return { handled: true, converted: true, pushed: ['-g', nextArg], extra: 1 };
  }
  if (arg.startsWith('--include=')) {
    return { handled: true, converted: true, pushed: [`-g=${arg.slice('--include='.length)}`], extra: 0 };
  }
  if (arg === '--exclude' && index + 1 < args.length) {
    const pattern = args[index + 1];
    if (pattern === undefined) return untouched;
    return { handled: true, converted: true, pushed: ['-g', negatedGlob(pattern)], extra: 1 };
  }
  if (arg.startsWith('--exclude=')) {
    const pattern = arg.slice('--exclude='.length);
    return { handled: true, converted: true, pushed: [`-g=${negatedGlob(pattern)}`], extra: 0 };
  }
  if (arg === '--exclude-dir' && index + 1 < args.length) {
    const dir = args[index + 1];
    if (dir === undefined) return untouched;
    return { handled: true, converted: true, pushed: ['-g', `!${dir}/**`], extra: 1 };
  }
  if (arg.startsWith('--exclude-dir=')) {
    const dir = arg.slice('--exclude-dir='.length);
    return { handled: true, converted: true, pushed: [`-g=!${dir}/**`], extra: 0 };
  }
  return untouched;
}

function normalizeRipgrepGrepStyleFlags(args: string[]): { args: string[]; converted: boolean } {
  const healedArgs: string[] = [];
  let converted = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    const step = translateGrepStyleArg(args, i, arg);
    if (!step.handled) {
      healedArgs.push(arg);
      continue;
    }
    if (step.converted) converted = true;
    healedArgs.push(...step.pushed);
    i += step.extra;
  }
  return { args: healedArgs, converted };
}

export function normalizeRipgrepInvocation(ctx: ExecutionContext): boolean {
  const unbundledFlags = unbundleSearchCommandArgs(ctx);
  reassembleRipgrepQuotes(ctx);
  const stripped = stripRipgrepRecursiveFlags(ctx.args);
  if (stripped.stripped) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: 'rg' searches recursively by default. Stripping redundant recursive flag (-r/-R) to prevent argument parsing errors... (Frictionless Recovery)`);
  }
  const healed = normalizeRipgrepGrepStyleFlags(stripped.args);
  ctx.args = healed.args;
  if (healed.converted) {
    console.error(`\n   🛠️ AUTONOMOUS HEALING: 'rg' does not accept grep-style '--include/--exclude'. Normalizing to ripgrep '-g' (glob) flags... (Frictionless Recovery)`);
  }
  return unbundledFlags;
}

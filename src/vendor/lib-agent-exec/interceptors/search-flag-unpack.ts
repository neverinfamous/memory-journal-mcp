// @ts-nocheck
import path from 'node:path';
import { FLAGS_WITH_ARG_BY_TOOL, RG_VALUE_FLAGS, inspectCombinedShortFlag, tokenizeArgs } from '../command-utils.js';
import { ExecutionContext } from './types.js';

const BUNDLED_SHORT_FLAG = /^-[a-zA-Z0-9]+$/;
const BUNDLED_LONG_FLAG = /^--[a-zA-Z0-9-]+$/;
const GREP_EXTRA_VALUE_FLAGS = [
  '--exclude', '--exclude-dir', '--exclude-from', '--include', '--include-from', '--label',
  '-d', '-D', '--directories', '--devices',
] as const;

function unpackBundledArg(arg: string, shortBase: 'rg' | 'grep', baseFlags: ReadonlySet<string>): string[] | undefined {
  if (!arg.startsWith('-') || !arg.includes(' ')) return undefined;
  const tokens = tokenizeArgs(arg);
  const head = tokens[0];
  if (tokens.length <= 1 || head === undefined) return undefined;
  if (!BUNDLED_SHORT_FLAG.test(head) && !BUNDLED_LONG_FLAG.test(head)) return undefined;
  if (head.startsWith('-') && !head.startsWith('--')) {
    if (inspectCombinedShortFlag(shortBase, head, baseFlags).hasAttachedValue) return undefined;
  }
  return tokens;
}

export function unbundleSearchCommandArgs(ctx: ExecutionContext): boolean {
  const unpackedArgs: string[] = [];
  const baseRaw = path.basename(ctx.cmdBasename).toLowerCase().replace(/\.exe$/, '');
  const shortBase = baseRaw === 'rg' || baseRaw === 'ripgrep' ? 'rg' : 'grep';
  const baseFlags = new Set([
    ...(FLAGS_WITH_ARG_BY_TOOL[shortBase] ?? []),
    ...(shortBase === 'rg' ? RG_VALUE_FLAGS : GREP_EXTRA_VALUE_FLAGS),
  ]);
  let unbundledFlags = false;
  let expectValue = false;
  for (let i = 0; i < ctx.args.length; i++) {
    const arg = ctx.args[i];
    if (arg === undefined) continue;
    if (arg === '--') {
      unpackedArgs.push(...ctx.args.slice(i));
      break;
    }
    if (expectValue) {
      expectValue = false;
      unpackedArgs.push(arg);
      continue;
    }
    const tokens = unpackBundledArg(arg, shortBase, baseFlags);
    if (tokens !== undefined) {
      unpackedArgs.push(...tokens);
      unbundledFlags = true;
      if (!tokens.includes('--')) {
        const lastTok = tokens[tokens.length - 1] ?? '';
        expectValue = inspectCombinedShortFlag(shortBase, lastTok, baseFlags).takesSeparateValue;
      }
      continue;
    }
    if (inspectCombinedShortFlag(shortBase, arg, baseFlags).takesSeparateValue) expectValue = true;
    unpackedArgs.push(arg);
  }
  if (!unbundledFlags) return false;
  ctx.args = unpackedArgs;
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected bundled search flags and pattern in a single argument. Unpacking arguments... (Frictionless Recovery)\x1b[0m`);
  return true;
}

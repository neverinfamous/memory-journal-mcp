// @ts-nocheck
import { RG_VALUE_FLAGS, tokenizeArgs } from '../command-utils.js';
import { ExecutionContext } from './types.js';

const BUNDLED_SHORT_FLAG = /^-[a-zA-Z0-9]+$/;
const BUNDLED_LONG_FLAG = /^--[a-zA-Z0-9-]+$/;
const SEARCH_VALUE_FLAGS = new Set([
  ...RG_VALUE_FLAGS,
  '--exclude', '--exclude-dir', '--exclude-from', '--include', '--include-from', '--label',
  '-d', '-D', '--directories', '--devices',
]);

function unpackBundledArg(arg: string): string[] | undefined {
  if (!arg.startsWith('-') || !arg.includes(' ')) return undefined;
  const tokens = tokenizeArgs(arg);
  const head = tokens[0];
  if (tokens.length <= 1 || head === undefined) return undefined;
  if (!BUNDLED_SHORT_FLAG.test(head) && !BUNDLED_LONG_FLAG.test(head)) return undefined;
  return tokens;
}

export function unbundleSearchCommandArgs(ctx: ExecutionContext): boolean {
  const unpackedArgs: string[] = [];
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
    const tokens = unpackBundledArg(arg);
    if (tokens !== undefined) {
      unpackedArgs.push(...tokens);
      unbundledFlags = true;
      continue;
    }
    if (SEARCH_VALUE_FLAGS.has(arg)) expectValue = true;
    unpackedArgs.push(arg);
  }
  if (!unbundledFlags) return false;
  ctx.args = unpackedArgs;
  if (ctx.payload.type === 'command') ctx.payload.args = ctx.args;
  console.error(`\n   🛠️ AUTONOMOUS HEALING: Detected bundled search flags and pattern in a single argument. Unpacking arguments... (Frictionless Recovery)\x1b[0m`);
  return true;
}

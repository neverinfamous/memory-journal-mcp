import fs from 'node:fs';
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function buildTmpPrefixes() {
  const raw = os.tmpdir();
  const candidates = [raw];
  try {
    const real = fs.realpathSync(raw);
    if (real !== raw) candidates.push(real);
  } catch { /* fallback to raw tmpdir */ }
  return candidates.map((dir) => {
    const bare = pathToFileURL(dir).href.replace(/\/+$/, '').toLowerCase();
    return { bare, slash: `${bare}/` };
  });
}

// [INTENT]: Anchors ESM and CJS module resolution to the caller's working directory when inline/eval or isolated scratch scripts execute outside the repo.
const inlineCwd = process.env.AGENT_EXEC_INLINE_CWD;
if (typeof module.registerHooks === 'function' && typeof inlineCwd === 'string' && inlineCwd.length > 0) {
  const cwdParentUrl = pathToFileURL(path.join(inlineCwd, '__agent_inline__.mjs')).href;
  const tmpPrefixes = buildTmpPrefixes();
  const scratchPattern = /\/\.gemini\/[^/]+\/brain\/[^/]+\/scratch\//i;

  module.registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (origErr) {
        const parentUrl = typeof context.parentURL === 'string' ? context.parentURL : '';
        const lowerParent = parentUrl.toLowerCase();
        const isFromTmpOrScratch =
          parentUrl.length === 0 ||
          tmpPrefixes.some((p) => lowerParent === p.bare || lowerParent.startsWith(p.slash)) ||
          scratchPattern.test(parentUrl);
        if (!isFromTmpOrScratch || specifier.startsWith('node:') || specifier.startsWith('file:')) {
          throw origErr;
        }
        return nextResolve(specifier, {
          ...context,
          parentURL: cwdParentUrl,
        });
      }
    },
  });
}

import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// [INTENT]: Anchors ESM and CJS module resolution to the caller's working directory when inline/eval or isolated scratch scripts execute outside the repo.
const inlineCwd = process.env.AGENT_EXEC_INLINE_CWD;
if (typeof module.registerHooks === 'function' && typeof inlineCwd === 'string' && inlineCwd.length > 0) {
  const cwdParentUrl = pathToFileURL(path.join(inlineCwd, '__agent_inline__.mjs')).href;
  const tmpPrefix = pathToFileURL(os.tmpdir()).href.replace(/\/+$/, '').toLowerCase();
  const scratchPattern = /\/\.gemini\/[^/]+\/brain\/[^/]+\/scratch\//i;

  module.registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (origErr) {
        const parentUrl = typeof context.parentURL === 'string' ? context.parentURL : '';
        const isFromTmpOrScratch =
          parentUrl.length === 0 ||
          parentUrl.toLowerCase().startsWith(tmpPrefix) ||
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

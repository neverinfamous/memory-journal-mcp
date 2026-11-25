// @ts-nocheck
import { stripVTControlCharacters } from 'node:util';

function hasInquirerPromptLine(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('?')) continue;
    const afterQ = trimmed.slice(1);
    if (!/^[ \t]+\S/.test(afterQ)) continue;
    const lastCh = afterQ[afterQ.length - 1];
    if (lastCh === '?' || lastCh === ':' || lastCh === '>' || lastCh === '›' || lastCh === '»') return true;
    if (lastCh === ']' && afterQ.includes('[')) return true;
    if (lastCh === ')' && afterQ.includes('(')) return true;
  }
  return false;
}

const PROMPT_PREFILTER_SYMBOLS_RE = /[?:>#$%✔…=[\]|)]/;
const PROMPT_PREFILTER_WORDS_RE = /(?:enter|press|hit|type|choose|select|provide|input|password|passphrase|username|login|email|token|y\/n|yes|no|editor|vi|nano|vim|emacs|notepad|code|wait|continue|abort|quit|exit|override|overwrite|replace|sure|accept|proceed|would you like to|shall we|\b[yn]\b)/;

const PROMPT_PATTERNS: readonly RegExp[] = [
  // Structured Prompts
  /(?:^|\n)[ \t]*\+?(?:password|passphrase|username|email|token|prompt|choice|select|selection|question|confirm|answer|login|authentication|user|id|pass|y\/n|yes\/no|repository|author)[ \t]*[:>?][ \t]*$/i,
  /(?:enter|provide|type|input)(?: \w+){0,3} (?:password|passphrase|username|email|token|user|id|pass|name|code|value|title|body)[ \t:]*$/i,
  // Inquirer Prompts
  /^[ \t]*\?[ \t]+(?:title|body|choose\b|select\b|what's next\b)[^\r\n]*$/im,
  /^[ \t]*[?✔][ \t]*[^\r\n]{0,250}(?:…|\.\.\.)/m,
  // REPLs and Shells
  /(?:ba)?sh(?:-[\d.]+)?(?:\$|#)[ \t]*$/m,
  /ps [a-z]:\\[^>]*>[ \t]*$/m,
  /^(?:node|bash|python|ruby)> [ \t]*$/m,
  /^(?:(?:~|\/[^/\r\n]*)[ \t]*)?(?:>>>|\.\.\.|>|\$|#)[ \t]*$/m,
  /(?:user|root)@.*?(?:\$|#|%)[ \t]*$/m,
  /^\[?[a-zA-Z0-9_.-]+@.*?(?:\$|#|%)[ \t]*$/m,
  /^(?:postgres=#|mysql>|sqlite>)[ \t]*$/m,
  /\((?:pdb|gdb|lldb|cmd)\)\s*$/i,
  // Action / Continue Prompts
  /(?:please enter|press enter|press return|press any key|do you want to|are you sure|type "yes"|type yes|type y|continue\?|proceed\?|would you like to|shall we|do you accept|to proceed, type)/i,
  /(?:press|hit) (?:any key|enter|return) to (?:continue|exit|quit|abort)/i,
  /are you sure you want to continue/i,
  /press any key to continue/i,
  /type 'yes' to confirm/i,
  /hit enter to proceed/i,
  /press enter to [^\r\n]*$/i,
  /^(?:hint:\s*)?waiting for (?:your editor|vi|nano|vim|emacs|notepad|code)/i,
  // Y/N and Multiple Choice
  /\(?(?:yes|y)\s*\/\s*(?:no|n)\)?\s*[?:]?\s*$/i,
  /(?:^|\n)[ \t]*(?:enter|select|choose) [^:\n]*:\s*$/i,
  /\[y\]\s*yes.*\[n\]\s*no/i,
  /\(default is ".*"\):/i,
  /Overwrite .*?\? \(y\/n(?:\[n\])?\)/i,
  /(?:overwrite|replace|override)\s*\??\s*$/i,
  /terminate batch job \(y\/n\)\??/i,
  /\((?:yes|y)\s*\/\s*(?:no|n)\)\s*[?:]?\s*$/i,
  /\[(?:yes|y)\s*\/\s*(?:no|n)\]\s*[?:]?\s*$/i,
  /\[[YyNn](?:\/[YyNnAaQqSsLl])+\][ \t:]*$/i,
  /\[[YyNnSsAaLl](?:es|o|ll)?\](?:[ \t]*\w+(?:[ \t]+\w+){0,2})?(?:[ \t]*\[[YyNnSsAaLl](?:es|o|ll)?\](?:[ \t]*\w+(?:[ \t]+\w+){0,2})?){0,5}[ \t]*(?:\(default is ".*?"\))?[ \t:]*$/i,
  /\[[Yy]\/[Nn]\]\s*$/i,
  /\([Yy]\/[Nn]\)\s*$/i,
  /\(yes\/no\)\s*\??\s*$/i,
  // Auth and Inputs
  /(?:choose an option|please type|pick an option|type in)[ \t:]*$/i,
  /(?:password|passphrase|username|token|login|title|body)(?: for .*)?[ \t]*[:>][ \t]*$/i,
  /(?:password|passphrase|username|login|email)\s*:\s*$/i,
  /enter passphrase/i,
  /are you sure you want to continue connecting\s*\(yes\/no(?:\/\[fingerprint\])?\)\?\s*$/i,
  /enter.*gpg.*passphrase/i,
  /\[sudo\][ \t]*password[ \t]*(?:for[ \t]+\S+)?[ \t]*:[ \t]*$/i,
  /(?:one-time password|otp|2fa|two.factor).*:\s*$/i,
  /password for '.*?':\s*$/i,
  /(?:enter|provide|type|input|select|choose)[ \t]+(?:your[ \t]+)?(?:name|option|value|choice|path|directory|file|url|key)[ \t]*[:>?][ \t]*$/i,
  /^[ \t]*(?:package name|version|description|entry point|test command|git repository|keywords|license)[ \t]*(?::[ \t]*(?:\([^)\r\n]*\))?|\([^)\r\n]*\)[ \t]*:)[ \t]*$/im,
  /^[ \t]*is this ok\?[ \t]*(?:\([^)\r\n]*\))?[ \t]*$/im,
  // Pagers
  /more\s*\(\d+%\)/i,
];

export function checkPrompt(tail: string): boolean {
  const lines = stripVTControlCharacters(tail).split('\n');
  let recentTail = '';
  let count = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    if (line.trim() !== '' || i === lines.length - 1) {
      recentTail = line + (recentTail ? '\n' + recentTail : '');
      if (line.trim() !== '') count++;
      if (count >= 3) break;
    }
  }

  const lower = recentTail.toLowerCase();

  if (!PROMPT_PREFILTER_SYMBOLS_RE.test(lower) && !lower.includes('...') && !PROMPT_PREFILTER_WORDS_RE.test(lower)) {
    return false;
  }

  if (hasInquirerPromptLine(lower)) return true;
  for (let i = 0; i < PROMPT_PATTERNS.length; i++) {
    const pattern = PROMPT_PATTERNS[i];
    if (pattern !== undefined && pattern.test(lower)) return true;
  }
  return false;
}

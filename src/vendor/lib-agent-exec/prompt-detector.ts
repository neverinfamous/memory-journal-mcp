// @ts-nocheck
import { stripVTControlCharacters } from 'node:util';

export function checkPrompt(tail: string): boolean {
  const lower = stripVTControlCharacters(tail).toLowerCase();
  
  if (!/[?:>#$%✔…]/.test(lower) && !/(?:enter|press|hit|type|choose|select|provide|input|password|passphrase|username|login|email|token|y\/n|yes|no|editor|vi|nano|vim|emacs|continue|abort|quit|exit|override|overwrite|replace|sure|accept|proceed|\b[yn]\b)/.test(lower)) {
    return false;
  }
  
  const hasStrictPrompt = /(?:^|\n)[ \t]*\+?(?:password|passphrase|username|email|token|prompt|choice|select|selection|question|confirm|answer|login|authentication|user|id|pass|y\/n|yes\/no|repository|branch|commit|version|author)[ \t]*[:>?][ \t]*$/i.test(lower);
  const hasActionPrompt = /(?:enter|provide|type|input)(?: \w+){0,3} (?:password|passphrase|username|email|token|user|id|pass|name|code|value|title|body)[ \t:]*$/i.test(lower);
  const hasInquirerPrompt = /^\s*\?\s+.*?(?:›|»|:|\[.*?\]|\(.*?\))\s*$/m.test(lower) || /^\s*\?\s+.*?\s*$/m.test(lower) || /^[✔?][^\r\n]{0,250}(?:…|\.\.\.)/m.test(lower);

  return hasStrictPrompt || hasActionPrompt || hasInquirerPrompt ||
         /waiting for emacs/i.test(lower) || /hit enter to proceed/i.test(lower) ||
         /bash-[\d.]+\$/m.test(lower) || /sh-[\d.]+#\s*$/m.test(lower) || /ps [a-z]:\\[^>]+>\s*$/m.test(lower) || /^(?:node|bash|python|ruby)> \s*$/m.test(lower) ||
         /(?:please enter|press enter|press return|press any key|do you want to|are you sure|type "yes"|type yes|type y|continue\?|proceed\?|would you like to|shall we|do you accept|to proceed, type)/i.test(lower) ||
         /\(?(?:yes|y)\s*\/\s*(?:no|n)\)?\s*[?:]?\s*$/i.test(lower) || /(?:enter|select|choose) .*:/i.test(lower) ||
         /\[y\]\s*yes.*\[n\]\s*no/i.test(lower) || /\(default is ".*"\):/i.test(lower) ||
         /(?:choose an option|please type|pick an option|type in)[ \t:]*$/i.test(lower) ||
         /(?:password|passphrase|username|token|login|title|body)(?: for .*)?[ \t]*[:>][ \t]*$/i.test(lower) ||
         /Overwrite .*?\? \(y\/n(?:\[n\])?\)/i.test(lower) ||
         /\((?:pdb|gdb|lldb|cmd)\)\s*$/i.test(lower) ||
         /more\s*\(\d+%\)/i.test(lower) ||
         /are you sure you want to continue/i.test(lower) || /press any key to continue/i.test(lower) || /type 'yes' to confirm/i.test(lower) ||
         /terminate batch job \(y\/n\)?/i.test(lower) ||
         /^(?:>>>|\.\.\.|>|\$)\s*$/m.test(lower) ||
         /(?:user|root)@.*?(?:\$|#|%)\s*$/m.test(lower) ||
         /^[a-zA-Z0-9_.-]+@.*?(?:\$|#|%)\s*$/m.test(lower) ||
         /\([yY].*?\/.*?[nN].*?\)\s*[?:]?\s*$/i.test(lower) ||
         /\[[yY].*?\/.*?[nN].*?\]\s*[?:]?\s*$/i.test(lower) ||
         /(?:press|hit) (?:any key|enter|return) to (?:continue|exit|quit|abort)/i.test(lower) ||
         /\[[YyNnSsAaLl](?:es|o|ll)?\](?:[ \t]*\w+){0,3}(?:[ \t]*\[[YyNnSsAaLl](?:es|o|ll)?\](?:[ \t]*\w+){0,3}){0,5}[ \t]*(?:\(default is ".*?"\))?[ \t:]*$/i.test(lower) ||
         // Edge-case: Password/passphrase/username prompts at end of buffer without trailing whitespace
         /(?:password|passphrase|username|login|email)\s*:\s*$/i.test(lower) ||
         /enter passphrase/i.test(lower) ||
         // SSH host key verification prompt
         /are you sure you want to continue connecting\s*\(yes\/no(?:\/\[fingerprint\])?\)\?\s*$/i.test(lower) ||
         // GPG passphrase
         /enter.*gpg.*passphrase/i.test(lower) ||
         // Sudo password prompt (may not have trailing colon in some locales)
         /\[sudo\]\s*password\s*(?:for\s+\S+)?\s*:\s*$/i.test(lower) ||
         // npm/yarn publish OTP prompt
         /(?:one-time password|otp|2fa|two.factor).*:\s*$/i.test(lower) ||
         // Generic "Confirm" or "Override" prompts
         /(?:overwrite|replace|override)\s*\??\s*$/i.test(lower) ||
         // GitHub device login and generic pauses
         /press enter to .*?\s*$/i.test(lower) ||
         /^(?:hint:\s*)?waiting for (?:your editor|vi|nano|vim|emacs)/i.test(lower) ||
         // Generic password prompts
         /password for '.*?':\s*$/i.test(lower) ||
         // Y/n without colons
         /\[[Yy]\/[Nn]\]\s*$/i.test(lower) ||
         /\([Yy]\/[Nn]\)\s*$/i.test(lower) ||
         /\(yes\/no\)\s*\??\s*$/i.test(lower) ||
         // Generic Enter X prompts
         /(?:enter|provide|type|input|select|choose)[ \t]+(?:your[ \t]+)?(?:name|option|value|choice|path|directory|file|url|key)[ \t]*[:>?][ \t]*$/i.test(lower) ||
         // DB REPLs and npm init
         /^(?:postgres=#|mysql>|sqlite>)\s*$/m.test(lower) ||
         /(?:package name|version|description|entry point|test command|git repository|keywords|license|is this ok\?)[ \t]*[:?]?[ \t]*(?:\(.*?\))?[ \t]*[:?]?[ \t]*$/i.test(lower);
}

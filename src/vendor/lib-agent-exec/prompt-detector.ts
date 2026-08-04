import { stripVTControlCharacters } from 'node:util';
import { match } from 'ts-pattern';

export function checkPrompt(tail: string): boolean {
  const lines = stripVTControlCharacters(tail).split('\n');
  let recentTail = '';
  let count = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.trim() !== '' || i === lines.length - 1) {
      recentTail = line + (recentTail ? '\n' + recentTail : '');
      if (line.trim() !== '') count++;
      if (count >= 3) break;
    }
  }
  
  const lower = recentTail.toLowerCase();
  
  if (!/[?:>#$%✔…█▓░=[\]|]/.test(lower) && !/(?:enter|press|hit|type|choose|select|provide|input|password|passphrase|username|login|email|token|y\/n|yes|no|editor|vi|nano|vim|emacs|notepad|code|wait|continue|abort|quit|exit|override|overwrite|replace|sure|accept|proceed|progress|done|receiving|extracting|downloading|uploading|resolving|\b[yn]\b)/.test(lower)) {
    return false;
  }
  
  return match(lower)
    // Structured Prompts
    .when(l => /(?:^|\n)[ \t]*\+?(?:password|passphrase|username|email|token|prompt|choice|select|selection|question|confirm|answer|login|authentication|user|id|pass|y\/n|yes\/no|repository|branch|commit|version|author)[ \t]*[:>?][ \t]*$/i.test(l), () => true)
    .when(l => /(?:enter|provide|type|input)(?: \w+){0,3} (?:password|passphrase|username|email|token|user|id|pass|name|code|value|title|body)[ \t:]*$/i.test(l), () => true)
    
    // Inquirer Prompts
    .when(l => /^\s*\?\s+.*?(?:›|»|:|\[.*?\]|\(.*?\))\s*$/m.test(l), () => true)
    .when(l => /^\s*\?\s+.*?\s*$/m.test(l), () => true)
    .when(l => /^[✔?][^\r\n]{0,250}(?:…|\.\.\.)/m.test(l), () => true)
    
    // REPLs and Shells
    .when(l => /(?:ba)?sh(?:-[\d.]+)?(?:\$|#)\s*$/m.test(l) || /ps [a-z]:\\[^>]*>\s*$/m.test(l) || /^(?:node|bash|python|ruby)> \s*$/m.test(l), () => true)
    .when(l => /^(?:(?:~|\/.*?)\s*)?(?:>>>|\.\.\.|>|\$|#)\s*$/m.test(l), () => true)
    .when(l => /(?:user|root)@.*?(?:\$|#|%)\s*$/m.test(l) || /^\[?[a-zA-Z0-9_.-]+@.*?(?:\$|#|%)\s*$/m.test(l), () => true)
    .when(l => /^(?:postgres=#|mysql>|sqlite>)\s*$/m.test(l), () => true)
    .when(l => /\((?:pdb|gdb|lldb|cmd)\)\s*$/i.test(l), () => true)
    
    // Action / Continue Prompts
    .when(l => /(?:please enter|press enter|press return|press any key|do you want to|are you sure|type "yes"|type yes|type y|continue\?|proceed\?|would you like to|shall we|do you accept|to proceed, type)/i.test(l), () => true)
    .when(l => /(?:press|hit) (?:any key|enter|return) to (?:continue|exit|quit|abort)/i.test(l), () => true)
    .when(l => /are you sure you want to continue/i.test(l) || /press any key to continue/i.test(l) || /type 'yes' to confirm/i.test(l), () => true)
    .when(l => /hit enter to proceed/i.test(l), () => true)
    .when(l => /press enter to .*?\s*$/i.test(l) || /^(?:hint:\s*)?waiting for (?:your editor|vi|nano|vim|emacs|notepad|code)/i.test(l), () => true)
    
    // Y/N and Multiple Choice
    .when(l => /\(?(?:yes|y)\s*\/\s*(?:no|n)\)?\s*[?:]?\s*$/i.test(l) || /(?:enter|select|choose) .*:/i.test(l), () => true)
    .when(l => /\[y\]\s*yes.*\[n\]\s*no/i.test(l) || /\(default is ".*"\):/i.test(l), () => true)
    .when(l => /Overwrite .*?\? \(y\/n(?:\[n\])?\)/i.test(l) || /(?:overwrite|replace|override)\s*\??\s*$/i.test(l), () => true)
    .when(l => /terminate batch job \(y\/n\)?/i.test(l), () => true)
    .when(l => /\([yY].*?\/.*?[nN].*?\)\s*[?:]?\s*$/i.test(l) || /\[[yY].*?\/.*?[nN].*?\]\s*[?:]?\s*$/i.test(l), () => true)
    .when(l => /\[[YyNnSsAaLl](?:es|o|ll)?\](?:[ \t]*\w+){0,3}(?:[ \t]*\[[YyNnSsAaLl](?:es|o|ll)?\](?:[ \t]*\w+){0,3}){0,5}[ \t]*(?:\(default is ".*?"\))?[ \t:]*$/i.test(l), () => true)
    .when(l => /\[[Yy]\/[Nn]\]\s*$/i.test(l) || /\([Yy]\/[Nn]\)\s*$/i.test(l) || /\(yes\/no\)\s*\??\s*$/i.test(l), () => true)
    
    // Auth and Inputs
    .when(l => /(?:choose an option|please type|pick an option|type in)[ \t:]*$/i.test(l), () => true)
    .when(l => /(?:password|passphrase|username|token|login|title|body)(?: for .*)?[ \t]*[:>][ \t]*$/i.test(l), () => true)
    .when(l => /(?:password|passphrase|username|login|email)\s*:\s*$/i.test(l) || /enter passphrase/i.test(l), () => true)
    .when(l => /are you sure you want to continue connecting\s*\(yes\/no(?:\/\[fingerprint\])?\)\?\s*$/i.test(l), () => true)
    .when(l => /enter.*gpg.*passphrase/i.test(l) || /\[sudo\]\s*password\s*(?:for\s+\S+)?\s*:\s*$/i.test(l), () => true)
    .when(l => /(?:one-time password|otp|2fa|two.factor).*:\s*$/i.test(l), () => true)
    .when(l => /password for '.*?':\s*$/i.test(l), () => true)
    .when(l => /(?:enter|provide|type|input|select|choose)[ \t]+(?:your[ \t]+)?(?:name|option|value|choice|path|directory|file|url|key)[ \t]*[:>?][ \t]*$/i.test(l), () => true)
    .when(l => /(?:package name|version|description|entry point|test command|git repository|keywords|license|is this ok\?)[ \t]*[:?]?[ \t]*(?:\(.*?\))?[ \t]*[:?]?[ \t]*$/i.test(l), () => true)
    
    // Pagers
    .when(l => /more\s*\(\d+%\)/i.test(l), () => true)
    

    
    // Default
    .otherwise(() => false);
}

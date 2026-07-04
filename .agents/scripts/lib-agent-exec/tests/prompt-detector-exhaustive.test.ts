import { test, describe } from 'bun:test';
import { checkPrompt } from '../prompt-detector.js';

function runChecks(prompts: string[]) {
  const failures = [];
  for (const prompt of prompts) {
    if (!checkPrompt(prompt)) {
      failures.push(prompt);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Failed to detect prompts:\n- ` + failures.join('\n- '));
  }
}

describe('prompt-detector.ts heuristics', () => {
  test('complex inquirer.js prompts', () => {
    runChecks([
      "? Please choose an option [Use arrows to move, type to filter]",
      "? What's your project name? (my-project)",
      "? Enter your password: [hidden]",
      "? Do you want to use TypeScript? › (Y/n)",
      "✔ What is your project named? … my-app",
      "? Select your features: (Press <space> to select, <a> to toggle all, <i> to invert selection)"
    ]);
  });

  test('complex y/n prompts', () => {
    runChecks([
      "Cancel installation? [y/N/a/q] ",
      "Install package foo? (yes/No) ",
      "Do you agree to the terms? [Y/n]: ",
      "Do you want to proceed? (Y/n/?) ",
      "Would you like to install it? [Y/n] ",
      "Rewrite 'file.txt'? [y/n/a/q] "
    ]);
  });

  test('git rebase -i blocking', () => {
    runChecks([
      "hint: Waiting for your editor to close the file...",
      "Waiting for Emacs...",
      "Press Enter to continue...",
      "Press ENTER or type command to continue",
      "Hit ENTER to proceed"
    ]);
  });

  test('forced TTY flags', () => {
    runChecks([
      "bash-5.1$ ",
      "sh-5.1# ",
      "root@6b9b3e6c0f2a:/app# ",
      "PS C:\\Users\\chris> ",
      "admin@debian-server:~$ "
    ]);
  });
});



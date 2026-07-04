import { test, describe } from 'bun:test';
import { checkPrompt } from '../prompt-detector.js';

describe('prompt-detector.ts heuristics', () => {
  test('complex inquirer.js prompts', () => {
    const prompts = [
      "? Please choose an option [Use arrows to move, type to filter]",
      "? What's your project name? (my-project)",
      "? Enter your password: [hidden]",
      "? Do you want to use TypeScript? › (Y/n)",
      "✔ What is your project named? … my-app" // not a prompt actually, this is when completed. But what if it's waiting?
    ];
    for (const prompt of prompts) {
      if (!checkPrompt(prompt)) {
        throw new Error(`Failed to detect inquirer prompt: ${prompt}`);
      }
    }
  });

  test('complex y/n prompts', () => {
    const prompts = [
      "Cancel installation? [y/N/a/q] ",
      "Install package foo? (yes/No) ",
      "Do you agree to the terms? [Y/n]: ",
      "Do you want to proceed? (Y/n/?) "
    ];
    for (const prompt of prompts) {
      if (!checkPrompt(prompt)) {
        throw new Error(`Failed to detect y/n prompt: ${prompt}`);
      }
    }
  });

  test('git rebase -i blocking', () => {
    const prompts = [
      "hint: Waiting for your editor to close the file...",
      "Waiting for Emacs...",
      "Press Enter to continue..."
    ];
    for (const prompt of prompts) {
      if (!checkPrompt(prompt)) {
        throw new Error(`Failed to detect blocking prompt: ${prompt}`);
      }
    }
  });

  test('forced TTY flags', () => {
    const prompts = [
      "bash-5.1$ ",
      "sh-5.1# ",
      "root@6b9b3e6c0f2a:/app# ",
      "PS C:\\Users\\chris> "
    ];
    for (const prompt of prompts) {
      if (!checkPrompt(prompt)) {
        throw new Error(`Failed to detect TTY prompt: ${prompt}`);
      }
    }
  });
});



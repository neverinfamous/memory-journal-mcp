import { test } from 'bun:test';

function tokenizeArgs(str: string): string[] {
  const args: string[] = [];
  const regex = /("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|[^\s]+)/g;
  let match;
  while ((match = regex.exec(str)) !== null) {
    args.push(match[1]);
  }
  return args;
}

test("tokenizeArgs edge case", () => {
  const str = "jira-cli create --title 'my \\' title'";
  console.log(tokenizeArgs(str));
});



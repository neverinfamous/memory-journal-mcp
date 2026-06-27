import { Command } from 'commander';

const program = new Command();

program
  .name('test-cli')
  .description('A test CLI')
  .option('-v, --version', 'output version');

program.addHelpText('after', 'ROBOT TEXT');
program.addHelpText('before', 'BEFORE TEXT');

program.configureHelp({
    formatHelp: (cmd, helper) => {
        return "OVERRIDDEN FORMAT HELP";
    }
});

console.log(program.helpInformation());

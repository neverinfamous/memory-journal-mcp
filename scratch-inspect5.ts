import { Command } from 'commander';
const program = new Command();
program.addHelpText('after', 'TEST AFTER TEXT');
console.log(program);

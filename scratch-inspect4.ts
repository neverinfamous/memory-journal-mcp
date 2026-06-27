import { Command } from 'commander';
const program = new Command();
program.addHelpText('after', 'TEST AFTER TEXT');
console.log(Object.getOwnPropertyNames(program).filter(k => k.toLowerCase().includes('help')));

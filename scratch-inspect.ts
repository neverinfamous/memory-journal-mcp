import { Command } from 'commander';

const program = new Command();
program.addHelpText('after', 'TEST AFTER TEXT');

console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(program)).filter(m => m.toLowerCase().includes('help')));
console.log(program.helpInformation());

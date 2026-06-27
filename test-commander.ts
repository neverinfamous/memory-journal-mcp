import { Command } from 'commander';

const program = new Command();

program
  .name('test-cli')
  .description('A test CLI')
  .option('-v, --version', 'output version');

function withGroup(command: Command, groupName: string, configurer: (cmd: Command) => void): Command {
    const beforeCount = command.options.length;
    configurer(command);
    for (let i = beforeCount; i < command.options.length; i++) {
        (command.options[i] as any)._group = groupName;
    }
    return command;
}

withGroup(program, 'Database Options', (cmd) => {
    cmd.option('--db <path>', 'Database path');
    cmd.option('--team-db <path>', 'Team Database path');
});

withGroup(program, 'Network Options', (cmd) => {
    cmd.option('--port <num>', 'Port to listen on');
});

program.configureHelp({
    formatHelp: (cmd, helper) => {
        let output = '';
        
        output += `Usage: ${helper.commandUsage(cmd)}\n`;
        
        const desc = helper.commandDescription(cmd);
        if (desc) output += `\n${desc}\n`;
        
        const options = helper.visibleOptions(cmd);
        if (options.length > 0) {
            const groups = new Map<string, typeof options>();
            options.forEach(opt => {
                const groupName = (opt as any)._group || 'Core Options';
                if (!groups.has(groupName)) groups.set(groupName, []);
                groups.get(groupName)!.push(opt);
            });
            
            const padWidth = helper.padWidth(cmd, helper);
            
            for (const [groupName, groupOpts] of groups.entries()) {
                output += `\n${groupName}:\n`;
                groupOpts.forEach(opt => {
                    const term = helper.optionTerm(opt);
                    const optionDesc = helper.optionDescription(opt);
                    output += `  ${term.padEnd(padWidth)}  ${optionDesc}\n`;
                });
            }
        }
        
        return output;
    }
});

program.parse(['node', 'test', '--help']);

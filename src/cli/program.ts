import { Command, type Option } from 'commander'
import { match, P } from 'ts-pattern'
import { ZodError, type ZodType } from 'zod'
import { VERSION } from '../version.js'
const optionGroups = new WeakMap<Option, string>()
const commandAiInstructions = new WeakMap<Command, string>()

export function withGroup(command: Command, groupName: string, configurer: (cmd: Command) => void): Command {
    const beforeCount = command.options.length;
    configurer(command);
    for (let i = beforeCount; i < command.options.length; i++) {
        const opt = command.options[i]
        if (opt) optionGroups.set(opt, groupName);
    }
    return command;
}

export function addAgentInstructions(command: Command, text: string): void {
    commandAiInstructions.set(command, text);
}

export function withValidation<T, A extends unknown[]>(schema: ZodType<T>, action: (...args: A) => void | Promise<void>) {
    return async (...args: A) => {
        const command = args[args.length - 1] as Command;
        // Commander's action handler args: (arg1, arg2, ..., options, command)
        const rawOptions = args.length > 1 ? args[args.length - 2] : {};
        try {
            const validOptions = schema.parse(rawOptions);
            const newArgs = [...args];
            // Replace rawOptions with validOptions in the args array
            if (newArgs.length > 1) {
                newArgs[newArgs.length - 2] = validOptions;
            }
            await action(...(newArgs as unknown as A));
        } catch (err: unknown) {
            if (err instanceof ZodError) {
                process.stderr.write(`\x1b[31mValidation Error:\x1b[0m\n`);
                err.issues.forEach((e: { path: PropertyKey[]; message: string }) => {
                    const path = e.path.length > 0 ? e.path.map(String).join('.') + ': ' : '';
                    process.stderr.write(`  - ${path}${e.message}\n`);
                });
                process.stderr.write('\n');
                command.help({ error: true });
            } else {
                throw err;
            }
        }
    }
}

export function createProgram(): Command {
    const program = new Command()

    program
        .name('memory-journal-mcp')
        .description('Project context management for AI-assisted development')
        .version(VERSION)
        .configureOutput({
            // Ensure error messages strictly go to stderr to maintain stdout discipline
            writeErr: (str) => process.stderr.write(str),
            outputError: (str, write) => write(`\x1b[31mError:\x1b[0m ${str}`)
        })

    program.configureHelp({
        formatHelp: (cmd, helper) => {
            // Check for JSON help mode
            const isJsonHelp = process.argv.includes('--json') || process.argv.includes('--json=true');
            if (isJsonHelp) {
                const envelope = {
                    status: 'success',
                    data: {
                        name: cmd.name(),
                        description: helper.commandDescription(cmd),
                        usage: helper.commandUsage(cmd),
                        commands: helper.visibleCommands(cmd).map(c => ({
                            term: helper.subcommandTerm(c),
                            description: helper.subcommandDescription(c)
                        })),
                        options: helper.visibleOptions(cmd).map(opt => ({
                            term: helper.optionTerm(opt),
                            description: helper.optionDescription(opt),
                            group: match([optionGroups.get(opt), opt.name()])
                                .with([P.string, P._], ([name]) => name)
                                .with([P.nullish, P.union('help', 'version')], () => 'Standard Options')
                                .with([P.nullish, P._], () => 'Command Options')
                                .exhaustive()
                        })),
                        arguments: helper.visibleArguments(cmd).map(arg => ({
                            term: helper.argumentTerm(arg),
                            description: helper.argumentDescription(arg)
                        })),
                        aiInstructions: commandAiInstructions.get(cmd) || null
                    },
                    timestamp: new Date().toISOString()
                }
                return JSON.stringify(envelope) + '\n';
            }

            let output = '';
            
            output += `Usage: ${helper.commandUsage(cmd)}\n`;
            
            const desc = helper.commandDescription(cmd);
            if (desc) output += `\n${desc}\n`;
            
            const args = helper.visibleArguments(cmd);
            if (args.length > 0) {
                output += '\nArguments:\n';
                args.forEach(arg => {
                    const term = helper.argumentTerm(arg);
                    const argumentDesc = helper.argumentDescription(arg);
                    output += `  ${term.padEnd(helper.padWidth(cmd, helper))}  ${argumentDesc}\n`;
                });
            }
            
            const options = helper.visibleOptions(cmd);
            if (options.length > 0) {
                const groups = new Map<string, typeof options>();
                options.forEach(opt => {
                    const groupName = match([optionGroups.get(opt), opt.name()])
                        .with([P.string, P._], ([name]) => name)
                        .with([P.nullish, P.union('help', 'version')], () => 'Standard Options')
                        .with([P.nullish, P._], () => 'Command Options')
                        .exhaustive();

                    if (!groups.has(groupName)) groups.set(groupName, []);
                    const group = groups.get(groupName);
                    if (group) group.push(opt);
                });
                
                const padWidth = helper.padWidth(cmd, helper);
                
                // Ensure Standard Options always prints last
                const standardOptions = groups.get('Standard Options');
                groups.delete('Standard Options');

                for (const [groupName, groupOpts] of groups.entries()) {
                    output += `\n${groupName}:\n`;
                    groupOpts.forEach(opt => {
                        const term = helper.optionTerm(opt);
                        const optionDesc = helper.optionDescription(opt);
                        output += `  ${term.padEnd(padWidth)}  ${optionDesc}\n`;
                    });
                }

                if (standardOptions) {
                    output += `\nStandard Options:\n`;
                    standardOptions.forEach(opt => {
                        const term = helper.optionTerm(opt);
                        const optionDesc = helper.optionDescription(opt);
                        output += `  ${term.padEnd(padWidth)}  ${optionDesc}\n`;
                    });
                }
            }

            const commands = helper.visibleCommands(cmd);
            if (commands.length > 0) {
                output += '\nCommands:\n';
                commands.forEach(c => {
                    const term = helper.subcommandTerm(c);
                    const subcommandDesc = helper.subcommandDescription(c);
                    output += `  ${term.padEnd(helper.padWidth(cmd, helper))}  ${subcommandDesc}\n`;
                });
            }
            
            const aiInstructions = commandAiInstructions.get(cmd);
            if (aiInstructions) {
                output += `\n${aiInstructions}\n`;
            }

            return output;
        }
    });

    return program
}
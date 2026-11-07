import { Command, type Help, type Option } from 'commander'
import { match, P } from 'ts-pattern'
import { ZodError, type ZodType } from 'zod'
import { VERSION } from '../version.js'
import { logAgentIssue } from '../utils/issue-logger.js'
const optionGroups = new WeakMap<Option, string>()
const commandAiInstructions = new WeakMap<Command, string>()

interface CommandHelpJson {
    name: string
    description: string
    usage: string
    commands: CommandHelpJson[]
    options: { term: string; description: string; group: string }[]
    arguments: { term: string; description: string }[]
    aiInstructions: string[] | null
}

function resolveOptionGroupName(opt: Option): string {
    return match([optionGroups.get(opt), opt.name()])
        .with([P.string, P._], ([name]) => name)
        .with([P.nullish, P.union('help', 'version')], () => 'Standard Options')
        .with([P.nullish, P._], () => 'Command Options')
        .exhaustive()
}

function buildCommandTree(c: Command, helper: Help): CommandHelpJson {
    const rawAiInstructions = commandAiInstructions.get(c)
    const cleanedAiInstructions = rawAiInstructions
        ? rawAiInstructions
              .replace(/^\n*🤖 AI AGENT INSTRUCTIONS:\n*/, '')
              .split('\n')
              .map((s) => s.trim().replace(/^- /, ''))
              .filter(Boolean)
        : null

    return {
        name: c.name(),
        description: helper.commandDescription(c),
        usage: helper.commandUsage(c),
        commands: helper.visibleCommands(c).map((subCmd) => buildCommandTree(subCmd, helper)),
        options: helper.visibleOptions(c).map((opt) => ({
            term: helper.optionTerm(opt),
            description: helper.optionDescription(opt),
            group: resolveOptionGroupName(opt),
        })),
        arguments: helper.visibleArguments(c).map((arg) => ({
            term: helper.argumentTerm(arg),
            description: helper.argumentDescription(arg),
        })),
        aiInstructions: cleanedAiInstructions,
    }
}

function formatTextHelp(cmd: Command, helper: Help): string {
    let output = `Usage: ${helper.commandUsage(cmd)}\n`

    const desc = helper.commandDescription(cmd)
    if (desc) output += `\n${desc}\n`

    const args = helper.visibleArguments(cmd)
    if (args.length > 0) {
        output += '\nArguments:\n'
        args.forEach((arg) => {
            const term = helper.argumentTerm(arg)
            const argumentDesc = helper.argumentDescription(arg)
            output += `  ${term.padEnd(helper.padWidth(cmd, helper))}  ${argumentDesc}\n`
        })
    }

    const options = helper.visibleOptions(cmd)
    if (options.length > 0) {
        const groups = new Map<string, typeof options>()
        options.forEach((opt) => {
            const groupName = resolveOptionGroupName(opt)
            if (!groups.has(groupName)) groups.set(groupName, [])
            const group = groups.get(groupName)
            if (group) group.push(opt)
        })

        const padWidth = helper.padWidth(cmd, helper)
        const standardOptions = groups.get('Standard Options')
        groups.delete('Standard Options')

        for (const [groupName, groupOpts] of groups.entries()) {
            output += `\n${groupName}:\n`
            groupOpts.forEach((opt) => {
                output += `  ${helper.optionTerm(opt).padEnd(padWidth)}  ${helper.optionDescription(opt)}\n`
            })
        }

        if (standardOptions) {
            output += `\nStandard Options:\n`
            standardOptions.forEach((opt) => {
                output += `  ${helper.optionTerm(opt).padEnd(padWidth)}  ${helper.optionDescription(opt)}\n`
            })
        }
    }

    const commands = helper.visibleCommands(cmd)
    if (commands.length > 0) {
        output += '\nCommands:\n'
        commands.forEach((c) => {
            const term = helper.subcommandTerm(c)
            const subcommandDesc = helper.subcommandDescription(c)
            output += `  ${term.padEnd(helper.padWidth(cmd, helper))}  ${subcommandDesc}\n`
        })
    }

    const aiInstructions = commandAiInstructions.get(cmd)
    if (aiInstructions) {
        output += `\n${aiInstructions}\n`
    }

    return output
}

function formatProgramHelp(cmd: Command, helper: Help): string {
    const isJsonHelp = process.argv.includes('--json') || process.argv.includes('--json=true')
    if (isJsonHelp) {
        return (
            JSON.stringify({
                status: 'success',
                data: buildCommandTree(cmd, helper),
                timestamp: new Date().toISOString(),
            }) + '\n'
        )
    }
    return formatTextHelp(cmd, helper)
}

/** Auto-heal snake_case flag names to kebab-case while preserving flag values and post-'--' arguments. */
export function normalizeCliArgv(argv: readonly string[]): string[] {
    let pastDoubleDash = false
    return argv.map((arg) => {
        if (arg === '--') {
            pastDoubleDash = true
            return arg
        }
        if (!pastDoubleDash && arg.startsWith('--') && arg.includes('_')) {
            const eqIdx = arg.indexOf('=')
            if (eqIdx === -1) return arg.replace(/_/g, '-')
            return arg.slice(0, eqIdx).replace(/_/g, '-') + arg.slice(eqIdx)
        }
        return arg
    })
}

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
                const errorMessages = err.issues.map((e: { path: PropertyKey[]; message: string }) => {
                    const path = e.path.length > 0 ? e.path.map(String).join('.') + ': ' : '';
                    return `${path}${e.message}`;
                }).join('; ');

                logAgentIssue({
                    source: 'CLI',
                    action: command.name(),
                    input: rawOptions,
                    error: `Validation Error: ${errorMessages}`
                });

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
            outputError: (str, write) => {
                logAgentIssue({
                    source: 'CLI',
                    action: 'commander-parsing',
                    input: process.argv.slice(2),
                    error: str.trim()
                });

                if (str.includes('unknown option')) {
                    write(`\x1b[31mError:\x1b[0m 🛠️ AUTONOMOUS HEALING: CLI parsing failed. Read the error below and fix your flags immediately.\n${str}`)
                } else {
                    write(`\x1b[31mError:\x1b[0m 🛠️ AUTONOMOUS HEALING: ${str}`)
                }
            }
        })

    program.configureHelp({
        formatHelp: formatProgramHelp,
    })

    return program
}
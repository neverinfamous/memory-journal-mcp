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
    const options = helper.visibleOptions(cmd)
    const commands = helper.visibleCommands(cmd)
    const padWidth =
        args.length > 0 || options.length > 0 || commands.length > 0
            ? helper.padWidth(cmd, helper)
            : 0

    if (args.length > 0) {
        output += '\nArguments:\n'
        args.forEach((arg) => {
            const term = helper.argumentTerm(arg)
            const argumentDesc = helper.argumentDescription(arg)
            output += `  ${term.padEnd(padWidth)}  ${argumentDesc}\n`
        })
    }

    if (options.length > 0) {
        const groups = new Map<string, typeof options>()
        options.forEach((opt) => {
            const groupName = resolveOptionGroupName(opt)
            if (!groups.has(groupName)) groups.set(groupName, [])
            const group = groups.get(groupName)
            if (group) group.push(opt)
        })

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

    if (commands.length > 0) {
        output += '\nCommands:\n'
        commands.forEach((c) => {
            const term = helper.subcommandTerm(c)
            const subcommandDesc = helper.subcommandDescription(c)
            output += `  ${term.padEnd(padWidth)}  ${subcommandDesc}\n`
        })
    }

    const aiInstructions = commandAiInstructions.get(cmd)
    if (aiInstructions) {
        output += `\n${aiInstructions}\n`
    }

    return output
}

function resolveJsonHelpFlag(argv: readonly string[], rootProgram: Command): boolean {
    const valueFlags = collectValueTakingFlags(argv, rootProgram)
    let isJsonHelp = false
    let expectValue = false
    for (let i = 2; i < argv.length; i++) {
        const tok = argv[i]
        if (tok === undefined) break
        if (expectValue) { expectValue = false; continue }
        if (tok === '--') break
        if (tok.startsWith('--')) {
            const eqIdx = tok.indexOf('=')
            const rawFlag = eqIdx === -1 ? tok : tok.slice(0, eqIdx)
            const normFlag = rawFlag.replace(/_/g, '-')
            if (eqIdx === -1 && valueFlags.has(normFlag)) { expectValue = true; continue }
            if (normFlag === '--no-json') isJsonHelp = false
            else if (normFlag === '--json') {
                const rhs = eqIdx === -1 ? 'true' : tok.slice(eqIdx + 1).toLowerCase()
                if (rhs === 'true') isJsonHelp = true
                else if (rhs === 'false') isJsonHelp = false
            }
            continue
        }
        if (/^-[^-]$/.test(tok) && valueFlags.has(tok)) expectValue = true
    }
    return isJsonHelp
}

function formatProgramHelp(cmd: Command, helper: Help): string {
    let root: Command = cmd
    while (root.parent !== null) root = root.parent
    const isJsonHelp = resolveJsonHelpFlag(process.argv, root)
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

const FALLBACK_VALUE_FLAGS = new Set([
    '--query',
    '-q',
    '--content',
    '-c',
    '--type',
    '-t',
    '--tags',
    '--workspace',
    '--workspace-id',
    '--target-workspace',
    '--project-number',
    '--project',
    '--session-id',
    '--msg',
    '--name',
    '--config',
    '--db',
    '--team-db',
    '--transport',
    '--host',
    '--port',
])

const COMMIT_VALUE_FLAGS = [
    '--msg',
    '-m',
    '--message',
    '--history',
    '--history-file',
    '--impact',
    '--trust',
    '--confidence',
    '--validation',
    '--significance',
    '--category',
    '--cwd',
    '--add',
    '--journal-project',
    '--session-id',
    '--tags',
    '--tag',
    '--relate',
] as const

function getDefaultSubcommand(cmd: Command): Command | undefined {
    const desc = Object.getOwnPropertyDescriptor(cmd, '_defaultCommandName')
    const defaultName = typeof desc?.value === 'string' ? desc.value : undefined
    if (defaultName === undefined) return undefined
    return cmd.commands.find((c) => c.name() === defaultName)
}

function addCommandValueFlags(cmd: Command, targetSet: Set<string>): void {
    for (const opt of cmd.options) {
        if (opt.required || opt.optional) {
            if (opt.short !== undefined) targetSet.add(opt.short)
            if (opt.long !== undefined) targetSet.add(opt.long)
        }
    }
}

function collectValueTakingFlags(argv: readonly string[], rootProgram?: Command): Set<string> {
    if (rootProgram === undefined) return FALLBACK_VALUE_FLAGS
    const flags = new Set<string>()
    const defaultFlags = new Set<string>()
    let currentCmd: Command = rootProgram
    addCommandValueFlags(currentCmd, flags)
    const refreshDefaultFlags = (cmd: Command): void => {
        defaultFlags.clear()
        const def = getDefaultSubcommand(cmd)
        if (def !== undefined) addCommandValueFlags(def, defaultFlags)
    }
    refreshDefaultFlags(currentCmd)

    let expectValue = false
    for (let i = 2; i < argv.length; i++) {
        const tok = argv[i]
        if (tok === undefined) break
        if (expectValue) {
            expectValue = false
            continue
        }
        if (tok === '--') break
        if (tok.startsWith('-')) {
            const eqIdx = tok.indexOf('=')
            const rawFlag = eqIdx === -1 ? tok : tok.slice(0, eqIdx)
            const normFlag = rawFlag.startsWith('--') ? rawFlag.replace(/_/g, '-') : rawFlag
            if (eqIdx === -1 && (flags.has(normFlag) || defaultFlags.has(normFlag))) {
                expectValue = true
            }
            continue
        }
        const sub = currentCmd.commands.find(
            (c) => c.name() === tok || c.aliases().includes(tok)
        )
        if (sub !== undefined) {
            currentCmd = sub
            addCommandValueFlags(currentCmd, flags)
            if (sub.name() === 'commit') {
                for (const f of COMMIT_VALUE_FLAGS) flags.add(f)
            }
            refreshDefaultFlags(currentCmd)
        }
    }
    for (const f of defaultFlags) flags.add(f)
    return flags
}

/** Auto-heal snake_case flag names to kebab-case while preserving flag values and post-'--' arguments. */
export function normalizeCliArgv(argv: readonly string[], rootProgram?: Command): string[] {
    const valueFlags = collectValueTakingFlags(argv, rootProgram)
    let pastDoubleDash = false
    let expectValue = false
    return argv.map((arg) => {
        if (pastDoubleDash) return arg
        if (expectValue) {
            expectValue = false
            return arg
        }
        if (arg === '--') {
            pastDoubleDash = true
            return arg
        }
        if (arg.startsWith('--')) {
            const eqIdx = arg.indexOf('=')
            const normalizedFlag =
                eqIdx === -1 ? arg.replace(/_/g, '-') : arg.slice(0, eqIdx).replace(/_/g, '-')
            if (eqIdx === -1 && valueFlags.has(normalizedFlag)) {
                expectValue = true
            }
            return eqIdx === -1 ? normalizedFlag : normalizedFlag + arg.slice(eqIdx)
        }
        if (/^-[^-]$/.test(arg) && valueFlags.has(arg)) {
            expectValue = true
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

function mergeGlobalJsonOption(command: Command, rawOptions: unknown): unknown {
    if (
        command.name() === 'serve' ||
        rawOptions === null ||
        typeof rawOptions !== 'object' ||
        Array.isArray(rawOptions)
    ) {
        return rawOptions;
    }
    const acceptsJson = command.options.some((opt) => opt.attributeName() === 'json');
    if (!acceptsJson || typeof command.optsWithGlobals !== 'function') {
        return rawOptions;
    }
    const globals = command.optsWithGlobals<{ json?: unknown }>();
    if (globals.json !== true || ('json' in rawOptions && rawOptions.json !== undefined)) {
        return rawOptions;
    }
    return { ...rawOptions, json: true };
}

type CliValidationAction = {
    run(...args: unknown[]): void | Promise<void>
}['run']

export function withValidation<T>(
    schema: ZodType<T>,
    action: CliValidationAction
): (...args: unknown[]) => Promise<void> {
    return async (...args: unknown[]) => {
        const rawCommand = args[args.length - 1];
        if (!(rawCommand instanceof Command)) {
            throw new TypeError('withValidation expected a Commander Command as the final argument');
        }
        const command = rawCommand;
        // Commander's action handler args: (arg1, arg2, ..., options, command)
        const rawOptions = args.length > 1 ? args[args.length - 2] : {};
        const effectiveRawOptions = mergeGlobalJsonOption(command, rawOptions);
        try {
            const validOptions = schema.parse(effectiveRawOptions);
            const newArgs = [...args];
            // Replace rawOptions with validOptions in the args array
            if (newArgs.length > 1) {
                newArgs[newArgs.length - 2] = validOptions;
            }
            await action(...newArgs);
        } catch (err: unknown) {
            if (err instanceof ZodError) {
                const errorMessages = err.issues.map((e: { path: PropertyKey[]; message: string }) => {
                    const path = e.path.length > 0 ? e.path.map(String).join('.') + ': ' : '';
                    return `${path}${e.message}`;
                }).join('; ');

                logAgentIssue({
                    source: 'CLI',
                    action: command.name(),
                    input: effectiveRawOptions,
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